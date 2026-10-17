from uploads.service import Store, delete, upload


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
