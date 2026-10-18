import pytest

from cart.service import Cart, OutOfStock


def test_out_of_stock_item_rejected():
    c = Cart()
    with pytest.raises(OutOfStock):
        c.add("B2")


def test_cannot_add_more_than_available():
    c = Cart()
    c.add("A1", 5)
    with pytest.raises(OutOfStock):
        c.add("A1")
