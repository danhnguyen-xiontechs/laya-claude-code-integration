"""Invoice totals.

The totals are integer cents: the line total, the net after discounts, the
tax on the net and the gross amount the customer pays.
"""

from billing.invoice import Invoice
from tests.helpers import BACKUP, HOSTING, make_invoice

SENIOR_RATE = 12000
JUNIOR_RATE = 6000
TRAVEL_FEE = 4550


def test_net_is_sum_of_lines(customer):
    inv = Invoice(customer)
    inv.add_line("Consulting, senior (hours)", 3, SENIOR_RATE)
    inv.add_line("Consulting, junior (hours)", 5, JUNIOR_RATE)
    inv.add_line("Travel flat fee", 1, TRAVEL_FEE)

    expected = 3 * SENIOR_RATE + 5 * JUNIOR_RATE + 1 * TRAVEL_FEE

    assert inv.net == expected
    assert inv.net == 70550


def test_empty_invoice_totals_zero(invoice):
    assert invoice.lines == []

    assert invoice.line_total == 0
    assert invoice.net == 0
    assert invoice.tax == 0
    assert invoice.gross == 0


def test_gross_is_net_plus_tax(customer):
    inv = make_invoice(
        customer,
        ("Managed hosting, monthly", 1, 1000),
    )

    assert inv.gross == inv.net + inv.tax
    assert inv.gross == 1200


def test_totals_follow_removed_line(customer):
    inv = make_invoice(customer, HOSTING, BACKUP)
    assert inv.net == 4500

    removed = inv.remove_line(1)

    assert removed.description == "Offsite backup add-on"
    assert inv.net == 4000
    assert len(inv.lines) == 1


def test_line_total_before_discounts(customer):
    inv = make_invoice(
        customer,
        ("Managed hosting, monthly", 2, 1000),
        ("Domain renewals", 3, 1500),
    )

    assert inv.line_total == 2 * 1000 + 3 * 1500
    assert inv.line_total == 6500
