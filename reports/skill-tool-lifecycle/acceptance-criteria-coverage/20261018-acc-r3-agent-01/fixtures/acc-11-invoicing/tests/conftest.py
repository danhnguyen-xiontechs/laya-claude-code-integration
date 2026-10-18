"""Fixtures for the billing tests: customers, the invoice book and the outbox."""

import pytest

from billing.invoice import Customer, Invoice, InvoiceBook
from billing.numbering import CreditNoteSequence
from billing.reminders import Outbox, ReminderLog


@pytest.fixture
def customer():
    return Customer(
        "Northwind Traders",
        email="Accounts@Northwind.example",
        vat_id="DE123456789",
    )


@pytest.fixture
def second_customer():
    return Customer(
        "Contoso Pharmaceuticals",
        email="ap@contoso.example",
        vat_id="FR12345678901",
    )


@pytest.fixture
def exempt_customer():
    return Customer(
        "Helping Hands e.V.",
        email="office@helpinghands.example",
        vat_id="DE987654321",
        tax_exempt=True,
    )


@pytest.fixture
def invoice(customer):
    return Invoice(customer)


@pytest.fixture
def book():
    return InvoiceBook()


@pytest.fixture
def sequence():
    return CreditNoteSequence()


@pytest.fixture
def outbox():
    return Outbox()


@pytest.fixture
def reminder_log():
    return ReminderLog()
