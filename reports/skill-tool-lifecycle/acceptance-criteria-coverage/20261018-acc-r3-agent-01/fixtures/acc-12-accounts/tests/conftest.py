"""Fixtures for the accounts tests.

Every test gets a fresh clock, outbox, audit log, user store and session
store, wired into the services the way the application wires them:

    SignupService(store, outbox, audit, clock)
    AuthService(store, sessions, audit, clock)
    ResetService(store, outbox, audit, clock)

The clock starts on Monday 2 March 2026 at 09:00 and only moves when a test
moves it.
"""

import pytest

from accounts.audit import AuditLog
from accounts.auth import AuthService
from accounts.clock import FakeClock
from accounts.mailer import Outbox
from accounts.reset import ResetService
from accounts.sessions import SessionStore
from accounts.signup import SignupService, UserStore

ANN_EMAIL = "ann@example.com"
BOB_EMAIL = "bob@example.com"
PASSWORD = "correct-horse-1"
BOB_PASSWORD = "bob-password-7"
WRONG = "wrong-guess-1"
NEW_PASSWORD = "battery-staple-2"
ADMIN_PASSWORD = "admin-secret-99"


def assert_login_denied(result, reason):
    assert result.ok is False
    assert result.reason == reason


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def audit(clock):
    return AuditLog(clock)


@pytest.fixture
def store():
    return UserStore()


@pytest.fixture
def sessions(clock):
    return SessionStore(clock)


@pytest.fixture
def signups(store, outbox, audit, clock):
    return SignupService(store, outbox, audit, clock)


@pytest.fixture
def auth(store, sessions, audit, clock):
    return AuthService(store, sessions, audit, clock)


@pytest.fixture
def resets(store, outbox, audit, clock):
    return ResetService(store, outbox, audit, clock)


@pytest.fixture
def ann(signups):
    """A member account: ann@example.com / PASSWORD."""
    return signups.signup(ANN_EMAIL, PASSWORD, name="Ann Lee").user


@pytest.fixture
def bob(signups):
    """A second member account: bob@example.com / BOB_PASSWORD."""
    return signups.signup(BOB_EMAIL, BOB_PASSWORD, name="Bob Stone").user


@pytest.fixture
def admin(signups):
    """An account with the admin role."""
    user = signups.signup("root@example.com", ADMIN_PASSWORD, name="Site Admin").user
    user.role = "admin"
    return user
