"""Cycle counts.

A counter counts one SKU on one location and CycleCount.record() compares
the number with the ledger.
"""

import pytest

from stock.counts import count_sheet
from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, SHELF_B, stock


def test_stocktake_variance_posts_correction(ledger, counts):
    stock(ledger, BOLTS, SHELF_A, 20)

    counts.record(BOLTS, SHELF_A, counted=17, counted_by="mia", now=NOW)

    move = ledger.moves[-1]

    assert move.kind == "adjustment"
    assert move.reason == "count"
    assert move.qty == -3


def test_count_without_difference_posts_nothing(ledger, counts):
    stock(ledger, BOLTS, SHELF_A, 20)
    moves_before = len(ledger.moves)

    result = counts.record(BOLTS, SHELF_A, counted=20, counted_by="mia", now=NOW)

    assert result.variance == 0
    assert len(ledger.moves) == moves_before


def test_count_result_recorded(ledger, counts):
    stock(ledger, NUTS, SHELF_B, 80)

    result = counts.record(NUTS, SHELF_B, counted=82, counted_by="leo", now=NOW)

    assert counts.results == [result]
    assert (result.expected, result.counted, result.variance) == (80, 82, 2)
    assert result.counted_by == "leo"
    assert result.at == NOW
    assert result.location == SHELF_B


def test_count_references_are_numbered(ledger, counts):
    stock(ledger, BOLTS, SHELF_A, 20)
    stock(ledger, NUTS, SHELF_B, 80)

    counts.record(BOLTS, SHELF_A, counted=19, counted_by="mia", now=NOW)
    counts.record(NUTS, SHELF_B, counted=80, counted_by="mia", now=NOW)
    counts.record(NUTS, SHELF_B, counted=81, counted_by="leo", now=NOW)

    refs = [m.ref for m in ledger.moves if m.ref.startswith("count-")]

    assert refs == ["count-1", "count-3"]
    assert len(counts.results) == 3


def test_negative_count_rejected(ledger, counts):
    stock(ledger, BOLTS, SHELF_A, 20)

    with pytest.raises(ValueError):
        counts.record(BOLTS, SHELF_A, counted=-1, counted_by="mia", now=NOW)

    assert counts.results == []


def test_count_sheet_lists_locations(ledger):
    stock(ledger, BOLTS, SHELF_A, 20)
    stock(ledger, NUTS, SHELF_A, 50)
    stock(ledger, NUTS, SHELF_B, 10)

    sheet = count_sheet(ledger, [SHELF_A, SHELF_B])

    assert [(row["location"], row["sku"]) for row in sheet] == [
        (SHELF_A, BOLTS),
        (SHELF_A, NUTS),
        (SHELF_B, NUTS),
    ]
    assert all(row["counted"] is None for row in sheet)
