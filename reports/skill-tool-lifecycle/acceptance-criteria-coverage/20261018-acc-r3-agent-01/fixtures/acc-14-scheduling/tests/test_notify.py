"""Scheduled notices and the outbox.

The notifier keeps messages scheduled for later; send_due(now) moves the
ones that are due into the outbox.
"""

from datetime import timedelta

from clinic.notify import Outbox
from tests.helpers import THU, TUE, at


def test_day_before_notice_scheduled(service, notifier):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    scheduled = notifier.pending(appt.id)[0]

    assert scheduled.run_at == appt.start - timedelta(hours=24)


def test_outbox_records_messages():
    outbox = Outbox()

    outbox.send("pat-1", "reminder", {"start": "x"})
    outbox.send("pat-2", "slot offer")

    assert [m.kind for m in outbox.messages] == ["reminder", "slot offer"]
    assert len(outbox.of_kind("reminder")) == 1
    assert outbox.messages[1].data == {}
    assert outbox.messages[0].to == "pat-1"


def test_send_due_sends_at_run_time(service, notifier, outbox, clock):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))
    run_at = notifier.pending(appt.id)[0].run_at

    clock.set(run_at)
    sent = notifier.send_due(clock.now())

    assert len(sent) == 1
    assert outbox.of_kind("reminder")[0].to == "pat-1"


def test_send_due_waits_until_run_time(service, notifier, outbox, clock):
    service.book("pat-1", "p1", at(TUE, "11:00"))

    sent = notifier.send_due(clock.now() + timedelta(hours=2))

    assert sent == []
    assert outbox.messages == []


def test_sent_notice_not_sent_again(service, notifier, outbox):
    service.book("pat-1", "p1", at(TUE, "11:00"))

    notifier.send_due(at(TUE, "11:00"))
    notifier.send_due(at(TUE, "12:00"))

    assert len(outbox.messages) == 1
    assert notifier.pending() == []
