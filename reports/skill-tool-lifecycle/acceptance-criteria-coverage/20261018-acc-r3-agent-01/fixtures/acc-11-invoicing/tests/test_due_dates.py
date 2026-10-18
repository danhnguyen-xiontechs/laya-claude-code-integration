"""Due dates and payment state.

payment_state(today) answers draft, open, overdue, paid or void. Payment is
recorded with mark_paid(day) and is only possible on an issued invoice.
"""

import pytest

from billing.invoice import Invoice
from tests.helpers import HOSTING, ISSUE_DAY, days_after_issue, issued_invoice


@pytest.mark.parametrize(
    "age_days, expected",
    [(10, "open"), (29, "open"), (30, "overdue"), (45, "overdue")],
)
def test_status_by_age(book, customer, age_days, expected):
    inv = issued_invoice(book, customer, HOSTING)

    today = days_after_issue(age_days)

    assert inv.payment_state(today) == expected


def test_due_date_is_thirty_days_after_issue(book, customer):
    inv = issued_invoice(book, customer, HOSTING)

    assert inv.due_date == days_after_issue(30)
    assert inv.issued_on == ISSUE_DAY


def test_paid_invoice_is_paid(book, customer):
    inv = issued_invoice(book, customer, HOSTING)

    inv.mark_paid(days_after_issue(12))

    assert inv.payment_state(days_after_issue(12)) == "paid"
    assert inv.paid_on == days_after_issue(12)


def test_draft_cannot_be_paid(customer):
    inv = Invoice(customer)
    inv.add_line(*HOSTING)

    with pytest.raises(ValueError):
        inv.mark_paid(ISSUE_DAY)

    assert inv.due_date is None
    assert inv.payment_state(ISSUE_DAY) == "draft"


def test_days_overdue_count(book, customer):
    inv = issued_invoice(book, customer, HOSTING)

    assert inv.days_overdue(days_after_issue(40)) == 10
    assert inv.days_overdue(days_after_issue(5)) == 0
