"""The waitlist.

Patients join the waitlist of a provider; when a booking with that provider
is cancelled, the first patient in line is told about the slot.
"""

import pytest

from clinic.cancellation import cancel
from tests.conftest import expect_offer
from tests.helpers import THU, at


def test_first_in_line_gets_offer(service, waitlist, outbox):
    waitlist.join("pat-2", "p1")
    waitlist.join("pat-3", "p1")
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, appt)

    expect_offer(outbox, "pat-2", at(THU, "10:00"))


def test_no_offer_without_waitlist(service, outbox):
    appt = service.book("pat-1", "p1", at(THU, "10:00"))

    cancel(service, appt)

    assert outbox.of_kind("slot offer") == []


class TestWaitlistOrder:
    def test_join_keeps_order(self, waitlist):
        waitlist.join("pat-2", "p1")
        waitlist.join("pat-3", "p1")
        waitlist.join("pat-1", "p2")

        assert waitlist.queue("p1") == ["pat-2", "pat-3"]
        assert waitlist.first("p2") == "pat-1"
        assert waitlist.first("p1") == "pat-2"
        assert len(waitlist.entries) == 3

    def test_join_twice_rejected(self, waitlist):
        waitlist.join("pat-2", "p1")

        with pytest.raises(ValueError):
            waitlist.join("pat-2", "p1")

        waitlist.join("pat-2", "p2")

        assert waitlist.queue("p1") == ["pat-2"]
        assert waitlist.queue("p2") == ["pat-2"]

    def test_leave_removes_patient(self, waitlist):
        waitlist.join("pat-2", "p1")
        waitlist.join("pat-3", "p1")

        waitlist.leave("pat-2", "p1")

        assert waitlist.first("p1") == "pat-3"

    def test_empty_queue_has_no_first(self, waitlist):
        assert waitlist.first("p1") is None
        assert waitlist.queue("p1") == []
