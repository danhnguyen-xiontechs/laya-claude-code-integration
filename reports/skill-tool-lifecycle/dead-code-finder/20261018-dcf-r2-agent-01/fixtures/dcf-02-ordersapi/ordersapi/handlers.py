class Handler:
    def dispatch(self, kind, order):
        return getattr(self, "on_" + kind)(order)

    def on_created(self, order):
        return ("created", order.total())

    def on_cancelled(self, order):
        return ("cancelled", order.total())
