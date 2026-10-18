"""Locking an account after repeated failed sign-ins.

Every failed sign-in is remembered on the user (user.failures). Too many of
them lock the account: user.is_locked(now) is then true.
"""

from tests.conftest import ANN_EMAIL, BOB_EMAIL, BOB_PASSWORD, PASSWORD, WRONG, assert_login_denied


def test_lock_after_five_failures(auth, clock, ann):
    for _ in range(5):
        auth.login(ANN_EMAIL, WRONG)
        clock.advance(minutes=1)

    assert ann.is_locked(clock.now())


def test_correct_password_while_locked(auth, ann):
    for _ in range(5):
        auth.login(ANN_EMAIL, WRONG)

    result = auth.login(ANN_EMAIL, PASSWORD)

    assert_login_denied(result, reason="locked")


def test_four_failures_do_not_lock(auth, clock, ann):
    for _ in range(4):
        auth.login(ANN_EMAIL, WRONG)

    assert not ann.is_locked(clock.now())
    assert len(ann.failures) == 4
    assert ann.locked_until is None


def test_failed_login_is_counted(auth, clock, ann):
    started = clock.now()

    auth.login(ANN_EMAIL, WRONG)
    clock.advance(minutes=2)
    auth.login(ANN_EMAIL, WRONG)

    assert len(ann.failures) == 2
    assert ann.failures[0] == started
    assert ann.failures[-1] == clock.now()


def test_success_clears_failures(auth, ann):
    for _ in range(3):
        auth.login(ANN_EMAIL, WRONG)
    assert len(ann.failures) == 3

    result = auth.login(ANN_EMAIL, PASSWORD)

    assert result.ok is True
    assert ann.failures == []


def test_failures_of_one_user_do_not_touch_another(auth, clock, ann, bob):
    for _ in range(5):
        auth.login(ANN_EMAIL, WRONG)

    assert bob.failures == []
    assert not bob.is_locked(clock.now())

    result = auth.login(BOB_EMAIL, BOB_PASSWORD)

    assert result.ok is True
