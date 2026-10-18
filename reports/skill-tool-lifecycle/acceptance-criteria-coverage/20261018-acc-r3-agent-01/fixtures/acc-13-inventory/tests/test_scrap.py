"""Scrapping damaged stock.

Damaged goods usually go to the quarantine cage first and are scrapped
there with a reason.
"""

import pytest

from tests.helpers import GLOVES, QUARANTINE, SHELF_A, stock


def test_scrap_reduces_on_hand(ledger):
    stock(ledger, GLOVES, QUARANTINE, 30)

    ledger.scrap(GLOVES, QUARANTINE, 12, reason="water damage")

    assert ledger.on_hand_at(GLOVES, QUARANTINE) == 18


def test_scrap_records_reason(ledger):
    stock(ledger, GLOVES, QUARANTINE, 30)

    move = ledger.scrap(GLOVES, QUARANTINE, 2, reason="torn packaging")

    assert move.kind == "scrap"
    assert move.reason == "torn packaging"
    assert move.location == QUARANTINE


def test_scrap_requires_reason(ledger):
    stock(ledger, GLOVES, SHELF_A, 30)

    with pytest.raises(ValueError):
        ledger.scrap(GLOVES, SHELF_A, 2, reason="")

    assert ledger.on_hand_at(GLOVES, SHELF_A) == 30


def test_scrap_zero_rejected(ledger):
    stock(ledger, GLOVES, QUARANTINE, 30)

    with pytest.raises(ValueError):
        ledger.scrap(GLOVES, QUARANTINE, 0, reason="nothing")

    assert len(ledger.moves) == 1


def test_scrap_move_is_negative(ledger):
    stock(ledger, GLOVES, QUARANTINE, 30)

    ledger.scrap(GLOVES, QUARANTINE, 5, reason="expired")

    assert ledger.moves[-1].qty == -5
    assert sum(m.qty for m in ledger.moves_for(GLOVES)) == 25
