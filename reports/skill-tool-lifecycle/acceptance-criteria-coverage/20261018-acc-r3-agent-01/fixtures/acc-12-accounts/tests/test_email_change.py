"""Changing the sign-in email address.

change_email(store, mailer, user, new_email) returns None on success or the
reason it refused.
"""

from accounts.signup import change_email


def test_change_email_updates_lookup(store, outbox, ann):
    error = change_email(store, outbox, ann, "ann.lee@example.com")

    assert error is None
    assert store.by_email("ann.lee@example.com") is ann
    assert store.by_email("ann@example.com") is None


def test_password_unchanged_after_email_change(auth, store, outbox, ann):
    change_email(store, outbox, ann, "ann.lee@example.com")

    result = auth.login("ann.lee@example.com", "correct-horse-1")

    assert result.ok is True
    assert result.user_id == ann.id
    assert auth.login("ann@example.com", "correct-horse-1").reason == "unknown email"


def test_change_to_taken_email_refused(store, outbox, ann, bob):
    error = change_email(store, outbox, ann, "bob@example.com")

    assert error == "email taken"
    assert ann.email == "ann@example.com"


def test_change_to_invalid_email_refused(store, outbox, ann):
    for bad in ("ann-at-example", "ann@", " "):
        error = change_email(store, outbox, ann, bad)

        assert error == "invalid email"

    assert ann.email == "ann@example.com"
    assert outbox.to("ann@example.com")[-1].subject == "Welcome to Acme Accounts"


def test_old_address_gets_notice(store, outbox, ann):
    change_email(store, outbox, ann, "ann.lee@example.com")

    notice = outbox.last_to("ann@example.com")

    assert outbox.last_to("ann.lee@example.com") is None

    assert notice.subject == "Your sign-in email was changed"
    assert "ann.lee@example.com" in notice.body
