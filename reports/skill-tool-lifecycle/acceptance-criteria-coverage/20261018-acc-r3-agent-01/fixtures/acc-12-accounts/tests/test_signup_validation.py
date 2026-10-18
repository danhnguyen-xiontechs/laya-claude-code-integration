"""What sign-up accepts as an email address and a password.

Validation happens before anything is stored: a rejected sign-up leaves the
store, the outbox and the audit log untouched.
"""

import pytest


@pytest.mark.parametrize(
    "email",
    [
        "ann",
        "ann@",
        "@example.com",
        "ann@example",
        "ann smith@example.com",
        "ann@@example.com",
        "ann@example.c",
        "",
    ],
)
def test_invalid_email_rejected(signups, email):
    result = signups.signup(email, "long-enough-1")

    assert result.ok is False
    assert result.error == "invalid email"
    assert result.user is None


def test_short_password_rejected(signups, store):
    result = signups.signup("dan@example.com", "short-1")

    assert result.ok is False
    assert result.error == "password too short"
    assert store.by_email("dan@example.com") is None


def test_password_without_digit_rejected(signups, store):
    result = signups.signup("dan@example.com", "no-digits-at-all")

    assert result.ok is False
    assert result.error == "password needs a digit"
    assert store.by_email("dan@example.com") is None


def test_rejected_signup_creates_nothing(signups, store, outbox, audit):
    # one bad address, one bad password
    signups.signup("not-an-email", "long-enough-1")
    signups.signup("dan@example.com", "short")

    assert store.users == {}
    assert outbox.messages == []
    assert audit.of_event("signup") == []


def test_signup_name_trimmed(signups):
    user = signups.signup(
        "dan@example.com",
        "long-enough-1",
        name="  Dan Moss  ",
    ).user

    assert user.name == "Dan Moss"


def test_signup_name_defaults_to_mailbox(signups):
    user = signups.signup("erin.cole@example.com", "long-enough-1").user
    blank = signups.signup(
        "frank@example.com",
        "long-enough-2",
        name="   ",
    ).user

    assert user.name == "erin.cole"
    assert blank.name == "frank"
