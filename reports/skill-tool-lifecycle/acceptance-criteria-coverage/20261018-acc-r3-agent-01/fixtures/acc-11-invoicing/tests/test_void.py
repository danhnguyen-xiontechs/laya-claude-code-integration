"""Voiding invoices.

void() takes an issued invoice, the credit-note sequence and the day of the
void. Drafts and invoices that are already void cannot be voided.
"""

import pytest

from billing.credit import void
from billing.invoice import Invoice
from tests.helpers import ISSUE_DAY, ONBOARDING, SUPPORT, days_after_issue, issued_invoice, make_invoice


def test_void_creates_credit_note(book, sequence, customer):
    inv = make_invoice(customer, SUPPORT)
    book.issue(inv, ISSUE_DAY)

    note = void(inv, sequence, days_after_issue(3))

    assert note in inv.credit_notes
    assert note.invoice_number == inv.number


def test_void_sets_status_void(book, sequence, customer):
    inv = issued_invoice(book, customer, SUPPORT)

    void(inv, sequence, ISSUE_DAY)

    assert inv.status == "void"
    assert inv.payment_state(days_after_issue(60)) == "void"


def test_void_draft_raises(sequence, customer):
    inv = Invoice(customer)
    inv.add_line(*SUPPORT)

    with pytest.raises(ValueError):
        void(inv, sequence, ISSUE_DAY)

    assert inv.status == "draft"
    assert inv.credit_notes == []


def test_void_twice_raises(book, sequence, customer):
    inv = issued_invoice(book, customer, SUPPORT)
    void(inv, sequence, ISSUE_DAY)

    with pytest.raises(ValueError):
        void(inv, sequence, ISSUE_DAY)

    assert len(inv.credit_notes) == 1


def test_void_keeps_lines(book, sequence, customer):
    inv = issued_invoice(book, customer, SUPPORT, ONBOARDING)

    void(inv, sequence, ISSUE_DAY)

    assert [line.description for line in inv.lines] == [
        "Support plan, annual",
        "Onboarding workshop",
    ]
