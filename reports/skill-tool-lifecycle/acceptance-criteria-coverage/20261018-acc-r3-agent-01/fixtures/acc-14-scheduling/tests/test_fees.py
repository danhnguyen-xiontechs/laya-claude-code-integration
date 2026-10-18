"""Visit fees.

Fees are kept in cents; fee_display() turns cents into the text shown to
patients.
"""

import pytest

from clinic.fees import FEES, fee_display, fee_for, total
from tests.helpers import assert_money


def test_fee_display():
    txt = fee_display(2500)

    assert_money(txt)


def test_fee_for_consultation():
    assert fee_for("consultation") == 6000
    assert fee_for("vaccination") == 2000


def test_unknown_visit_kind_rejected():
    with pytest.raises(ValueError):
        fee_for("massage")

    with pytest.raises(ValueError):
        total(["consultation", "massage"])


def test_follow_up_cheaper_than_consultation():
    assert FEES["follow-up"] < FEES["consultation"]
    assert FEES["vaccination"] < FEES["follow-up"]
    assert sorted(FEES) == ["consultation", "follow-up", "vaccination"]


def test_total_for_visits():
    assert total(["consultation", "follow-up", "vaccination"]) == 11500
    assert total(["vaccination", "vaccination"]) == 4000
    assert total([]) == 0
