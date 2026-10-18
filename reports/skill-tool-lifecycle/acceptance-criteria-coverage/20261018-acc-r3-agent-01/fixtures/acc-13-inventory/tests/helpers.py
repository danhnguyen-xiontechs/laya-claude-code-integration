"""Names, times and checks shared by the stock tests."""

from datetime import datetime, timedelta

NOW = datetime(2026, 3, 2, 8, 0)

BOLTS = "BLT-0100"
NUTS = "NUT-0200"
WASHERS = "WSH-0300"
GLOVES = "GLV-0400"

SHELF_A = "A-01-01"
SHELF_A2 = "A-01-02"
SHELF_B = "B-02-01"
DOCK = "D-00-01"
QUARANTINE = "Q-00-01"


def hours_later(hours):
    return NOW + timedelta(hours=hours)


def stock(ledger, sku, location, qty):
    """Put qty units of sku on a location through a receipt."""
    return ledger.receive(sku, location, qty, ref="opening balance")


def assert_released(item, expected):
    if expected:
        assert item.reserved == 0
        assert item.available == item.on_hand
    else:
        assert item.reserved > 0
