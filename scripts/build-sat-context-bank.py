"""Build the website question bank from the October 2026 question and vocabulary exports."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def build_bank(question_source, vocab_source):
    vocabulary = defaultdict(list)
    for word in vocab_source["words"]:
        for ref in word["occurrences"]:
            vocabulary[ref["qid"], ref["choice"]].append(word)

    bank = []
    used_positions = set()
    for number, question in enumerate(question_source["questions"], 1):
        qid = question["id"]
        assert qid == f"Q{number:04d}", qid
        assert len(question["choices"]) == 4 and question["answer_letter"] in "ABCD", qid
        assert question["stem"].strip() and question["prompt"].strip(), qid
        glosses = question.get("option_vocab_zh") or []
        assert len(glosses) in (0, 4), qid
        options = []
        for i, (letter, raw_choice) in enumerate(zip("ABCD", question["choices"])):
            prefix = f"{letter}. "
            assert raw_choice.startswith(prefix), (qid, raw_choice)
            choice = raw_choice.removeprefix(prefix)
            position = qid, letter
            used_positions.add(position)
            words = vocabulary[position]
            assert choice.strip() and words, position
            # Keep sentence-length options as written. Study common inflections under their headword.
            term = words[0]["headword"] if len(words) == 1 and len(choice.split()) <= 4 else choice
            if glosses:
                original, separator, meaning = glosses[i].partition("：")
                normalize = lambda s: re.sub(r"[^\w]+", "", s.casefold())
                assert separator and normalize(original) == normalize(raw_choice), position
                meaning = meaning.strip()
            else:
                meanings = []
                for word in words:
                    sense = word["test_sense"]
                    gloss = f"{sense['pos']} {sense['zh']}"
                    meanings.append(f"{word['headword']} · {gloss}" if term != word["headword"] else gloss)
                meaning = " / ".join(meanings)
            assert meaning, position
            options.append({"text": choice, "term": term, "meaning": meaning})

        bank.append({
            "id": qid,
            "source": question["label"],
            "passage": question["stem"],
            "prompt": question["prompt"],
            "options": options,
            "answer": question["answer_letter"],
            "status": question["answer_status"],
            "explanation": question["analysis_zh"],
        })

    assert len(bank) == question_source["question_count"] == vocab_source["question_count"]
    assert used_positions == vocabulary.keys()
    return bank


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("questions", type=Path)
    parser.add_argument("vocabulary", type=Path)
    args = parser.parse_args()
    bank = build_bank(read_json(args.questions), read_json(args.vocabulary))
    output = Path(__file__).resolve().parents[1] / "sat-context" / "questions.json"
    rows = (json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in bank)
    output.write_text("[\n" + ",\n".join(rows) + "\n]\n", encoding="utf-8")
    print(f"Exported {len(bank)} questions and {sum(len(q['options']) for q in bank)} options.")


if __name__ == "__main__":
    main()
