"""How many appointments one patient may hold.

The count is per patient and per provider.
"""

import pytest

from clinic.booking import LimitReached
from clinic.cancellation import cancel
from tests.helpers import THU, TUE, WED, at


def test_third_booking_rejected(service):
    service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-1", "p1", at(WED, "09:00"))

    with pytest.raises(LimitReached):
        service.book("pat-1", "p1", at(THU, "09:00"))


def test_two_bookings_allowed(service):
    first = service.book("pat-1", "p1", at(TUE, "09:00"))
    second = service.book("pat-1", "p1", at(WED, "10:20"))

    assert service.for_patient("pat-1") == [first, second]
    assert first.status == second.status == "booked"


def test_limit_is_per_provider(service):
    service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-1", "p1", at(WED, "09:00"))

    other = service.book("pat-1", "p2", at(TUE, "14:00"))
    another = service.book("pat-2", "p1", at(THU, "09:00"))

    assert other.provider_id == "p2"
    assert another.patient_id == "pat-2"
    assert len(service.for_patient("pat-1")) == 3


def test_cancelled_booking_frees_a_place(service):
    first = service.book("pat-1", "p1", at(TUE, "09:00"))
    service.book("pat-1", "p1", at(WED, "09:00"))
    cancel(service, first)

    third = service.book("pat-1", "p1", at(THU, "09:00"))

    assert third.status == "booked"
