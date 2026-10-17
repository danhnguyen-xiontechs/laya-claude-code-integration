from shop.legacy_parser import parse_lines


def test_empty_and_blank_input():
    assert parse_lines("") == []
    assert parse_lines("   \n  ") == []


def test_none_input_is_empty():
    assert parse_lines(None) == []


def test_comment_only():
    assert parse_lines("# x\n#y") == []
