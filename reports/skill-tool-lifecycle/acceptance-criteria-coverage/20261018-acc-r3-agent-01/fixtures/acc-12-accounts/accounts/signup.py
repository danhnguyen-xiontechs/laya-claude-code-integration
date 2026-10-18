"""Sign-up, the user store and profile changes."""

import re
from dataclasses import dataclass, field

from .auth import make_hash, password_problem
from .mailer import welcome_mail

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def normalize_email(email):
    return email.strip().casefold()


@dataclass
class User:
    id: int
    email: str
    password_hash: str
    name: str = ""
    role: str = "member"
    failures: list = field(default_factory=list)
    locked_until: object = None
    last_login: object = None
    created_at: object = None

    def is_locked(self, now):
        return self.locked_until is not None and now < self.locked_until


class UserStore:
    def __init__(self):
        self.users = {}
        self._next = 0

    def next_id(self):
        self._next += 1
        return self._next

    def add(self, user):
        self.users[user.id] = user
        return user

    def get(self, user_id):
        return self.users.get(user_id)

    def remove(self, user_id):
        self.users.pop(user_id, None)

    def by_email(self, email):
        key = normalize_email(email)
        for user in self.users.values():
            if user.email == key:
                return user
        return None


@dataclass
class SignupResult:
    ok: bool
    error: str = None
    user: User = None


class SignupService:
    def __init__(self, store, mailer, audit, clock):
        self.store = store
        self.mailer = mailer
        self.audit = audit
        self.clock = clock

    def signup(self, email, password, name=""):
        if not EMAIL.match(email.strip()):
            return SignupResult(False, "invalid email")
        problem = password_problem(password)
        if problem:
            return SignupResult(False, problem)
        if self.store.by_email(email) is not None:
            return SignupResult(False, "email taken")
        key = normalize_email(email)
        user_id = self.store.next_id()
        user = User(
            id=user_id,
            email=key,
            password_hash=make_hash(password, f"user-{user_id}"),
            name=name.strip() or key.split("@")[0],
            created_at=self.clock.now(),
        )
        self.store.add(user)
        subject, body = welcome_mail(user)
        self.mailer.send(user.email, subject, body)
        self.audit.record("signup", user.id)
        return SignupResult(True, None, user)


def rename(user, name):
    if not name.strip():
        raise ValueError("name cannot be blank")
    user.name = name.strip()


def change_email(store, mailer, user, new_email):
    """Move the account to a new address; the old address gets a notice."""
    if not EMAIL.match(new_email.strip()):
        return "invalid email"
    other = store.by_email(new_email)
    if other is not None and other is not user:
        return "email taken"
    old = user.email
    user.email = normalize_email(new_email)
    mailer.send(old, "Your sign-in email was changed", f"Your account now uses {user.email}.\n")
    return None
