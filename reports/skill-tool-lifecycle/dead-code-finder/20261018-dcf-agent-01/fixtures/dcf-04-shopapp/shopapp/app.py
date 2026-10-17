import importlib

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
