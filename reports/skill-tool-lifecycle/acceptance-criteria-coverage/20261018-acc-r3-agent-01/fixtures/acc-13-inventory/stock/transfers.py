"""Moving stock from one location to another."""

from .ledger import InsufficientStock, Move


def transfer(ledger, sku, source, dest, qty, ref=""):
    if source == dest:
        raise ValueError("source and destination are the same location")
    if qty <= 0:
        raise ValueError("transfer quantity must be positive")
    ledger.locations.get(source)
    ledger.locations.get(dest)
    if ledger.on_hand_at(sku, source) < qty:
        raise InsufficientStock(f"{sku} at {source}: {ledger.on_hand_at(sku, source)} on hand, {qty} requested")
    ledger._apply(sku, source, -qty)
    ledger._apply(sku, dest, qty)
    return ledger._record(Move("transfer", sku, qty, source, ref=ref, to_location=dest))
