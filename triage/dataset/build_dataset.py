# build_dataset.py - Buoc 2: tao dataset log loi THAT bang cach chay that cac lenh loi tren may.
#
# Moi case: tao file trong thu muc tam, chay lenh, lay stdout+stderr va exit code, ghi vao cases.jsonl
# dung dang ma Claude Code dua cho hook PostToolUseFailure: truong "error" = "Exit code N\n" + output.
# Nhan: "category" (nhom loi dung) va "marker" (chuoi co trong dong nguyen nhan goc; doan nao chua marker la doan dung).
#
# Chay:  python triage/dataset/build_dataset.py            (ghi triage/dataset/cases.jsonl)
#        python triage/dataset/build_dataset.py --only t01  (chay lai 1 case de xem output)
import argparse, json, os, shutil, subprocess, sys, tempfile, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

# Doan "nhieu" that: chuong trinh in log/warning truoc khi loi, giong app that.
PY_NOISE = textwrap.dedent("""
    import logging, warnings
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("app")
    for i in range(N_NOISE):
        log.info("loading shard %d/%d from cache (%d rows)", i + 1, N_NOISE, 1000 + i * 37)
    warnings.warn("datetime.utcnow() is deprecated, use timezone-aware objects", DeprecationWarning, stacklevel=1)
    log.warning("config key 'retry_backoff' is deprecated; use 'retry.backoff'")
""")
JS_NOISE = textwrap.dedent("""
    for (let i = 0; i < N_NOISE; i++) console.log(`[info] compiled module ${i + 1}/${N_NOISE} (${120 + i * 7} ms)`);
    console.warn("(node:1) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.");
""")


def py(body: str, noise: int = 0) -> str:
    pre = PY_NOISE.replace("N_NOISE", str(noise)) if noise else ""
    return pre + textwrap.dedent(body)


def js(body: str, noise: int = 0) -> str:
    pre = JS_NOISE.replace("N_NOISE", str(noise)) if noise else ""
    return pre + textwrap.dedent(body)


def pytest_suite(n_pass: int, failing: str, extra: str = "") -> dict:
    tests = "\n".join(f"def test_ok_{i}():\n    assert {i} + 1 == {i + 1}\n" for i in range(n_pass))
    return {"test_app.py": textwrap.dedent(extra) + "\n" + tests + "\n" + textwrap.dedent(failing)}


PYTEST = "uv run -q --no-project --with pytest python -m pytest -q -p no:cacheprovider"

