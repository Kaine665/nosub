#!/usr/bin/env python3
"""
nosub 高质量词典构建脚本 — Wiktionary 数据源。

数据源: kaikki.org (预解析的 Wiktionary JSON, 更新及时)
        格式: https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.json

用法:
    python scripts/build-dict-wiktionary.py [target_lang]

产物:
    public/dict-{lang}.json  (~5-15MB per language, JSON格式)

示例:
    python scripts/build-dict-wiktionary.py zh    # 英→中词典
    python scripts/build-dict-wiktionary.py ja    # 英→日词典
    python scripts/build-dict-wiktionary.py en    # 英→英词典(只用英文释义)

特点:
    - 含词性、释义、中文翻译、例句、音标
    - 只保留有中文翻译的词条(大幅压缩体积)
    - 去重+压缩格式
"""

import json
import sys
import io
import re
import time
import gzip
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

# ---- 配置 ----
OUTPUT = Path(__file__).parent.parent / "public" / "dict-{lang}.json"
SOURCE_URL = "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl"

# 多镜像
SOURCES = [
    "https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl",
]

CHUNK_SIZE = 10_000  # 流式处理, 每1万条打印进度


def fetch_stream(url: str):
    """流式下载+流式解析 JSON Lines 格式(每行一个 JSON 对象, gzip压缩)"""
    print(f"下载: {url}")
    req = Request(url, headers={"User-Agent": "nosub-dict-builder/2.0", "Accept-Encoding": "gzip"})
    try:
        resp = urlopen(req, timeout=120)
    except URLError as e:
        print(f"  ✗ 下载失败: {e}")
        raise

    content_length = resp.headers.get("Content-Length")
    total_bytes = int(content_length) if content_length else None
    if total_bytes:
        print(f"  压缩文件大小: {total_bytes / 1024 / 1024:.0f} MB")

    # kaikki.org 返回 JSON Lines (每行一个 JSON)
    encoding = resp.headers.get("Content-Encoding", "")
    if "gzip" in encoding:
        fh = gzip.GzipFile(fileobj=resp)
    else:
        fh = resp

    reader = io.TextIOWrapper(fh, encoding="utf-8")
    count = 0
    last_pct = -1
    for line in reader:
        line = line.strip()
        if not line or line.startswith("["):
            continue
        try:
            entry = json.loads(line)
            yield entry
            count += 1
            if count % CHUNK_SIZE == 0:
                # 如果能估进度(假设解压后线性), 报告一下
                if total_bytes and fh:
                    try:
                        raw_pos = resp.fp.tell() if hasattr(resp, 'fp') else 0
                        pct = min(99, int(raw_pos / total_bytes * 100))
                        if pct > last_pct:
                            print(f"  下载进度 ~{pct}% ({count:,} 词条)...")
                            last_pct = pct
                    except:
                        pass
                print(f"  已处理 {count:,} 词条...")
        except json.JSONDecodeError:
            continue
    print(f"  下载完成 — 总词条: {count:,}")


def extract_translations(entry: dict, target_lang: str) -> list[str]:
    """从 Wiktionary 条目的 translations 字段提取目标语言翻译"""
    translations: list[str] = []
    senses = entry.get("senses", [])
    for sense in senses:
        for tr in sense.get("translations", []):
            # kaikki.org 用全名: "Chinese Mandarin", "Chinese Cantonese"
            lang_name = tr.get("lang", "")
            if target_lang == "zh" and lang_name.startswith("Chinese"):
                word = tr.get("word", "")
                if word: translations.append(word)
            elif lang_name.lower() == target_lang:
                word = tr.get("word", "")
                if word: translations.append(word)
    return translations


def extract_info(entry: dict, target_lang: str) -> dict | None:
    """从 Wiktionary JSON 提取: 词性、释义、中文翻译、例句、音标"""
    word = entry.get("word", "").lower().strip()
    if not word:
        return None

    pos = entry.get("pos", "")
    if not pos:
        return None

    # 英文释义
    definitions: list[str] = []
    examples: list[str] = []
    senses = entry.get("senses", [])
    for sense in senses:
        glosses = sense.get("glosses", [])
        for g in glosses:
            definitions.append(clean_text(g))
        for ex in sense.get("examples", []):
            text = ex.get("text", "")
            if text:
                examples.append(clean_text(text))

    # 中文翻译
    cn_translations = extract_translations(entry, target_lang)

    # 音标
    sounds = entry.get("sounds", [])
    ipa = ""
    for s in sounds:
        if s.get("ipa"):
            ipa = s["ipa"]
            break

    return {
        "pos": pos,
        "defs": definitions[:5],        # 最多 5 条英文释义
        "cn": cn_translations[:5],      # 最多 5 条中文翻译
        "examples": examples[:3],       # 最多 3 条例句
        "ipa": ipa,                     # 音标
    }


