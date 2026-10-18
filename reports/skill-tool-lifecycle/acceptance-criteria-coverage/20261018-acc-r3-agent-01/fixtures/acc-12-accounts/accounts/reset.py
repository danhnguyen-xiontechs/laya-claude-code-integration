"""Password reset by emailed token."""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

from .auth import make_hash, password_problem

TOKEN_TTL = timedelta(hours=1)
RESET_URL = "https://accounts.example/reset?token="


class InvalidToken(Exception):
    pass


@dataclass
class ResetToken:
    value: str
    user_id: int
    created_at: datetime
    used: bool = False


class ResetService:
    def __init__(self, store, mailer, audit, clock):
        self.store = store
        self.mailer = mailer
        self.audit = audit
        self.clock = clock
        self.tokens = {}
        self._issued = 0

    def request(self, email):
        """Mail a reset link; returns the token, or None for an unknown address."""
        user = self.store.by_email(email)
        if user is None:
            return None
        self._issued += 1
        raw = f"{user.id}:{self._issued}:{self.clock.iso()}"
        value = hashlib.sha256(raw.encode()).hexdigest()[:32]
        self.tokens[value] = ResetToken(value, user.id, self.clock.now())
        self.mailer.send(
            user.email,
            "Reset your password",
            f"Open {RESET_URL}{value} to choose a new password.\n",
        )
        self.audit.record("reset_request", user.id)
        return value

    def is_valid(self, value):
        token = self.tokens.get(value)
        if token is None or token.used:
            return False
        return self.clock.now() - token.created_at < TOKEN_TTL

    def complete(self, value, new_password):
        if not self.is_valid(value):
            raise InvalidToken(value)
        problem = password_problem(new_password)
        if problem:
            raise ValueError(problem)
        token = self.tokens[value]
        user = self.store.get(token.user_id)
        user.password_hash = make_hash(new_password, f"user-{user.id}-reset-{value}")
        token.used = True
        self.audit.record("password_reset", user.id)
        return user
