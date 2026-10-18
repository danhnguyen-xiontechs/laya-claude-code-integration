from cart.service import Cart


def test_total_never_negative():
    c = Cart()
    c.add("A1")
    c.apply_coupon("SAVE10")
    assert c.total() >= 0


def test_empty_cart_total_is_zero():
    assert Cart().total() == 0


def test_shipping_is_added_once():
    c = Cart()
    c.add("C3", 2)
    assert c.total() == 500 + 700
