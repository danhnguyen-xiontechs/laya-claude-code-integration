"""Writes the three own acceptance-criteria-coverage fixtures (service + tests + criteria.json) and gold.
usage: python make_acc.py <outdir>  -> <outdir>/repos/<case>/..., <outdir>/keys/<case>.json
gold: {AC: [accepted coverage values]}"""
import json, sys
from pathlib import Path

FIX, GOLD = {}, {}

# ============================================================ acc-02 cart
FIX["acc-02-cart"] = {
"criteria.json": json.dumps({"source": "Story SHOP-7 'Cart and coupons'", "criteria": [
    {"id": "AC-01", "text": "Adding an item sets its quantity and raises the subtotal; adding the same SKU twice merges into one line."},
    {"id": "AC-02", "text": "Coupon SAVE10 takes 10% off the subtotal; the shipping fee is not discounted."},
    {"id": "AC-03", "text": "A second coupon is rejected with CouponError and the first coupon stays applied."},
    {"id": "AC-04", "text": "Removing the last item empties the cart and clears any applied coupon."},
    {"id": "AC-05", "text": "A coupon worth more than the subtotal makes the item total zero, never negative; shipping is still charged."},
    {"id": "AC-06", "text": "Adding an out-of-stock item raises OutOfStock and leaves the cart unchanged."},
]}, indent=2),
"cart/__init__.py": "",
"cart/service.py": '''class OutOfStock(Exception):
    pass


class CouponError(Exception):
    pass


STOCK = {"A1": 5, "B2": 0, "C3": 10}
PRICES = {"A1": 1000, "B2": 500, "C3": 250}
SHIPPING = 700
COUPONS = {"SAVE10": 10, "HALF": 50, "BIG": 150}


class Cart:
    def __init__(self):
        self.lines = {}
        self.coupon = None

    def add(self, sku, qty=1):
        if STOCK.get(sku, 0) < self.lines.get(sku, 0) + qty:
            raise OutOfStock(sku)
        self.lines[sku] = self.lines.get(sku, 0) + qty

    def remove(self, sku):
        self.lines.pop(sku, None)
        if not self.lines:
            self.coupon = None

    def apply_coupon(self, code):
        if self.coupon is not None:
            raise CouponError("already applied")
        if code not in COUPONS:
            raise CouponError("unknown coupon")
        self.coupon = code

    def subtotal(self):
        return sum(PRICES[s] * q for s, q in self.lines.items())

    def discount(self):
        return self.subtotal() * COUPONS.get(self.coupon, 0) // 100

    def total(self):
        if not self.lines:
            return 0
        return max(0, self.subtotal() - self.discount()) + SHIPPING
''',
"tests/__init__.py": "",
"tests/test_items.py": '''from cart.service import Cart


def test_add_single_item_sets_quantity_and_subtotal():
    c = Cart()
    c.add("A1")
    assert c.lines == {"A1": 1}
    assert c.subtotal() == 1000


def test_add_same_sku_twice_merges_lines():
    c = Cart()
    c.add("A1")
    c.add("A1")
    assert c.lines == {"A1": 2}
    assert len(c.lines) == 1
    assert c.subtotal() == 2000


def test_two_different_skus_make_two_lines():
    c = Cart()
    c.add("A1")
    c.add("C3", 2)
    assert set(c.lines) == {"A1", "C3"}
''',
"tests/test_coupons.py": '''import pytest

from cart.service import Cart, CouponError


def test_save10_takes_ten_percent_off_subtotal():
    c = Cart()
    c.add("A1", 2)
    c.apply_coupon("SAVE10")
    assert c.discount() == 200


def test_second_coupon_rejected_and_first_kept():
    c = Cart()
    c.add("A1")
    c.apply_coupon("SAVE10")
    with pytest.raises(CouponError):
        c.apply_coupon("HALF")
    assert c.coupon == "SAVE10"


def test_unknown_coupon_rejected():
    c = Cart()
    c.add("A1")
    with pytest.raises(CouponError):
        c.apply_coupon("NOPE")
    assert c.coupon is None


def test_half_coupon_halves_subtotal():
    c = Cart()
    c.add("A1", 2)
    c.apply_coupon("HALF")
    assert c.discount() == 1000
''',
"tests/test_removal.py": '''from cart.service import Cart


def test_remove_item_deletes_the_line():
    c = Cart()
    c.add("A1")
    c.add("C3")
    c.remove("A1")
    assert "A1" not in c.lines
    assert "C3" in c.lines


def test_remove_last_item_empties_cart():
    c = Cart()
    c.add("A1")
    c.remove("A1")
    assert c.lines == {}
    assert c.total() == 0


def test_remove_unknown_sku_is_a_noop():
    c = Cart()
    c.add("A1")
    c.remove("ZZ")
    assert c.lines == {"A1": 1}
''',
"tests/test_totals.py": '''from cart.service import Cart


def test_total_never_negative():
    c = Cart()
    c.add("A1")
    c.apply_coupon("SAVE10")
    assert c.total() >= 0


def test_empty_cart_total_is_zero():
    assert Cart().total() == 0


def test_shipping_is_added_once():
    c = Cart()
    c.add("C3", 2)
    assert c.total() == 500 + 700
''',
"tests/test_stock.py": '''import pytest

from cart.service import Cart, OutOfStock


def test_out_of_stock_item_rejected():
    c = Cart()
    with pytest.raises(OutOfStock):
        c.add("B2")


def test_cannot_add_more_than_available():
    c = Cart()
    c.add("A1", 5)
    with pytest.raises(OutOfStock):
        c.add("A1")
''',
}
GOLD["acc-02-cart"] = {"AC-01": ["Covered"], "AC-02": ["Partial"], "AC-03": ["Covered"], "AC-04": ["Partial"],
                       "AC-05": ["Missing", "Unclear"], "AC-06": ["Partial"]}

