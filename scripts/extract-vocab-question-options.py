#!/usr/bin/env python3
"""Extract SAT vocab-question answer choices into audit-friendly JSON."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, OrderedDict
from pathlib import Path

from docx import Document


LABEL_RE = re.compile(r"^(\d{4}年\d{1,2}月.+?)(?:M(\d+))?Q(\d+)$")
CHOICE_RE = re.compile(r"^([A-D])[\.)]\s*(.+)$")
PROMPT_RE = re.compile(
    r"(most\s+lo(?:g|a)ical\s+and\s+precise\s+word\s+or\s+phrase|as used in the text.*most nearly mean[s]?)",
    re.IGNORECASE,
)

SET_LETTERS = {
    "1": "A",
    "一": "A",
    "2": "B",
    "二": "B",
    "3": "C",
    "三": "C",
    "4": "D",
    "四": "D",
    "5": "E",
    "五": "E",
}

CHOICE_FIXES = {
    "aconvergence": "a convergence",
    "aacquiesces": "acquiesces",
    "cant' t": "can't",
    ". )) intercede in": "intercede in",
    "i omit": "omit",
    "suppor": "support",
    "re mitigate": "mitigate",
    "re corroborate": "corroborate",
    "hencapsulate": "encapsulate",
    "overshadow (ge ) (tm))": "overshadow",
    "cc fimpieie": "complete",
    "particular lt d °% fh g": "particular",
    "entrusted ji bd °%> fai ¢": "entrusted",
    "anticipated 1p qd °% fe!": "anticipated",
    "reflected 1b yd °> fh ¢": "reflected",
    "amended 1b yd °> fa ¢": "amended",
    "pervasiveness lp d %> fh c": "pervasiveness",
    "0 circumspection": "circumspection",
    "6 interconnected": "interconnected",
    "discrepancies between har, hel": "discrepancies between",
}

QUESTION_CHOICE_FIXES = {
    ("202512NAAM1Q1", "A"): "overlooked in",
    ("202512NAAM1Q1", "B"): "polarizing in",
    ("202512NAAM1Q1", "C"): "essential to",
    ("202512NAAM1Q1", "D"): "knowledgeable about",
    ("202605AsiaCM1Q3", "A"): "instinctive for",
    ("202605AsiaCM1Q3", "B"): "unique to",
    ("202605AsiaCM1Q3", "C"): "imposed on",
    ("202605AsiaCM1Q3", "D"): "undertaken by",
}

MANUAL_QUESTIONS = [
    {
        "sourceFileName": "2025年3月SAT阅读词汇题汇总.txt",
        "source": "2025年3月亚太C卷",
        "sourceCode": "202503Asia",
        "label": "2025年3月亚太C卷M2Q27",
        "questionCode": "202503AsiaM2Q27",
        "module": 2,
        "number": 27,
        "stemLines": [],
        "prompt": "Which choice completes the text with the most logical and precise word or phrase?",
        "choices": [
            {"letter": "A", "choice": "tranquil"},
            {"letter": "B", "choice": "peculiar"},
            {"letter": "C", "choice": "nostalgic"},
            {"letter": "D", "choice": "dispassionate"},
        ],
    }
]


def read_lines(path: Path) -> list[str]:
    if path.suffix.lower() == ".txt":
        text = path.read_text(encoding="utf-8-sig")
        return [line.strip() for line in text.splitlines() if line.strip()]

    if path.suffix.lower() == ".docx":
        doc = Document(path)
        lines: list[str] = []
        for paragraph in doc.paragraphs:
            text = paragraph.text.strip()
            if text:
                lines.extend(part.strip() for part in text.splitlines() if part.strip())
        return lines

    raise ValueError(f"Unsupported source type: {path}")


def selected_sources(source_dir: Path) -> list[Path]:
    candidates: OrderedDict[str, dict[str, Path]] = OrderedDict()
    for path in sorted(source_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in {".txt", ".docx"}:
            continue
        if path.name.startswith("~$") or "清单" in path.stem:
            continue
        candidates.setdefault(path.stem, {})[path.suffix.lower()] = path

    chosen: list[Path] = []
    for variants in candidates.values():
        chosen.append(variants.get(".txt") or variants[".docx"])

    def sort_key(path: Path) -> tuple[int, int, str]:
        match = re.search(r"(\d{4})年(\d{1,2})月", path.name)
        if not match:
            return (9999, 99, path.name)
        return (int(match.group(1)), int(match.group(2)), path.name)

    return sorted(chosen, key=sort_key)


def normalize_choice(choice: str) -> str:
    text = choice.strip()
    text = text.replace("“", '"').replace("”", '"').replace("’", "'")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:])$", r"\1", text)
    lowered = text.lower()
    lowered = CHOICE_FIXES.get(lowered, lowered)
    lowered = re.sub(r"^(?:a|an|the)\s+", "", lowered)
    return lowered.strip(" .;:")


def verified_choice(question_code: str, letter: str, original: str) -> tuple[str, str]:
    fixed = QUESTION_CHOICE_FIXES.get((question_code, letter))
    if fixed:
        return fixed, "按原始真题 PDF 核对补全选项"
    return original, ""


def source_to_code(label: str) -> str:
    date_match = re.match(r"(\d{4})年(\d{1,2})月", label)
    date = "000000"
    if date_match:
        date = f"{date_match.group(1)}{int(date_match.group(2)):02d}"

    region = "Source"
    if "亚太" in label:
        region = "Asia"
    elif "北美" in label:
        region = "NA"

    set_letter = ""
    set_match = re.search(r"第([一二三四五1-5])套", label)
    if set_match:
        set_letter = SET_LETTERS.get(set_match.group(1), "")

    return f"{date}{region}{set_letter}"


def parse_compiled_questions(path: Path) -> list[dict]:
    lines = read_lines(path)
    questions: list[dict] = []
    current: dict | None = None

    for line in lines:
        label_match = LABEL_RE.match(line)
        if label_match:
            if current:
                questions.append(current)
            source, module, number = label_match.groups()
            current = {
                "source": source,
                "sourceCode": source_to_code(source),
                "label": line,
                "questionCode": f"{source_to_code(source)}{f'M{module}' if module else ''}Q{int(number)}",
                "module": int(module) if module else None,
                "number": int(number),
                "stemLines": [],
                "prompt": "",
                "choices": [],
                "sourceFile": str(path),
            }
            continue

        if current is None:
            continue

        choice_match = CHOICE_RE.match(line)
        if choice_match:
            current["choices"].append(
                {"letter": choice_match.group(1), "choice": choice_match.group(2).strip()}
            )
            continue

        if PROMPT_RE.search(line):
            current["prompt"] = line
        elif not current["prompt"]:
            current["stemLines"].append(line)

    if current:
        questions.append(current)

    return [
        question
        for question in questions
        if PROMPT_RE.search(question.get("prompt", "")) and len(question.get("choices", [])) >= 1
    ]


def build_rows(questions: list[dict]) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    warnings: list[dict] = []
    for question in questions:
        if len(question["choices"]) != 4:
            warnings.append(
                {
                    "label": question["label"],
                    "message": f"expected 4 choices, found {len(question['choices'])}",
                    "sourceFile": question["sourceFile"],
                }
            )
        for choice in question["choices"]:
            extracted = choice["choice"]
            original, correction_note = verified_choice(
                question["questionCode"], choice["letter"], extracted
            )
            term = normalize_choice(original)
            rows.append(
                {
                    "source": question["source"],
                    "sourceCode": question["sourceCode"],
                    "questionLabel": question["label"],
                    "questionCode": question["questionCode"],
                    "module": question["module"],
                    "number": question["number"],
                    "letter": choice["letter"],
                    "originalChoice": original,
                    "extractedChoice": extracted,
                    "correctionNote": correction_note,
                    "term": term,
                    "sourceFile": question["sourceFile"],
                }
            )
    return rows, warnings


def apply_manual_questions(questions: list[dict], sources: list[Path]) -> None:
    existing_codes = {question["questionCode"] for question in questions}
    source_by_name = {path.name: str(path) for path in sources}
    for manual in MANUAL_QUESTIONS:
        if manual["questionCode"] in existing_codes:
            continue
        question = dict(manual)
        question["sourceFile"] = source_by_name.get(manual["sourceFileName"], "")
        question.pop("sourceFileName", None)
        questions.append(question)


def summarize_terms(rows: list[dict]) -> list[dict]:
    grouped: OrderedDict[str, list[dict]] = OrderedDict()
    for row in rows:
        grouped.setdefault(row["term"], []).append(row)

    summary: list[dict] = []
    for term, occurrences in grouped.items():
        source_refs = [
            f"{row['sourceCode']}{'(' + row['letter'] + ')'}"
            for row in occurrences
        ]
        original_forms = sorted({row["originalChoice"] for row in occurrences})
        summary.append(
            {
                "term": term,
                "firstQuestionCode": occurrences[0]["questionCode"],
                "firstQuestionLabel": occurrences[0]["questionLabel"],
                "count": len(occurrences),
                "sourceRefs": source_refs,
                "originalForms": original_forms,
                "sources": sorted({row["source"] for row in occurrences}),
            }
        )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--out-json", required=True, type=Path)
    args = parser.parse_args()

    sources = selected_sources(args.source_dir)
    questions: list[dict] = []
    for path in sources:
        questions.extend(parse_compiled_questions(path))
    apply_manual_questions(questions, sources)

    rows, warnings = build_rows(questions)
    terms = summarize_terms(rows)
    source_counts = Counter(question["sourceFile"] for question in questions)

    payload = {
        "sourceDir": str(args.source_dir),
        "selectedSources": [str(path) for path in sources],
        "sourceQuestionCounts": dict(source_counts),
        "questions": questions,
        "optionRows": rows,
        "terms": terms,
        "warnings": warnings,
        "stats": {
            "sourceFiles": len(sources),
            "questions": len(questions),
            "optionRows": len(rows),
            "uniqueTerms": len(terms),
            "warnings": len(warnings),
        },
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["stats"], ensure_ascii=False))
    if warnings:
        print(json.dumps(warnings[:10], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
