"""Credit-note numbers.

Credit notes are numbered CN-YYYY-NNNN with a serial that restarts every
calendar year.
"""

from datetime import date

import pytest

from billing.numbering import CreditNoteSequence, parse


def test_first_credit_note_number():
    seq = CreditNoteSequence()

    assert seq.peek(2026) == "CN-2026-0001"
    assert seq.next(date(2026, 1, 15)) == "CN-2026-0001"
    assert seq.peek(2026) == "CN-2026-0002"


def test_credit_note_numbers_increase():
    seq = CreditNoteSequence()

    numbers = [
        seq.next(date(2026, 2, 1)),
        seq.next(date(2026, 2, 3)),
        seq.next(date(2026, 4, 9)),
    ]

    assert numbers == ["CN-2026-0001", "CN-2026-0002", "CN-2026-0003"]


def test_credit_note_sequence_restarts_each_year():
    seq = CreditNoteSequence()
    seq.next(date(2026, 12, 30))
    seq.next(date(2026, 12, 31))

    assert seq.next(date(2027, 1, 2)) == "CN-2027-0001"
    assert seq.next(date(2026, 12, 31)) == "CN-2026-0003"


def test_parse_credit_note_number():
    assert parse("CN-2026-0042") == (2026, 42)
    assert parse("CN-2027-0001") == (2027, 1)

    with pytest.raises(ValueError):
        parse("CN-26-42")
    with pytest.raises(ValueError):
        parse("XX-2026-0042")
