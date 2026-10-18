"""Reorder rules and purchase suggestions.

A rule says: when available stock of a SKU drops below the reorder point,
suggest buying qty units from the supplier.
"""

import pytest

from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, stock


def test_suggestion_created_below_point(ledger, book, reorder):
    stock(ledger, BOLTS, SHELF_A, 12)
    reorder.add_rule(BOLTS, point=10, qty=50, supplier="FAST")
    book.reserve(BOLTS, 5, order_id="SO-3001", now=NOW)

    reorder.check(BOLTS, NOW)

    assert reorder.suggestions[0].sku == BOLTS


def test_no_suggestion_above_point(ledger, book, reorder):
    stock(ledger, BOLTS, SHELF_A, 30)
    reorder.add_rule(BOLTS, point=10, qty=50, supplier="FAST")
    book.reserve(BOLTS, 5, order_id="SO-3002", now=NOW)

    result = reorder.check(BOLTS, NOW)

    assert result is None
    assert reorder.suggestions == []


def test_suggestion_takes_quantity_from_rule(ledger, reorder):
    stock(ledger, NUTS, SHELF_A, 4)
    reorder.add_rule(NUTS, point=20, qty=500, supplier="FAST")

    suggestion = reorder.check(NUTS, NOW)

    assert suggestion is not None
    assert suggestion.sku == NUTS
    assert suggestion.qty == 500
    assert suggestion.supplier == "FAST"
    assert suggestion.status == "open"
    assert suggestion.created_at == NOW


def test_no_suggestion_without_rule(ledger, reorder):
    stock(ledger, NUTS, SHELF_A, 1)

    result = reorder.check(NUTS, NOW)

    assert result is None
    assert reorder.suggestions == []
    assert reorder.rules == {}


def test_rule_replaced_for_same_sku(reorder):
    reorder.add_rule(BOLTS, point=10, qty=50, supplier="FAST")

    rule = reorder.add_rule(BOLTS, point=25, qty=120, supplier="SAFE")

    assert reorder.rules[BOLTS] is rule
    assert (rule.point, rule.qty, rule.supplier) == (25, 120, "SAFE")
    assert len(reorder.rules) == 1


def test_rule_point_cannot_be_negative(reorder):
    with pytest.raises(ValueError):
        reorder.add_rule(BOLTS, point=-1, qty=50, supplier="FAST")

    with pytest.raises(ValueError):
        reorder.add_rule(BOLTS, point=10, qty=0, supplier="FAST")

    assert reorder.rules == {}


def test_rule_needs_known_supplier(reorder):
    with pytest.raises(KeyError):
        reorder.add_rule(BOLTS, point=10, qty=50, supplier="NOPE")

    rule = reorder.add_rule(BOLTS, point=10, qty=50, supplier="SAFE")

    assert rule.supplier == "SAFE"
