"""Shared builders and checks for the billing tests."""

from datetime import date, timedelta

from billing.invoice import Invoice

ISSUE_DAY = date(2026, 3, 2)

HOSTING = ("Managed hosting, monthly", 1, 4000)
BACKUP = ("Offsite backup add-on", 1, 500)
SUPPORT = ("Support plan, annual", 1, 20000)
ONBOARDING = ("Onboarding workshop", 2, 7500)


def make_invoice(customer, *lines, rate="standard"):
    """A draft invoice with (description, quantity, unit_price) lines."""
    inv = Invoice(customer, rate=rate)
    for description, quantity, unit_price in lines:
        inv.add_line(description, quantity, unit_price)
    return inv


def issued_invoice(book, customer, *lines, on=ISSUE_DAY):
    """An invoice issued through the book on the given day."""
    inv = make_invoice(customer, *lines)
    book.issue(inv, on)
    return inv


def days_after_issue(days):
    return ISSUE_DAY + timedelta(days=days)


def assert_totals(inv, net, tax, gross):
    assert inv.net == net
    assert inv.tax == tax
    assert inv.gross == gross


def check_issued(inv):
    assert inv.status == "issued"
