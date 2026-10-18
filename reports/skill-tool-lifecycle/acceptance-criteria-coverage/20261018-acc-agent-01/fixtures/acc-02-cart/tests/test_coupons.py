import pytest

from cart.service import Cart, CouponError


def test_save10_takes_ten_percent_off_subtotal():
    c = Cart()
    c.add("A1", 2)
    c.apply_coupon("SAVE10")
    assert c.discount() == 200


def test_second_coupon_rejected_and_first_kept():
    c = Cart()
    c.add("A1")
    c.apply_coupon("SAVE10")
    with pytest.raises(CouponError):
        c.apply_coupon("HALF")
    assert c.coupon == "SAVE10"


def test_unknown_coupon_rejected():
    c = Cart()
    c.add("A1")
    with pytest.raises(CouponError):
        c.apply_coupon("NOPE")
    assert c.coupon is None


def test_half_coupon_halves_subtotal():
    c = Cart()
    c.add("A1", 2)
    c.apply_coupon("HALF")
    assert c.discount() == 1000
