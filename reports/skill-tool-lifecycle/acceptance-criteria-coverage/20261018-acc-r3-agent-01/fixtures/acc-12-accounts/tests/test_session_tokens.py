"""Session tokens and looking sessions up by token.

Tokens are 24 lowercase hex characters. They are handed to the browser at
sign-in and are the only way the server finds a session again.
"""

UNKNOWN = "0" * 24


class TestTokenLookup:
    def test_tokens_are_unique(self, sessions, ann, bob):
        tokens = {sessions.create(ann.id).token for _ in range(20)}
        tokens.add(sessions.create(bob.id).token)

        assert len(tokens) == 21

    def test_token_length(self, sessions, ann):
        session = sessions.create(ann.id)

        assert len(session.token) == 24
        assert all(ch in "0123456789abcdef" for ch in session.token)

    def test_unknown_token_is_not_active(self, sessions, ann):
        sessions.create(ann.id)

        assert sessions.get(UNKNOWN) is None
        assert not sessions.is_active(UNKNOWN)
        assert sessions.touch(UNKNOWN) is False

    def test_get_returns_the_session(self, sessions, ann, bob):
        first = sessions.create(ann.id)
        second = sessions.create(bob.id)

        assert sessions.get(first.token) is first
        assert sessions.get(second.token) is second
        assert sessions.get(first.token).user_id == ann.id

    def test_revoke_unknown_token_is_harmless(self, sessions, ann):
        session = sessions.create(ann.id)

        sessions.revoke(UNKNOWN)

        assert sessions.is_active(session.token)
        assert len(sessions.sessions) == 1
