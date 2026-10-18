"""Builds the four git-risk-scanner case repos (fast-import, scripted history) plus hidden tests.
usage: python make_grs.py <outdir>   -> <outdir>/repos/<case>/ (git repo) and <outdir>/keys/<case>/hidden_test.py
History diffs of filler commits only change a REV constant; fix commits add the real guards."""
import subprocess, sys
from pathlib import Path

START = 1696248000  # 2023-10-02
DAY = 86400
AUTH = {"alice": "Alice Nguyen <alice@example.com>", "bob": "Bob Tran <bob@example.com>",
        "carol": "Carol Le <carol@example.com>", "dave": "Dave Pham <dave@example.com>"}

# ------------------------------------------------------------------ module renderers (flags -> source)

def billing(f, rev):
    s = f'"""Invoice math."""\nfrom decimal import Decimal, ROUND_HALF_UP\n\nREV = {rev}\n\n\n'
    s += "def apply_discount(total_cents, pct):\n"
    if f.get("negguard"):
        s += "    if pct <= 0:\n        return total_cents\n"
    if f.get("clamp"):
        s += "    if pct > 100:\n        pct = 100\n"
    if f.get("decimal"):
        s += "    amount = Decimal(total_cents) * Decimal(100 - pct) / Decimal(100)\n"
        s += "    amount = amount.quantize(Decimal(1), rounding=ROUND_HALF_UP)\n"
        s += "    return int(amount)\n"
    elif f.get("fastround"):
        s += "    return round(total_cents * (100 - pct) / 100)\n"
    else:
        s += "    return int(total_cents * (100 - pct) / 100)\n"
    s += "\n\ndef invoice_total(lines, discount_pct=0):\n    total = 0\n    for line in lines:\n"
    if f.get("noneskip"):
        s += "        if line is None:\n            continue\n"
        s += '        qty = line.get("qty") or 0\n        price = line.get("price_cents") or 0\n'
    else:
        s += '        qty = line["qty"]\n        price = line["price_cents"]\n'
    s += "        total += qty * price\n"
    s += "    total = int(total)\n"          # genuinely redundant (qty/price are ints)
    s += "    return apply_discount(total, discount_pct)\n"
    return s

def sync(f, rev):
    stamp = "".join(f"TUNING_{i} = {rev * (i + 3) % 97}\n" for i in range(6))
    s = f'"""Nightly sync of records into the store."""\nimport time\n\nREV = {rev}\n{stamp}\n\nclass Locked(Exception):\n    pass\n\n\n'
    s += "def sync_batch(records, store):\n    written = 0\n    for rec in records:\n"
    if f.get("nullowner"):
        s += '        if rec.get("owner") is None:\n            continue\n'
    s += '        store.write(rec["id"], rec)\n        written += 1\n'
    if f.get("sleep"):
        s += "    time.sleep(0.2)\n"
    if f.get("retry"):
        s += "    try:\n        store.commit()\n    except Locked:\n        time.sleep(0.5)\n        store.commit()\n"
    else:
        s += "    store.commit()\n"
    s += "    count = int(written)\n"       # genuinely redundant
    s += "    return count\n"
    return s

def fmt(f, rev):
    s = f'"""Formatting helpers."""\n\nREV = {rev}\n\n\n'
    s += "def format_money(cents, currency=\"USD\"):\n"
    s += "    if currency is None:\n        currency = \"USD\"\n"
    s += "    sign = \"-\" if cents < 0 else \"\"\n    cents = abs(int(cents))\n"
    s += "    return f\"{sign}{cents // 100}.{cents % 100:02d} {currency}\"\n"
    s += "\n\ndef slugify(text):\n    text = str(text)\n    text = text.strip().lower()\n"
    s += "    out = \"\"\n    for ch in text:\n        if ch.isalnum():\n            out += ch\n        elif out and not out.endswith(\"-\"):\n            out += \"-\"\n"
    s += "    return out.strip(\"-\")\n"
    return s

