"""Build the SAT inference practice bank from the matching question and analysis DOCX files."""

import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
QUESTION_HEADING = re.compile(r"^(Q\d{4})\s+·\s+(.+)$")
ANSWER_CELL = re.compile(r"(Q\d{4})\s+([ABCD])(†)?")


# These source passages use a separate Word paragraph for each wrapped line.
WRAPPED_PASSAGES = {"Q0134", "Q0136", "Q0138", "Q0139", "Q0140", "Q0141", "Q0144", "Q0146"}


def read_body(path):
    with ZipFile(path) as docx:
        document = ET.fromstring(docx.read("word/document.xml"))
    return document.find(WORD + "body")


def paragraph_text(paragraph):
    parts = []
    for element in paragraph.iter():
        if element.tag == WORD + "t":
            parts.append(element.text or "")
        elif element.tag in (WORD + "br", WORD + "cr"):
            parts.append("\n")
        elif element.tag == WORD + "tab":
            parts.append("\t")
    return "".join(parts).strip()


def read_question_blocks(body):
    blocks = {}
    current = None
    for paragraph in body.findall(WORD + "p"):
        text = paragraph_text(paragraph)
        heading = QUESTION_HEADING.fullmatch(text)
        if heading:
            qid, source = heading.groups()
            assert qid not in blocks, qid
            current = []
            blocks[qid] = (source, current)
        elif current is not None and text:
            current.append(text)
    return blocks


def read_answers(body):
    answers = {}
    for cell in body.iter(WORD + "tc"):
        match = ANSWER_CELL.fullmatch(paragraph_text(cell))
        if match:
            qid, answer, provisional = match.groups()
            assert qid not in answers, qid
            answers[qid] = (answer, bool(provisional))
    return answers


def read_choices(lines, start, qid):
    choices = []
    for offset, letter in enumerate("ABCD"):
        line = lines[start + offset]
        assert line.startswith(f"{letter}. "), (qid, line)
        choices.append(line[3:])
    return choices


def read_question(lines, qid):
    choice_start = next(i for i, line in enumerate(lines) if line.startswith("A. "))
    assert choice_start >= 2, qid
    separator = " " if qid in WRAPPED_PASSAGES else "\n\n"
    passage = separator.join(lines[:choice_start - 1])
    prompt = lines[choice_start - 1]
    assert prompt.endswith("?"), (qid, prompt)
    choices = read_choices(lines, choice_start, qid)
    return passage, prompt, choices


def read_field(lines, label):
    return next(line.removeprefix(label).strip() for line in lines if line.startswith(label))


def build_bank(question_body, analysis_body):
    questions = read_question_blocks(question_body)
    analyses = read_question_blocks(analysis_body)
    answers = read_answers(question_body)
    assert questions.keys() == analyses.keys() == answers.keys()

    rows = []
    for number, (qid, (source, lines)) in enumerate(questions.items(), 1):
        assert qid == f"Q{number:04d}", qid
        passage, prompt, choices = read_question(lines, qid)
        analysis_source, analysis = analyses[qid]
        analysis_passage, analysis_prompt, analysis_choices = read_question(analysis, qid)
        assert source == analysis_source and prompt == analysis_prompt, qid
        assert passage.split() == analysis_passage.split(), qid
        assert [choice.split() for choice in choices] == [choice.split() for choice in analysis_choices], qid
        answer, provisional = answers[qid]
        status_note = read_field(analysis, "核验状态：")
        assert answer == read_field(analysis, "答案："), qid
        assert provisional == ("语境推定" in status_note), qid
        status = "source_verified"
        if provisional:
            status = "inferred_answer"
        elif "原图局部缺文" in status_note:
            status = "incomplete_source"
        analysis_start = analysis.index("选项分析：") + 1
        rows.append({
            "id": qid,
            "source": source,
            "passage": passage,
            "prompt": prompt,
            "options": [{"text": choice} for choice in choices],
            "answer": answer,
            "status": status,
            "clue": read_field(analysis, "关键线索："),
            "explanation": read_field(analysis, "解析："),
            "optionAnalysis": read_choices(analysis, analysis_start, qid),
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("questions", type=Path)
    parser.add_argument("analysis", type=Path)
    args = parser.parse_args()
    rows = build_bank(read_body(args.questions), read_body(args.analysis))
    output = Path(__file__).resolve().parents[1] / "sat-inference" / "questions.json"
    serialized = (json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows)
    output.write_text("[\n" + ",\n".join(serialized) + "\n]\n", encoding="utf-8")
    print(f"Verified and exported {len(rows)} questions, {sum(len(row['options']) for row in rows)} choices, and {len(rows)} answers.")


if __name__ == "__main__":
    main()
