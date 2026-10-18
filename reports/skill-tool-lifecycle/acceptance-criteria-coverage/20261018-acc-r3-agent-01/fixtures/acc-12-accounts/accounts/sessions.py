"""Sign-in sessions. A session stays active while it is used."""

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta

IDLE_LIMIT = timedelta(hours=8)


@dataclass
class Session:
    token: str
    user_id: int
    created_at: datetime
    last_seen: datetime
    revoked: bool = False


class SessionStore:
    def __init__(self, clock):
        self.clock = clock
        self.sessions = {}
        self._count = 0

    def create(self, user_id):
        self._count += 1
        token = hashlib.sha256(f"session-{self._count}-{user_id}".encode()).hexdigest()[:24]
        now = self.clock.now()
        session = Session(token, user_id, now, now)
        self.sessions[token] = session
        return session

    def get(self, token):
        return self.sessions.get(token)

    def is_active(self, token):
        session = self.sessions.get(token)
        if session is None or session.revoked:
            return False
        return self.clock.now() - session.last_seen < IDLE_LIMIT

    def touch(self, token):
        if not self.is_active(token):
            return False
        self.sessions[token].last_seen = self.clock.now()
        return True

    def revoke(self, token):
        session = self.sessions.get(token)
        if session is not None:
            session.revoked = True

    def revoke_others(self, user_id, keep):
        for session in self.sessions.values():
            if session.user_id == user_id and session.token != keep:
                session.revoked = True

    def active_for(self, user_id):
        return [s.token for s in self.sessions.values() if s.user_id == user_id and self.is_active(s.token)]
