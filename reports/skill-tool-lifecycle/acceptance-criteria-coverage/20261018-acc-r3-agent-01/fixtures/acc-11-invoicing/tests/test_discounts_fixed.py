"""Fixed-amount discounts.

A fixed discount takes a set number of cents off the invoice net. Several
fixed discounts can be combined, and they come after percentage discounts.
"""

import pytest

from billing.discounts import FixedDiscount, PercentDiscount
from billing.invoice import Invoice
from tests.helpers import make_invoice

SEAT = ("Workshop seat, Berlin", 2, 1500)


def test_fixed_discount_never_negative(customer):
    inv = Invoice(customer)
    inv.add_line(*SEAT)
    inv.add_discount(FixedDiscount(500))

    assert inv.net == 2500


def test_fixed_discount_lowers_gross_too(customer):
    inv = make_invoice(customer, SEAT)

    inv.add_discount(FixedDiscount(1000))

    assert inv.net == 2000
    assert inv.tax == 400
    assert inv.gross == 2400


def test_fixed_amount_must_be_positive():
    with pytest.raises(ValueError):
        FixedDiscount(0)

    with pytest.raises(ValueError):
        FixedDiscount(-250)


def test_two_fixed_discounts_add_up(customer):
    inv = make_invoice(customer, SEAT)

    inv.add_discount(FixedDiscount(500))
    inv.add_discount(FixedDiscount(700))

    assert inv.net == 3000 - 500 - 700
    assert len(inv.discounts) == 2


def test_fixed_applied_after_percent(customer):
    inv = make_invoice(
        customer,
        ("Analytics suite, annual licence", 1, 10000),
    )

    inv.add_discount(FixedDiscount(1000))
    inv.add_discount(PercentDiscount(10))

    assert inv.net == 8000
