"""The audit log.

Each entry is a dict with the time, the event name, the user id, the outcome
and any extra details the caller passed.
"""

from accounts.roles import assign_role
from tests.conftest import ANN_EMAIL, NEW_PASSWORD, PASSWORD, WRONG
from tests.snap import match_snapshot


def test_login_is_audited(auth, audit, ann):
    auth.login(ANN_EMAIL, PASSWORD)
    auth.login(ANN_EMAIL, WRONG)

    match_snapshot("login_audit", audit.of_event("login"))


def test_signup_is_audited(signups, audit):
    user = signups.signup("erin@example.com", "erin-pass-55").user
    signups.signup("erin@example.com", "erin-pass-55")

    entries = audit.of_event("signup")

    assert len(entries) == 1
    assert entries[0]["user_id"] == user.id
    assert entries[0]["outcome"] == "ok"


def test_role_change_is_audited(audit, admin, bob):
    assign_role(admin, bob, "support", audit=audit)
    assign_role(admin, bob, "member", audit=audit)

    entries = audit.of_event("role_change")

    assert [e["role"] for e in entries] == ["support", "member"]

    entry = entries[0]

    assert entry["user_id"] == bob.id
    assert entry["role"] == "support"
    assert entry["by"] == admin.id


def test_entries_filtered_by_user(auth, audit, ann, bob):
    auth.change_password(ann, PASSWORD, NEW_PASSWORD, current_token=None)

    events = [e["event"] for e in audit.for_user(ann.id)]

    assert events == ["signup", "password_change"]
    assert [e["event"] for e in audit.for_user(bob.id)] == ["signup"]


def test_audit_entry_has_timestamp(signups, audit, clock):
    signups.signup("dora@example.com", "dora-pass-56")
    clock.advance(hours=3, minutes=15)

    signups.signup("erin@example.com", "erin-pass-55")

    assert audit.entries[0]["at"] == "2026-03-02T09:00:00"
    assert audit.entries[-1]["at"] == "2026-03-02T12:15:00"


def test_reset_request_is_audited(resets, audit, ann):
    resets.request(ANN_EMAIL)
    resets.request("nobody@example.com")

    entries = audit.of_event("reset_request")

    assert [e["user_id"] for e in entries] == [ann.id]
