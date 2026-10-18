"""Unlocking accounts.

AuthService.unlock(actor, user) lifts a lock and forgets earlier failures.
The actor's role decides whether the call is allowed.
"""

from tests.conftest import ANN_EMAIL, PASSWORD, WRONG


def _lock(auth, email):
    for _ in range(5):
        auth.login(email, WRONG)


def test_admin_unlocks(auth, clock, ann, admin):
    _lock(auth, ANN_EMAIL)
    assert ann.is_locked(clock.now())

    auth.unlock(admin, ann)

    assert not ann.is_locked(clock.now())


def test_unlock_clears_failure_count(auth, ann, admin):
    for _ in range(3):
        auth.login(ANN_EMAIL, WRONG)
    assert len(ann.failures) == 3

    auth.unlock(admin, ann)

    assert ann.failures == []
    assert ann.locked_until is None


def test_unlock_is_audited(auth, audit, ann, admin):
    _lock(auth, ANN_EMAIL)

    auth.unlock(admin, ann)

    entry = audit.of_event("unlock")[-1]

    assert entry["user_id"] == ann.id
    assert entry["by"] == admin.id
    assert entry["outcome"] == "ok"


def test_unlocked_user_can_sign_in(auth, sessions, ann, admin):
    _lock(auth, ANN_EMAIL)
    auth.unlock(admin, ann)

    result = auth.login(ANN_EMAIL, PASSWORD)

    assert result.ok is True
    assert sessions.is_active(result.session.token)
