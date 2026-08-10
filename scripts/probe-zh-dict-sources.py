#!/usr/bin/env python3
"""Probe EN→ZH short gloss quality from multiple free/unofficial APIs."""
from __future__ import annotations

import json
import re
import ssl
import urllib.parse
import urllib.request
from typing import Any

WORDS = [
    "though", "something", "anyway", "however", "because",
    "whatever", "nevertheless", "although", "therefore", "meanwhile",
]

CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 nosub-dict-probe", "Accept": "application/json"}


def get(url: str, timeout: float = 8) -> Any:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read()
        ct = r.headers.get("Content-Type", "")
        if "json" in ct or raw[:1] in (b"{", b"["):
            return json.loads(raw.decode("utf-8", "ignore"))
        return raw.decode("utf-8", "ignore")


def youdao(word: str) -> list[str]:
    """有道 — 简明释义"""
    url = (
        "https://dict.youdao.com/jsonapi?"
        + urllib.parse.urlencode({"q": word, "le": "en"})
    )
    try:
        data = get(url)
    except Exception as e:
        return [f"ERR:{e}"]
    out: list[str] = []
    # ec.word[].trs[].tr[].l.i[]
    for w in (data.get("ec") or {}).get("word") or []:
        for trs in w.get("trs") or []:
            pos = (trs.get("pos") or "").strip()
            for tr in trs.get("tr") or []:
                items = ((tr.get("l") or {}).get("i")) or []
                text = "".join(items) if isinstance(items, list) else str(items)
                text = text.strip()
                if text:
                    out.append(f"{pos} {text}".strip() if pos else text)
    # fallback: fanyi
    if not out:
        fy = ((data.get("fanyi") or {}).get("tran") or "").strip()
        if fy:
            out.append(fy)
    return out[:6]


def bing(word: str) -> list[str]:
    """必应词典"""
    url = (
        "https://www.bing.com/api/v6/dictionarywords/search?"
        + urllib.parse.urlencode(
            {
                "q": word,
                "appid": "371E7B2AF0F9B84EC491D58168FE2800333344B3",
                "mkt": "zh-cn",
                "pname": "bingdict",
            }
        )
    )
    try:
        data = get(url)
    except Exception as e:
        return [f"ERR:{e}"]
    out: list[str] = []
    for g in data.get("value") or []:
        meaning_groups = (
            ((g.get("meaningGroups") or [{}])[0]).get("meanings")
            if g.get("meaningGroups")
            else None
        )
        # structure varies; try common paths
        for mg in g.get("meaningGroups") or []:
            pos = ""
            for p in mg.get("partsOfSpeech") or []:
                pos = p.get("description") or p.get("name") or pos
            for m in mg.get("meanings") or []:
                for d in m.get("definitionGroups") or []:
                    for defn in d.get("definitions") or []:
                        t = (defn.get("text") or "").strip()
                        if t:
                            out.append(f"{pos} {t}".strip() if pos else t)
    return out[:6]


def google_translate(word: str) -> list[str]:
    url = (
        "https://translate.googleapis.com/translate_a/single?"
        + urllib.parse.urlencode(
            {"client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": word}
        )
    )
    try:
        data = get(url)
        text = "".join(x[0] for x in (data[0] or []) if isinstance(x, list) and x)
        return [text] if text else []
    except Exception as e:
        return [f"ERR:{e}"]


def iciba(word: str) -> list[str]:
    url = f"https://dict-mobile.iciba.com/interface/index.php?c=word&m=getsuggest&nums=1&is_need_mean=1&word={urllib.parse.quote(word)}"
    try:
        data = get(url)
    except Exception as e:
        return [f"ERR:{e}"]
    out: list[str] = []
    for item in data.get("message") or []:
        for mean in item.get("means") or []:
            pos = (mean.get("part") or "").strip()
            for m in mean.get("means") or []:
                t = str(m).strip()
                if t:
                    out.append(f"{pos} {t}".strip() if pos else t)
    return out[:6]


def main() -> None:
    probes = [
        ("youdao", youdao),
        ("bing", bing),
        ("iciba", iciba),
        ("gtranslate", google_translate),
    ]
    report: dict[str, dict[str, list[str]]] = {}
    for name, fn in probes:
        report[name] = {}
        for w in WORDS:
            try:
                glosses = fn(w)
            except Exception as e:
                glosses = [f"EXC:{e}"]
            report[name][w] = glosses
            print(f"{name}/{w}: {glosses}", flush=True)

    out = Path(__file__).with_name("_probe-zh-report.json")
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {out}")


if __name__ == "__main__":
    from pathlib import Path
    main()
