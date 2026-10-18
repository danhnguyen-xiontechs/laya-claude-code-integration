"""Reservations.

ReservationBook.reserve(sku, qty, order_id, now) holds stock for an order.
available(sku) is what is left for new reservations.
"""

import pytest

from stock.reservations import InsufficientStock
from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, SHELF_B, stock


def test_reserve_reduces_available(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)

    book.reserve(BOLTS, 4, order_id="SO-1001", now=NOW)

    assert book.available(BOLTS) == 6
    assert ledger.on_hand(BOLTS) == 10


def test_over_reserve_rejected(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)

    with pytest.raises(InsufficientStock):
        book.reserve(BOLTS, 11, order_id="SO-1002", now=NOW)


def test_confirm_marks_reservation(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    res = book.reserve(BOLTS, 4, order_id="SO-1003", now=NOW)
    assert res.confirmed is False

    book.confirm(res.id)

    assert book.reservations[res.id].confirmed is True
    assert book.reserved(BOLTS) == 4
    assert book.available(BOLTS) == 6
    assert res.order_id == "SO-1003"


def test_release_restores_available(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    res = book.reserve(BOLTS, 4, order_id="SO-1004", now=NOW)
    other = book.reserve(BOLTS, 3, order_id="SO-1104", now=NOW)
    assert book.available(BOLTS) == 3

    book.release(res.id)

    assert book.available(BOLTS) == 7
    assert book.reserved(BOLTS) == 3
    assert other.released is False

    book.release(other.id)

    assert book.available(BOLTS) == 10
    assert book.reserved(BOLTS) == 0


def test_reservations_listed_per_order(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_B, 20)
    first = book.reserve(BOLTS, 2, order_id="SO-1005", now=NOW)
    second = book.reserve(NUTS, 6, order_id="SO-1005", now=NOW)
    book.reserve(NUTS, 3, order_id="SO-1006", now=NOW)

    held = book.for_order("SO-1005")

    assert held == [first, second]
    assert [r.id for r in held] == ["R-00001", "R-00002"]


def test_reserve_zero_rejected(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)

    with pytest.raises(ValueError):
        book.reserve(BOLTS, 0, order_id="SO-1007", now=NOW)

    with pytest.raises(ValueError):
        book.reserve(BOLTS, -2, order_id="SO-1007", now=NOW)
