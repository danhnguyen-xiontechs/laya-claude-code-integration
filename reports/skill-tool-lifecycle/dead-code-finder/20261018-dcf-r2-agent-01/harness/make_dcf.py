"""Writes the three own dead-code-finder fixture repos and their gold (answer key kept apart).
usage: python make_dcf.py <outdir>  -> <outdir>/repos/<case>/..., <outdir>/keys/<case>.json
gold items: {id, class: dead|decoy, file, match}  (match = substring that identifies the symbol or the line)"""
import json, sys
from pathlib import Path

FIX = {}
GOLD = {}

# ====================================================================== dcf-02 orders-api (decorators, getattr, entry points, config)
FIX["dcf-02-ordersapi"] = {
"pyproject.toml": '''[project]
name = "ordersapi"
version = "0.3.0"

[project.scripts]
orders = "ordersapi.cli:main"

[project.entry-points."ordersapi.exporters"]
csv = "ordersapi.exporters:CsvExporter"
''',
"settings.toml": '''[tasks]
schedule = ["rebuild_index"]
''',
"ordersapi/__init__.py": '''from .core import Order, total_for

__all__ = ["Order", "total_for"]
''',
"ordersapi/core.py": '''import json
from decimal import Decimal

ROUND_MODE = "half-up"
TAX = Decimal("0.2")


class Order:
    def __init__(self, items):
        self.items = items

    def total(self):
        return sum(price * qty for price, qty in self.items)

    def to_dict(self):
        return {"items": self.items, "total": self.total()}

    def to_xml(self):
        rows = "".join(f"<item price='{p}' qty='{q}'/>" for p, q in self.items)
        return f"<order>{rows}</order>"


def total_for(order):
    return order.total() * (1 + TAX)


def legacy_total(order):
    return sum(p for p, _ in order.items)


def _cents(value):
    return int(round(value * 100))
''',
"ordersapi/web.py": '''from .core import Order

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
''',
"ordersapi/tasks.py": '''TASKS = {}


def task(fn):
    TASKS[fn.__name__] = fn
    return fn


@task
def nightly_cleanup():
    return "cleaned"


@task
def rebuild_index():
    return "indexed"


def send_digest(users):
    return [f"digest for {u}" for u in users]
''',
"ordersapi/handlers.py": '''class Handler:
    def dispatch(self, kind, order):
        return getattr(self, "on_" + kind)(order)

    def on_created(self, order):
        return ("created", order.total())

    def on_cancelled(self, order):
        return ("cancelled", order.total())
''',
"ordersapi/exporters.py": '''class BaseExporter:
    def export(self, order):
        raise NotImplementedError


class CsvExporter(BaseExporter):
    def export(self, order):
        return ",".join(str(p * q) for p, q in order.items)
''',
"ordersapi/cli.py": '''import sys

from .core import Order, total_for
from . import tasks, web
from .handlers import Handler


def main():
    print("DEBUG argv", sys.argv)
    if len(sys.argv) < 2:
        print("usage: orders <price> <qty>")
        return 2
    order = Order([(int(sys.argv[1]), int(sys.argv[2]))])
    # total = order.total()
    # print("old total", total)
    print(total_for(order))
    print(Handler().dispatch("created", order))
    print(sorted(web.ROUTES), sorted(tasks.TASKS))
    return 0
''',
"ordersapi/debug.py": '''def dump_order(order):
    return f"Order({order.items!r})"
''',
"tests/test_core.py": '''from ordersapi import Order, total_for
from ordersapi.debug import dump_order


def make_order():
    return Order([(100, 2), (50, 1)])


def test_total():
    assert make_order().total() == 250


def test_total_for():
    assert total_for(make_order()) == 300


def test_dump():
    assert "Order" in dump_order(make_order())
''',
}
GOLD["dcf-02-ordersapi"] = [
    ("D1", "dead", "ordersapi/core.py", "legacy_total"), ("D2", "dead", "ordersapi/core.py", "ROUND_MODE"),
    ("N1", "neutral", "ordersapi/core.py", "to_xml"), ("N2", "neutral", "ordersapi/cli.py", "Handler().dispatch|sorted(web.ROUTES)"), ("D4", "dead", "ordersapi/core.py", "import json"),
    ("D5", "dead", "ordersapi/core.py", "_cents"), ("D6", "dead", "ordersapi/web.py", "render_xml"),
    ("D7", "dead", "ordersapi/tasks.py", "send_digest"), ("D8", "dead", "ordersapi/cli.py", "DEBUG argv"),
    ("D9", "dead", "ordersapi/cli.py", "total = order.total()|old total"),
    ("K1", "decoy", "ordersapi/__init__.py", "total_for"), ("K2", "decoy", "ordersapi/core.py", "class Order"),
    ("K3", "decoy", "ordersapi/web.py", "list_orders"), ("K4", "decoy", "ordersapi/web.py", "health"),
    ("K5", "decoy", "ordersapi/tasks.py", "nightly_cleanup"), ("K6", "decoy", "ordersapi/tasks.py", "rebuild_index"),
    ("K7", "decoy", "ordersapi/handlers.py", "on_created"), ("K8", "decoy", "ordersapi/handlers.py", "on_cancelled"),
    ("K9", "decoy", "ordersapi/exporters.py", "CsvExporter"), ("K10", "decoy", "ordersapi/cli.py", "def main"),
    ("K11", "decoy", "ordersapi/debug.py", "dump_order"), ("K12", "decoy", "ordersapi/cli.py", "usage: orders"),
    ("K13", "decoy", "ordersapi/core.py", "to_dict"),
]

