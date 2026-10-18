from shop.billing import apply_discount, invoice_total


def test_negative_pct_never_raises_total():
    assert apply_discount(1000, -10) == 1000


def test_over_100_percent_is_free_not_negative():
    assert apply_discount(1000, 150) == 0


def test_half_cent_rounds_up():
    assert apply_discount(5, 50) == 3
    assert apply_discount(25, 50) == 13


def test_none_line_skipped():
    assert invoice_total([None, {"qty": 1, "price_cents": 300}]) == 300


def test_missing_qty_counts_zero():
    assert invoice_total([{"price_cents": 300}, {"qty": 2, "price_cents": 100}]) == 200
