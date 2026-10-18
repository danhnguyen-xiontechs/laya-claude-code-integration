"""SKU codes.

A SKU is three capital letters, a dash and four digits, for example
BLT-0100. Input from scanners is normalised first.
"""

import pytest

from stock.ledger import normalize_sku, valid_sku
from tests.helpers import SHELF_A
from tests.snap import match_snapshot


@pytest.mark.parametrize(
    "sku, ok",
    [
        ("BLT-0100", True),
        ("NUT-0200", True),
        ("BL-0100", False),
        ("BLT-100", False),
        ("blt-0100", False),
        ("BLT0100", False),
    ],
)
def test_sku_format(sku, ok):
    assert valid_sku(sku) is ok


def test_normalize_sku():
    assert normalize_sku("  blt-0100 ") == "BLT-0100"
    assert normalize_sku("NUT-0200") == "NUT-0200"
    assert valid_sku(normalize_sku("nut-0200"))
    assert not valid_sku(normalize_sku("nut 0200"))


def test_ledger_rejects_bad_sku(ledger):
    with pytest.raises(ValueError):
        ledger.receive("bolt", SHELF_A, 10)

    with pytest.raises(ValueError):
        ledger.receive("blt-0100", SHELF_A, 10)

    assert ledger.skus() == []
    assert ledger.moves == []


def test_sku_label_snapshot():
    labels = {sku: f"{sku} | {normalize_sku(sku)}" for sku in ("blt-0100", "NUT-0200")}

    match_snapshot("sku_labels", labels)
