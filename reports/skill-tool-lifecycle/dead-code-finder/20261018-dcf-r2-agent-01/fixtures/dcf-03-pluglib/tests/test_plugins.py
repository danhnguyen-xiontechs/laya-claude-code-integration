import pluglib
import pluglib.builtin  # noqa: F401
from pluglib.registry import unregister


def test_upper():
    assert pluglib.get_plugin("upper").run(" a  b ") == "A B"


def test_available():
    assert pluglib.available() == ["reverse", "upper"]


def test_unregister_roundtrip():
    unregister("nope")
