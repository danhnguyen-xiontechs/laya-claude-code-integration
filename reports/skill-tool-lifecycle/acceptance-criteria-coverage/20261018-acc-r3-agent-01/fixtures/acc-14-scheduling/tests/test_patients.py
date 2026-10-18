"""Patient records.

Patients are registered with a name, an email address and an optional
phone number in international format.
"""

import pytest

from clinic.booking import PatientRegistry
from tests.helpers import TUE, WED, at


def test_register_patient():
    registry = PatientRegistry()

    patient = registry.register("pat-9", "  Jonas Brandt ", "Jonas@Example.com")

    assert patient.name == "Jonas Brandt"
    assert registry.get("pat-9") is patient
    assert patient.id == "pat-9"
    assert patient.phone == ""


@pytest.mark.parametrize(
    "phone, ok",
    [("+4915112345678", True), ("+12025550123", True), ("015112345678", False), ("+49 151 1234", False)],
)
def test_phone_format(phone, ok):
    registry = PatientRegistry()

    if ok:
        assert registry.register("pat-9", "Jonas Brandt", "j@example.com", phone).phone == phone
    else:
        with pytest.raises(ValueError):
            registry.register("pat-9", "Jonas Brandt", "j@example.com", phone)


def test_email_lowercased(patients):
    registry = PatientRegistry()
    patient = registry.register("pat-9", "Jonas Brandt", "Jonas@Example.com")

    assert patient.email == "jonas@example.com"
    assert patients.get("pat-1").email == "lena@example.com"


def test_unknown_patient_raises(patients):
    with pytest.raises(KeyError):
        patients.get("pat-404")


def test_bookings_listed_per_patient(service):
    a = service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-2", "p1", at(TUE, "09:20"))
    b = service.book("pat-1", "p2", at(WED, "14:00"))

    assert service.for_patient("pat-1") == [a, b]
    assert len(service.for_patient("pat-2")) == 1
    assert service.for_patient("pat-3") == []
