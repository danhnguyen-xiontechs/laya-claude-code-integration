"""The stock ledger.

The ledger keeps on-hand quantity per SKU and location. Outgoing moves
(issue, scrap) take stock off a location.
"""

import pytest

from stock.ledger import NegativeStock
from stock.locations import UnknownLocation
from tests.helpers import BOLTS, NUTS, SHELF_A, SHELF_B, stock


@pytest.mark.parametrize("kind", ["issue", "scrap"])
def test_short_move_rejected(ledger, kind):
    stock(ledger, BOLTS, SHELF_A, 3)

    with pytest.raises(NegativeStock):
        ledger.move(kind, BOLTS, SHELF_A, 5, reason="damaged in handling")


def test_on_hand_starts_at_zero(ledger):
    assert ledger.on_hand(BOLTS) == 0
    assert ledger.on_hand_at(BOLTS, SHELF_A) == 0
    assert ledger.skus() == []
    assert ledger.moves == []


def test_on_hand_total_across_locations(ledger):
    stock(ledger, BOLTS, SHELF_A, 40)
    stock(ledger, BOLTS, SHELF_B, 25)
    stock(ledger, NUTS, SHELF_A, 100)

    assert ledger.on_hand(BOLTS) == 65
    assert ledger.on_hand(NUTS) == 100
    assert ledger.by_location(BOLTS) == {SHELF_A: 40, SHELF_B: 25}

    ledger.issue(BOLTS, SHELF_B, 5)

    assert ledger.on_hand(BOLTS) == 60
    assert ledger.skus() == [BOLTS, NUTS]


def test_issue_reduces_on_hand(ledger):
    stock(ledger, BOLTS, SHELF_A, 40)

    move = ledger.issue(BOLTS, SHELF_A, 15, ref="SO-1001")

    assert ledger.on_hand_at(BOLTS, SHELF_A) == 25
    assert move.kind == "issue"
    assert move.qty == -15

    ledger.issue(BOLTS, SHELF_A, 25, ref="SO-1002")

    assert ledger.on_hand_at(BOLTS, SHELF_A) == 0


def test_issue_quantity_must_be_positive(ledger):
    stock(ledger, NUTS, SHELF_B, 10)

    with pytest.raises(ValueError):
        ledger.issue(NUTS, SHELF_B, 0)

    with pytest.raises(ValueError):
        ledger.issue(NUTS, SHELF_B, -3)


def test_unknown_location_rejected(ledger):
    with pytest.raises(UnknownLocation):
        ledger.receive(BOLTS, "Z-99-99", 10)

    assert ledger.on_hand(BOLTS) == 0
    assert ledger.moves == []
