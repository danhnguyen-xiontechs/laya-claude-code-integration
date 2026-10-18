"""Provider leave and the reception listing.

The reception screen lists every provider with a status for the day:
available, on leave or not working.
"""

from tests.helpers import SAT, TUE, WED


def test_listing_shows_leave(directory):
    directory.add_leave("p1", TUE)

    listing = directory.listing(TUE)

    assert {"provider": "Dr Ana Weber", "status": "on leave"} in listing
    assert {"provider": "Dr Ben Okafor", "status": "available"} in listing
    assert len(listing) == 2


def test_listing_on_normal_day(directory):
    listing = directory.listing(WED)

    assert listing == [
        {"provider": "Dr Ana Weber", "status": "available"},
        {"provider": "Dr Ben Okafor", "status": "available"},
    ]


def test_leave_day_stored(directory):
    directory.add_leave("p2", WED)

    assert directory.get("p2").on_leave(WED)
    assert not directory.get("p2").on_leave(TUE)

    directory.remove_leave("p2", WED)

    assert not directory.get("p2").on_leave(WED)


def test_listing_on_weekend(directory):
    statuses = [row["status"] for row in directory.listing(SAT)]

    assert statuses == ["not working", "not working"]

    directory.add_leave("p1", SAT)

    assert directory.listing(SAT)[0]["status"] == "not working"
