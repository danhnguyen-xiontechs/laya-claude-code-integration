"""Payment reminder emails.

send_reminders goes over the invoices, picks the overdue ones and writes one
email per invoice to the outbox.
"""

from billing.reminders import reminder_message, send_reminders
from tests.helpers import HOSTING, days_after_issue, issued_invoice

LATE = days_after_issue(35)


def test_reminder_subject_and_content(book, customer):
    inv = issued_invoice(book, customer, HOSTING)

    msg = reminder_message(inv, LATE)

    assert msg["subject"].startswith("Payment reminder")
    assert "5 days overdue" in msg["body"]
    assert msg["body"].startswith("Dear Northwind Traders")


def test_reminder_goes_to_customer_email(book, customer, outbox, reminder_log):
    issued_invoice(book, customer, HOSTING)

    send_reminders(book.invoices, LATE, outbox, reminder_log)

    recipients = [m["to"] for m in outbox.messages]

    assert recipients == ["accounts@northwind.example"]


def test_no_reminder_for_paid_invoice(book, customer, outbox, reminder_log):
    inv = issued_invoice(book, customer, HOSTING)
    inv.mark_paid(days_after_issue(20))

    sent = send_reminders(book.invoices, LATE, outbox, reminder_log)

    assert sent == []
    assert outbox.messages == []


def test_reminder_includes_amount(book, customer, outbox, reminder_log):
    issued_invoice(book, customer, ("Data migration project", 1, 100000))

    send_reminders(book.invoices, LATE, outbox, reminder_log)

    body = outbox.messages[0]["body"]

    assert "1,200.00 EUR" in body
