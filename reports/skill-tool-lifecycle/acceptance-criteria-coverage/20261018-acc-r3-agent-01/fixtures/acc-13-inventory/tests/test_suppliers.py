"""Suppliers and lead times.

Each supplier has a code, a name and a lead time in days. The expected
arrival of a suggestion is its creation day plus the lead time.
"""

from datetime import date

import pytest

from stock.reorder import Suggestion, SupplierDirectory, expected_arrival
from tests.helpers import BOLTS, NOW


def test_supplier_added_and_found(suppliers):
    supplier = suppliers.get("FAST")
    other = suppliers.get("SAFE")

    assert supplier.name == "Fastener World"
    assert supplier.lead_days == 3
    assert "SAFE" in suppliers
    assert other.name == "SafetyFirst Supply"
    assert other.lead_days == 7


def test_unknown_supplier_raises(suppliers):
    with pytest.raises(KeyError):
        suppliers.get("NOPE")

    assert "NOPE" not in suppliers


def test_lead_time_must_be_positive():
    directory = SupplierDirectory()

    with pytest.raises(ValueError):
        directory.add("SLOW", "Slow Freight", lead_days=0)

    assert "SLOW" not in directory


def test_expected_arrival_date(suppliers):
    suggestion = Suggestion(BOLTS, 50, "SAFE", created_at=NOW)

    arrival = expected_arrival(suggestion, suppliers.get("SAFE"))
    faster = expected_arrival(suggestion, suppliers.get("FAST"))

    assert arrival == date(2026, 3, 9)
    assert faster == date(2026, 3, 5)