# ====================================================================== dcf-03 plugin library (init_subclass registry, __all__, yaml, plugins)
FIX["dcf-03-pluglib"] = {
"pyproject.toml": '''[project]
name = "pluglib"
version = "1.2.0"

[project.entry-points."pytest11"]
pluglib = "pluglib.pytest_plugin"
''',
"pluglib/__init__.py": '''from . import builtin  # noqa: F401  (registers the built-in plugins)
from .registry import Plugin, get_plugin, available
from .text import normalize

__all__ = ["Plugin", "get_plugin", "available", "normalize"]
''',
"pluglib/registry.py": '''_PLUGINS = {}


class Plugin:
    name = None

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        if cls.name:
            _PLUGINS[cls.name] = cls

    def run(self, data):
        raise NotImplementedError


def get_plugin(name):
    return _PLUGINS[name]()


def available():
    return sorted(_PLUGINS)


def unregister(name):
    _PLUGINS.pop(name, None)
''',
"pluglib/builtin.py": '''from .registry import Plugin
from .text import normalize


class Upper(Plugin):
    name = "upper"

    def run(self, data):
        return normalize(data).upper()


class Reverse(Plugin):
    name = "reverse"

    def run(self, data):
        return normalize(data)[::-1]


class Experimental(Plugin):
    def run(self, data):
        return data
''',
"pluglib/text.py": '''import re
import unicodedata

WS = re.compile(r"\\s+")
MAX_LEN = 10_000


def normalize(text):
    return WS.sub(" ", text).strip()


def strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))


def truncate(text, n=80):
    return text[:n]
''',
"pluglib/pytest_plugin.py": '''import pytest


@pytest.fixture
def plugin_names():
    from pluglib import available
    return available()


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: slow plugin test")
''',
"pluglib/compat.py": '''import sys

PY2 = sys.version_info[0] == 2


def text_type():
    return str if not PY2 else unicode  # noqa: F821
''',
"pluglib/config.py": '''DEFAULTS = {"plugin": "upper"}


def load(path):
    import yaml
    with open(path) as fh:
        return {**DEFAULTS, **yaml.safe_load(fh)}
''',
"pluglib.yaml": '''plugin: reverse
formatter: pluglib.text.truncate
loader: pluglib.config.load
''',
"tests/test_plugins.py": '''import pluglib
import pluglib.builtin  # noqa: F401
from pluglib.registry import unregister


def test_upper():
    assert pluglib.get_plugin("upper").run(" a  b ") == "A B"


def test_available():
    assert pluglib.available() == ["reverse", "upper"]


def test_unregister_roundtrip():
    unregister("nope")
''',
}
GOLD["dcf-03-pluglib"] = [
    ("D1", "dead", "pluglib/text.py", "strip_accents"), ("D2", "dead", "pluglib/text.py", "MAX_LEN"),
    ("D3", "dead", "pluglib/compat.py", "text_type"), ("N1", "neutral", "pluglib/compat.py", "PY2"), ("N2", "neutral", "pluglib/text.py", "unicodedata"), ("N3", "neutral", "tests/test_plugins.py", "pluglib.builtin"), ("N4", "neutral", "pluglib/compat.py", "compat"),
    ("D5", "dead", "pluglib/builtin.py", "Experimental"),
    ("K1", "decoy", "pluglib/__init__.py", "get_plugin"), ("K2", "decoy", "pluglib/__init__.py", "normalize"),
    ("K3", "decoy", "pluglib/builtin.py", "Upper"), ("K4", "decoy", "pluglib/builtin.py", "Reverse"),
    ("K5", "decoy", "pluglib/text.py", "truncate"), ("K6", "decoy", "pluglib/pytest_plugin.py", "plugin_names"),
    ("K7", "decoy", "pluglib/pytest_plugin.py", "pytest_configure"), ("K8", "decoy", "pluglib/registry.py", "__init_subclass__"),
    ("K9", "decoy", "pluglib/registry.py", "unregister"), ("K10", "decoy", "pluglib/config.py", "def load"),
    ("K11", "decoy", "pluglib/registry.py", "available"),
]

