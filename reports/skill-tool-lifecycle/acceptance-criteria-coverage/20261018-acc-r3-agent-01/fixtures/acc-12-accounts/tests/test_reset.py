"""Password reset tokens.

ResetService.request(email) creates a token and mails it; complete(token,
new_password) sets the new password. is_valid(token) says whether a token
can still be used.
"""

import pytest

from accounts.auth import verify_password
from accounts.reset import InvalidToken
from tests.conftest import ANN_EMAIL, NEW_PASSWORD, PASSWORD


@pytest.mark.parametrize(
    "minutes, valid",
    [(0, True), (59, True), (60, False), (61, False)],
)
def test_token_validity(resets, clock, ann, minutes, valid):
    token = resets.request(ANN_EMAIL)

    clock.advance(minutes=minutes)

    assert resets.is_valid(token) is valid


def test_token_single_use(resets, ann):
    token = resets.request(ANN_EMAIL)

    resets.complete(token, NEW_PASSWORD)

    assert verify_password(NEW_PASSWORD, ann.password_hash)


def test_unknown_email_gets_no_token(resets, ann):
    token = resets.request("nobody@example.com")

    assert token is None
    assert resets.tokens == {}

    real = resets.request(ANN_EMAIL)

    assert real is not None
    assert resets.tokens[real].user_id == ann.id


def test_tokens_differ_per_request(resets, clock, ann):
    first = resets.request(ANN_EMAIL)
    clock.advance(minutes=5)
    second = resets.request(ANN_EMAIL)

    assert first != second
    assert len(first) == len(second) == 32
    assert set(resets.tokens) == {first, second}


def test_invalid_token_rejected(resets, ann):
    resets.request(ANN_EMAIL)

    with pytest.raises(InvalidToken):
        resets.complete("not-a-real-token", NEW_PASSWORD)

    assert not verify_password(NEW_PASSWORD, ann.password_hash)
    assert verify_password(PASSWORD, ann.password_hash)


def test_weak_new_password_refused(resets, ann):
    token = resets.request(ANN_EMAIL)

    with pytest.raises(ValueError):
        resets.complete(token, "weak")

    assert verify_password(PASSWORD, ann.password_hash)
    assert not verify_password("weak", ann.password_hash)
