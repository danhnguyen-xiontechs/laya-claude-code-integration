"""The audit log: one entry per security-relevant event."""


class AuditLog:
    def __init__(self, clock):
        self.clock = clock
        self.entries = []

    def record(self, event, user_id, outcome="ok", **details):
        entry = {"at": self.clock.iso(), "event": event, "user_id": user_id, "outcome": outcome}
        entry.update(details)
        self.entries.append(entry)
        return entry

    def for_user(self, user_id):
        return [e for e in self.entries if e["user_id"] == user_id]

    def of_event(self, event):
        return [e for e in self.entries if e["event"] == event]
