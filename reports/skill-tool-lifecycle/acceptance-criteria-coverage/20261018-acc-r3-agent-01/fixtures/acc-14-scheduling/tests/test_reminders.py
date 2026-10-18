"""Appointment reminders.

Every booking plans one reminder in the notifier; reminder_text() is what the
patient reads.
"""

from clinic.cancellation import cancel
from clinic.reminders import reminder_text
from tests.helpers import THU, TUE, at


def test_no_reminder_after_cancel(service):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, appt)

    assert appt.status == "cancelled"


def test_reminder_text_names_time(service, directory):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    text = reminder_text(appt, directory.get("p1").name)

    assert text == "Reminder: your appointment with Dr Ana Weber is on Thursday 05 March at 10:00."


def test_reminder_addressed_to_patient(service, notifier):
    appt = service.book("pat-3", "p2", at(TUE, "15:00"))

    items = notifier.pending(appt.id)

    assert len(items) == 1

    item = items[0]

    assert item.to == "pat-3"
    assert item.kind == "reminder"


def test_one_reminder_per_booking(service, notifier):
    service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-2", "p1", at(TUE, "09:20"))
    service.book("pat-3", "p2", at(TUE, "14:00"))

    assert len(notifier.pending()) == 3


def test_reminder_carries_start_and_provider(service, notifier):
    appt = service.book("pat-1", "p2", at(TUE, "16:40"))

    data = notifier.pending(appt.id)[0].data

    assert data == {"start": "2026-03-03T16:40", "provider": "p2"}
