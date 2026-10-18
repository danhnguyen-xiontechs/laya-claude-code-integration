"""Issuing invoices, and what can still be changed afterwards.

Invoices are issued through an InvoiceBook, which keeps every invoice it has
issued. Once issued, the lines and discounts of an invoice are fixed.
"""

import pytest

from billing.discounts import PercentDiscount
from billing.invoice import Invoice, InvoiceLocked
from tests.helpers import BACKUP, HOSTING, ISSUE_DAY, check_issued, issued_invoice, make_invoice


def test_issue_sets_status(book, customer):
    inv = make_invoice(customer, HOSTING)

    book.issue(inv, ISSUE_DAY)

    check_issued(inv)


def test_issue_requires_lines(book, customer):
    inv = Invoice(customer)

    with pytest.raises(ValueError):
        book.issue(inv, ISSUE_DAY)

    assert inv.status == "draft"
    assert book.invoices == []


def test_issue_records_issue_date(book, customer):
    inv = make_invoice(customer, HOSTING)

    book.issue(inv, ISSUE_DAY)

    assert inv.issued_on == ISSUE_DAY
    assert inv in book.invoices


def test_issue_twice_raises(book, customer):
    inv = issued_invoice(book, customer, HOSTING)

    with pytest.raises(InvoiceLocked):
        book.issue(inv, ISSUE_DAY)

    assert book.invoices.count(inv) == 1


class TestLockedInvoice:
    def test_add_line_after_issue_raises(self, book, customer):
        inv = make_invoice(customer, HOSTING)
        book.issue(inv, ISSUE_DAY)

        with pytest.raises(InvoiceLocked):
            inv.add_line("Late extra: SSL certificate", 1, 500)

        assert len(inv.lines) == 1

    def test_remove_line_after_issue_raises(self, book, customer):
        inv = issued_invoice(book, customer, HOSTING, BACKUP)

        with pytest.raises(InvoiceLocked):
            inv.remove_line(0)

        assert len(inv.lines) == 2

    def test_discount_after_issue_raises(self, book, customer):
        inv = issued_invoice(book, customer, HOSTING)

        with pytest.raises(InvoiceLocked):
            inv.add_discount(PercentDiscount(5))

        assert inv.discounts == []

    def test_draft_accepts_more_lines(self, customer):
        inv = make_invoice(customer, HOSTING)

        inv.add_line(*BACKUP)

        assert len(inv.lines) == 2
        assert inv.status == "draft"
