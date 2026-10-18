"""Sign-up of new accounts.

SignupService.signup(email, password, name) returns a SignupResult with ok,
error and the new user. A successful sign-up stores the user, sends a welcome
mail and writes an audit entry.
"""

import pytest

from tests.conftest import ANN_EMAIL


def test_duplicate_email(signups, store, ann):
    assert len(store.users) == 1

    result = signups.signup(ANN_EMAIL, "another-pass-2", name="Ann Again")

    assert result.ok is False
    assert result.error == "email taken"
    assert len(store.users) == 1


@pytest.mark.parametrize(
    "variant",
    [
        "Ann@example.com",
        "ANN@EXAMPLE.COM",
        "ann@Example.Com",
        "aNN@eXample.com",
        " ann@example.com ",
    ],
)
def test_duplicate_email_any_case(signups, ann, variant):
    result = signups.signup(variant, "another-pass-2")

    assert result.ok is False
    assert result.error == "email taken"


def test_signup_creates_user(signups, store, clock):
    clock.advance(minutes=30)

    result = signups.signup(
        "carol@example.com",
        "carol-pass-42",
        name="Carol Diaz",
    )

    assert result.ok is True
    assert result.error is None
    assert store.get(result.user.id) is result.user
    assert result.user.email == "carol@example.com"
    assert result.user.created_at == clock.now()


def test_signup_sends_welcome_mail(signups, outbox):
    signups.signup(
        "carol@example.com",
        "carol-pass-42",
        name="Carol Diaz",
    )

    mail = outbox.last_to("carol@example.com")

    assert mail is not None
    assert mail.subject == "Welcome to Acme Accounts"
    assert "Hello Carol Diaz" in mail.body
    assert len(outbox.messages) == 1


def test_new_user_has_member_role(signups, store):
    user = signups.signup("carol@example.com", "carol-pass-42").user
    other = signups.signup("dave@example.com", "dave-pass-43").user

    assert user.role == "member"
    assert other.role == "member"
    assert user.locked_until is None
    assert user.failures == []
    assert user.id != other.id
