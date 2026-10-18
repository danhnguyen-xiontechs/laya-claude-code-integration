"""Fixtures for the clinic tests.

Two providers work at the practice:
  p1  Dr Ana Weber   09:00-12:00, Monday to Friday
  p2  Dr Ben Okafor  14:00-17:00, Monday to Thursday
Three patients are registered: pat-1, pat-2 and pat-3.
"""

from datetime import datetime

import pytest

from clinic.booking import BookingService, Clock, PatientRegistry
from clinic.confirmation import Clinic
from clinic.holidays import HolidayCalendar
from clinic.notify import Notifier, Outbox
from clinic.providers import Provider, ProviderDirectory
from clinic.waitlist import Waitlist

NOW = datetime(2026, 3, 2, 8, 0)


def expect_offer(outbox, patient, slot):
    offers = outbox.of_kind("slot offer")
    assert offers[-1].to == patient
    assert offers[-1].data["slot"] == slot


@pytest.fixture
def clock():
    return Clock(NOW)


@pytest.fixture
def holidays():
    return HolidayCalendar()


@pytest.fixture
def directory():
    d = ProviderDirectory()
    d.add(Provider("p1", "Dr Ana Weber", start_hour=9, end_hour=12))
    d.add(Provider("p2", "Dr Ben Okafor", start_hour=14, end_hour=17, weekdays=(0, 1, 2, 3)))
    return d


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def notifier(outbox):
    return Notifier(outbox)


@pytest.fixture
def waitlist():
    return Waitlist()


@pytest.fixture
def patients():
    registry = PatientRegistry()
    registry.register("pat-1", "Lena Fischer", "lena@example.com", "+4915112345678")
    registry.register("pat-2", "Tom Berg", "tom@example.com")
    registry.register("pat-3", "Mira Kahn", "mira@example.com")
    return registry


@pytest.fixture
def service(clock, directory, holidays, notifier, waitlist):
    return BookingService(clock, directory, holidays, notifier, waitlist)


@pytest.fixture
def clinic():
    return Clinic("Lindenhof Practice", "Lindenstrasse 12, 10969 Berlin", "+49 30 1234567")
