from uploads.service import MAX_BYTES, Store, upload


def test_too_large_file_rejected():
    s = Store()
    status, _ = upload(s, "ann", "big.png", "image/png", b"x" * (MAX_BYTES + 1))
    assert status == 413


def test_file_at_exactly_the_limit_is_accepted():
    s = Store()
    status, _ = upload(s, "ann", "edge.png", "image/png", b"x" * MAX_BYTES)
    assert status == 201
