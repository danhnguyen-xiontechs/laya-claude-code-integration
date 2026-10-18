"""Credit-note numbers: CN-YYYY-NNNN, restarting at 0001 every year."""

import re

PATTERN = re.compile(r"^CN-(\d{4})-(\d{4})$")


class CreditNoteSequence:
    def __init__(self):
        self._last = {}

    def peek(self, year):
        return f"CN-{year}-{self._last.get(year, 0) + 1:04d}"

    def next(self, on):
        n = self._last.get(on.year, 0) + 1
        if n > 9999:
            raise OverflowError("credit-note sequence exhausted for the year")
        self._last[on.year] = n
        return f"CN-{on.year}-{n:04d}"


def parse(number):
    """(year, serial) of a credit-note number."""
    m = PATTERN.match(number)
    if not m:
        raise ValueError(f"not a credit-note number: {number!r}")
    return int(m.group(1)), int(m.group(2))
