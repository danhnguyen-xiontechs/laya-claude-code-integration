"""VAT rates and the VAT amount on an invoice.

Rates are looked up by code; the invoice applies its rate to the net.
"""

from decimal import Decimal

import pytest

from billing.invoice import RATES, VAT_RATE, rate_for, rate_label
from tests.helpers import make_invoice


@pytest.mark.parametrize(
    "net, expected_tax",
    [
        (1000, 200),
        (2500, 500),
        (9995, 1999),
        (105, 21),
        (123450, 24690),
    ],
)
def test_vat_amount(customer, net, expected_tax):
    inv = make_invoice(customer, ("Professional services", 1, net))

    assert inv.net == net
    assert inv.tax == expected_tax


def test_standard_rate_constant():
    assert VAT_RATE == Decimal("0.20")
    assert RATES["standard"] is VAT_RATE
    assert rate_for("standard") == Decimal("0.20")


def test_reduced_rate_invoice(customer):
    inv = make_invoice(
        customer,
        ("Printed user manuals", 4, 500),
        rate="reduced",
    )

    assert inv.rate == "reduced"
    assert inv.net == 2000
    assert inv.tax == 100
    assert inv.gross == 2100


def test_unknown_rate_code_raises(customer):
    with pytest.raises(ValueError):
        rate_for("luxury")

    with pytest.raises(ValueError):
        make_invoice(
            customer,
            ("Yacht charter", 1, 900000),
            rate="luxury",
        )


def test_rate_label_as_percent():
    labels = {code: rate_label(code) for code in ("standard", "reduced", "zero")}

    assert labels == {
        "standard": "20%",
        "reduced": "5%",
        "zero": "0%",
    }