# ============================================================ acc-03 uploads
FIX["acc-03-uploads"] = {
"criteria.json": json.dumps({"source": "Story FILES-12 'Image upload'", "criteria": [
    {"id": "AC-01", "text": "A file larger than 5 MB is rejected with HTTP 413 and nothing is stored."},
    {"id": "AC-02", "text": "Only PNG and JPEG images are accepted; any other type is rejected with HTTP 415."},
    {"id": "AC-03", "text": "The stored file name has any directory part removed, so a name like ../../etc/passwd.png is stored as passwd.png."},
    {"id": "AC-04", "text": "Uploading identical content again returns HTTP 200 with the existing id and stores no second copy."},
    {"id": "AC-05", "text": "Every upload is passed to the virus scanner before it is stored; an infected file gets HTTP 422 and is not stored."},
    {"id": "AC-06", "text": "Only the owner can delete a file; anyone else gets HTTP 403 and the file remains."},
]}, indent=2),
"uploads/__init__.py": "",
"uploads/service.py": '''import hashlib
import os

MAX_BYTES = 5 * 1024 * 1024
ALLOWED = {"image/png", "image/jpeg"}


class Store:
    def __init__(self):
        self.files = {}
        self.owners = {}


def sanitize(name):
    return os.path.basename(name.replace("\\\\", "/")).lstrip(".") or "file"


def upload(store, owner, name, mime, data, scanner=None):
    if len(data) > MAX_BYTES:
        return 413, {"error": "too large"}
    if mime not in ALLOWED:
        return 415, {"error": "unsupported type"}
    if scanner is not None and not scanner(data):
        return 422, {"error": "infected"}
    digest = hashlib.sha256(data).hexdigest()
    if digest in store.files:
        return 200, {"id": digest, "duplicate": True}
    store.files[digest] = {"name": sanitize(name), "data": data}
    store.owners[digest] = owner
    return 201, {"id": digest, "name": store.files[digest]["name"]}


def delete(store, user, file_id):
    if store.owners.get(file_id) != user:
        return 403, {"error": "not the owner"}
    del store.files[file_id]
    del store.owners[file_id]
    return 204, {}
''',
"tests/__init__.py": "",
"tests/test_limits.py": '''from uploads.service import MAX_BYTES, Store, upload


def test_too_large_file_rejected():
    s = Store()
    status, _ = upload(s, "ann", "big.png", "image/png", b"x" * (MAX_BYTES + 1))
    assert status == 413


def test_file_at_exactly_the_limit_is_accepted():
    s = Store()
    status, _ = upload(s, "ann", "edge.png", "image/png", b"x" * MAX_BYTES)
    assert status == 201
''',
"tests/test_types.py": '''from uploads.service import Store, upload


def test_png_accepted():
    s = Store()
    assert upload(s, "ann", "a.png", "image/png", b"1")[0] == 201


def test_jpeg_accepted():
    s = Store()
    assert upload(s, "ann", "a.jpg", "image/jpeg", b"2")[0] == 201


def test_gif_rejected_with_415_and_not_stored():
    s = Store()
    status, _ = upload(s, "ann", "a.gif", "image/gif", b"3")
    assert status == 415
    assert s.files == {}
''',
"tests/test_names.py": '''from uploads.service import Store, sanitize, upload


def test_directory_part_removed_from_stored_name():
    s = Store()
    _, body = upload(s, "ann", "../../etc/passwd.png", "image/png", b"4")
    assert body["name"] == "passwd.png"
    assert s.files[body["id"]]["name"] == "passwd.png"


def test_plain_name_unchanged():
    assert sanitize("photo.png") == "photo.png"
''',
"tests/test_dedupe.py": '''from uploads.service import Store, upload


def test_duplicate_upload_returns_existing_id():
    s = Store()
    _, first = upload(s, "ann", "a.png", "image/png", b"same")
    status, second = upload(s, "bob", "b.png", "image/png", b"same")
    assert status == 200
    assert second["id"] == first["id"]


def test_different_content_gets_new_id():
    s = Store()
    _, a = upload(s, "ann", "a.png", "image/png", b"one")
    _, b = upload(s, "ann", "a.png", "image/png", b"two")
    assert a["id"] != b["id"]
''',
"tests/test_delete.py": '''from uploads.service import Store, delete, upload


def test_owner_can_delete():
    s = Store()
    _, body = upload(s, "ann", "a.png", "image/png", b"5")
    assert delete(s, "ann", body["id"])[0] == 204
    assert body["id"] not in s.files


def test_other_user_gets_403_and_file_remains():
    s = Store()
    _, body = upload(s, "ann", "a.png", "image/png", b"6")
    assert delete(s, "bob", body["id"])[0] == 403
    assert body["id"] in s.files
''',
}
GOLD["acc-03-uploads"] = {"AC-01": ["Partial"], "AC-02": ["Covered", "Partial"], "AC-03": ["Covered"], "AC-04": ["Partial"],
                          "AC-05": ["Missing"], "AC-06": ["Covered"]}