# (id, category, marker, command, files)
CASES = [
    # ---- dependency_missing: thu vien ben thu ba / tool chua cai
    ("d01", "dependency_missing", "No module named 'requests_toolbelt'",
     f"{PY} main.py", {"main.py": py("import requests_toolbelt\n", noise=25)}),
    ("d02", "dependency_missing", "Cannot find module 'express'",
     "node server.js", {"server.js": js("const express = require('express');\n", noise=20)}),
    ("d03", "dependency_missing", "No module named 'numpy'",
     PYTEST, pytest_suite(12, "import numpy as np\n\ndef test_mean():\n    assert np.mean([1, 2]) == 1.5\n")),
    ("d04", "dependency_missing", "NU1101",
     "dotnet build -nologo", {"app.csproj": """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup>
  <ItemGroup><PackageReference Include="Contoso.Nonexistent.Lib.Xyz" Version="1.2.3" /></ItemGroup>
</Project>""", "Program.cs": "System.Console.WriteLine(1);\n"}),
    ("d05", "dependency_missing", "No module named 'ruamel'",
     f"{PY} load.py", {"load.py": py("""
        print("reading pipeline definition...")
        def load(p):
            import ruamel.yaml as yaml
            return yaml.safe_load(open(p))
        load("pipeline.yml")
     """, noise=40)}),
    ("d06", "dependency_missing", "Cannot find package 'zod'",
     "node index.mjs", {"index.mjs": "import { z } from 'zod';\nconsole.log(z);\n", "package.json": '{"type":"module"}'}),

    # ---- import_or_path: module/file cua chinh project sai ten hoac sai duong dan
    ("i01", "import_or_path", "No module named 'utils.helpers'",
     f"{PY} main.py", {"utils/__init__.py": "", "utils/helper.py": "def slug(s): return s\n",
                        "main.py": py("from utils.helpers import slug\n", noise=15)}),
    ("i02", "import_or_path", "Cannot find module './lib/math'",
     "node app.js", {"lib/maths.js": "module.exports = { add: (a, b) => a + b };\n",
                     "app.js": js("const { add } = require('./lib/math');\n", noise=25)}),
    ("i03", "import_or_path", "No such file or directory: 'data/config.json'",
     f"{PY} run.py", {"run.py": py("""
        import json
        def read_cfg():
            with open("data/config.json") as f:
                return json.load(f)
        read_cfg()
     """, noise=30)}),
    ("i04", "import_or_path", "cannot import name 'parse_date'",
     f"{PY} main.py", {"dates.py": "def parse_datetime(s): return s\n",
                        "main.py": py("from dates import parse_date\n", noise=10)}),
    ("i05", "import_or_path", "does not provide an export named 'formatPrice'",
     "node index.mjs", {"package.json": '{"type":"module"}', "money.mjs": "export function formatMoney(x) { return x; }\n",
                        "index.mjs": "import { formatPrice } from './money.mjs';\nconsole.log(formatPrice(1));\n"}),
    ("i06", "import_or_path", "can't open file",
     f"{PY} scripts/migrate.py", {"script/migrate.py": "print('migrate')\n"}),

    # ---- syntax_or_type: bug trong chinh code (cu phap, kieu, ten chua dinh nghia, thuoc tinh sai)
    ("s01", "syntax_or_type", "SyntaxError",
     f"{PY} calc.py", {"calc.py": "def total(xs)\n    return sum(xs)\nprint(total([1, 2]))\n"}),
    ("s02", "syntax_or_type", "unsupported operand type(s) for +: 'int' and 'str'",
     f"{PY} report.py", {"report.py": py("""
        def summarize(rows):
            total = 0
            for r in rows:
                total = total + r["amount"]
            return total
        print(summarize([{"amount": 10}, {"amount": "25"}]))
     """, noise=30)}),
    ("s03", "syntax_or_type", "ReferenceError: userId is not defined",
     "node handler.js", {"handler.js": js("""
        function handle(req) {
          const id = req.id;
          return { user: userId };
        }
        console.log(handle({ id: 1 }));
     """, noise=30)}),
    ("s04", "syntax_or_type", "CS1002",
     "dotnet build -nologo", {"app.csproj": """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup>
</Project>""", "Program.cs": "string? name = null;\nint unused = 0;\nSystem.Console.WriteLine(name.Length)\n"}),
    ("s05", "syntax_or_type", "is not assignable to type 'number'",
     "npx -y -p typescript@5 tsc --noEmit --strict app.ts",
     {"app.ts": "function area(w: number, h: number): number { return w * h; }\nconst w: number = '10';\nconsole.log(area(w, 2));\n"}),
    ("s06", "syntax_or_type", "'NoneType' object has no attribute 'strip'",
     f"{PY} clean.py", {"clean.py": py("""
        import re
        def find_title(html):
            m = re.search(r"<title>(.*)</title>", html)
            return m and m.group(1)
        print(find_title("<html><head></head></html>").strip())
     """, noise=35)}),

    # ---- test_assertion: test chay nhung ket qua sai
    ("t01", "test_assertion", "assert 100 == 90",
     PYTEST, pytest_suite(20, """
        def apply_discount(price, pct):
            return price
        def test_discount():
            assert apply_discount(100, 10) == 90
     """)),
    ("t02", "test_assertion", "Expected values to be strictly deep-equal",
     "node --test", {"cart.test.js": js("""
        const test = require('node:test');
        const assert = require('node:assert');
        for (let i = 0; i < 8; i++) test(`sums line ${i}`, () => assert.strictEqual(i + 1, i + 1));
        test('groups items by sku', () => {
          assert.deepStrictEqual({ a: 2, b: 1 }, { a: 2, b: 2 });
        });
     """)}),
    ("t03", "test_assertion", "AssertionError: 'Hello, bob' != 'Hello, Bob'",
     f"{PY} -m unittest -v", {"test_greet.py": textwrap.dedent("""
        import unittest
        def greet(n): return f"Hello, {n}"
        class T(unittest.TestCase):
        """) + "".join(f"    def test_ok_{i}(self): self.assertTrue(True)\n" for i in range(10)) +
        "    def test_greet(self): self.assertEqual(greet('bob'), 'Hello, Bob')\n"}),
    ("t04", "test_assertion", "assert 3 == 4",
     PYTEST, pytest_suite(15, """
        def test_count_words():
            assert len("a b c".split()) == 4
     """, extra="""
        import warnings
        def test_warns():
            warnings.warn("pandas option 'mode.use_inf_as_na' is deprecated", FutureWarning)
            assert True
        def test_warns_2():
            warnings.warn("datetime.utcnow() is deprecated", DeprecationWarning)
            assert True
     """)),
    ("t05", "test_assertion", "Expected: 'ok'",
     "node --test", {"status.test.js": """const test = require('node:test');
const assert = require('node:assert');
for (let i = 0; i < 12; i++) test(`parses header ${i}`, () => assert.ok(true));
test('status endpoint reports ok', () => {
  const res = { status: 'degraded' };
  assert.equal(res.status, 'ok', "Expected: 'ok'");
});
"""}),
    ("t06", "test_assertion", "DID NOT RAISE",
     PYTEST, pytest_suite(10, """
        import pytest
        def withdraw(balance, amount):
            return balance - amount
        def test_overdraft_rejected():
            with pytest.raises(ValueError):
                withdraw(10, 50)
     """)),

    # ---- env_or_config: bien moi truong, file cau hinh, script/project config
    ("e01", "env_or_config", "KeyError: 'DATABASE_URL'",
     f"{PY} db.py", {"db.py": py("""
        import os
        def connect():
            url = os.environ["DATABASE_URL"]
            return url
        connect()
     """, noise=20)}),
    ("e02", "env_or_config", "Missing required environment variable STRIPE_SECRET_KEY",
     "node pay.js", {"pay.js": js("""
        function requireEnv(k) { const v = process.env[k]; if (!v) throw new Error(`Missing required environment variable ${k}`); return v; }
        const key = requireEnv('STRIPE_SECRET_KEY');
     """, noise=25)}),
    ("e03", "env_or_config", "JSONDecodeError",
     f"{PY} app.py", {"settings.json": '{\n  "port": 8080,\n  "debug": true,\n}\n', "app.py": py("""
        import json
        cfg = json.load(open("settings.json"))
     """, noise=20)}),
    ("e04", "env_or_config", "Missing script: \"build\"",
     "npm run build", {"package.json": '{"name":"web","version":"1.0.0","scripts":{"dev":"node x.js","test":"node --test"}}'}),
    ("e05", "env_or_config", "Couldn't find a project to run",
     "dotnet run", {"README.md": "hello\n"}),
    ("e06", "env_or_config", "requires Python 3.11",
     f"{PY} cli.py", {"cli.py": py("""
        import sys
        if sys.version_info >= (3, 12):
            raise SystemExit(f"error: this tool requires Python 3.11 (found {sys.version.split()[0]}); set UV_PYTHON=3.11")
     """, noise=10)}),

    # ---- permission_or_network: quyen truy cap, ket noi mang, DNS, port
    ("n01", "permission_or_network", "ConnectionRefusedError",
     f"{PY} ping.py", {"ping.py": py("""
        import urllib.request
        urllib.request.urlopen("http://127.0.0.1:9/health", timeout=3)
     """, noise=20)}),
    ("n02", "permission_or_network", "ENOTFOUND",
     "node fetch.js", {"fetch.js": js("""
        const https = require('https');
        https.get('https://api.does-not-exist.invalid/v1/items', r => console.log(r.statusCode))
          .on('error', e => { console.error(e); process.exit(1); });
     """, noise=15)}),
    ("n03", "permission_or_network", "PermissionError",
     f"{PY} read.py", {"read.py": py("""
        open(r"C:\\Windows\\System32\\config\\SAM", "rb").read()
     """, noise=20)}),
    ("n04", "permission_or_network", "Could not resolve host",
     "git clone https://git.does-not-exist.invalid/team/repo.git", {}),
    ("n05", "permission_or_network", "Only one usage of each socket address",
     f"{PY} serve.py", {"serve.py": py("""
        import socket
        a = socket.socket(); a.bind(("127.0.0.1", 0)); a.listen()
        port = a.getsockname()[1]
        b = socket.socket(); b.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        b.bind(("127.0.0.1", port))
     """, noise=15)}),
    ("n06", "permission_or_network", "EPERM",
     "node write.js", {"write.js": js("""
        const fs = require('fs');
        fs.writeFileSync('out.lock', 'x'); fs.chmodSync('out.lock', 0o444);
        fs.writeFileSync('out.lock', 'y');
     """, noise=15)}),

    # ---- timeout_or_resource: timeout, het bo nho, de quy qua sau
    ("r01", "timeout_or_resource", "RecursionError",
     f"{PY} tree.py", {"tree.py": py("""
        def depth(node):
            return 1 + depth(node)
        depth({})
     """, noise=15)}),
    ("r02", "timeout_or_resource", "MemoryError",
     f"{PY} big.py", {"big.py": py("buf = bytearray(10**14)\n", noise=20)}),
    ("r03", "timeout_or_resource", "Maximum call stack size exceeded",
     "node walk.js", {"walk.js": js("function walk(n) { return walk(n + 1); }\nwalk(0);\n", noise=20)}),
    ("r04", "timeout_or_resource", "TimeoutExpired",
     f"{PY} job.py", {"job.py": py("""
        import subprocess, sys
        subprocess.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=1)
     """, noise=20)}),
    ("r05", "timeout_or_resource", "heap out of memory",
     "node --max-old-space-size=32 hog.js", {"hog.js": js("const a = []; while (true) a.push(new Array(1e5).fill('x'));\n", noise=10)}),
    ("r06", "timeout_or_resource", "TimeoutError",
     f"{PY} fetch_all.py", {"fetch_all.py": py("""
        import asyncio
        async def slow(): await asyncio.sleep(5)
        async def main(): await asyncio.wait_for(slow(), timeout=0.5)
        asyncio.run(main())
     """, noise=25)}),

    # ---- other: khong thuoc nhom nao o tren
    ("o01", "other", "nothing to commit",
     "git init -q && git -c user.email=a@b.c -c user.name=a commit -m wip", {}),
    ("o02", "other", "pathspec 'feature/login' did not match",
     "git init -q && git checkout feature/login", {}),
    ("o03", "other", "aborted: 3 files would be overwritten",
     f"{PY} gen.py", {"gen.py": py("""
        import sys
        print("generating client from openapi.yaml ...")
        sys.exit("aborted: 3 files would be overwritten (use --force)")
     """, noise=15)}),
]


