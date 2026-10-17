from ordersapi import Order, total_for
from ordersapi.debug import dump_order


def make_order():
    return Order([(100, 2), (50, 1)])


def test_total():
    assert make_order().total() == 250


def test_total_for():
    assert total_for(make_order()) == 300


def test_dump():
    assert "Order" in dump_order(make_order())
