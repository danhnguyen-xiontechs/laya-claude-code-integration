from . import builtin  # noqa: F401  (registers the built-in plugins)
from .registry import Plugin, get_plugin, available
from .text import normalize

__all__ = ["Plugin", "get_plugin", "available", "normalize"]
