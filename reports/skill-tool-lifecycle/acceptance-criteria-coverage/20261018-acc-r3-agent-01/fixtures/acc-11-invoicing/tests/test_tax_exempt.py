"""Customers that are exempt from VAT.

Exemption is a flag on the customer record and needs a VAT id.
"""

import pytest

from billing.invoice import Customer, Invoice


def test_exempt_customer_has_zero_tax(exempt_customer):
    inv = Invoice(exempt_customer)
    inv.add_line("Charity gala catering", 2, 5000)

    assert inv.tax == 0


def test_exempt_flag_from_customer_record(exempt_customer, customer):
    assert exempt_customer.tax_exempt is True
    assert customer.tax_exempt is False

    assert exempt_customer.vat_id == "DE987654321"
    assert exempt_customer.email == "office@helpinghands.example"


def test_non_exempt_customer_pays_vat(customer):
    inv = Invoice(customer)
    inv.add_line("Charity gala catering", 2, 5000)

    assert inv.net == 10000
    assert inv.tax == 2000
    assert inv.gross == 12000


def test_exemption_needs_vat_id():
    with pytest.raises(ValueError):
        Customer("Helping Hands e.V.", tax_exempt=True)

    with pytest.raises(ValueError):
        Customer("Helping Hands e.V.", vat_id="", tax_exempt=True)
