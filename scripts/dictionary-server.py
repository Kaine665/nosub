#!/usr/bin/env python3
"""
nosub 词典后端 API —— 保证每个单词返回标准结构。

启动: python3 dictionary-server.py --port 8899
API:  GET /api/word/en/{word}   → EN 释义 + 例句 + 音标
      GET /api/word/zh/{word}   → ZH 翻译
      GET /api/audio/{word}?accent=uk|us → 发音音频
      GET /api/health           → health check

数据源: Wiktionary 1.35M 词 + Tatoeba 索引 + Youdao 发音兜底
"""
import json, os, re, http.server, argparse
from urllib.parse import urlparse, unquote, parse_qs
from urllib.request import Request, urlopen

# ==================== 加载数据 ====================

print("Loading data...")

with open("dict-en.json") as f:
    EN_DICT = json.load(f)
print(f"  EN dict: {len(EN_DICT):,} words")

EXAMPLES = {}
if os.path.exists("eng_sentences.tsv"):
    with open("eng_sentences.tsv", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) < 3: continue
            text = parts[2]
            if len(text) > 100: continue
            for w in set(re.findall(r"[a-z]+", text.lower())):
                if w not in EXAMPLES: EXAMPLES[w] = []
                if len(EXAMPLES[w]) < 3 and text not in EXAMPLES[w]:
                    EXAMPLES[w].append(text)
    print(f"  Examples: {len(EXAMPLES):,} words indexed")

ZH_DICT = {}
if os.path.exists("dict-zh.json"):
    with open("dict-zh.json") as f:
        ZH_DICT = json.load(f)
    print(f"  ZH dict: {len(ZH_DICT):,} words")


def prefer_simplified(text: str) -> str:
    """Wiktionary 常给「繁體 /简体」——取斜线后的简体侧。"""
    if not text:
        return text
    parts = re.split(r"\s*/\s*", text.strip())
    if len(parts) >= 2 and parts[-1].strip():
        return parts[-1].strip()
    return text.strip()


def get_word(word, lang):
    """返回标准格式的单词数据"""
    word = word.lower().strip()

    if lang == "zh":
        entry = ZH_DICT.get(word)
        if entry:
            defs = entry.get("c", entry.get("d", []))[:8]
            return {
                "word": word,
                "pos": entry.get("p", ""),
                "defs": [prefer_simplified(d) for d in defs],
                "examples": (entry.get("e") or EXAMPLES.get(word, []))[:3],
                "ipa": entry.get("i", ""),
            }
        # 找不到 → Google Translate 兜底
        cn = translate_to_cn(word)
        if cn:
            return {
                "word": word,
                "pos": "",
                "defs": [cn],
                "examples": EXAMPLES.get(word, [])[:3],
                "ipa": "",
            }
        return None

    # EN
    entry = EN_DICT.get(word)
    if not entry:
        return None

    defs = entry.get("d", [])
    examples = entry.get("e") or EXAMPLES.get(word, [])
    ipa = entry.get("i", "")

    # 如果没有 IPA, 从在线 API 补
    if not ipa:
        ipa = get_ipa_online(word)

    return {
        "word": word,
        "pos": entry.get("p", ""),
        "defs": defs[:8],
        "examples": examples[:3],
        "ipa": ipa,
    }


def translate_to_cn(word):
    """Google Translate 英→中"""
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q={word}"
        r = urlopen(Request(url, headers={"User-Agent": "nosub-server"}), timeout=3)
        data = json.loads(r.read())
        return "".join(x[0] for x in (data[0] or []) if isinstance(x, list) and x)
    except Exception:
        return None


def get_ipa_online(word):
    """从 Free Dictionary API 获取 IPA"""
    try:
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        r = urlopen(Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 nosub-dict",
        }), timeout=3)
        data = json.loads(r.read())
        return data[0].get("phonetic", "")
    except Exception:
        return ""


def fetch_bytes(url, timeout=6):
    r = urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0 nosub-dict"}), timeout=timeout)
    return r.read(), r.headers.get("Content-Type", "audio/mpeg")


def proxy_audio(word, accent="us"):
    """
    发音链路:
      1) Google Translate TTS (en-GB / en-US)
      2) Free Dictionary API → 按 UK/US 选音频
      3) Youdao dictvoice 兜底 (type=1 UK, type=2 US)
    """
    accent = "uk" if accent == "uk" else "us"

    # 1) Google Translate TTS
    try:
        tl = "en-GB" if accent == "uk" else "en-US"
        gurl = (
            "https://translate.googleapis.com/translate_tts"
            f"?ie=UTF-8&client=gtx&tl={tl}&q={word}"
        )
        return fetch_bytes(gurl)
    except Exception:
        pass

    # 2) Free Dictionary
    try:
        ua = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 nosub-dict"}
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        r = urlopen(Request(url, headers=ua), timeout=4)
        data = json.loads(r.read())
        phonetics = data[0].get("phonetics", []) or []
        preferred, others = [], []
        for p in phonetics:
            audio_url = (p.get("audio") or "").strip()
            if not audio_url:
                continue
            tag = audio_url.lower()
            if accent == "uk" and ("-uk" in tag or "_uk" in tag):
                preferred.append(audio_url)
            elif accent == "us" and ("-us" in tag or "_us" in tag):
                preferred.append(audio_url)
            else:
                others.append(audio_url)
        for audio_url in preferred + others:
            try:
                return fetch_bytes(audio_url)
            except Exception:
                continue
    except Exception:
        pass

    # 3) Youdao TTS 兜底
    try:
        ytype = 1 if accent == "uk" else 2
        yurl = f"https://dict.youdao.com/dictvoice?audio={word}&type={ytype}"
        return fetch_bytes(yurl)
    except Exception:
        pass

    return None, None


# ==================== HTTP Server ====================

class DictHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = path.strip("/").split("/")
        qs = parse_qs(parsed.query)

        if path == "/api/health":
            return self.json(200, {"ok": True, "en_words": len(EN_DICT)})

        # GET /api/audio/{word}?accent=uk|us
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "audio":
            word = unquote(parts[2]).lower().strip()
            accent = (qs.get("accent") or ["us"])[0].lower()
            audio_data, ct = proxy_audio(word, accent)
            if audio_data:
                self.send_response(200)
                self.send_header("Content-Type", ct or "audio/mpeg")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(audio_data)
            else:
                self.json(404, {"error": "no audio", "word": word})
            return

        if len(parts) == 4 and parts[0] == "api" and parts[1] == "word":
            lang = parts[2]
            word = unquote(parts[3])
            result = get_word(word, lang)

            if result:
                self.json(200, result)
            else:
                self.json(404, {"error": "not found", "word": word})
            return

        self.json(200, {
            "usage": "GET /api/word/{lang}/{word}",
            "audio": "GET /api/audio/{word}?accent=uk|us",
            "health": "GET /api/health",
        })

    def json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def log_message(self, format, *args):
        pass  # 安静模式


class DictionaryHTTPServer(http.server.ThreadingHTTPServer):
    """Keep one slow or abandoned client from blocking every dictionary lookup."""

    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128

    def get_request(self):
        request, client_address = super().get_request()
        request.settimeout(10)
        return request, client_address


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8899)
    args = p.parse_args()

    print(f"\n🚀 nosub dict server on {args.host}:{args.port}")
    print(f"   EN: GET /api/word/en/matter")
    print(f"   ZH: GET /api/word/zh/matter")
    print(f"   Audio: GET /api/audio/matter?accent=us")
    DictionaryHTTPServer((args.host, args.port), DictHandler).serve_forever()
