"""Warehouse locations: shelves, docks and the quarantine area."""

import re
from dataclasses import dataclass

CODE = re.compile(r"^[A-Z]-\d{2}-\d{2}$")
KINDS = ("shelf", "dock", "quarantine")


class UnknownLocation(KeyError):
    pass


@dataclass(frozen=True)
class Location:
    code: str
    name: str
    kind: str = "shelf"


class LocationRegistry:
    def __init__(self):
        self._by_code = {}

    def add(self, code, name, kind="shelf"):
        if not CODE.match(code):
            raise ValueError(f"bad location code: {code!r}")
        if kind not in KINDS:
            raise ValueError(f"unknown location kind: {kind!r}")
        if code in self._by_code:
            raise ValueError(f"location {code} already exists")
        loc = Location(code, name, kind)
        self._by_code[code] = loc
        return loc

    def get(self, code):
        try:
            return self._by_code[code]
        except KeyError:
            raise UnknownLocation(code) from None

    def __contains__(self, code):
        return code in self._by_code

    def codes(self):
        return sorted(self._by_code)

    def by_kind(self, kind):
        return [loc for code, loc in sorted(self._by_code.items()) if loc.kind == kind]
