from shopapp.models import Order
from shopapp.views import order_list
from shopapp.utils import today
from shopapp.app import build


def test_list():
    Order.objects[:] = [Order("a")]
    assert order_list(None) == ["a"]


def test_today():
    assert len(today()) == 10


def test_build_wires_everything():
    middleware, backend_ok, routes = build()
    assert len(middleware) == 1 and backend_ok and len(routes) == 2