def legacy(f, rev):
    s = f'"""Parser for the legacy export format."""\n\nREV = {rev}\n\n\n'
    s += "def parse_lines(text):\n    rows = []\n"
    if f.get("empty"):
        s += "    if not text or not text.strip():\n        return rows\n"
    s += "    for raw in text.splitlines():\n        line = raw.strip()\n"
    s += "        if not line or line.startswith(\"#\"):\n            continue\n"
    s += "        key, _, value = line.partition(\"=\")\n        rows.append((key.strip(), value.strip()))\n"
    s += "    return rows\n"
    return s

# ------------------------------------------------------------------ histories: (day, author, msg, flag-changes)
def hist_billing():
    A, B, C, D = "alice", "bob", "carol", "dave"
    return [
        (0, A, "add billing module", {}),
        (15, B, "add proration support to billing", {}),
        (30, C, "fix crash on empty line items", {"noneskip": 1}),
        (44, A, "fix rounding of invoice totals", {"decimal": 1}),
        (58, D, "speed up invoice rounding", {"decimal": 0, "fastround": 1}),
        (63, D, 'Revert "speed up invoice rounding"', {"decimal": 1, "fastround": 0}),
        (80, B, "hotfix: refund amount negative for partial refunds", {"negguard": 1}),
        (95, C, "fix currency conversion regression after rate refactor", {}),
        (112, A, "hotfix: negative invoice when coupon is over 100 percent", {"clamp": 1}),
        (130, D, "fix rounding again for JPY", {}),
        (146, B, "patch tax calculation for EU customers", {}),
        (160, C, "bugfix: discount applied twice", {}),
        (175, A, "hotfix: prod incident, invoices stuck in pending", {}),
        (190, D, "fix off-by-one in billing period end", {}),
        (206, B, "fix crash on missing price", {}),
        (220, A, "add proration support to billing", {}),
        (236, C, 'Revert "cache exchange rates"', {}),
        (250, D, "fix rounding of tax lines", {}),
        (265, B, "bugfix: duplicate invoice numbers", {}),
        (280, A, "hotfix: double charge when gateway retries", {}),
        (296, C, "fix regression in credit note totals", {}),
        (310, D, "patch invoice export", {}),
        (324, B, "fix crash on zero quantity", {}),
        (340, A, "bugfix: stale totals after edit", {}),
        (356, C, "fix rounding again for CHF", {}),
        (372, D, "hotfix: invoice emailed twice", {}),
    ]

def hist_sync():
    C, D = "carol", "dave"
    return [
        (0, C, "add nightly sync job", {}),
        (40, D, "temporarily disable retry until the gateway is stable", {}),
        (62, C, "work around flaky lock in nightly sync", {"retry": 1}),
        (88, D, "sync broke again after deploy, add sleep before commit", {"sleep": 1}),
        (110, C, "incident 2026-04: duplicate rows, guard insert", {}),
        (131, D, "disable dedupe for now, revisit later", {}),
        (155, C, "nightly sync failing again, bump timeout as a stopgap", {}),
        (178, D, "hack: skip records with null owner until upstream cleans data", {"nullowner": 1}),
        (203, C, "stopgap: lock contention during the nightly window", {}),
        (228, D, "sync stuck again after the db failover, restart loop as a workaround", {}),
        (251, C, "incident 2026-08: partial writes, temporary guard", {}),
        (270, D, "bump sleep for now, flaky again", {}),
        (284, "alice", "workaround: pause the job while the warehouse export runs", {}),
        (296, C, "sync stuck again, kill and restart as a stopgap", {}),
        (309, D, "temporarily widen the lock window", {}),
        (321, "alice", "nightly sync failing again after the schema change, skip validation for now", {}),
        (333, C, "incident 2026-10: stale rows served, manual cleanup", {}),
        (345, D, "hack: sleep longer on slow replicas", {}),
        (357, "alice", "flaky again, bump retries as a workaround", {}),
        (369, C, "revisit later: dedupe still disabled", {}),
    ]

