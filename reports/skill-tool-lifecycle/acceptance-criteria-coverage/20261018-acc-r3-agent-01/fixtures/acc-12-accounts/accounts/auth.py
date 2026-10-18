"""Passwords, sign-in, lockout and password changes."""

import hashlib
from dataclasses import dataclass
from datetime import timedelta

from .roles import require

MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=15)
LOCK_DURATION = timedelta(minutes=30)
MIN_LENGTH = 10


def hash_password(password, salt):
    digest = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"{salt}${digest}"


def make_hash(password, seed):
    salt = hashlib.sha256(seed.encode()).hexdigest()[:16]
    return hash_password(password, salt)


def verify_password(password, stored):
    salt, _, _ = stored.partition("$")
    return hash_password(password, salt) == stored


def password_problem(password):
    if len(password) < MIN_LENGTH:
        return "password too short"
    if not any(ch.isdigit() for ch in password):
        return "password needs a digit"
    return None


@dataclass
class LoginResult:
    ok: bool
    reason: str = None
    session: object = None
    user_id: int = None


class AuthService:
    def __init__(self, store, sessions, audit, clock):
        self.store = store
        self.sessions = sessions
        self.audit = audit
        self.clock = clock

    def login(self, email, password):
        now = self.clock.now()
        user = self.store.by_email(email)
        if user is None:
            self.audit.record("login", None, "failure", reason="unknown email")
            return LoginResult(False, "unknown email")
        if user.is_locked(now):
            self.audit.record("login", user.id, "failure", reason="locked")
            return LoginResult(False, "locked", user_id=user.id)
        if not verify_password(password, user.password_hash):
            recent = [t for t in user.failures if now - t < FAILURE_WINDOW]
            user.failures = recent + [now]
            if len(user.failures) >= MAX_FAILURES:
                user.locked_until = now + LOCK_DURATION
                user.failures = []
            self.audit.record("login", user.id, "failure", reason="bad credentials")
            return LoginResult(False, "bad credentials", user_id=user.id)
        user.failures = []
        user.last_login = now
        session = self.sessions.create(user.id)
        self.audit.record("login", user.id, "success")
        return LoginResult(True, None, session, user.id)

    def logout(self, token):
        self.sessions.revoke(token)

    def change_password(self, user, old_password, new_password, current_token):
        """Set a new password; every other session of the user is ended."""
        if not verify_password(old_password, user.password_hash):
            raise ValueError("wrong password")
        problem = password_problem(new_password)
        if problem:
            raise ValueError(problem)
        user.password_hash = make_hash(new_password, f"user-{user.id}-{self.clock.iso()}")
        self.sessions.revoke_others(user.id, keep=current_token)
        self.audit.record("password_change", user.id)

    def unlock(self, actor, user):
        require(actor, "unlock")
        user.locked_until = None
        user.failures = []
        self.audit.record("unlock", user.id, by=actor.id)
