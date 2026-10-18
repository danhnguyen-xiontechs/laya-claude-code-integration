"""Visit fees in cents, and how they are shown."""

FEES = {"consultation": 6000, "follow-up": 3500, "vaccination": 2000}


def fee_for(kind):
    try:
        return FEES[kind]
    except KeyError:
        raise ValueError(f"unknown visit kind: {kind!r}") from None


def fee_display(cents):
    return f"{cents // 100}.{cents % 100:02d} EUR"


def total(kinds):
    return sum(fee_for(k) for k in kinds)
