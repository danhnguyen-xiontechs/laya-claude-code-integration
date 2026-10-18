"""Invoice lines.

A line is a description, a quantity and a unit price in cents. These tests
look at what a single line accepts and keeps.
"""

import pytest

from billing.invoice import Line


def test_add_line_stores_values(invoice):
    line = invoice.add_line(
        description="Ergonomic desk lamp",
        quantity=2,
        unit_price=3450,
    )

    assert line.description == "Ergonomic desk lamp"
    assert line.quantity == 2
    assert line.unit_price == 3450
    assert invoice.lines == [line]


def test_line_total_is_quantity_times_price():
    chairs = Line("Office chair, mesh back", 4, 18990)
    lamps = Line("Ergonomic desk lamp", 1, 3450)
    setup = Line("Setup (waived)", 1, 0)

    assert chairs.total == 4 * 18990
    assert lamps.total == 3450
    assert setup.total == 0


def test_quantity_must_be_positive(invoice):
    with pytest.raises(ValueError):
        invoice.add_line("Ergonomic desk lamp", 0, 3450)

    with pytest.raises(ValueError):
        invoice.add_line("Ergonomic desk lamp", -1, 3450)

    assert invoice.lines == []


def test_unit_price_cannot_be_negative(invoice):
    with pytest.raises(ValueError):
        invoice.add_line("Goodwill refund", 1, -500)

    with pytest.raises(ValueError):
        Line("Goodwill refund", 3, -1)

    assert invoice.lines == []


def test_lines_keep_their_order(invoice):
    for description in ("Discovery call", "Design sprint", "Handover"):
        invoice.add_line(description, 1, 1000)

    descriptions = [line.description for line in invoice.lines]

    assert descriptions == [
        "Discovery call",
        "Design sprint",
        "Handover",
    ]


def test_remaining_lines_keep_their_values(invoice):
    first = invoice.add_line("Discovery call", 1, 1000)
    second = invoice.add_line("Design sprint", 5, 2400)

    invoice.remove_line(0)

    assert invoice.lines == [second]
    assert second.total == 12000
    assert first.total == 1000
