"""Compare values with stored snapshots under $SNAPSHOT_DIR.

A snapshot is a JSON file named after the snapshot. When SNAPSHOT_DIR is not
set, the comparison cannot run and the test is skipped.
"""

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
