"""Profile changes: display name and password.

rename() changes the display name. AuthService.change_password() needs the
old password and a new one that follows the password policy.
"""

import pytest

from accounts.signup import rename
from tests.conftest import ANN_EMAIL, NEW_PASSWORD, PASSWORD, WRONG


def test_rename_user(ann, bob):
    rename(ann, "Ann L.")
    assert ann.name == "Ann L."

    rename(ann, "  Ann Lee-Park ")

    assert ann.name == "Ann Lee-Park"
    assert bob.name == "Bob Stone"
    assert ann.email == "ann@example.com"


def test_blank_name_rejected(ann):
    with pytest.raises(ValueError):
        rename(ann, "   ")

    assert ann.name == "Ann Lee"


def test_change_password_requires_old_password(auth, ann):
    with pytest.raises(ValueError):
        auth.change_password(ann, WRONG, NEW_PASSWORD, current_token=None)

    assert auth.login(ANN_EMAIL, PASSWORD).ok is True


def test_new_password_must_follow_policy(auth, ann):
    with pytest.raises(ValueError):
        auth.change_password(ann, PASSWORD, "short-2", current_token=None)

    assert auth.login(ANN_EMAIL, PASSWORD).ok is True


def test_new_password_works_for_login(auth, ann):
    auth.change_password(ann, PASSWORD, NEW_PASSWORD, current_token=None)

    assert auth.login(ANN_EMAIL, NEW_PASSWORD).ok is True
    assert auth.login(ANN_EMAIL, PASSWORD).reason == "bad credentials"
