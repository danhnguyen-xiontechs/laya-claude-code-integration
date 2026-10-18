"""The stock ledger: on-hand quantity per SKU and location, and every move.

Quantities are whole units ("each"). Every change of on-hand goes through a
move, so the move list is the full history of a location.
"""

import re
from dataclasses import dataclass

UNITS = {"each": 1, "box": 12, "pallet": 480}
SKU = re.compile(r"^[A-Z]{3}-\d{4}$")


class StockError(Exception):
    pass


class NegativeStock(StockError):
    pass


class InsufficientStock(StockError):
    pass


def to_each(qty, unit="each"):
    try:
        return qty * UNITS[unit]
    except KeyError:
        raise ValueError(f"unknown unit: {unit!r}") from None


def normalize_sku(sku):
    return sku.strip().upper()


def valid_sku(sku):
    return bool(SKU.match(sku))


@dataclass
class Move:
    kind: str
    sku: str
    qty: int
    location: str
    reason: str = ""
    ref: str = ""
    to_location: str = None


class Ledger:
    def __init__(self, locations):
        self.locations = locations
        self.moves = []
        self._on_hand = {}

    # ----- reading

    def on_hand_at(self, sku, location):
        return self._on_hand.get((sku, location), 0)

    def on_hand(self, sku):
        return sum(q for (s, _), q in self._on_hand.items() if s == sku)

    def skus(self):
        return sorted({s for s, _ in self._on_hand})

    def by_location(self, sku):
        return {loc: q for (s, loc), q in sorted(self._on_hand.items()) if s == sku and q}

    def moves_for(self, sku):
        return [m for m in self.moves if m.sku == sku]

    # ----- writing

    def _apply(self, sku, location, delta):
        self.locations.get(location)
        if not valid_sku(sku):
            raise ValueError(f"bad SKU: {sku!r}")
        new = self.on_hand_at(sku, location) + delta
        if new < 0:
            raise NegativeStock(f"{sku} at {location}: {self.on_hand_at(sku, location)} on hand, {-delta} requested")
        self._on_hand[(sku, location)] = new

    def _record(self, move):
        self.moves.append(move)
        return move

    def receive(self, sku, location, qty, ref="", unit="each"):
        qty = to_each(qty, unit)
        if qty <= 0:
            raise ValueError("received quantity must be positive")
        self._apply(sku, location, qty)
        return self._record(Move("receipt", sku, qty, location, ref=ref))

    def issue(self, sku, location, qty, ref=""):
        if qty <= 0:
            raise ValueError("issued quantity must be positive")
        self._apply(sku, location, -qty)
        return self._record(Move("issue", sku, -qty, location, ref=ref))

    def scrap(self, sku, location, qty, reason):
        if not reason:
            raise ValueError("scrapping needs a reason")
        if qty <= 0:
            raise ValueError("scrapped quantity must be positive")
        self._apply(sku, location, -qty)
        return self._record(Move("scrap", sku, -qty, location, reason=reason))

    def adjust(self, sku, location, delta, reason, ref=""):
        self._apply(sku, location, delta)
        return self._record(Move("adjustment", sku, delta, location, reason=reason, ref=ref))

    def move(self, kind, sku, location, qty, reason="", ref=""):
        """Outgoing move by kind name: "issue" or "scrap"."""
        if kind == "issue":
            return self.issue(sku, location, qty, ref=ref)
        if kind == "scrap":
            return self.scrap(sku, location, qty, reason=reason)
        raise ValueError(f"unknown outgoing move kind: {kind!r}")
