from cart.service import Cart


def test_remove_item_deletes_the_line():
    c = Cart()
    c.add("A1")
    c.add("C3")
    c.remove("A1")
    assert "A1" not in c.lines
    assert "C3" in c.lines


def test_remove_last_item_empties_cart():
    c = Cart()
    c.add("A1")
    c.remove("A1")
    assert c.lines == {}
    assert c.total() == 0


def test_remove_unknown_sku_is_a_noop():
    c = Cart()
    c.add("A1")
    c.remove("ZZ")
    assert c.lines == {"A1": 1}
