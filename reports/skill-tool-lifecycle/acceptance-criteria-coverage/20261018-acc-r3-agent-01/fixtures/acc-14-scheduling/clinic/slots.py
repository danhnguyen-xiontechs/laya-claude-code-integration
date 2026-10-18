"""The slot grid: which start times a provider offers on a day."""

from dataclasses import dataclass
from datetime import datetime, timedelta

SLOT_MINUTES = 20


@dataclass(frozen=True)
class Slot:
    provider_id: str
    start: datetime
    end: datetime


def grid_times(start_hour, end_hour):
    if end_hour < start_hour:
        raise ValueError("working hours end before they start")
    times, minute = [], start_hour * 60
    while minute + SLOT_MINUTES <= end_hour * 60:
        times.append(f"{minute // 60:02d}:{minute % 60:02d}")
        minute += SLOT_MINUTES
    return times


def day_slots(provider, day):
    out = []
    for hhmm in grid_times(provider.start_hour, provider.end_hour):
        start = datetime.combine(day, datetime.strptime(hhmm, "%H:%M").time())
        out.append(Slot(provider.id, start, start + timedelta(minutes=SLOT_MINUTES)))
    return out


def offered_slots(provider, day, holidays):
    if not provider.works_on(day) or provider.on_leave(day) or holidays.is_holiday(day):
        return []
    return day_slots(provider, day)


def earliest_free(service, provider_id, from_day, days=14):
    for offset in range(days):
        day = from_day + timedelta(days=offset)
        free = service.free_slots(provider_id, day)
        if free:
            return free[0]
    return None
