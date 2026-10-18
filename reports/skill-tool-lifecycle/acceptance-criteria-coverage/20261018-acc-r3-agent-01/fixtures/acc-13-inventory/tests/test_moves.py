"""The move history.

Every change of on-hand is a Move with a kind, a signed quantity, the
location and an optional reason and reference.
"""

from tests.helpers import BOLTS, NUTS, SHELF_A, SHELF_B, stock


def test_moves_recorded_in_order(ledger):
    stock(ledger, BOLTS, SHELF_A, 50)
    ledger.issue(BOLTS, SHELF_A, 10)
    ledger.scrap(BOLTS, SHELF_A, 2, reason="rusted")
    ledger.adjust(BOLTS, SHELF_A, 1, reason="found behind shelf")

    kinds = [m.kind for m in ledger.moves]

    assert kinds == [
        "receipt",
        "issue",
        "scrap",
        "adjustment",
    ]
    assert ledger.on_hand_at(BOLTS, SHELF_A) == 39


def test_move_quantities_are_signed(ledger):
    stock(ledger, BOLTS, SHELF_A, 50)
    ledger.issue(BOLTS, SHELF_A, 10)
    ledger.scrap(BOLTS, SHELF_A, 2, reason="rusted")

    quantities = [m.qty for m in ledger.moves]

    assert quantities == [50, -10, -2]
    assert sum(quantities) == ledger.on_hand(BOLTS)


def test_moves_filtered_by_sku(ledger):
    stock(ledger, BOLTS, SHELF_A, 50)
    stock(ledger, NUTS, SHELF_B, 80)
    ledger.issue(NUTS, SHELF_B, 30)

    nut_moves = ledger.moves_for(NUTS)

    assert [m.kind for m in nut_moves] == ["receipt", "issue"]
    assert all(m.sku == NUTS for m in nut_moves)


def test_move_keeps_reference(ledger):
    stock(ledger, BOLTS, SHELF_A, 50)

    move = ledger.issue(BOLTS, SHELF_A, 5, ref="SO-1042")
    scrapped = ledger.scrap(BOLTS, SHELF_A, 1, reason="bent thread")

    assert move.ref == "SO-1042"
    assert move.location == SHELF_A
    assert ledger.moves[0].ref == "opening balance"
    assert scrapped.reason == "bent thread"
    assert scrapped.ref == ""


def test_adjustment_can_go_either_way(ledger):
    stock(ledger, NUTS, SHELF_B, 80)

    up = ledger.adjust(NUTS, SHELF_B, 4, reason="found in returns bin")
    down = ledger.adjust(NUTS, SHELF_B, -6, reason="label mix-up")

    assert (up.qty, down.qty) == (4, -6)
    assert up.kind == down.kind == "adjustment"
    assert ledger.on_hand_at(NUTS, SHELF_B) == 78
