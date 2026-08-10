#!/usr/bin/env python3
"""
中文释义质量抽检关卡：10 → 20 → 50 → 100。
任一关失败即停止，打印不合格样本。

用法:
  python scripts/qa-zh-dict-gates.py
  python scripts/qa-zh-dict-gates.py --gate 10
"""
from __future__ import annotations

import argparse
import json
import re
import ssl
import urllib.parse
import urllib.request
from pathlib import Path

CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 nosub-qa", "Accept": "application/json"}

# ---- 与 src/assistance/zh-gloss-quality.ts 对齐的规则 ----
T2S_KEYS = set("開關雖體爲為時會過來對動學書見說話語國後當發個種經點這還無與則際難題兒兩麼氣線總專導轉車運萬東邊達選遠遠連愛變單義樂機沒聽員戰據業價務區協參實應樣從給結網裡處號長門間頭風飛電魚鳥馬畫讀寫論於並稱類該須顯觀預頁項頻顏願裏餘併")
CANTONESE = re.compile(r"[啲嘢咗嘅冇係唔哋佢攞嚟嗰噉咁乜睇𠶧]")
LATIN_WORD = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñÄÖÜäöüß]{3,}")
HAN = re.compile(r"[\u4e00-\u9fff]")

POS_CANON = {
    "n": "n", "noun": "n", "n.": "n", "名": "n", "名词": "n",
    "v": "v", "verb": "v", "v.": "v", "动": "v", "动词": "v",
    "adj": "adj", "adjective": "adj", "adj.": "adj", "形": "adj", "形容词": "adj",
    "adv": "adv", "adverb": "adv", "adv.": "adv", "副": "adv", "副词": "adv",
    "prep": "prep", "preposition": "prep", "prep.": "prep", "介": "prep", "介词": "prep",
    "conj": "conj", "conjunction": "conj", "conj.": "conj", "连": "conj", "连词": "conj",
    "pron": "pron", "pronoun": "pron", "pron.": "pron", "代": "pron", "代词": "pron",
    "det": "det", "determiner": "det", "det.": "det",
    "int": "int", "interjection": "int", "int.": "int",
}


def strip_noise(text: str) -> str:
    # 短括号（不）/（没有）是义项一部分：整条丢弃，避免「一点儿都」残句
    if re.search(r"[（(][^）)]{0,4}[）)]", text):
        return ""
    text = re.sub(r"（[^）]*）", "", text)
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"<[^>]*>", "", text)
    text = re.sub(r"【[^】]*】", "", text)
    return re.sub(r"\s+", "", text).strip()


def prefer_simplified_side(text: str) -> str:
    parts = re.split(r"\s*/\s*", text.strip())
    return parts[-1].strip() if len(parts) >= 2 else text.strip()