# ============================================================ acc-04 booking
FIX["acc-04-booking"] = {
"criteria.json": json.dumps({"source": "Story ROOMS-3 'Meeting room booking'", "criteria": [
    {"id": "AC-01", "text": "Two bookings of the same room that overlap are rejected with Conflict and the first booking is kept."},
    {"id": "AC-02", "text": "Back-to-back bookings (one ends exactly when the next starts) are allowed."},
    {"id": "AC-03", "text": "A booking that starts in the past is rejected."},
    {"id": "AC-04", "text": "A booking longer than 4 hours is rejected; exactly 4 hours is allowed."},
    {"id": "AC-05", "text": "Cancelling a booking frees the slot so the same slot can be booked again."},
    {"id": "AC-06", "text": "A booking cannot be cancelled less than 1 hour before it starts; it stays booked."},
]}, indent=2),
"rooms/__init__.py": "",
"rooms/calendar.py": '''from datetime import timedelta


class Conflict(Exception):
    pass


class Rejected(Exception):
    pass


class Calendar:
    def __init__(self, now):
        self.now = now
        self.items = {}
        self._n = 0

    def book(self, room, start, end):
        if start < self.now:
            raise Rejected("in the past")
        if end - start > timedelta(hours=4):
            raise Rejected("too long")
        for r, s, e in self.items.values():
            if r == room and start < e and s < end:
                raise Conflict(room)
        self._n += 1
        self.items[self._n] = (room, start, end)
        return self._n

    def cancel(self, booking_id):
        room, start, end = self.items[booking_id]
        if start - self.now < timedelta(hours=1):
            raise Rejected("too late to cancel")
        del self.items[booking_id]
''',
"tests/__init__.py": "",
"tests/conftest.py": '''from datetime import datetime, timedelta

import pytest

from rooms.calendar import Calendar

NOW = datetime(2026, 3, 2, 9, 0)


@pytest.fixture
def cal():
    return Calendar(NOW)


def at(hours):
    return NOW + timedelta(hours=hours)
''',
"tests/test_overlap.py": '''import pytest

from rooms.calendar import Conflict
from tests.conftest import at


def test_overlapping_booking_conflicts_and_first_is_kept(cal):
    first = cal.book("R1", at(2), at(4))
    with pytest.raises(Conflict):
        cal.book("R1", at(3), at(5))
    assert list(cal.items) == [first]


def test_same_time_other_room_is_fine(cal):
    cal.book("R1", at(2), at(4))
    cal.book("R2", at(2), at(4))
    assert len(cal.items) == 2


def test_back_to_back_bookings_allowed(cal):
    cal.book("R1", at(2), at(3))
    cal.book("R1", at(3), at(4))
    assert len(cal.items) == 2
''',
"tests/test_time_rules.py": '''import pytest

from rooms.calendar import Rejected
from tests.conftest import NOW, at


def test_booking_in_the_past_is_rejected(cal):
    with pytest.raises(Rejected):
        cal.book("R1", NOW.replace(hour=7), NOW.replace(hour=8))


def test_five_hour_booking_is_rejected(cal):
    with pytest.raises(Rejected):
        cal.book("R1", at(2), at(7))


def test_two_hour_booking_is_fine(cal):
    assert cal.book("R1", at(2), at(4))
''',
"tests/test_cancel.py": '''from tests.conftest import at


def test_cancel_removes_the_booking(cal):
    b = cal.book("R1", at(5), at(6))
    cal.cancel(b)
    assert b not in cal.items


def test_cancel_requires_notice(cal):
    b = cal.book("R1", at(3), at(4))
    cal.cancel(b)
    assert b not in cal.items
''',
}
GOLD["acc-04-booking"] = {"AC-01": ["Covered"], "AC-02": ["Covered"], "AC-03": ["Covered"], "AC-04": ["Partial"],
                          "AC-05": ["Partial", "Covered"], "AC-06": ["Missing", "Unclear"]}

if __name__ == "__main__":
    out = Path(sys.argv[1])
    for case, files in FIX.items():
        for rel, body in files.items():
            p = out / "repos" / case / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
        (out / "keys").mkdir(parents=True, exist_ok=True)
        (out / "keys" / f"{case}.json").write_text(json.dumps(GOLD[case], indent=1), encoding="utf-8")
        print("built", case)
