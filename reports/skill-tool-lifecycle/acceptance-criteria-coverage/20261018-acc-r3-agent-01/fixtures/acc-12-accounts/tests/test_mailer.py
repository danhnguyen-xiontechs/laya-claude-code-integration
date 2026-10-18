"""The outbox that collects outgoing mail.

Nothing leaves the process: Outbox.send() appends a Mail(to, subject, body)
to outbox.messages, and the helpers below read it back.
"""

from accounts.mailer import Outbox, welcome_mail
from tests.snap import match_snapshot


def test_outbox_records_messages():
    outbox = Outbox()

    outbox.send("a@example.com", "One", "first")
    outbox.send("b@example.com", "Two", "second")

    assert [m.subject for m in outbox.messages] == ["One", "Two"]
    assert [m.to for m in outbox.messages] == ["a@example.com", "b@example.com"]


def test_last_to_returns_latest():
    outbox = Outbox()
    outbox.send("a@example.com", "One", "first")
    outbox.send("a@example.com", "Two", "second")

    assert outbox.last_to("a@example.com").subject == "Two"
    assert outbox.last_to("c@example.com") is None
    assert len(outbox.to("a@example.com")) == 2


def test_to_filters_by_address():
    outbox = Outbox()
    outbox.send("a@example.com", "One", "first")
    outbox.send("b@example.com", "Two", "second")
    outbox.send("a@example.com", "Three", "third")

    to_a = outbox.to("a@example.com")

    assert [m.subject for m in to_a] == ["One", "Three"]
    assert outbox.to("nobody@example.com") == []


def test_clear_empties_outbox():
    outbox = Outbox()
    outbox.send("a@example.com", "One", "first")
    outbox.send("b@example.com", "Two", "second")

    outbox.clear()

    assert outbox.messages == []
    assert outbox.last_to("a@example.com") is None


def test_welcome_mail_snapshot(ann):
    subject, body = welcome_mail(ann)

    match_snapshot("welcome_mail", {"subject": subject, "body": body})
