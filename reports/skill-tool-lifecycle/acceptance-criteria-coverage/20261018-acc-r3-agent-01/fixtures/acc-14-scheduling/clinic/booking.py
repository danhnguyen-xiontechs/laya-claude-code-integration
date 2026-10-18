"""Patients and bookings."""

import re
from dataclasses import dataclass
from datetime import timedelta

from .reminders import plan_reminder
from .slots import offered_slots

BOOKING_HORIZON = timedelta(days=60)
BOOKING_CUTOFF = timedelta(hours=2)
MAX_FUTURE_PER_PROVIDER = 2
PHONE = re.compile(r"^\+\d{8,15}$")


class SlotTaken(Exception):
    pass


class NotOffered(Exception):
    pass


class BookingClosed(Exception):
    pass


class LimitReached(Exception):
    pass


class Clock:
    def __init__(self, now):
        self._now = now

    def now(self):
        return self._now

    def advance(self, **kw):
        self._now += timedelta(**kw)
        return self._now

    def set(self, when):
        self._now = when


@dataclass
class Patient:
    id: str
    name: str
    email: str
    phone: str = ""


class PatientRegistry:
    def __init__(self):
        self._by_id = {}

    def register(self, patient_id, name, email, phone=""):
        if phone and not PHONE.match(phone):
            raise ValueError(f"bad phone number: {phone!r}")
        patient = Patient(patient_id, name.strip(), email.strip().lower(), phone)
        self._by_id[patient_id] = patient
        return patient

    def get(self, patient_id):
        return self._by_id[patient_id]


@dataclass
class Appointment:
    id: int
    patient_id: str
    provider_id: str
    start: object
    end: object
    status: str = "booked"
    fee: int = 0


class BookingService:
    def __init__(self, clock, directory, holidays, notifier, waitlist=None):
        self.clock = clock
        self.directory = directory
        self.holidays = holidays
        self.notifier = notifier
        self.waitlist = waitlist
        self.appointments = []

    def taken(self, provider_id, day):
        return {a.start for a in self.appointments
                if a.provider_id == provider_id and a.status == "booked" and a.start.date() == day}

    def free_slots(self, provider_id, day):
        provider = self.directory.get(provider_id)
        taken = self.taken(provider_id, day)
        return [s for s in offered_slots(provider, day, self.holidays) if s.start not in taken]

    def window_end(self):
        return self.clock.now() + BOOKING_HORIZON

    def book(self, patient_id, provider_id, start):
        now = self.clock.now()
        if start - now < BOOKING_CUTOFF:
            raise BookingClosed("online booking has closed for this slot")
        if start > self.window_end():
            raise BookingClosed("online booking is not open yet for this day")
        provider = self.directory.get(provider_id)
        slots = {s.start: s for s in offered_slots(provider, start.date(), self.holidays)}
        if start not in slots:
            raise NotOffered(start.isoformat())
        if start in self.taken(provider_id, start.date()):
            raise SlotTaken(start.isoformat())
        future = [a for a in self.appointments if a.patient_id == patient_id
                  and a.provider_id == provider_id and a.status == "booked" and a.start > now]
        if len(future) >= MAX_FUTURE_PER_PROVIDER:
            raise LimitReached(f"{patient_id} already has {len(future)} appointments with {provider_id}")
        appt = Appointment(len(self.appointments) + 1, patient_id, provider_id, start, slots[start].end)
        self.appointments.append(appt)
        plan_reminder(self.notifier, appt)
        return appt

    def for_patient(self, patient_id):
        return [a for a in self.appointments if a.patient_id == patient_id]

    def get(self, appt_id):
        return self.appointments[appt_id - 1]
