from uploads.service import Store, upload


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
