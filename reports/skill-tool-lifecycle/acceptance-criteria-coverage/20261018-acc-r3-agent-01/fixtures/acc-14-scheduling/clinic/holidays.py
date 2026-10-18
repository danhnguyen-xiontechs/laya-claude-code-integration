"""Public holidays on which the clinic is closed."""

from datetime import date

FIXED = {
    (1, 1): "New Year's Day",
    (5, 1): "Labour Day",
    (10, 3): "Day of German Unity",
    (12, 25): "Christmas Day",
    (12, 26): "Boxing Day",
}


class HolidayCalendar:
    def __init__(self):
        self.extra = {}

    def add(self, day, name):
        self.extra[day] = name

    def is_holiday(self, day):
        return (day.month, day.day) in FIXED or day in self.extra

    def name(self, day):
        return self.extra.get(day) or FIXED.get((day.month, day.day))

    def in_year(self, year):
        days = {date(year, m, d) for m, d in FIXED}
        days.update(d for d in self.extra if d.year == year)
        return sorted(days)
