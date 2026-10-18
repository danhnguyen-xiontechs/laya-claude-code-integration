"""Payment reminders for overdue invoices.

An overdue invoice gets a reminder email; the next one for the same invoice is
sent no sooner than seven days later.
"""

from datetime import timedelta

from .currency import format_money

REMINDER_INTERVAL = timedelta(days=7)


class Outbox:
    def __init__(self):
        self.messages = []

    def send(self, to, subject, body):
        self.messages.append({"to": to, "subject": subject, "body": body})


class ReminderLog:
    def __init__(self):
        self.last_sent = {}

    def record(self, number, day):
        self.last_sent[number] = day

    def last(self, number):
        return self.last_sent.get(number)


def reminder_message(invoice, today):
    amount = format_money(invoice.gross, invoice.customer.currency)
    days = invoice.days_overdue(today)
    subject = f"Payment reminder: invoice {invoice.number}"
    body = (
        f"Dear {invoice.customer.name},\n\n"
        f"our invoice {invoice.number} over {amount} was due on {invoice.due_date.isoformat()} "
        f"and is now {days} days overdue. Please arrange payment.\n"
    )
    return {"to": invoice.customer.email, "subject": subject, "body": body}


def due_for_reminder(invoice, today, log):
    if invoice.payment_state(today) != "overdue":
        return False
    last = log.last(invoice.number)
    return last is None or today - last >= REMINDER_INTERVAL


def send_reminders(invoices, today, outbox, log):
    """Send every reminder that is due today; returns the invoice numbers reminded."""
    sent = []
    for invoice in invoices:
        if not due_for_reminder(invoice, today, log):
            continue
        msg = reminder_message(invoice, today)
        outbox.send(msg["to"], msg["subject"], msg["body"])
        log.record(invoice.number, today)
        sent.append(invoice.number)
    return sent
