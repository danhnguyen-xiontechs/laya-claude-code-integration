"""Signing in with email and password.

AuthService.login(email, password) returns a LoginResult. A successful
sign-in opens a session; a refused one says why in result.reason.
"""

from tests.conftest import ANN_EMAIL, BOB_EMAIL, BOB_PASSWORD, PASSWORD, WRONG, assert_login_denied


def test_login_with_correct_password(auth, ann, bob):
    result = auth.login(ANN_EMAIL, PASSWORD)

    assert result.ok is True
    assert result.reason is None
    assert result.user_id == ann.id

    other = auth.login(BOB_EMAIL, BOB_PASSWORD)

    assert other.ok is True
    assert other.user_id == bob.id


def test_login_wrong_password_denied(auth, ann):
    result = auth.login(ANN_EMAIL, WRONG)

    assert_login_denied(result, reason="bad credentials")
    assert result.session is None
    assert result.user_id == ann.id


def test_password_of_another_user_denied(auth, ann, bob):
    result = auth.login(ANN_EMAIL, BOB_PASSWORD)

    assert_login_denied(result, reason="bad credentials")
    assert ann.last_login is None


def test_login_unknown_email_denied(auth, ann):
    result = auth.login("nobody@example.com", PASSWORD)

    assert_login_denied(result, reason="unknown email")
    assert result.user_id is None
    assert result.session is None
    assert ann.failures == []


def test_login_returns_active_session(auth, sessions, ann):
    result = auth.login(ANN_EMAIL, PASSWORD)

    session = result.session

    assert session.user_id == ann.id
    assert sessions.is_active(session.token)
    assert sessions.get(session.token) is session


def test_login_updates_last_login(auth, clock, ann, bob):
    assert ann.last_login is None

    clock.advance(hours=2)
    auth.login(ANN_EMAIL, PASSWORD)
    clock.advance(minutes=10)
    auth.login(BOB_EMAIL, BOB_PASSWORD)

    assert ann.last_login == clock.now().replace(minute=0)
    assert bob.last_login == clock.now()
