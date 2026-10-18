"""Customer records.

A customer has a name, an email address, an optional VAT id and a currency.
Names are trimmed, emails lowercased and VAT ids normalised on creation.
"""

import pytest

from billing.invoice import Customer, valid_vat_id


def test_customer_requires_name():
    with pytest.raises(ValueError):
        Customer("   ")

    with pytest.raises(ValueError):
        Customer("")


@pytest.mark.parametrize(
    "vat_id, ok",
    [
        ("DE123456789", True),
        ("FR12345678901", True),
        ("de 123 456 789", True),
        ("123456789", False),
        ("DE12", False),
    ],
)
def test_vat_id_format(vat_id, ok):
    normalised = vat_id.replace(" ", "").upper()

    assert valid_vat_id(normalised) is ok


def test_customer_email_lowercased(customer):
    assert customer.email == "accounts@northwind.example"


def test_customer_default_currency(customer, second_customer):
    assert customer.currency == "EUR"
    assert second_customer.currency == "EUR"


def test_invalid_vat_id_rejected():
    with pytest.raises(ValueError):
        Customer("Contoso", vat_id="XX1")

    trimmed = Customer("  Fabrikam Ltd  ", vat_id="nl 8123 4567 8b01")

    assert trimmed.name == "Fabrikam Ltd"
    assert trimmed.vat_id == "NL812345678B01"
