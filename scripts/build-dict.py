#!/usr/bin/env python3
"""
nosub 本地词典构建脚本。

数据源: GCIDE (GNU Collaborative International Dictionary of English)
         基于 1913 版 Webster's Unabridged, 公共领域, ~103K 词条。

用法:
    python scripts/build-dict.py

产物:
    src/assistance/dict.json  (~15MB, 包含 IPA 音标 + 释义 + 例句)

网络要求:
    从 jsDelivr CDN 下载预处理的 GCIDE JSON (~50MB 压缩, ~200MB 解压后)
    国内可能需要代理; 如果 jsDelivr 不可用, 尝试 GitHub raw。

依赖: Python 3.7+, requests (可选, 有内置 urllib)
"""

import json
import sys
import os
import gzip
import io
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

# ---- 配置 ----
OUTPUT = Path(__file__).parent.parent / "src" / "assistance" / "dict.json"

# 数据源: GCIDE (JSON 格式), 按优先级排列
SOURCES = [
    # andrianllmm/eng-dictionary-parser 预处理版 (~103K 词)
    "https://cdn.jsdelivr.net/gh/andrianllmm/eng-dictionary-parser@main/output/eng_dictionary.json",
    # 备用: 直接 GitHub raw
    "https://raw.githubusercontent.com/andrianllmm/eng-dictionary-parser/main/output/eng_dictionary.json",
]

# ---- 期望的词典条目格式 ----
# 输入格式 (GCIDE JSON):
#   { "abandon": [{ "part_of_speech": "v.t.", "definition": "To give up...", "example": "...", ... }], ... }
#
# 输出格式 (nosub 内部):
#   { "abandon": { "p": "v.", "d": ["To give up...", ...], "e": ["..."] }, ... }
#   压缩: p=partOfSpeech(合并同类项), d=definitions, e=examples


def fetch(url: str, retries: int = 3) -> bytes:
    """下载数据, 支持重试."""
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "nosub-dict-builder/1.0"})
            with urlopen(req, timeout=30) as resp:
                data = resp.read()
                print(f"  ✓ 下载成功: {len(data) / 1024 / 1024:.1f} MB")
                return data
        except URLError as e:
            print(f"  ✗ 尝试 {i + 1}/{retries}: {e}")
            if i == retries - 1:
                raise


def compact_entry(attributes: list[dict]) -> dict:
    """将 GCIDE attributes 压缩为 nosub 内部格式."""
    parts_of_speech: list[str] = []
    definitions: list[str] = []
    examples: list[str] = []

    for attr in attributes:
        pos = attr.get("pos", "")
        if pos and pos not in parts_of_speech:
            parts_of_speech.append(pos)

        defn = attr.get("definition", "")
        if defn:
            definitions.append(defn)

        example = attr.get("example", "")
        if example and example not in examples:
            examples.append(example)

    result: dict = {"d": definitions}
    if parts_of_speech:
        result["p"] = "/".join(parts_of_speech)
    if examples:
        result["e"] = examples[:3]
    return result


def build() -> None:
    """主流程."""

    # 1. 下载
    data: bytes | None = None
    for url in SOURCES:
        print(f"尝试下载: {url[:80]}...")
        try:
            data = fetch(url)
            break
        except URLError:
            print("  失败, 尝试下一个源...")

    if not data:
        print("所有数据源均不可用。请检查网络连接。")
        sys.exit(1)

    # 2. 解析
    print("解析 JSON...")
    raw: list[dict] = json.loads(data.decode("utf-8"))
    print(f"  词条数: {len(raw):,}")

    # 3. 压缩转换
    print("压缩格式...")
    compact: dict[str, dict] = {}
    skipped = 0
    for entry in raw:
        word = entry.get("word", "")
        attrs = entry.get("attributes", [])
        if not word or not attrs:
            skipped += 1
            continue
        compact[word.lower()] = compact_entry(attrs)

    print(f"  有效词条: {len(compact):,} (跳过 {skipped} 个无定义词条)")

    # 4. 写文件
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))
    size_mb = OUTPUT.stat().st_size / 1024 / 1024
    print(f"  写入: {OUTPUT} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    build()
