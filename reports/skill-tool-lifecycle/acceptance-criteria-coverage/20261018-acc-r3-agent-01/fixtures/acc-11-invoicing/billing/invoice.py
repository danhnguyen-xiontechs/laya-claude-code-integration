"""Invoices, their lines and totals, and the issue step.

All amounts are integer cents. VAT is computed on the invoice net and rounded
to a whole cent.
"""

import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

RATES = {"standard": Decimal("0.20"), "reduced": Decimal("0.05"), "zero": Decimal("0")}
VAT_RATE = RATES["standard"]
PAYMENT_TERMS_DAYS = 30
EXEMPT_NOTE = "VAT exempt"
VAT_ID = re.compile(r"^[A-Z]{2}[0-9A-Z]{8,12}$")


class InvoiceLocked(Exception):
    """Raised when an invoice that is no longer a draft is changed."""


def rate_for(code):
    """VAT rate for a rate code such as "standard"."""
    try:
        return RATES[code]
    except KeyError:
        raise ValueError(f"unknown rate code: {code!r}") from None


def rate_label(code):
    return f"{int(rate_for(code) * 100)}%"


def to_cents(amount):
    """Round an amount of cents half-up to a whole cent."""
    return int(Decimal(amount).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def valid_vat_id(value):
    return bool(VAT_ID.match(value or ""))


@dataclass
class Customer:
    name: str
    email: str = ""
    vat_id: str = ""
    tax_exempt: bool = False
    currency: str = "EUR"

    def __post_init__(self):
        if not self.name or not self.name.strip():
            raise ValueError("customer name is required")
        self.name = self.name.strip()
        self.email = self.email.strip().lower()
        self.vat_id = self.vat_id.replace(" ", "").upper()
        if self.vat_id and not valid_vat_id(self.vat_id):
            raise ValueError(f"invalid VAT id: {self.vat_id}")
        if self.tax_exempt and not self.vat_id:
            raise ValueError("a tax-exempt customer needs a VAT id")


@dataclass
class Line:
    description: str
    quantity: int
    unit_price: int

    def __post_init__(self):
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
        if self.unit_price < 0:
            raise ValueError("unit price cannot be negative")

    @property
    def total(self):
        return self.quantity * self.unit_price


class Invoice:
    def __init__(self, customer, rate="standard"):
        rate_for(rate)
        self.customer = customer
        self.rate = rate
        self.lines = []
        self.discounts = []
        self.status = "draft"
        self.number = None
        self.issued_on = None
        self.paid_on = None
        self.credit_notes = []

    # ----- editing (drafts only)

    def _check_editable(self):
        if self.status != "draft":
            raise InvoiceLocked(f"invoice {self.number} is {self.status}")

    def add_line(self, description, quantity, unit_price):
        self._check_editable()
        line = Line(description, quantity, unit_price)
        self.lines.append(line)
        return line

    def remove_line(self, index):
        self._check_editable()
        return self.lines.pop(index)

    def add_discount(self, discount):
        self._check_editable()
        self.discounts.append(discount)
        return discount

    def remove_discount(self, discount):
        self._check_editable()
        self.discounts.remove(discount)

    def copy(self):
        """A new draft with the same customer, lines and discounts."""
        twin = Invoice(self.customer, self.rate)
        for line in self.lines:
            twin.lines.append(Line(line.description, line.quantity, line.unit_price))
        twin.discounts = list(self.discounts)
        return twin

    # ----- totals

    @property
    def line_total(self):
        return sum(line.total for line in self.lines)

    @property
    def net(self):
        amount = self.line_total
        for discount in sorted(self.discounts, key=lambda d: d.order):
            amount = discount.apply(amount)
        return max(amount, 0)

    @property
    def tax(self):
        if self.customer.tax_exempt:
            return 0
        return to_cents(self.net * rate_for(self.rate))

    @property
    def gross(self):
        return self.net + self.tax

    @property
    def notes(self):
        return [EXEMPT_NOTE] if self.customer.tax_exempt else []

    # ----- payment

    @property
    def due_date(self):
        if self.issued_on is None:
            return None
        return self.issued_on + timedelta(days=PAYMENT_TERMS_DAYS)

    def mark_paid(self, on):
        if self.status != "issued":
            raise ValueError("only issued invoices can be paid")
        self.paid_on = on

    def payment_state(self, today):
        if self.status in ("draft", "void"):
            return self.status
        if self.paid_on is not None:
            return "paid"
        if (today - self.issued_on).days >= PAYMENT_TERMS_DAYS:
            return "overdue"
        return "open"

    def days_overdue(self, today):
        if self.payment_state(today) != "overdue":
            return 0
        return (today - self.due_date).days


class InvoiceBook:
    """Issues invoices and hands out their numbers, one sequence per year."""

    def __init__(self):
        self.invoices = []
        self._last = {}

    def next_number(self, year):
        n = self._last.get(year, 0) + 1
        self._last[year] = n
        return f"INV-{year}-{n:04d}"

    def issue(self, invoice, on):
        if invoice.status != "draft":
            raise InvoiceLocked(f"invoice {invoice.number} is already {invoice.status}")
        if not invoice.lines:
            raise ValueError("an invoice needs at least one line")
        invoice.number = self.next_number(on.year)
        invoice.status = "issued"
        invoice.issued_on = on
        self.invoices.append(invoice)
        return invoice.number

    def open_invoices(self, today):
        return [inv for inv in self.invoices if inv.payment_state(today) in ("open", "overdue")]
