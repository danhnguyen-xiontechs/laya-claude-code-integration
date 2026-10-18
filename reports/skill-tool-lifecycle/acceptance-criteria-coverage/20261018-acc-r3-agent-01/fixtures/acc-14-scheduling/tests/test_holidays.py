"""Public holidays.

The calendar knows the fixed national holidays; movable ones such as Good
Friday are added each year.
"""

from datetime import date

import pytest

from clinic.slots import offered_slots


def test_no_slots_on_christmas(directory, holidays):
    christmas = date(2026, 12, 25)

    assert offered_slots(directory.get("p1"), christmas, holidays) == []


@pytest.mark.parametrize(
    "day, expected",
    [
        (date(2026, 1, 1), True),
        (date(2026, 5, 1), True),
        (date(2026, 10, 3), True),
        (date(2026, 12, 24), False),
        (date(2026, 3, 3), False),
    ],
)
def test_fixed_holidays(holidays, day, expected):
    assert holidays.is_holiday(day) is expected


def test_holiday_names(holidays):
    assert holidays.name(date(2026, 12, 25)) == "Christmas Day"
    assert holidays.name(date(2026, 12, 26)) == "Boxing Day"
    assert holidays.name(date(2026, 3, 3)) is None


def test_extra_holiday_added(holidays):
    assert not holidays.is_holiday(date(2026, 4, 3))

    holidays.add(date(2026, 4, 3), "Good Friday")

    assert holidays.is_holiday(date(2026, 4, 3))
    assert holidays.name(date(2026, 4, 3)) == "Good Friday"
    assert not holidays.is_holiday(date(2027, 4, 3))


def test_holidays_in_year(holidays):
    holidays.add(date(2026, 4, 3), "Good Friday")

    days = holidays.in_year(2026)

    assert days[0] == date(2026, 1, 1)
    assert days[-1] == date(2026, 12, 26)
    assert date(2026, 4, 3) in days
    assert len(days) == 6
    assert len(holidays.in_year(2027)) == 5
