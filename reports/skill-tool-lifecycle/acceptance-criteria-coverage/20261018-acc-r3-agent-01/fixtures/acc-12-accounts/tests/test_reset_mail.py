"""The email that carries a password reset link.

The link points at RESET_URL with the token appended; the mail goes to the
address on the account.
"""

from accounts.reset import RESET_URL
from tests.conftest import ANN_EMAIL, BOB_EMAIL


def test_reset_mail_sent_to_user(resets, outbox, ann, bob):
    outbox.clear()

    resets.request(ANN_EMAIL)

    assert [m.to for m in outbox.messages] == [ANN_EMAIL]
    assert outbox.to(BOB_EMAIL) == []


def test_reset_mail_subject(resets, outbox, ann, bob):
    resets.request(ANN_EMAIL)
    resets.request(BOB_EMAIL)

    to_ann = outbox.last_to(ANN_EMAIL)
    to_bob = outbox.last_to(BOB_EMAIL)

    assert to_ann.subject == "Reset your password"
    assert to_bob.subject == "Reset your password"
    assert to_ann.body != to_bob.body


def test_reset_mail_contains_link(resets, outbox, ann):
    token = resets.request(ANN_EMAIL)

    body = outbox.last_to(ANN_EMAIL).body

    assert f"{RESET_URL}{token}" in body
    assert body.startswith("Open https://")


def test_each_request_sends_a_mail(resets, outbox, clock, ann):
    outbox.clear()

    first = resets.request(ANN_EMAIL)
    clock.advance(minutes=10)
    second = resets.request(ANN_EMAIL)

    bodies = [m.body for m in outbox.to(ANN_EMAIL)]

    assert len(bodies) == 2
    assert first in bodies[0]
    assert second in bodies[1]


def test_no_mail_for_unknown_email(resets, outbox, ann):
    outbox.clear()

    resets.request("nobody@example.com")
    resets.request("ann@example.org")

    assert outbox.messages == []
    assert resets.tokens == {}
