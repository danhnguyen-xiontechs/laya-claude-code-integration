"""Transfers between locations.

transfer(ledger, sku, source, dest, qty) moves stock from one location to
another and records one move of kind "transfer".
"""

import pytest

from stock.locations import UnknownLocation
from stock.transfers import transfer
from tests.helpers import BOLTS, SHELF_A, SHELF_B, stock


def test_transfer_moves_quantity(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    transfer(ledger, BOLTS, SHELF_A, SHELF_B, 5)

    assert ledger.on_hand_at(BOLTS, SHELF_A) == 10 - 5
    assert ledger.on_hand_at(BOLTS, SHELF_B) == 0 + 5


def test_transfer_insufficient_stock_rejected(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    transfer(ledger, BOLTS, SHELF_A, SHELF_B, 4)

    assert ledger.moves[-1].kind == "transfer"


def test_transfer_to_same_location_rejected(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    with pytest.raises(ValueError):
        transfer(ledger, BOLTS, SHELF_A, SHELF_A, 4)


def test_transfer_to_unknown_location_rejected(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    with pytest.raises(UnknownLocation):
        transfer(ledger, BOLTS, SHELF_A, "Z-99-99", 4)


def test_transfer_zero_quantity_rejected(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    with pytest.raises(ValueError):
        transfer(ledger, BOLTS, SHELF_A, SHELF_B, 0)


def test_transfer_records_one_move(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)
    before = len(ledger.moves)

    transfer(ledger, BOLTS, SHELF_A, SHELF_B, 2)
    transfer(ledger, BOLTS, SHELF_B, SHELF_A, 1)

    assert len(ledger.moves) == before + 2
    assert [m.kind for m in ledger.moves[before:]] == ["transfer", "transfer"]


def test_transfer_keeps_reference(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)

    move = transfer(ledger, BOLTS, SHELF_A, SHELF_B, 3, ref="REPLEN-7")

    assert move.ref == "REPLEN-7"
    assert move.location == SHELF_A
    assert move.to_location == SHELF_B
    assert move.qty == 3
