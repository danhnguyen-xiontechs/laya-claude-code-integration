from .core import Order

ROUTES = {}


def route(path):
    def deco(fn):
        ROUTES[path] = fn
        return fn
    return deco


def render_json(order):
    return order.to_dict()


def render_xml(order):
    return order.to_xml()


@route("/orders")
def list_orders():
    return [render_json(Order([(100, 2)]))]


@route("/health")
def health():
    return {"ok": True}
