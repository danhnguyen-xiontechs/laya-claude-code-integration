from tests.conftest import at


def test_cancel_removes_the_booking(cal):
    b = cal.book("R1", at(5), at(6))
    cal.cancel(b)
    assert b not in cal.items


def test_cancel_requires_notice(cal):
    b = cal.book("R1", at(3), at(4))
    cal.cancel(b)
    assert b not in cal.items
