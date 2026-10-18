"""How amounts are rounded for display.

round_for_display takes an amount in major units (euros, not cents) and
returns the text shown on screen.
"""

from decimal import Decimal

from billing.currency import round_for_display


def test_display_rounds_half_up():
    assert round_for_display(Decimal("10.005")) == "10.01"
    assert round_for_display(Decimal("0.125")) == "0.13"
    assert round_for_display(Decimal("2.675")) == "2.68"


def test_display_rounds_down_below_half():
    assert round_for_display(Decimal("10.004")) == "10.00"
    assert round_for_display(Decimal("3.3333")) == "3.33"


def test_display_pads_two_decimals():
    assert round_for_display(Decimal("7.5")) == "7.50"
    assert round_for_display(Decimal("12")) == "12.00"
    assert round_for_display(0) == "0.00"


def test_display_negative_amount():
    assert round_for_display(Decimal("-4.255")) == "-4.26"
    assert round_for_display(Decimal("-0.004")) == "-0.00"
