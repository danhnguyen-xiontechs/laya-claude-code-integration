"""Reservations that lapse.

release_expired(now) is run by a scheduler; it releases every reservation
that has lapsed by then and returns the released ones. Confirmed
reservations stay until their order ships or is changed.
"""

import pytest

from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, assert_released, hours_later, stock


@pytest.mark.parametrize("hours, expected", [(47, False), (48, True)])
def test_release_after_hours(ledger, book, hours, expected):
    stock(ledger, BOLTS, SHELF_A, 10)
    book.reserve(BOLTS, 4, order_id="SO-2001", now=NOW)

    book.release_expired(hours_later(hours))

    assert_released(book.status(BOLTS), expected)


def test_confirmed_reservation_is_kept(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    res = book.reserve(BOLTS, 4, order_id="SO-2002", now=NOW)
    book.confirm(res.id)

    released = book.release_expired(hours_later(200))

    assert released == []
    assert book.reserved(BOLTS) == 4

    status = book.status(BOLTS)

    assert (status.on_hand, status.reserved, status.available) == (10, 4, 6)


def test_only_old_reservations_released(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_A, 10)
    old = book.reserve(BOLTS, 4, order_id="SO-2003", now=NOW)
    fresh = book.reserve(NUTS, 3, order_id="SO-2004", now=hours_later(40))

    released = book.release_expired(hours_later(50))

    assert released == [old]
    assert fresh.released is False


def test_expiry_time(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    res = book.reserve(BOLTS, 4, order_id="SO-2005", now=NOW)

    assert book.expires_at(res) == hours_later(48)

    book.confirm(res.id)

    assert book.expires_at(res) is None
