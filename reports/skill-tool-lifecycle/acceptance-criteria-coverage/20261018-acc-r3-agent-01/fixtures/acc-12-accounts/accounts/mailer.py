"""Outgoing mail. The Outbox keeps messages in memory instead of sending them."""

from dataclasses import dataclass


@dataclass
class Mail:
    to: str
    subject: str
    body: str


class Outbox:
    def __init__(self):
        self.messages = []

    def send(self, to, subject, body):
        mail = Mail(to, subject, body)
        self.messages.append(mail)
        return mail

    def to(self, address):
        return [m for m in self.messages if m.to == address]

    def last_to(self, address):
        sent = self.to(address)
        return sent[-1] if sent else None

    def clear(self):
        self.messages.clear()


def welcome_mail(user):
    subject = "Welcome to Acme Accounts"
    body = (
        f"Hello {user.name},\n\n"
        f"your account {user.email} is ready. You can sign in at https://accounts.example/login.\n"
    )
    return subject, body
