RECEIVERS = []


def receiver(signal):
    def deco(fn):
        RECEIVERS.append((signal, fn))
        return fn
    return deco


@receiver("order_created")
def send_confirmation(order):
    return f"confirmation for {order.name}"


def _unused_signal_helper(order):
    return order.name
