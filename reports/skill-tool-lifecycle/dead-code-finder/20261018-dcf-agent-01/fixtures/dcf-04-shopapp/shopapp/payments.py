class StripeBackend:
    def charge(self, amount):
        return {"status": "ok", "amount": amount}


class PaypalBackend:
    def charge(self, amount):
        return {"status": "ok", "amount": amount}