# ====================================================================== dcf-04 django-style app (settings dotted paths, receivers, admin, mgmt command)
FIX["dcf-04-shopapp"] = {
"pyproject.toml": '''[project]
name = "shopapp"
version = "0.1.0"
''',
"shopapp/__init__.py": "",
"shopapp/settings.py": '''MIDDLEWARE = ["shopapp.middleware.TimingMiddleware"]
PAYMENT_BACKEND = "shopapp.payments.StripeBackend"
URLCONF = "shopapp.urls"
''',
"shopapp/app.py": '''import importlib

from . import settings, urls


def load(path):
    mod, _, name = path.rpartition(".")
    return getattr(importlib.import_module(mod), name)


def build():
    for name in ("admin", "signals"):
        importlib.import_module(f"shopapp.{name}")
    middleware = [load(p) for p in settings.MIDDLEWARE]
    backend_ok = load(settings.PAYMENT_BACKEND)().charge(0)["status"] == "ok"
    routes = {pattern: load(view) for pattern, view in urls.URLPATTERNS}
    return middleware, backend_ok, routes
''',
"shopapp/urls.py": '''URLPATTERNS = [
    ("orders/", "shopapp.views.order_list"),
    ("orders/<id>/", "shopapp.views.order_detail"),
]
''',
"shopapp/views.py": '''from .models import Order


def order_list(request):
    return [o.name for o in Order.objects]


def order_detail(request, id):
    return Order.get(id)


def order_export(request):
    return "csv"
''',
"shopapp/models.py": '''class Order:
    objects = []

    def __init__(self, name):
        self.name = name

    @classmethod
    def get(cls, id):
        return cls.objects[int(id)]

    def __str__(self):
        return self.name

    def recalculate_legacy(self):
        return 0
''',
"shopapp/middleware.py": '''import time


class TimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.time()
        response = self.get_response(request)
        print("took", time.time() - start)
        return response


class DebugToolbarMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)
''',
"shopapp/payments.py": '''class StripeBackend:
    def charge(self, amount):
        return {"status": "ok", "amount": amount}


class PaypalBackend:
    def charge(self, amount):
        return {"status": "ok", "amount": amount}
''',
"shopapp/signals.py": '''RECEIVERS = []


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
''',
"shopapp/admin.py": '''REGISTRY = {}


def register(model):
    def deco(cls):
        REGISTRY[model] = cls
        return cls
    return deco


@register("Order")
class OrderAdmin:
    list_display = ("name",)

    def get_queryset(self):
        return []
''',
"manage.py": '''import importlib
import sys

if __name__ == "__main__":
    mod = importlib.import_module(f"shopapp.management.commands.{sys.argv[1]}")
    mod.Command().handle()
''',
"shopapp/management/commands/purge.py": '''class BaseCommand:
    def handle(self, *args, **options):
        raise NotImplementedError


class Command(BaseCommand):
    help = "Purge old orders"

    def handle(self, *args, **options):
        print("purging")
        # for o in old_orders():
        #     o.delete()
        return 0
''',
"shopapp/utils.py": '''import datetime

DATE_FMT = "%Y-%m-%d"
OLD_DATE_FMT = "%d/%m/%Y"


def today():
    return datetime.date.today().strftime(DATE_FMT)


def slug(text):
    return text.lower().replace(" ", "-")
''',
"tests/test_views.py": '''from shopapp.models import Order
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
''',
}
GOLD["dcf-04-shopapp"] = [
    ("D1", "dead", "shopapp/views.py", "order_export"), ("D2", "dead", "shopapp/models.py", "recalculate_legacy"),
    ("D3", "dead", "shopapp/middleware.py", "DebugToolbarMiddleware"), ("D4", "dead", "shopapp/payments.py", "PaypalBackend"),
    ("D5", "dead", "shopapp/signals.py", "_unused_signal_helper"), ("D6", "dead", "shopapp/utils.py", "OLD_DATE_FMT"),
    ("D7", "dead", "shopapp/utils.py", "def slug"), ("D8", "dead", "shopapp/management/commands/purge.py", "old_orders|o.delete"),
    ("K1", "decoy", "shopapp/views.py", "order_detail"), ("K2", "decoy", "shopapp/views.py", "order_list"),
    ("K3", "decoy", "shopapp/middleware.py", "TimingMiddleware"), ("K4", "decoy", "shopapp/payments.py", "StripeBackend"),
    ("K5", "decoy", "shopapp/signals.py", "send_confirmation"), ("K6", "decoy", "shopapp/admin.py", "OrderAdmin"),
    ("N1", "neutral", "shopapp/admin.py", "get_queryset"), ("K8", "decoy", "shopapp/management/commands/purge.py", "handle"),
    ("K9", "decoy", "shopapp/models.py", "__str__"), ("K10", "decoy", "shopapp/utils.py", "DATE_FMT = "),
    ("N3", "neutral", "shopapp/settings.py", "URLCONF"),
    ("K11", "decoy", "shopapp/management/commands/purge.py", "purging"), ("N2", "neutral", "shopapp/middleware.py", "took"),
]

if __name__ == "__main__":
    out = Path(sys.argv[1])
    for case, files in FIX.items():
        for rel, body in files.items():
            p = out / "repos" / case / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
        (out / "keys").mkdir(parents=True, exist_ok=True)
        (out / "keys" / f"{case}.json").write_text(json.dumps(
            [{"id": i, "class": c, "file": f, "match": m} for i, c, f, m in GOLD[case]], indent=1), encoding="utf-8")
        print("built", case)
