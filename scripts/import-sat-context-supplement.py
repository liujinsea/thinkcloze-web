"""Append a checked question supplement without renumbering existing questions or groups."""
from pathlib import Path
import argparse
import json
import os
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {'source_verified', 'inferred_answer', 'incomplete_source', 'historical_unverified'}


def read(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, list):
        raise ValueError(f'Expected a question array: {path}')
    return value


def validate(question):
    qid = question['id']
    if not re.fullmatch(r'Q\d{4,}', qid):
        raise ValueError(f'Invalid question id: {qid}')
    for field in ['source', 'passage', 'prompt', 'explanation']:
        if not isinstance(question.get(field), str) or not question[field].strip():
            raise ValueError(f'{qid}: missing {field}')
    if len(question['options']) != 4 or len(question['answer']) != 1 or question['answer'] not in 'ABCD':
        raise ValueError(f'{qid}: four options and an answer letter are required')
    for option in question['options']:
        if any(not isinstance(option.get(key), str) or not option[key].strip() for key in ['text', 'term', 'meaning']):
            raise ValueError(f'{qid}: incomplete option')
    if question['status'] not in STATUSES:
        raise ValueError(f'{qid}: invalid verification status')
    for field, text in [('passageUnderlines', question['passage']), ('passageItalics', question['passage']), ('blurbItalics', question.get('blurb', ''))]:
        cursor = 0
        for phrase in question.get(field, []):
            if not isinstance(phrase, str) or not phrase:
                raise ValueError(f'{qid}: {field} must contain text strings')
            start = text.find(phrase, cursor)
            if start < 0:
                raise ValueError(f'{qid}: missing or out-of-order {field}: {phrase}')
            cursor = start + len(phrase)
    if 'practiceGroup' in question and (not isinstance(question['practiceGroup'], int) or question['practiceGroup'] < 1):
        raise ValueError(f'{qid}: invalid practice group')


def merge(base, supplement):
    output = list(base)
    by_id = {question['id']: question for question in base}
    if len(by_id) != len(base):
        raise ValueError('Existing bank contains duplicate question ids')
    for question in supplement:
        validate(question)
        existing = by_id.get(question['id'])
        if existing is not None:
            if existing != question:
                raise ValueError(f"{question['id']}: existing item differs; review before replacing it")
            continue
        by_id[question['id']] = question
        output.append(question)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bank', type=Path, default=ROOT / 'sat-context/questions.json')
    parser.add_argument('--supplement', type=Path, default=ROOT / 'sat-context/supplements/2023-2024.json')
    parser.add_argument('--check', action='store_true', help='Validate the merge without changing the bank')
    args = parser.parse_args()
    original = read(args.bank)
    output = merge(original, read(args.supplement))
    for old, preserved in zip(original, output):
        if old != preserved:
            raise ValueError('An existing question was changed')
    added = len(output) - len(original)
    if not args.check and added:
        payload = '[\n' + ',\n'.join(json.dumps(q, ensure_ascii=False, separators=(',', ':')) for q in output) + '\n]\n'
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=args.bank.parent, prefix='.question-import-', delete=False) as handle:
            temp = Path(handle.name)
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, args.bank)
    print(f'{len(original)} existing questions preserved; {added} new questions; {len(output)} total.')


if __name__ == '__main__':
    main()
