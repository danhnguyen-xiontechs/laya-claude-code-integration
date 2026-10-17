class OutOfStock(Exception):
    pass


class CouponError(Exception):
    pass


STOCK = {"A1": 5, "B2": 0, "C3": 10}
PRICES = {"A1": 1000, "B2": 500, "C3": 250}
SHIPPING = 700
COUPONS = {"SAVE10": 10, "HALF": 50, "BIG": 150}


class Cart:
    def __init__(self):
        self.lines = {}
        self.coupon = None

    def add(self, sku, qty=1):
        if STOCK.get(sku, 0) < self.lines.get(sku, 0) + qty:
            raise OutOfStock(sku)
        self.lines[sku] = self.lines.get(sku, 0) + qty

    def remove(self, sku):
        self.lines.pop(sku, None)
        if not self.lines:
            self.coupon = None

    def apply_coupon(self, code):
        if self.coupon is not None:
            raise CouponError("already applied")
        if code not in COUPONS:
            raise CouponError("unknown coupon")
        self.coupon = code

    def subtotal(self):
        return sum(PRICES[s] * q for s, q in self.lines.items())

    def discount(self):
        return self.subtotal() * COUPONS.get(self.coupon, 0) // 100

    def total(self):
        if not self.lines:
            return 0
        return max(0, self.subtotal() - self.discount()) + SHIPPING
