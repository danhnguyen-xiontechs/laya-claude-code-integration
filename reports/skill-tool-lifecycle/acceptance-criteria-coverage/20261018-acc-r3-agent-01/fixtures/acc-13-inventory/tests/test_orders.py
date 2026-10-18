"""Customer orders.

Placing an order reserves its lines; shipping issues the stock from a
location. Orders that have not shipped can be cancelled.
"""

import pytest

from stock.orders import Order, OrderLine
from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, stock


def _order(order_id, paid=0):
    """An order for 4 bolts and 10 nuts."""
    return Order(
        order_id,
        [
            OrderLine(BOLTS, 4),
            OrderLine(NUTS, 10),
        ],
        paid=paid,
    )


def test_place_reserves_lines(ledger, book, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4001")

    assert order.status == "open"

    orders.place(order, NOW)

    assert order.status == "placed"
    assert [(r.sku, r.qty) for r in book.for_order("SO-4001")] == [
        (BOLTS, 4),
        (NUTS, 10),
    ]
    assert all(r.order_id == "SO-4001" for r in book.for_order("SO-4001"))


def test_order_without_lines_rejected(orders):
    order = Order("SO-4000")

    with pytest.raises(ValueError):
        orders.place(order, NOW)

    assert order.status == "open"


def test_cancel_sets_status(ledger, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4002")
    orders.place(order, NOW)

    orders.cancel(order)

    assert order.status == "cancelled"


def test_cancel_refunds_paid_amount(ledger, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4003", paid=12900)
    orders.place(order, NOW)

    assert order.refunded == 0

    orders.cancel(order)

    assert order.refunded == 12900
    assert order.paid == 12900


def test_ship_issues_stock(ledger, book, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4004")
    orders.place(order, NOW)

    orders.ship(order, SHELF_A)

    assert order.status == "shipped"
    assert ledger.on_hand(BOLTS) == 6
    assert ledger.on_hand(NUTS) == 40
    assert [m.ref for m in ledger.moves if m.kind == "issue"] == ["SO-4004", "SO-4004"]


def test_cancelled_order_cannot_ship(ledger, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4006")
    orders.place(order, NOW)
    orders.cancel(order)

    with pytest.raises(ValueError):
        orders.ship(order, SHELF_A)

    assert ledger.on_hand(BOLTS) == 10
    assert order.status == "cancelled"


def test_shipped_order_cannot_be_cancelled(ledger, orders):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 50)
    order = _order("SO-4005", paid=12900)
    orders.place(order, NOW)
    orders.ship(order, SHELF_A)

    with pytest.raises(ValueError):
        orders.cancel(order)

    assert order.status == "shipped"
    assert order.refunded == 0
