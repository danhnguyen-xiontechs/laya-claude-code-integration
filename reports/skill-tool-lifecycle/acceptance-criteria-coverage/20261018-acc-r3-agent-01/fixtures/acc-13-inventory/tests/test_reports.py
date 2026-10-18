"""Stock reports.

stock_report(book) gives one row per SKU with on hand, reserved and
available; reorder.low_stock() lists SKUs below their reorder point.
"""

from stock.reservations import stock_report
from tests.helpers import BOLTS, NOW, NUTS, SHELF_A, SHELF_B, stock
from tests.snap import match_snapshot


def test_stock_report_rows(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_B, 40)
    book.reserve(NUTS, 15, order_id="SO-5001", now=NOW)

    report = stock_report(book)

    assert len(report) == 2
    assert report == [
        {"sku": BOLTS, "on_hand": 10, "reserved": 0, "available": 10},
        {"sku": NUTS, "on_hand": 40, "reserved": 15, "available": 25},
    ]


def test_by_location_hides_empty_locations(ledger):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, BOLTS, SHELF_B, 4)
    ledger.issue(BOLTS, SHELF_B, 4)

    assert ledger.by_location(BOLTS) == {SHELF_A: 10}


def test_report_follows_issues(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    ledger.issue(BOLTS, SHELF_A, 3)
    book.reserve(BOLTS, 2, order_id="SO-5002", now=NOW)

    row = stock_report(book)[0]

    assert row["on_hand"] == 7
    assert row["reserved"] == 2
    assert row["available"] == 5


def test_low_stock_list(ledger, reorder):
    stock(ledger, BOLTS, SHELF_A, 5)
    stock(ledger, NUTS, SHELF_A, 500)
    reorder.add_rule(BOLTS, point=10, qty=50, supplier="FAST")
    reorder.add_rule(NUTS, point=100, qty=1000, supplier="FAST")

    assert reorder.low_stock() == [BOLTS]


def test_stock_report_snapshot(ledger, book):
    stock(ledger, BOLTS, SHELF_A, 10)
    stock(ledger, NUTS, SHELF_B, 40)

    match_snapshot("stock_report", stock_report(book))
