"""CSV export for the accountant.

The export lists issued and void invoices, one row each, with amounts in
cents.
"""

import csv
import io

from billing.credit import void
from billing.export import COLUMNS, rows, to_csv
from tests.helpers import BACKUP, HOSTING, ISSUE_DAY, issued_invoice, make_invoice
from tests.snap import match_snapshot


def _read(text):
    return list(csv.DictReader(io.StringIO(text)))


def test_csv_header(book):
    text = to_csv(book.invoices)

    assert text.splitlines()[0] == ",".join(COLUMNS)
    assert len(text.splitlines()) == 1


def test_csv_skips_drafts(book, customer):
    issued = issued_invoice(book, customer, HOSTING)
    draft = make_invoice(customer, HOSTING)

    exported = rows([issued, draft])

    assert len(exported) == 1
    assert exported[0]["status"] == "issued"


def test_csv_row_amounts(book, customer):
    issued_invoice(
        book,
        customer,
        HOSTING,
        ("Offsite backup add-on", 2, 500),
    )

    row = _read(to_csv(book.invoices))[0]

    assert (row["net"], row["tax"], row["gross"]) == ("5000", "1000", "6000")
    assert row["customer"] == "Northwind Traders"
    assert row["currency"] == "EUR"


def test_csv_lists_void_invoices(book, sequence, customer, second_customer):
    inv = issued_invoice(book, customer, HOSTING)
    issued_invoice(book, second_customer, HOSTING, BACKUP)
    void(inv, sequence, ISSUE_DAY)

    exported = _read(to_csv(book.invoices))

    assert [row["status"] for row in exported] == ["void", "issued"]
    assert exported[0]["issued_on"] == "2026-03-02"


def test_export_layout_snapshot(book, customer):
    for quantity in (1, 2, 3):
        issued_invoice(book, customer, ("Managed hosting, monthly", quantity, 4000))

    match_snapshot("export_layout", to_csv(book.invoices))
