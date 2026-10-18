"""Percentage discounts.

A percentage discount is an object attached to a draft invoice. It knows its
label and how much it takes off a given amount.
"""

import pytest

from billing.discounts import PercentDiscount, total_discount
from billing.invoice import Invoice
from tests.helpers import assert_totals, make_invoice

LICENCE = ("Analytics suite, annual licence", 1, 10000)


def test_percent_discount_before_vat(customer):
    inv = Invoice(customer)
    inv.add_line(*LICENCE)
    inv.add_discount(PercentDiscount(10))

    assert_totals(inv, net=9000, tax=1800, gross=10800)


@pytest.mark.parametrize("percent", [-5, 101, 250])
def test_percent_out_of_range(percent):
    with pytest.raises(ValueError):
        PercentDiscount(percent)


def test_zero_percent_changes_nothing(customer):
    inv = make_invoice(customer, LICENCE)

    inv.add_discount(PercentDiscount(0))

    assert inv.net == 10000
    assert total_discount(inv) == 0
    assert len(inv.discounts) == 1


def test_percent_discount_label():
    assert PercentDiscount(15).label == "15% off"
    assert PercentDiscount(100).label == "100% off"
    assert PercentDiscount(0).label == "0% off"


def test_percent_discount_amount(customer):
    inv = make_invoice(
        customer,
        ("Analytics suite, annual licence", 2, 10000),
    )

    discount = inv.add_discount(PercentDiscount(25))

    assert discount.amount_for(inv.line_total) == 5000
    assert total_discount(inv) == 5000
