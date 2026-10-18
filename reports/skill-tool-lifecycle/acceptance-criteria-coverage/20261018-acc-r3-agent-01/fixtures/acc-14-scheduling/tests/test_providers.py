"""The provider directory.

Providers have an id, a name, daily working hours and working weekdays.
"""

import pytest

from clinic.providers import Provider
from tests.helpers import FRI, SAT, TUE


def test_provider_added_and_found(directory):
    provider = directory.get("p1")
    other = directory.get("p2")

    assert provider.name == "Dr Ana Weber"
    assert (provider.start_hour, provider.end_hour) == (9, 12)
    assert other.name == "Dr Ben Okafor"
    assert other.weekdays == (0, 1, 2, 3)


def test_unknown_provider_raises(directory):
    with pytest.raises(KeyError):
        directory.get("p9")

    with pytest.raises(KeyError):
        directory.add_leave("p9", TUE)


def test_working_weekdays(directory):
    p1, p2 = directory.get("p1"), directory.get("p2")

    assert p1.works_on(TUE) and p1.works_on(FRI)
    assert not p1.works_on(SAT)
    assert p2.works_on(TUE) and not p2.works_on(FRI)


def test_find_by_name(directory):
    found = directory.find_by_name("okafor")

    assert [p.id for p in found] == ["p2"]
    assert directory.find_by_name("dr") == directory.all()


def test_all_sorted_by_id(directory):
    directory.add(Provider("p0", "Nurse Ida Holm", start_hour=8, end_hour=10))

    assert [p.id for p in directory.all()] == ["p0", "p1", "p2"]
