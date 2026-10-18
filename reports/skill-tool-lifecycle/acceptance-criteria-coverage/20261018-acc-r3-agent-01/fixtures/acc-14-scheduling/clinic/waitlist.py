"""The waitlist: patients who want an earlier slot with a provider."""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class Offer:
    patient_id: str
    provider_id: str
    start: datetime


class Waitlist:
    def __init__(self):
        self.entries = []

    def join(self, patient_id, provider_id):
        if (patient_id, provider_id) in self.entries:
            raise ValueError("already on the waitlist")
        self.entries.append((patient_id, provider_id))

    def leave(self, patient_id, provider_id):
        self.entries.remove((patient_id, provider_id))

    def queue(self, provider_id):
        return [p for p, prov in self.entries if prov == provider_id]

    def first(self, provider_id):
        queue = self.queue(provider_id)
        return queue[0] if queue else None

    def offer_freed(self, provider_id, start, outbox):
        patient_id = self.first(provider_id)
        if patient_id is None:
            return None
        self.entries.remove((patient_id, provider_id))
        outbox.send(patient_id, "slot offer", {"provider": provider_id, "slot": start})
        return Offer(patient_id, provider_id, start)
