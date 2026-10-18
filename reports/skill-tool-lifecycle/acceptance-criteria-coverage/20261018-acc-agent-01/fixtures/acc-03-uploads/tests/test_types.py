from uploads.service import Store, upload


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
