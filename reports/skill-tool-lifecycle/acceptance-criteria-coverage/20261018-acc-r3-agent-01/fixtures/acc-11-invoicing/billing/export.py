"""CSV export of issued and void invoices for the accountant."""

import csv
import io

COLUMNS = ["number", "customer", "issued_on", "status", "net", "tax", "gross", "currency"]


def rows(invoices):
    out = []
    for inv in invoices:
        if inv.status == "draft":
            continue
        out.append({
            "number": inv.number,
            "customer": inv.customer.name,
            "issued_on": inv.issued_on.isoformat(),
            "status": inv.status,
            "net": inv.net,
            "tax": inv.tax,
            "gross": inv.gross,
            "currency": inv.customer.currency,
        })
    return out


def to_csv(invoices):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in rows(invoices):
        writer.writerow(row)
    return buf.getvalue()
