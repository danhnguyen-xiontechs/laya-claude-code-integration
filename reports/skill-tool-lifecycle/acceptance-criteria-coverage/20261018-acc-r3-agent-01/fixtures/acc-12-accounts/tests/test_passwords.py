"""Password hashing and the password policy.

Stored hashes look like "<salt>$<sha256 hex>". The policy asks for at least
ten characters and at least one digit.
"""

import pytest

from accounts.auth import make_hash, password_problem, verify_password
from tests.conftest import PASSWORD, WRONG


def test_hash_is_not_plain_text(ann):
    salt, _, digest = ann.password_hash.partition("$")

    assert PASSWORD not in ann.password_hash
    assert len(salt) == 16
    assert len(digest) == 64


def test_verify_correct_password(ann):
    assert verify_password(PASSWORD, ann.password_hash)


def test_verify_wrong_password(ann):
    assert not verify_password(WRONG, ann.password_hash)
    assert not verify_password("", ann.password_hash)


def test_tampered_hash_fails(ann):
    salt, _, digest = ann.password_hash.partition("$")
    tampered = f"{salt}${digest[:-1]}0" if digest[-1] != "0" else f"{salt}${digest[:-1]}1"

    assert not verify_password(PASSWORD, tampered)
    assert verify_password(PASSWORD, ann.password_hash)


@pytest.mark.parametrize(
    "password, problem",
    [
        ("short-1", "password too short"),
        ("no-digits-here", "password needs a digit"),
        ("nine-ch-1", "password too short"),
        ("ten-chars1", None),
        ("long-enough-1", None),
        ("a much longer passphrase 2026", None),
    ],
)
def test_password_policy(password, problem):
    assert password_problem(password) == problem


def test_salts_differ_per_user(ann, bob):
    first = make_hash(PASSWORD, "user-1")
    second = make_hash(PASSWORD, "user-2")

    assert first != second
    assert ann.password_hash.split("$")[0] != bob.password_hash.split("$")[0]
