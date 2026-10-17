from cart.service import Cart


def test_add_single_item_sets_quantity_and_subtotal():
    c = Cart()
    c.add("A1")
    assert c.lines == {"A1": 1}
    assert c.subtotal() == 1000


def test_add_same_sku_twice_merges_lines():
    c = Cart()
    c.add("A1")
    c.add("A1")
    assert c.lines == {"A1": 2}
    assert len(c.lines) == 1
    assert c.subtotal() == 2000


def test_two_different_skus_make_two_lines():
    c = Cart()
    c.add("A1")
    c.add("C3", 2)
    assert set(c.lines) == {"A1", "C3"}
