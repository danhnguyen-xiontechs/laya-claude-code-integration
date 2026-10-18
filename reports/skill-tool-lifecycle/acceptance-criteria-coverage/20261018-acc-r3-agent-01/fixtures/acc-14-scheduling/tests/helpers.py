"""Dates and small checks shared by the clinic tests.

The tests run on Monday 2 March 2026 at 08:00 (see conftest.NOW).
"""

from datetime import date, datetime

TUE = date(2026, 3, 3)
WED = date(2026, 3, 4)
THU = date(2026, 3, 5)
FRI = date(2026, 3, 6)
SAT = date(2026, 3, 7)
NEXT_MON = date(2026, 3, 9)


def at(day, hhmm):
    """datetime for a day and an "HH:MM" string."""
    return datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time())


def assert_money(text):
    assert text.endswith(" EUR")
