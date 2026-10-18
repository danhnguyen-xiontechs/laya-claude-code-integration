"""Reorder rules and purchase suggestions."""

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class Supplier:
    code: str
    name: str
    lead_days: int


@dataclass
class ReorderRule:
    sku: str
    point: int
    qty: int
    supplier: str


@dataclass
class Suggestion:
    sku: str
    qty: int
    supplier: str
    created_at: datetime
    status: str = "open"


class SupplierDirectory:
    def __init__(self):
        self._by_code = {}

    def add(self, code, name, lead_days):
        if lead_days <= 0:
            raise ValueError("lead time must be at least one day")
        self._by_code[code] = Supplier(code, name, lead_days)
        return self._by_code[code]

    def get(self, code):
        return self._by_code[code]

    def __contains__(self, code):
        return code in self._by_code


class Reorder:
    def __init__(self, book, suppliers):
        self.book = book
        self.suppliers = suppliers
        self.rules = {}
        self.suggestions = []

    def add_rule(self, sku, point, qty, supplier):
        if point < 0:
            raise ValueError("reorder point cannot be negative")
        if qty <= 0:
            raise ValueError("reorder quantity must be positive")
        if supplier not in self.suppliers:
            raise KeyError(supplier)
        self.rules[sku] = ReorderRule(sku, point, qty, supplier)
        return self.rules[sku]

    def open_for(self, sku):
        return [s for s in self.suggestions if s.sku == sku and s.status == "open"]

    def check(self, sku, now):
        """Create a suggestion when available stock is below the point and none is open."""
        rule = self.rules.get(sku)
        if rule is None or self.book.available(sku) >= rule.point:
            return None
        if self.open_for(sku):
            return None
        suggestion = Suggestion(sku, rule.qty, rule.supplier, now)
        self.suggestions.append(suggestion)
        return suggestion

    def close(self, suggestion):
        suggestion.status = "closed"

    def low_stock(self):
        return sorted(sku for sku, rule in self.rules.items() if self.book.available(sku) < rule.point)


def expected_arrival(suggestion, supplier):
    return (suggestion.created_at + timedelta(days=supplier.lead_days)).date()
