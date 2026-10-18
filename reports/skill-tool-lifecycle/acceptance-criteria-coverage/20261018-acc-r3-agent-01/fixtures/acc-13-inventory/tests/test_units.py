"""Units of measure.

Stock is kept in single units. Goods arrive in boxes of 12 or pallets of
480, and receipts convert to units on the way in.
"""

import pytest

from stock.ledger import UNITS, to_each
from tests.helpers import DOCK, WASHERS


@pytest.mark.parametrize(
    "qty, unit, each",
    [
        (1, "each", 1),
        (3, "box", 36),
        (2, "pallet", 960),
        (0, "box", 0),
    ],
)
def test_conversion_to_each(qty, unit, each):
    assert to_each(qty, unit) == each


def test_unknown_unit_raises():
    with pytest.raises(ValueError):
        to_each(1, "crate")

    assert sorted(UNITS) == ["box", "each", "pallet"]


def test_receive_in_boxes(ledger):
    move = ledger.receive(WASHERS, DOCK, 5, ref="PO-601", unit="box")

    assert move.qty == 60
    assert move.kind == "receipt"
    assert move.ref == "PO-601"
    assert ledger.on_hand(WASHERS) == 60

    ledger.receive(WASHERS, DOCK, 7, ref="PO-602")

    assert ledger.on_hand(WASHERS) == 67


def test_receive_pallet(ledger):
    ledger.receive(WASHERS, DOCK, 1, unit="pallet")

    assert ledger.on_hand_at(WASHERS, DOCK) == 480

    with pytest.raises(ValueError):
        ledger.receive(WASHERS, DOCK, 1, unit="crate")

    assert ledger.on_hand_at(WASHERS, DOCK) == 480
