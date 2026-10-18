"""Display formatting of money amounts."""

from decimal import ROUND_HALF_UP, Decimal

SYMBOLS = {"EUR": "€", "GBP": "£", "USD": "$"}


def symbol(code):
    try:
        return SYMBOLS[code]
    except KeyError:
        raise ValueError(f"unsupported currency: {code!r}") from None


def format_money(cents, currency="EUR"):
    """1234550 -> '12,345.50 EUR'."""
    symbol(currency)
    sign = "-" if cents < 0 else ""
    whole, rest = divmod(abs(cents), 100)
    return f"{sign}{whole:,}.{rest:02d} {currency}"


def round_for_display(value):
    """A major-unit amount as text with two decimals, e.g. Decimal('7.5') -> '7.50'."""
    return str(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def parse_money(text):
    """'12,345.50 EUR' -> 1234550."""
    amount, _, code = text.strip().partition(" ")
    symbol(code)
    negative = amount.startswith("-")
    whole, _, rest = amount.lstrip("-").replace(",", "").partition(".")
    cents = int(whole) * 100 + int((rest or "0").ljust(2, "0")[:2])
    return -cents if negative else cents
