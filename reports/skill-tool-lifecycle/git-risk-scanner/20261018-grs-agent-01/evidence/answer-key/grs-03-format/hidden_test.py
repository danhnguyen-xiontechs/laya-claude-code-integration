from shop.format_utils import format_money, slugify


def test_money_zero_and_negative():
    assert format_money(0) == "0.00 USD"
    assert format_money(-1999, "EUR") == "-19.99 EUR"


def test_slug_collapses_and_strips():
    assert slugify("  A  b--C!! ") == "a-b-c"
    assert slugify("--x--") == "x"
