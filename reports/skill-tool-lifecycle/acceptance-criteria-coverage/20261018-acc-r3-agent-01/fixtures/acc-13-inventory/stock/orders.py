"""Customer orders: placing reserves stock, shipping issues it."""

from dataclasses import dataclass, field


@dataclass
class OrderLine:
    sku: str
    qty: int


@dataclass
class Order:
    id: str
    lines: list = field(default_factory=list)
    paid: int = 0
    status: str = "open"
    refunded: int = 0


class OrderService:
    def __init__(self, book, ledger):
        self.book = book
        self.ledger = ledger

    def place(self, order, now):
        if not order.lines:
            raise ValueError("an order needs at least one line")
        for line in order.lines:
            self.book.reserve(line.sku, line.qty, order.id, now)
        order.status = "placed"

    def cancel(self, order):
        if order.status == "shipped":
            raise ValueError("a shipped order cannot be cancelled")
        order.status = "cancelled"
        order.refunded = order.paid
        self.book.release_for_order(order.id)

    def ship(self, order, location):
        if order.status != "placed":
            raise ValueError(f"cannot ship an order that is {order.status}")
        for res in self.book.for_order(order.id):
            self.ledger.issue(res.sku, location, res.qty, ref=order.id)
            res.released = True
        order.status = "shipped"
