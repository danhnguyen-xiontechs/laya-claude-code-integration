"""Warehouse locations.

Location codes look like A-01-02: aisle letter, bay and shelf. Every
location also has a kind: shelf, dock or quarantine.
"""

import pytest

from stock.locations import LocationRegistry, UnknownLocation


class TestLocationRegistry:
    def test_add_and_get(self):
        registry = LocationRegistry()

        added = registry.add("C-03-04", "Aisle C, bay 03, shelf 04")

        assert registry.get("C-03-04") is added
        assert added.kind == "shelf"
        assert "C-03-04" in registry

    def test_bad_code_rejected(self):
        registry = LocationRegistry()

        for code in ("C3-04", "c-03-04", "CC-03-04", "C-3-4", ""):
            with pytest.raises(ValueError):
                registry.add(code, "Bad shelf")

        assert registry.codes() == []

    def test_duplicate_code_rejected(self, locations):
        with pytest.raises(ValueError):
            locations.add("A-01-01", "Another shelf")

        assert locations.get("A-01-01").name == "Aisle A, bay 01, shelf 01"

    def test_unknown_kind_rejected(self):
        registry = LocationRegistry()

        with pytest.raises(ValueError):
            registry.add("C-03-04", "Roof", kind="roof")

    def test_locations_by_kind(self, locations):
        docks = locations.by_kind("dock")
        shelves = locations.by_kind("shelf")

        assert [loc.code for loc in docks] == ["D-00-01"]
        assert [loc.code for loc in shelves] == ["A-01-01", "A-01-02", "B-02-01"]

    def test_unknown_location_raises(self, locations):
        with pytest.raises(UnknownLocation):
            locations.get("Z-99-99")

        assert locations.codes() == ["A-01-01", "A-01-02", "B-02-01", "D-00-01", "Q-00-01"]
