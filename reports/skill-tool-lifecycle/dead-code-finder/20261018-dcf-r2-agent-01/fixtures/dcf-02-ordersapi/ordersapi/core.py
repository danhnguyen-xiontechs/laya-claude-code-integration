import json
from decimal import Decimal

ROUND_MODE = "half-up"
TAX = Decimal("0.2")


class Order:
    def __init__(self, items):
        self.items = items

    def total(self):
        return sum(price * qty for price, qty in self.items)

    def to_dict(self):
        return {"items": self.items, "total": self.total()}

    def to_xml(self):
        rows = "".join(f"<item price='{p}' qty='{q}'/>" for p, q in self.items)
        return f"<order>{rows}</order>"


def total_for(order):
    return order.total() * (1 + TAX)


def legacy_total(order):
    return sum(p for p, _ in order.items)


def _cents(value):
    return int(round(value * 100))
