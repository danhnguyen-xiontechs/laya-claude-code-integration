from uploads.service import Store, sanitize, upload


def test_directory_part_removed_from_stored_name():
    s = Store()
    _, body = upload(s, "ann", "../../etc/passwd.png", "image/png", b"4")
    assert body["name"] == "passwd.png"
    assert s.files[body["id"]]["name"] == "passwd.png"


def test_plain_name_unchanged():
    assert sanitize("photo.png") == "photo.png"
