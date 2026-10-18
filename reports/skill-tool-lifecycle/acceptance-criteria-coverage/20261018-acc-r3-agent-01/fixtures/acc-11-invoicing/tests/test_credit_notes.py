"""Credit notes.

A credit note reverses money on an issued invoice: the whole invoice, or one
of its lines.
"""

from billing.credit import credit_line, credited_total, void
from tests.helpers import ISSUE_DAY, ONBOARDING, SUPPORT, days_after_issue, issued_invoice, make_invoice


def test_reversal_amount_matches_original(book, sequence, customer):
    original = make_invoice(customer, SUPPORT, ONBOARDING)
    book.issue(original, ISSUE_DAY)

    reversal = void(original, sequence, days_after_issue(5))

    assert reversal.amount == original.gross
    assert reversal.amount == 42000


def test_credit_note_keeps_reason(book, sequence, customer):
    inv = issued_invoice(book, customer, SUPPORT)

    note = void(inv, sequence, ISSUE_DAY, reason="duplicate order")

    assert note.reason == "duplicate order"
    assert note.issued_on == ISSUE_DAY


def test_line_credit_amount_includes_vat(book, sequence, customer):
    inv = issued_invoice(
        book,
        customer,
        SUPPORT,
        ("Onboarding call", 1, 1000),
    )

    note = credit_line(inv, 1, sequence, ISSUE_DAY)

    assert note.amount == 1200
    assert inv.status == "issued"


def test_credit_note_gets_its_own_number(book, sequence, customer):
    inv = issued_invoice(book, customer, SUPPORT)

    note = credit_line(inv, 0, sequence, ISSUE_DAY)

    assert note.number == "CN-2026-0001"
    assert note.invoice_number == inv.number


def test_credited_total_adds_line_credits(book, sequence, customer):
    inv = issued_invoice(
        book,
        customer,
        ("Licence A", 1, 1000),
        ("Licence B", 1, 2000),
        ("Licence C", 1, 3000),
    )

    credit_line(inv, 0, sequence, ISSUE_DAY)
    credit_line(inv, 2, sequence, ISSUE_DAY)

    assert credited_total(inv) == 1200 + 3600
    assert len(inv.credit_notes) == 2
