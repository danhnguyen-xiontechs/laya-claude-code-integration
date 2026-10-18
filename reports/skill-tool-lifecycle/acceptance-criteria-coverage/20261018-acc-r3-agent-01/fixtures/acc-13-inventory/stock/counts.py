"""Cycle counts: counting a location and booking the difference."""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class CountResult:
    sku: str
    location: str
    expected: int
    counted: int
    variance: int
    counted_by: str
    at: datetime


class CycleCount:
    def __init__(self, ledger):
        self.ledger = ledger
        self.results = []

    def record(self, sku, location, counted, counted_by, now):
        if counted < 0:
            raise ValueError("a count cannot be negative")
        expected = self.ledger.on_hand_at(sku, location)
        variance = counted - expected
        if variance:
            self.ledger.adjust(sku, location, variance, reason="count", ref=f"count-{len(self.results) + 1}")
        result = CountResult(sku, location, expected, counted, variance, counted_by, now)
        self.results.append(result)
        return result


def count_sheet(ledger, codes):
    """Rows to count, without the expected quantity (blind count)."""
    rows = []
    for code in codes:
        for sku in ledger.skus():
            if ledger.on_hand_at(sku, code):
                rows.append({"location": code, "sku": sku, "counted": None})
    return rows
