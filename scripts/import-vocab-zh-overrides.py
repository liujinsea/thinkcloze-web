#!/usr/bin/env python3
"""Import reviewed Chinese meanings from the ThinkCloze vocab audit workbook."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import openpyxl


EXTRA_VERIFIED_MEANINGS = {
    "essential to": "adj. phr. 对……至关重要的",
    "knowledgeable about": "adj. phr. 对……了解的；熟悉……的",
    "overlooked in": "v. phr. 在……方面被忽视",
    "polarizing in": "adj. phr. 在……方面引发分化的；两极化的",
    "imposed on": "v. phr. 强加于……",
    "instinctive for": "adj. phr. 对……来说本能的",
    "undertaken by": "v. phr. 由……承担；由……进行",
    "unique to": "adj. phr. 为……所特有的；独有的",
}


def read_reviewed_meanings(path: Path) -> list[dict[str, str]]:
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    sheet = workbook["合并词表"]
    rows = sheet.iter_rows(values_only=True)
    headers = [str(value).strip() if value is not None else "" for value in next(rows)]
    header_index = {header: index for index, header in enumerate(headers)}
    term_index = header_index["词/短语"]
    meaning_index = header_index["中文释义"]

    entries: dict[str, dict[str, str]] = {}
    for row in rows:
        values = list(row)
        term = values[term_index] if term_index < len(values) else None
        meaning = values[meaning_index] if meaning_index < len(values) else None
        term = str(term or "").strip()
        meaning = str(meaning or "").strip()
        if not term or not meaning or meaning.startswith("待补充释义"):
            continue
        entries[term.lower()] = {
            "term": term,
            "meaningZh": meaning,
            "source": "reviewed-xlsx",
        }

    for term, meaning in EXTRA_VERIFIED_MEANINGS.items():
        entries.setdefault(
            term.lower(),
            {
                "term": term,
                "meaningZh": meaning,
                "source": "verified-original-pdf",
            },
        )

    return sorted(entries.values(), key=lambda item: item["term"].lower())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", required=True, type=Path)
    parser.add_argument("--out-json", required=True, type=Path)
    args = parser.parse_args()

    entries = read_reviewed_meanings(args.xlsx)
    payload = {
        "sourceWorkbook": str(args.xlsx),
        "entries": entries,
        "stats": {
            "entries": len(entries),
            "reviewedXlsx": sum(1 for entry in entries if entry["source"] == "reviewed-xlsx"),
            "verifiedOriginalPdf": sum(1 for entry in entries if entry["source"] == "verified-original-pdf"),
        },
    }
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["stats"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
