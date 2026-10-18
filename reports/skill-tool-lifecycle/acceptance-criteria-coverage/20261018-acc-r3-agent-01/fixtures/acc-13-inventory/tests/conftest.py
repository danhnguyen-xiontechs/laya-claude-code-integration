"""Fixtures for the stock tests.

The warehouse has two aisles of shelves, one receiving dock and a quarantine
area. Fixtures build the ledger and the services on top of it.
"""

import pytest

from stock.counts import CycleCount
from stock.ledger import Ledger
from stock.locations import LocationRegistry
from stock.orders import OrderService
from stock.reorder import Reorder, SupplierDirectory
from stock.reservations import ReservationBook


@pytest.fixture
def locations():
    registry = LocationRegistry()
    registry.add("A-01-01", "Aisle A, bay 01, shelf 01")
    registry.add("A-01-02", "Aisle A, bay 01, shelf 02")
    registry.add("B-02-01", "Aisle B, bay 02, shelf 01")
    registry.add("D-00-01", "Receiving dock", kind="dock")
    registry.add("Q-00-01", "Quarantine cage", kind="quarantine")
    return registry


@pytest.fixture
def ledger(locations):
    return Ledger(locations)


@pytest.fixture
def book(ledger):
    return ReservationBook(ledger)


@pytest.fixture
def suppliers():
    directory = SupplierDirectory()
    directory.add("FAST", "Fastener World", lead_days=3)
    directory.add("SAFE", "SafetyFirst Supply", lead_days=7)
    return directory


@pytest.fixture
def reorder(book, suppliers):
    return Reorder(book, suppliers)


@pytest.fixture
def counts(ledger):
    return CycleCount(ledger)


@pytest.fixture
def orders(book, ledger):
    return OrderService(book, ledger)
