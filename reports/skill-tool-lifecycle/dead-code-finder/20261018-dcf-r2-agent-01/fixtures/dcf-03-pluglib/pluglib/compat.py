import sys

PY2 = sys.version_info[0] == 2


def text_type():
    return str if not PY2 else unicode  # noqa: F821