def hist_fmt():
    return [
        (0, "dave", "add formatting helpers", {}),
        (20, "bob", "fix typo in docstring", {}), (35, "dave", "fix lint warnings", {}),
        (51, "bob", "fix formatting", {}), (70, "dave", "fix import order", {}),
        (90, "bob", "fix typo in comment", {}), (108, "dave", "fix flake8 line length", {}),
        (125, "bob", "fix typo in docstring", {}), (140, "dave", "fix lint warnings", {}),
        (160, "bob", "fix formatting", {}), (181, "dave", "fix import order", {}),
        (203, "bob", "fix typo in comment", {}), (222, "dave", "fix flake8 line length", {}),
        (240, "bob", "add slugify helper", {}), (262, "dave", "fix lint warnings", {}),
    ]

def hist_legacy():
    return [
        (0, "alice", "initial import of legacy parser", {}),
        (30, "alice", "fix parser crash on empty input", {"empty": 1}),
    ]

# ------------------------------------------------------------------ visible and hidden tests
VIS = {
"billing": ('''from shop.billing import apply_discount, invoice_total


def test_total_plain():
    assert invoice_total([{"qty": 2, "price_cents": 500}, {"qty": 1, "price_cents": 250}]) == 1250


def test_discount_ten_percent():
    assert apply_discount(1000, 10) == 900


def test_invoice_with_discount():
    assert invoice_total([{"qty": 3, "price_cents": 1000}], discount_pct=20) == 2400
''', '''from shop.billing import apply_discount, invoice_total


def test_negative_pct_never_raises_total():
    assert apply_discount(1000, -10) == 1000


def test_over_100_percent_is_free_not_negative():
    assert apply_discount(1000, 150) == 0


def test_half_cent_rounds_up():
    assert apply_discount(5, 50) == 3
    assert apply_discount(25, 50) == 13


def test_none_line_skipped():
    assert invoice_total([None, {"qty": 1, "price_cents": 300}]) == 300


def test_missing_qty_counts_zero():
    assert invoice_total([{"price_cents": 300}, {"qty": 2, "price_cents": 100}]) == 200
'''),
"sync": ('''from shop.sync import sync_batch


class Store:
    def __init__(self):
        self.rows = {}
        self.committed = 0

    def write(self, key, rec):
        self.rows[key] = rec

    def commit(self):
        self.committed += 1


def test_writes_all_and_returns_count():
    s = Store()
    n = sync_batch([{"id": 1, "owner": "a"}, {"id": 2, "owner": "b"}], s)
    assert n == 2 and set(s.rows) == {1, 2} and s.committed == 1
''', '''import time
from shop.sync import sync_batch, Locked


class SlowLockStore:
    """Commit fails when it comes too soon after a write, and once on the first attempt."""
    def __init__(self, fail_first=False):
        self.rows, self.last, self.fail_first, self.commits = {}, 0.0, fail_first, 0

    def write(self, key, rec):
        self.rows[key] = rec
        self.last = time.monotonic()

    def commit(self):
        self.commits += 1
        if time.monotonic() - self.last < 0.15:
            raise Locked("too soon after write")
        if self.fail_first and self.commits == 1:
            raise Locked("busy")


def test_waits_before_commit():
    s = SlowLockStore()
    assert sync_batch([{"id": 1, "owner": "a"}], s) == 1
    assert s.commits == 1


def test_retries_once_when_locked():
    s = SlowLockStore(fail_first=True)
    assert sync_batch([{"id": 1, "owner": "a"}], s) == 1
    assert s.commits == 2


def test_null_owner_is_skipped():
    s = SlowLockStore()
    assert sync_batch([{"id": 1, "owner": None}, {"id": 2, "owner": "b"}], s) == 1
    assert set(s.rows) == {2}
'''),
"fmt": ('''from shop.format_utils import format_money, slugify


def test_money():
    assert format_money(1234) == "12.34 USD"
    assert format_money(-5, "EUR") == "-0.05 EUR"


def test_slug():
    assert slugify("Hello World") == "hello-world"
''', '''from shop.format_utils import format_money, slugify


def test_money_zero_and_negative():
    assert format_money(0) == "0.00 USD"
    assert format_money(-1999, "EUR") == "-19.99 EUR"


def test_slug_collapses_and_strips():
    assert slugify("  A  b--C!! ") == "a-b-c"
    assert slugify("--x--") == "x"
'''),
"legacy": ('''from shop.legacy_parser import parse_lines


def test_parse_pairs():
    assert parse_lines("a=1\\nb = 2\\n# note\\n") == [("a", "1"), ("b", "2")]
''', '''from shop.legacy_parser import parse_lines


def test_empty_and_blank_input():
    assert parse_lines("") == []
    assert parse_lines("   \\n  ") == []


def test_none_input_is_empty():
    assert parse_lines(None) == []


def test_comment_only():
    assert parse_lines("# x\\n#y") == []
'''),
}

