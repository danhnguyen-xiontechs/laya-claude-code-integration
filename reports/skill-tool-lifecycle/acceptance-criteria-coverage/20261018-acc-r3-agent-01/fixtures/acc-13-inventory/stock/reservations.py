"""Reservations hold stock for an order until it ships.

available = on hand - reserved. Unconfirmed reservations lapse after
RESERVATION_TTL.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from .ledger import InsufficientStock

RESERVATION_TTL = timedelta(hours=48)

__all__ = ["InsufficientStock", "Reservation", "ReservationBook", "StockStatus", "RESERVATION_TTL"]


@dataclass
class Reservation:
    id: str
    sku: str
    qty: int
    order_id: str
    created_at: datetime
    confirmed: bool = False
    released: bool = False


@dataclass
class StockStatus:
    sku: str
    on_hand: int
    reserved: int
    available: int


class ReservationBook:
    def __init__(self, ledger):
        self.ledger = ledger
        self.reservations = {}
        self._n = 0

    def _active(self):
        return [r for r in self.reservations.values() if not r.released]

    def reserved(self, sku):
        return sum(r.qty for r in self._active() if r.sku == sku)

    def available(self, sku):
        return self.ledger.on_hand(sku) - self.reserved(sku)

    def status(self, sku):
        on_hand, reserved = self.ledger.on_hand(sku), self.reserved(sku)
        return StockStatus(sku, on_hand, reserved, on_hand - reserved)

    def reserve(self, sku, qty, order_id, now):
        if qty <= 0:
            raise ValueError("reserved quantity must be positive")
        if qty > self.available(sku):
            raise InsufficientStock(f"{sku}: {self.available(sku)} available, {qty} requested")
        self._n += 1
        res = Reservation(f"R-{self._n:05d}", sku, qty, order_id, now)
        self.reservations[res.id] = res
        return res

    def confirm(self, res_id):
        self.reservations[res_id].confirmed = True

    def release(self, res_id):
        self.reservations[res_id].released = True

    def expires_at(self, res):
        return None if res.confirmed else res.created_at + RESERVATION_TTL

    def release_expired(self, now):
        lapsed = [r for r in self._active() if not r.confirmed and now - r.created_at >= RESERVATION_TTL]
        for r in lapsed:
            r.released = True
        return lapsed

    def for_order(self, order_id):
        return [r for r in self._active() if r.order_id == order_id]

    def release_for_order(self, order_id):
        held = self.for_order(order_id)
        for r in held:
            r.released = True
        return held


def stock_report(book):
    """One row per SKU: on hand, reserved and available."""
    return [vars(book.status(sku)) for sku in book.ledger.skus()]
