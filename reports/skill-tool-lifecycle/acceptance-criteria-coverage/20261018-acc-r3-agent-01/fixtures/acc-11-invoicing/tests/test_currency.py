"""Money formatting.

format_money takes integer cents and a currency code; parse_money reads the
same text back.
"""

import pytest

from billing.currency import format_money, parse_money, symbol
from tests.snap import match_snapshot


def test_format_money_eur():
    assert format_money(1234550) == "12,345.50 EUR"
    assert format_money(100) == "1.00 EUR"


def test_format_money_small_and_zero():
    assert format_money(5) == "0.05 EUR"
    assert format_money(0) == "0.00 EUR"
    assert format_money(-1200, "GBP") == "-12.00 GBP"


def test_unknown_currency_raises():
    with pytest.raises(ValueError):
        format_money(100, "XYZ")

    with pytest.raises(ValueError):
        symbol("XYZ")

    assert symbol("EUR") == "€"


def test_parse_money_round_trip():
    for cents in (0, 5, 1200, 1234550, -990):
        text = format_money(cents)

        assert parse_money(text) == cents


def test_amount_table_snapshot():
    table = {
        str(cents): format_money(cents)
        for cents in (1, 99, 100, 100000, 123456789)
    }

    match_snapshot("amount_table", table)
