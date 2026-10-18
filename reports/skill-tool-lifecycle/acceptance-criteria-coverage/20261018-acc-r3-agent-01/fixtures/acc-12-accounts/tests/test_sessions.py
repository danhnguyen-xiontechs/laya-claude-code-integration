"""Sign-in sessions.

A session is created at sign-in and identified by its token.
SessionStore.is_active(token) answers whether it can still be used.
"""

from tests.conftest import ANN_EMAIL, BOB_EMAIL, BOB_PASSWORD, NEW_PASSWORD, PASSWORD


def test_password_change_revokes_sessions(auth, sessions, ann):
    # Ann is signed in on three devices and changes her password on the first
    current = auth.login(ANN_EMAIL, PASSWORD).session
    laptop = auth.login(ANN_EMAIL, PASSWORD).session
    phone = auth.login(ANN_EMAIL, PASSWORD).session

    auth.change_password(ann, PASSWORD, NEW_PASSWORD, current_token=current.token)

    assert not sessions.is_active(laptop.token)
    assert not sessions.is_active(phone.token)


def test_idle_timeout(sessions, clock, ann):
    session = sessions.create(ann.id)

    clock.advance(hours=7, minutes=59)
    assert sessions.is_active(session.token)

    clock.advance(minutes=2)
    assert not sessions.is_active(session.token)


def test_new_session_is_active(sessions, clock, ann):
    session = sessions.create(ann.id)

    assert sessions.is_active(session.token)
    assert session.created_at == clock.now()
    assert session.last_seen == clock.now()
    assert session.revoked is False


def test_logout_ends_session(auth, sessions, ann):
    session = auth.login(ANN_EMAIL, PASSWORD).session

    other = auth.login(ANN_EMAIL, PASSWORD).session

    auth.logout(session.token)

    assert not sessions.is_active(session.token)
    assert sessions.get(session.token).revoked is True
    assert sessions.is_active(other.token)


def test_touch_records_activity(sessions, clock, ann):
    session = sessions.create(ann.id)
    opened = session.created_at
    clock.advance(hours=1)

    assert sessions.touch(session.token) is True

    assert session.last_seen == clock.now()
    assert session.created_at == opened


def test_sessions_listed_per_user(auth, sessions, ann, bob):
    first = auth.login(ANN_EMAIL, PASSWORD).session
    second = auth.login(ANN_EMAIL, PASSWORD).session
    auth.login(BOB_EMAIL, BOB_PASSWORD)

    assert sessions.active_for(ann.id) == [first.token, second.token]
    assert len(sessions.active_for(bob.id)) == 1
