"""Receiving goods at the dock and on shelves.

ledger.receive(sku, location, qty, ref, unit) books a receipt move. The ref
is usually the purchase order number.
"""

import pytest

from stock.locations import UnknownLocation
from tests.helpers import BOLTS, DOCK, GLOVES, SHELF_A


def test_receive_increases_on_hand(ledger):
    ledger.receive(BOLTS, DOCK, 200, ref="PO-501")
    ledger.receive(BOLTS, SHELF_A, 20, ref="PO-502")

    assert ledger.on_hand_at(BOLTS, DOCK) == 200
    assert ledger.on_hand(BOLTS) == 220


def test_receipt_move_records_reference(ledger):
    move = ledger.receive(GLOVES, DOCK, 60, ref="PO-503")

    assert move.kind == "receipt"
    assert move.qty == 60
    assert move.ref == "PO-503"
    assert ledger.moves == [move]


def test_receive_several_skus_at_dock(ledger):
    ledger.receive(BOLTS, DOCK, 200, ref="PO-510")
    ledger.receive(GLOVES, DOCK, 40, ref="PO-510")
    ledger.receive(GLOVES, DOCK, 20, ref="PO-511")

    assert ledger.by_location(GLOVES) == {DOCK: 60}
    assert ledger.skus() == [BOLTS, GLOVES]
    assert [m.ref for m in ledger.moves_for(GLOVES)] == ["PO-510", "PO-511"]


def test_receive_non_positive_rejected(ledger):
    with pytest.raises(ValueError):
        ledger.receive(GLOVES, DOCK, 0)

    with pytest.raises(ValueError):
        ledger.receive(GLOVES, DOCK, -5)

    assert ledger.on_hand(GLOVES) == 0


def test_receive_into_unknown_location_rejected(ledger):
    with pytest.raises(UnknownLocation):
        ledger.receive(GLOVES, "X-00-00", 60, ref="PO-504")

    assert ledger.moves == []
    assert ledger.on_hand(GLOVES) == 0