def run_case(cid, cat, marker, cmd, files) -> dict:
    d = tempfile.mkdtemp(prefix=f"triage_{cid}_")
    try:
        for name, content in files.items():
            p = os.path.join(d, name)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
        try:
            r = subprocess.run(cmd, shell=True, cwd=d, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=180)
            out, code = (r.stdout + ("\n" if r.stdout and r.stderr else "") + r.stderr).strip(), r.returncode
        except subprocess.TimeoutExpired:
            out, code = "(timed out)", -1
    finally:
        shutil.rmtree(d, ignore_errors=True)
    # Thay duong dan thu muc tam de dataset on dinh giua cac lan chay
    out = out.replace(d, "<proj>").replace(d.replace("\\", "/"), "<proj>")
    return {"id": cid, "category": cat, "marker": marker, "command": cmd.replace(PY, "python"),
            "exit_code": code, "error": f"Exit code {code}\n{out}",
            "marker_found": marker in out, "lines": out.count("\n") + 1}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    a = ap.parse_args()
    cases = [c for c in CASES if not a.only or c[0] == a.only]
    rows = []
    for c in cases:
        row = run_case(*c)
        flag = "" if row["exit_code"] != 0 and row["marker_found"] else "   <-- CHECK"
        print(f"{row['id']} {row['category']:<22} exit={row['exit_code']:<4} lines={row['lines']:<4}{flag}", flush=True)
        rows.append(row)
        if a.only:
            print(row["error"])
    if not a.only:
        with open(os.path.join(HERE, "cases.jsonl"), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
