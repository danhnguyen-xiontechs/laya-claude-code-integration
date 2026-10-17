from datetime import datetime, timedelta

import pytest

from rooms.calendar import Calendar

NOW = datetime(2026, 3, 2, 9, 0)


@pytest.fixture
def cal():
    return Calendar(NOW)


def at(hours):
    return NOW + timedelta(hours=hours)
