"""Providers (doctors, nurses) and their working days."""

from dataclasses import dataclass, field

WEEKDAYS = (0, 1, 2, 3, 4)


@dataclass
class Provider:
    id: str
    name: str
    start_hour: int = 9
    end_hour: int = 12
    weekdays: tuple = WEEKDAYS
    leave: set = field(default_factory=set)

    def works_on(self, day):
        return day.weekday() in self.weekdays

    def on_leave(self, day):
        return day in self.leave


class ProviderDirectory:
    def __init__(self):
        self._by_id = {}

    def add(self, provider):
        self._by_id[provider.id] = provider
        return provider

    def get(self, provider_id):
        return self._by_id[provider_id]

    def all(self):
        return [self._by_id[k] for k in sorted(self._by_id)]

    def add_leave(self, provider_id, day):
        self.get(provider_id).leave.add(day)

    def remove_leave(self, provider_id, day):
        self.get(provider_id).leave.discard(day)

    def find_by_name(self, text):
        needle = text.casefold()
        return [p for p in self.all() if needle in p.name.casefold()]

    def listing(self, day):
        """What the reception screen shows for a day."""
        rows = []
        for p in self.all():
            if not p.works_on(day):
                status = "not working"
            elif p.on_leave(day):
                status = "on leave"
            else:
                status = "available"
            rows.append({"provider": p.name, "status": status})
        return rows
