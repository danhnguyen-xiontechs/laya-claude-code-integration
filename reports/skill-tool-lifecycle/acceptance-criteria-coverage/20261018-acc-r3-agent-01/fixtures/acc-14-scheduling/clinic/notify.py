"""Outgoing messages and messages scheduled for later."""

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Message:
    to: str
    kind: str
    data: dict = field(default_factory=dict)


class Outbox:
    def __init__(self):
        self.messages = []

    def send(self, to, kind, data=None):
        msg = Message(to, kind, dict(data or {}))
        self.messages.append(msg)
        return msg

    def of_kind(self, kind):
        return [m for m in self.messages if m.kind == kind]


@dataclass
class Scheduled:
    appt_id: int
    kind: str
    run_at: datetime
    to: str
    data: dict
    sent: bool = False


class Notifier:
    def __init__(self, outbox):
        self.outbox = outbox
        self.scheduled = []

    def schedule(self, appt_id, kind, run_at, to, data=None):
        item = Scheduled(appt_id, kind, run_at, to, dict(data or {}))
        self.scheduled.append(item)
        return item

    def pending(self, appt_id=None):
        return [s for s in self.scheduled if not s.sent and (appt_id is None or s.appt_id == appt_id)]

    def drop(self, appt_id):
        self.scheduled = [s for s in self.scheduled if s.sent or s.appt_id != appt_id]

    def send_due(self, now):
        due = [s for s in self.pending() if s.run_at <= now]
        for s in due:
            self.outbox.send(s.to, s.kind, s.data)
            s.sent = True
        return due
