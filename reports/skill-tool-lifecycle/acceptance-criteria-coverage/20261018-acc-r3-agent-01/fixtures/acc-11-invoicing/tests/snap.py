"""Compare values with stored snapshots under $SNAPSHOT_DIR."""

import json
import os
from pathlib import Path

import pytest


def match_snapshot(name, value):
    root = os.environ.get("SNAPSHOT_DIR")
    if not root:
        pytest.skip("snapshot store not configured")
    path = Path(root) / f"{name}.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored == value