CASES = {
    "grs-01-billing": ("billing", "shop/billing.py", billing, hist_billing),
    "grs-02-sync": ("sync", "shop/sync.py", sync, hist_sync),
    "grs-03-format": ("fmt", "shop/format_utils.py", fmt, hist_fmt),
    "grs-04-legacy": ("legacy", "shop/legacy_parser.py", legacy, hist_legacy),
}
OTHER = {
    "shop/__init__.py": "",
    "README.md": "# shop\n\nSmall order toolkit.\n",
    "shop/util.py": "def clamp(x, lo, hi):\n    return max(lo, min(hi, x))\n",
}

def build(case, dest, keys):
    key, path, render, hist = CASES[case]
    events = [(START, "alice", "initial import", dict(OTHER))]
    flags, rev = {}, 0
    for day, who, msg, ch in hist():
        flags = {**flags, **ch}
        rev += 1
        events.append((int(START + (day + 1) * DAY), who, msg, {path: render(flags, rev)}))
    last_day = hist()[-1][0]
    events.append((int(START + (last_day + 5) * DAY), "bob", "add tests", {f"tests/test_{key}.py": VIS[key][0], "tests/__init__.py": ""}))
    out = []
    for mark, (ts, who, msg, snap) in enumerate(events, 1):
        ident = f"{AUTH[who]} {ts} +0000"
        m = msg.encode()
        out.append(f"commit refs/heads/main\nmark :{mark}\nauthor {ident}\ncommitter {ident}\ndata {len(m)}\n".encode() + m + b"\n")
        if mark > 1:
            out.append(f"from :{mark-1}\n".encode())
        for p, c in snap.items():
            d = c.encode()
            out.append(f"M 100644 inline {p}\ndata {len(d)}\n".encode() + d + b"\n")
        out.append(b"\n")
    dest = Path(dest); dest.mkdir(parents=True, exist_ok=True)
    run = lambda *a, **kw: subprocess.run(["git", "-C", str(dest), *a], check=True, capture_output=True, **kw)
    run("init", "-q", "-b", "main")
    run("fast-import", "--quiet", input=b"".join(out))
    run("checkout", "-q", "-f", "main")
    run("config", "user.email", "agent@example.com"); run("config", "user.name", "agent")
    (Path(keys) / case).mkdir(parents=True, exist_ok=True)
    (Path(keys) / case / "hidden_test.py").write_text(VIS[key][1], encoding="utf-8")

if __name__ == "__main__":
    out = Path(sys.argv[1])
    for c in CASES:
        build(c, out / "repos" / c, out / "keys")
        print("built", c)