def is_clean_zh_atom(raw: str) -> bool:
    s = strip_noise(prefer_simplified_side(raw))
    if not s or len(s) > 10:
        return False
    if not HAN.search(s):
        return False
    if CANTONESE.search(s):
        return False
    if LATIN_WORD.search(s):
        return False
    if any(c in T2S_KEYS for c in s):
        return False
    if re.search(r"[。！？?…]", s):
        return False
    if re.match(r"^(想来|表示|用于|指|形容|说明)", s):
        return False
    hans = sum(1 for c in s if HAN.match(c))
    return hans >= max(1, (len(s) + 1) // 2)


def split_atoms(text: str) -> list[str]:
    cleaned = strip_noise(prefer_simplified_side(text)).replace("，", ",")
    atoms = []
    for chunk in re.split(r"[;；]", cleaned):
        for piece in re.split(r"[、]", chunk):
            p = piece.strip()
            if p and is_clean_zh_atom(p):
                atoms.append(p)
    return atoms


def canon_pos(raw: str) -> str:
    key = raw.strip().lower().replace(" ", "")
    return POS_CANON.get(key) or POS_CANON.get(key.rstrip(".")) or "x"


def build_lines(items: list[dict]) -> list[dict]:
    buckets: dict[str, list[str]] = {}
    for item in items:
        pos = canon_pos(item.get("pos") or "")
        for atom in split_atoms(item.get("definition") or ""):
            lst = buckets.setdefault(pos, [])
            if atom in lst:
                continue
            if any(atom in x or x in atom for x in lst):
                continue
            lst.append(atom)
    order = ["prep", "adv", "adj", "v", "n", "pron", "det", "conj", "int", "x"]
    has_tagged = any((buckets.get(p) or []) for p in order if p != "x")
    lines = []
    for pos in order:
        if pos == "x" and has_tagged:
            continue
        senses = buckets.get(pos) or []
        if not senses:
            continue
        text = ";".join(senses[:5])
        if all(is_clean_zh_atom(a) for a in text.split(";")):
            lines.append({"pos": "" if pos == "x" else pos, "text": text})
        if len(lines) >= 4:
            break
    return lines


def http_json(url: str, timeout: float = 6):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def fetch_iciba(word: str) -> list[dict]:
    url = (
        "https://dict-mobile.iciba.com/interface/index.php?"
        f"c=word&m=getsuggest&nums=1&is_need_mean=1&word={urllib.parse.quote(word)}"
    )
    data = http_json(url)
    raw = []
    for item in data.get("message") or []:
        for mean in item.get("means") or []:
            pos = mean.get("part") or ""
            for m in mean.get("means") or []:
                if str(m).strip():
                    raw.append({"pos": pos, "definition": str(m).strip()})
    return raw


def fetch_youdao(word: str) -> list[dict]:
    url = "https://dict.youdao.com/jsonapi?" + urllib.parse.urlencode({"q": word, "le": "en"})
    data = http_json(url)
    raw = []
    for w in ((data.get("ec") or {}).get("word") or []):
        for trs in w.get("trs") or []:
            pos = trs.get("pos") or ""
            for tr in trs.get("tr") or []:
                i = (tr.get("l") or {}).get("i")
                text = "".join(i) if isinstance(i, list) else (i or "")
                if text.strip():
                    raw.append({"pos": pos, "definition": text.strip()})
    return raw


def fetch_google(word: str) -> list[dict]:
    url = (
        "https://translate.googleapis.com/translate_a/single?"
        + urllib.parse.urlencode({"client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": word})
    )
    data = http_json(url)
    text = "".join(x[0] for x in (data[0] or []) if isinstance(x, list) and x)
    return [{"pos": "", "definition": text}] if text else []


def lookup(word: str) -> tuple[str, list[dict]]:
    """按产品路由：iciba → youdao → google"""
    for name, fn in (("iciba", fetch_iciba), ("youdao", fetch_youdao), ("google", fetch_google)):
        try:
            raw = fn(word)
            lines = build_lines(raw)
            if lines:
                return name, lines
        except Exception:
            continue
    return "none", []


# 关卡词表：含历史上出过错的词 + 常用词
POOL = [
    # gate 问题词
    "though", "something", "anyway", "however", "whatever", "nevertheless",
    "although", "therefore", "meanwhile", "because",
    # 常用
    "matter", "about", "through", "against", "between", "without", "within",
    "already", "always", "almost", "enough", "rather", "quite", "perhaps",
    "whether", "unless", "until", "while", "since", "during", "before",
    "after", "under", "over", "above", "below", "across", "around",
    "people", "world", "time", "year", "way", "day", "man", "woman",
    "child", "life", "hand", "part", "place", "case", "week", "company",
    "system", "program", "question", "work", "government", "number",
    "night", "point", "home", "water", "room", "mother", "area", "money",
    "story", "fact", "month", "lot", "right", "study", "book", "eye",
    "job", "word", "business", "issue", "side", "kind", "head", "house",
    "service", "friend", "father", "power", "hour", "game", "line", "end",
    "member", "law", "car", "city", "name", "team", "idea", "body",
    "information", "back", "parent", "face", "others", "level", "office",
    "door", "health", "person", "art", "war", "history", "party", "result",
    "change", "morning", "reason", "research", "girl", "guy", "moment",
    "air", "teacher", "force", "education",
]


def run_gate(n: int) -> bool:
    words = POOL[:n]
    print(f"\n===== GATE {n} ({len(words)} words) =====")
    fails = []
    sources = {}
    for w in words:
        src, lines = lookup(w)
        sources[src] = sources.get(src, 0) + 1
        if not lines:
            fails.append((w, src, "NO_CLEAN_GLOSS"))
            print(f"  FAIL {w:14} [{src}] empty after quality gate")
            continue
        # 额外硬性检查整行
        bad = False
        for line in lines:
            text = line["text"]
            if CANTONESE.search(text) or any(c in T2S_KEYS for c in text) or LATIN_WORD.search(text):
                fails.append((w, src, text))
                print(f"  FAIL {w:14} [{src}] dirty: {line['pos']} {text}")
                bad = True
                break
        if not bad:
            preview = " | ".join(f"{l['pos']} {l['text']}".strip() for l in lines)
            print(f"  OK   {w:14} [{src}] {preview}")

    print(f"sources: {sources}")
    print(f"result: {len(words) - len(fails)}/{len(words)} pass, {len(fails)} fail")
    return len(fails) == 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", type=int, choices=[10, 20, 50, 100], help="只跑某一关")
    args = ap.parse_args()
    gates = [args.gate] if args.gate else [10, 20, 50, 100]
    for g in gates:
        ok = run_gate(g)
        if not ok:
            print(f"\nGATE {g} FAILED — stop")
            raise SystemExit(1)
        print(f"\nGATE {g} PASSED")
    print("\nALL GATES PASSED")


if __name__ == "__main__":
    main()