def clean_text(text: str) -> str:
    """清理 MediaWiki 标记残留"""
    # 去掉 HTML 标签
    text = re.sub(r"<[^>]+>", "", text)
    # 去掉 wiki 链接 [[...|...]]
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", text)
    # 去掉引用标记 [1], [note]
    text = re.sub(r"\[\d+\]", "", text)
    text = re.sub(r"\[note\]", "", text)
    # 合并空白
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build(target_lang: str = "zh", local_file: str | None = None) -> None:
    """主流程"""
    print(f"nosub Wiktionary 词典构建 — 目标语言: {target_lang}")
    print(f"=" * 50)

    # 1. 流式下载(或读本地文件) + 过滤
    source_desc = f"本地文件: {local_file}" if local_file else f"远程: {SOURCE_URL}"
    print(f"\n[1/3] 读取并过滤 ({source_desc})...")

    if local_file:
        # 从本地文件读取
        local_path = Path(local_file)
        if not local_path.exists():
            print(f"  ✗ 文件不存在: {local_path}")
            sys.exit(1)
        size_mb = local_path.stat().st_size / 1024 / 1024
        print(f"  本地文件大小: {size_mb:.0f} MB")

        # 判断是 gz 还是纯文本
        fh = gzip.open(local_path, "rt", encoding="utf-8") if local_path.suffix == ".gz" else open(local_path, "r", encoding="utf-8")
    else:
        # 远程下载
        fh = None  # 由 fetch_stream 处理
    entries: dict[str, dict] = {}
    skipped_no_trans = 0
    skipped_no_pos = 0

    # 选择数据源: 本地文件 or 远程流
    def read_entries():
        if local_file:
            count = 0
            for line in fh:
                line = line.strip()
                if not line or line.startswith("["):
                    continue
                try:
                    entry = json.loads(line)
                    yield entry
                    count += 1
                    if count % CHUNK_SIZE == 0:
                        print(f"  已处理 {count:,} 条...")
                except json.JSONDecodeError:
                    continue
            print(f"  总条数: {count:,}")
        else:
            yield from fetch_stream(SOURCE_URL)

    try:
        for entry in read_entries():
            info = extract_info(entry, target_lang)
            if not info:
                skipped_no_pos += 1
                continue

            word = entry["word"].lower().strip()

            # 对目标语言, 需要中文翻译才保留
            if target_lang != "en":
                if not info["cn"]:
                    skipped_no_trans += 1
                    continue

            # 已有词条 → 合并词性
            if word in entries:
                existing = entries[word]
                if info["pos"] not in existing["pos"]:
                    existing["pos"] += "/" + info["pos"]
                existing["defs"] = dedup(existing["defs"] + info["defs"])[:5]
                existing["cn"] = dedup(existing["cn"] + info["cn"])[:5]
                existing["examples"] = dedup(existing["examples"] + info["examples"])[:3]
                if not existing["ipa"] and info["ipa"]:
                    existing["ipa"] = info["ipa"]
            else:
                entries[word] = info

    except URLError as e:
        if local_file:
            raise  # 本地文件不应该有 URLError
        print(f"下载失败: {e}")
        print("请检查网络, 或尝试使用代理。")
        sys.exit(1)

    print(f"\n  有效词条: {len(entries):,}")
    print(f"  跳过(无目标翻译): {skipped_no_trans:,}")
    print(f"  跳过(无词性): {skipped_no_pos:,}")

    # 2. 写文件
    outpath = Path(str(OUTPUT).format(lang=target_lang))
    outpath.parent.mkdir(parents=True, exist_ok=True)
    print(f"\n[2/3] 写入 {outpath}...")

    # 压缩格式: {"word": {"p":"noun/verb","d":[...],"c":[...],"e":[...],"i":"..."}}
    compact = {}
    for word, info in entries.items():
        compact[word] = {
            "p": info["pos"],
            "d": info["defs"],
            "c": info["cn"] if info["cn"] else [],  # c = Chinese translations
            "e": info["examples"],
            "i": info["ipa"],
        }

    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = outpath.stat().st_size / 1024 / 1024
    print(f"  写入: {outpath} ({size_mb:.1f} MB)")

    # 3. 统计
    print(f"\n[3/3] 统计")
    with_cn = sum(1 for v in compact.values() if v["c"])
    with_ex = sum(1 for v in compact.values() if v["e"])
    with_ipa = sum(1 for v in compact.values() if v["i"])
    print(f"  总词条: {len(compact):,}")
    print(f"  有中文翻译: {with_cn:,} ({with_cn/len(compact)*100:.0f}%)")
    print(f"  有例句: {with_ex:,} ({with_ex/len(compact)*100:.0f}%)")
    print(f"  有音标: {with_ipa:,} ({with_ipa/len(compact)*100:.0f}%)")

    print("\n✅ 完成!")


def dedup(items: list[str]) -> list[str]:
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


if __name__ == "__main__":
    lang = "zh"
    local = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--local" and i + 1 < len(args):
            local = args[i + 1]; i += 2
        elif not args[i].startswith("--"):
            lang = args[i]; i += 1
        else:
            i += 1
    build(lang, local)
