"""Draft invoices.

A draft can be changed freely until it is issued: lines and discounts can be
added and removed, and a draft can be copied to start a similar invoice.
"""

from billing.discounts import FixedDiscount
from billing.invoice import Invoice
from tests.helpers import BACKUP, HOSTING, make_invoice


def test_new_invoice_is_draft(customer):
    inv = Invoice(customer)

    assert inv.status == "draft"
    assert inv.issued_on is None
    assert inv.credit_notes == []


def test_draft_line_can_be_removed(customer):
    inv = make_invoice(customer, HOSTING, BACKUP)

    removed = inv.remove_line(0)

    assert removed.description == "Managed hosting, monthly"
    assert [line.description for line in inv.lines] == ["Offsite backup add-on"]


def test_draft_discount_can_be_removed(customer):
    inv = make_invoice(customer, HOSTING)
    discount = inv.add_discount(FixedDiscount(1000))

    inv.remove_discount(discount)

    assert inv.discounts == []
    assert inv.net == 4000


def test_draft_copy_has_same_lines(customer):
    inv = make_invoice(customer, HOSTING, ("Offsite backup add-on", 3, 500))

    twin = inv.copy()

    assert [(l.description, l.quantity) for l in twin.lines] == [
        ("Managed hosting, monthly", 1),
        ("Offsite backup add-on", 3),
    ]
    assert twin.lines[0] is not inv.lines[0]


def test_draft_copy_is_a_new_draft(customer):
    inv = make_invoice(customer, HOSTING)

    twin = inv.copy()

    assert twin.status == "draft"
    assert twin.customer is inv.customer


def test_draft_copy_keeps_rate_and_is_separate(customer):
    inv = make_invoice(
        customer,
        ("Printed user manuals", 10, 500),
        rate="reduced",
    )

    twin = inv.copy()
    twin.add_line("Spiral binding", 10, 100)

    assert twin.rate == "reduced"
    assert len(inv.lines) == 1
    assert len(twin.lines) == 2
