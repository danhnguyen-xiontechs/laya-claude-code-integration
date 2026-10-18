"""Credit notes: voiding a whole invoice, or crediting one of its lines."""

from dataclasses import dataclass
from datetime import date

from .invoice import rate_for, to_cents


@dataclass
class CreditNote:
    number: str
    invoice_number: str
    amount: int
    reason: str
    issued_on: date


def void(invoice, sequence, on, reason="void"):
    """Void an issued invoice; the credit note reverses its gross amount."""
    if invoice.status != "issued":
        raise ValueError(f"cannot void a {invoice.status} invoice")
    note = CreditNote(sequence.next(on), invoice.number, invoice.gross, reason, on)
    invoice.credit_notes.append(note)
    invoice.status = "void"
    return note


def credit_line(invoice, index, sequence, on, reason="line credit"):
    """Credit a single line of an issued invoice, VAT included."""
    if invoice.status != "issued":
        raise ValueError(f"cannot credit a {invoice.status} invoice")
    line = invoice.lines[index]
    tax = 0 if invoice.customer.tax_exempt else to_cents(line.total * rate_for(invoice.rate))
    note = CreditNote(sequence.next(on), invoice.number, line.total + tax, reason, on)
    invoice.credit_notes.append(note)
    return note


def credited_total(invoice):
    return sum(note.amount for note in invoice.credit_notes)
