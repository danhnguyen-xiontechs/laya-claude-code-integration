"""Booking confirmations.

After booking, the patient gets a confirmation message with a reference
number.
"""

from clinic.confirmation import confirmation_message, confirmation_text
from tests.helpers import TUE, at
from tests.snap import match_snapshot


def test_confirmation_content(service, directory, clinic, patients):
    appt = service.book("pat-1", "p1", at(TUE, "09:20"))

    text = confirmation_text(appt, directory.get("p1"), clinic, patients.get("pat-1"))

    match_snapshot("confirmation_text", text)


def test_confirmation_subject(service, directory, clinic, patients):
    appt = service.book("pat-1", "p1", at(TUE, "09:20"))

    msg = confirmation_message(appt, directory.get("p1"), clinic, patients.get("pat-1"))

    assert msg["subject"] == "Booking confirmed"
    assert set(msg) == {"to", "subject", "reference", "body"}


def test_confirmation_goes_to_patient_email(service, directory, clinic, patients):
    appt = service.book("pat-2", "p1", at(TUE, "09:40"))

    msg = confirmation_message(appt, directory.get("p1"), clinic, patients.get("pat-2"))

    assert msg["to"] == "tom@example.com"


def test_confirmation_reference(service, directory, clinic, patients):
    service.book("pat-1", "p1", at(TUE, "09:00"))
    appt = service.book("pat-2", "p1", at(TUE, "09:20"))

    msg = confirmation_message(appt, directory.get("p1"), clinic, patients.get("pat-2"))

    assert msg["reference"] == "BK-00002"
    assert msg["to"] == "tom@example.com"


def test_confirmation_greets_patient(service, directory, clinic, patients):
    appt = service.book("pat-3", "p1", at(TUE, "10:00"))

    text = confirmation_text(appt, directory.get("p1"), clinic, patients.get("pat-3"))

    lines = text.splitlines()

    assert lines[0] == "Booking confirmed"
    assert lines[1] == "Dear Mira Kahn,"
