"""Discounts on the invoice net.

Percentage discounts are applied first, fixed amounts after them. The invoice
never lets the net drop below zero.
"""

from decimal import Decimal

from .invoice import to_cents


class PercentDiscount:
    order = 0

    def __init__(self, percent):
        if isinstance(percent, bool) or not 0 <= percent <= 100:
            raise ValueError("a percentage discount must be between 0 and 100")
        self.percent = percent

    @property
    def label(self):
        return f"{self.percent}% off"

    def amount_for(self, net):
        return to_cents(Decimal(net) * Decimal(self.percent) / 100)

    def apply(self, net):
        return net - self.amount_for(net)


class FixedDiscount:
    order = 1

    def __init__(self, amount):
        if amount <= 0:
            raise ValueError("a fixed discount must be a positive amount")
        self.amount = amount

    @property
    def label(self):
        whole, cents = divmod(self.amount, 100)
        return f"{whole}.{cents:02d} off"

    def amount_for(self, net):
        return min(self.amount, max(net, 0))

    def apply(self, net):
        return max(net - self.amount, 0)


def total_discount(invoice):
    """How much the discounts take off the line total."""
    return invoice.line_total - invoice.net
