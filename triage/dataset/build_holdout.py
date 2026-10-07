# build_holdout.py - Tap HELD-OUT doc lap voi cases.jsonl: cac loi THAT khac (loai loi / thong diep / tool khac).
#
# Cung dinh dang voi build_dataset.py: "error" = "Exit code N\n" + stdout+stderr cua lenh loi chay that trong thu muc tam.
# Khac: moi case co the co "setup" (cac lenh chuan bi, vd tao repo git bi conflict) - output cua setup KHONG duoc ghi.
#
# Chay:  python triage/dataset/build_holdout.py              (ghi triage/dataset/holdout.jsonl)
#        python triage/dataset/build_holdout.py --only h_dep01
import argparse, json, os, shutil, subprocess, sys, tempfile, textwrap

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dataset import PY, PYTEST, py, js  # noqa: E402  (helper dung chung: interpreter, pytest qua uv, noise)

HERE = os.path.dirname(os.path.abspath(__file__))
OPENSSL = shutil.which("openssl") or r"C:\Program Files\Git\mingw64\bin\openssl.exe"
PS = "powershell -NoProfile -ExecutionPolicy Bypass -File"
GIT_ENV = {"GIT_AUTHOR_NAME": "dev", "GIT_AUTHOR_EMAIL": "dev@example.com", "GIT_COMMITTER_NAME": "dev",
           "GIT_COMMITTER_EMAIL": "dev@example.com", "GIT_TERMINAL_PROMPT": "0", "GIT_EDITOR": "true"}
CSPROJ = """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><RootNamespace>Shop</RootNamespace></PropertyGroup>
</Project>"""

PS_NOISE = "".join(f'Write-Host "[{i:02d}:14:0{i % 10}] INFO step {i + 1}/8 ok ({200 + i * 13} ms)"\n' for i in range(8)) + \
    'Write-Warning "TLS 1.0 is deprecated for this endpoint"\n'


def ps(body: str, noise: bool = False) -> str:
    return "$ErrorActionPreference = 'Stop'\n" + (PS_NOISE if noise else "") + textwrap.dedent(body)


GIT_INIT = "git init -q -b main"
GIT_BASE = [GIT_INIT, "git add -A", "git commit -q -m init"]


def case(cid, cat, marker, cmd, files=None, setup=None):
    return {"id": cid, "category": cat, "marker": marker, "command": cmd, "files": files or {}, "setup": setup or []}


CASES = [
    # ---------------- dependency_missing
    case("h_dep01", "dependency_missing", "flask-limiter-pro was not found",
         'uv run --no-project --offline --with "flask-limiter-pro==9.9.9" python -c "print(1)"'),
    case("h_dep02", "dependency_missing", "missing: lodash@^4.17.21",
         "npm ls --depth=0",
         {"package.json": '{"name":"web","version":"1.0.0","dependencies":{"lodash":"^4.17.21"}}'}),
    case("h_dep03", "dependency_missing", "Could not execute because the specified command or file was not found",
         "dotnet ef migrations add InitialCreate", {"app.csproj": CSPROJ, "Program.cs": "System.Console.WriteLine(1);\n"}),
    case("h_dep04", "dependency_missing", "'jq' is not recognized",
         "node prebuild.js && jq -r .version package.json",
         {"package.json": '{"name":"cli","version":"2.3.1"}',
          "prebuild.js": js("console.log('[prebuild] bundle ready');\n", noise=18)}),
    case("h_dep05", "dependency_missing", "module 'SqlServer' was not loaded",
         f"{PS} backup.ps1", {"backup.ps1": ps("""
            Import-Module SqlServer
            Backup-SqlDatabase -ServerInstance localhost -Database shop
         """, noise=True)}),

    # ---------------- import_or_path
    case("h_imp01", "import_or_path", "partially initialized module",
         f"{PY} main.py", {
             "models.py": "from services import notify\n\nclass User:\n    pass\n",
             "services.py": "from models import User\n\ndef notify(u: User):\n    return u\n",
             "main.py": py("import models\nprint(models.User())\n", noise=20)}),
    case("h_imp02", "import_or_path", "ENOENT: no such file or directory",
         "node render.js", {
             "templates/welcome.htm": "<h1>Hi {{name}}</h1>\n",
             "render.js": js("""
                const fs = require('fs'), path = require('path');
                const tpl = fs.readFileSync(path.join(__dirname, 'templates', 'welcome.html'), 'utf8');
                console.log(tpl.replace('{{name}}', 'An'));
             """, noise=22)}),
    case("h_imp03", "import_or_path", "CS0234",
         "dotnet build -nologo", {
             "app.csproj": CSPROJ,
             "Pricing/PriceService.cs": "namespace Shop.Pricing;\npublic class PriceService { public decimal Get() => 1m; }\n",
             "Program.cs": "using Shop.Services;\nvar s = new PriceService();\nSystem.Console.WriteLine(s.Get());\n"}),
    case("h_imp04", "import_or_path", "common.ps1' is not recognized",
         f"{PS} deploy.ps1", {
             "lib/Common-Utils.ps1": "function Get-Target { 'prod' }\n",
             "deploy.ps1": ps("""
                . "$PSScriptRoot\\lib\\common.ps1"
                Write-Host "deploying to $(Get-Target)"
             """)}),
    case("h_imp05", "import_or_path", "attempted relative import with no known parent package",
         f"{PY} app/cli.py", {
             "app/__init__.py": "", "app/config.py": "def load():\n    return {}\n",
             "app/cli.py": py("from .config import load\nprint(load())\n", noise=12)}),

    # ---------------- syntax_or_type
    case("h_syn01", "syntax_or_type", "IndentationError",
         f"{PY} billing.py", {"billing.py": "def invoice_total(lines):\n    total = 0\n    for l in lines:\n        total += l\n      return total\n\nprint(invoice_total([1, 2]))\n"}),
    case("h_syn02", "syntax_or_type", "Cannot read properties of undefined (reading 'map')",
         "node orders.js", {"orders.js": js("""
            function lineTotals(order) {
              return order.items.map(i => i.qty * i.price);
            }
            const orders = [{ id: 1, items: [{ qty: 2, price: 5 }] }, { id: 2 }];
            for (const o of orders) console.log(o.id, lineTotals(o));
         """, noise=28)}),
    case("h_syn03", "syntax_or_type", "SyntaxError: Unexpected token",
         "npx --no-install prettier --check src", {
             "src/ok.js": "export const a = 1;\n",
             "src/config.js": "export const config = {\n  retries: 3,,\n  timeout: 1000,\n};\n"}),
    case("h_syn04", "syntax_or_type", "CS0029",
         "dotnet build -nologo", {
             "app.csproj": CSPROJ,
             "Program.cs": "string input = System.Console.ReadLine() ?? \"5\";\nint qty = input;\nSystem.Console.WriteLine(qty * 2);\n"}),
    case("h_syn05", "syntax_or_type", "You cannot call a method on a null-valued expression",
         f"{PS} release.ps1", {"release.ps1": ps("""
            $settings = @{ name = 'shop'; channel = 'beta' }
            $tag = $settings['version']
            Write-Host "tag: $($tag.Trim())"
         """, noise=True)}),

    # ---------------- test_assertion
    case("h_tst01", "test_assertion", "Assert.Equal() Failure",
         "dotnet test -nologo", {
             "tests.csproj": """<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsPackable>false</IsPackable></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>
</Project>""",
             "CartTests.cs": "using Xunit;\npublic static class Cart { public static int Total(int[] xs) { int t = 0; for (int i = 1; i < xs.Length; i++) t += xs[i]; return t; } }\n"
                             "public class CartTests {\n"
                             + "".join(f"  [Fact] public void Ok{i}() => Assert.True({i} >= 0);\n" for i in range(6))
                             + "  [Fact] public void TotalSumsAllLines() => Assert.Equal(60, Cart.Total(new[] { 10, 20, 30 }));\n}\n"}),
    case("h_tst02", "test_assertion", "assert 'hello-world-' == 'hello-world'",
         PYTEST, {"test_slug.py": textwrap.dedent("""
            import pytest
            def slugify(s):
                return "".join(c if c.isalnum() else "-" for c in s.lower())
            @pytest.mark.parametrize("raw,expected", [("abc", "abc"), ("A B", "a-b"), ("x_y", "x-y"),
                                                      ("hello world!", "hello-world")])
            def test_slugify(raw, expected):
                assert slugify(raw) == expected
         """) + "".join(f"\ndef test_misc_{i}():\n    assert str({i}).isdigit()\n" for i in range(9))}),
    case("h_tst03", "test_assertion", "Missing expected exception",
         "node --test", {"validate.test.js": js("""
            const test = require('node:test');
            const assert = require('node:assert');
            function parseAge(s) { const n = Number(s); return n; }
            for (let i = 0; i < 9; i++) test(`parses age ${i}`, () => assert.strictEqual(parseAge(String(i)), i));
            test('rejects negative age', () => {
              assert.throws(() => parseAge('-4'), RangeError);
            });
         """)}),
    case("h_tst04", "test_assertion", "Expected: {110}",
         'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -EnableExit"', {
             "Tax.ps1": "function Get-Total([decimal]$net) { return $net }\n",
             "Tax.Tests.ps1": textwrap.dedent("""
                . "$PSScriptRoot\\Tax.ps1"
                Describe 'Get-Total' {
                    It 'returns zero for zero' { Get-Total 0 | Should Be 0 }
                    It 'handles decimals' { (Get-Total 1.5) -gt 0 | Should Be $true }
                    It 'adds 10 percent VAT' { Get-Total 100 | Should Be 110 }
                }
             """)}),
    case("h_tst05", "test_assertion", "Failed example",
         f"{PY} -m doctest -v pricing.py", {"pricing.py": textwrap.dedent('''
            def round_price(x):
                """
                >>> round_price(1.234)
                1.23
                >>> round_price(2)
                2.0
                >>> round_price(2.675)
                2.68
                """
                return round(float(x), 2)
            def pct(a, b):
                """
                >>> pct(1, 4)
                25.0
                """
                return a / b * 100
         ''')}),

    # ---------------- env_or_config
    case("h_env01", "env_or_config", "Failed to parse",
         "uv run --offline python -c \"print(1)\"",
         {"pyproject.toml": '[project]\nname = "svc"\nversion = "0.1.0\nrequires-python = ">=3.11"\ndependencies = []\n'}),
    case("h_env02", "env_or_config", ".env: not found",
         "node --env-file=.env server.js", {"server.js": "console.log('port', process.env.PORT);\n",
                                             ".env.example": "PORT=3000\nDB_URL=postgres://localhost/app\n"}),
    case("h_env03", "env_or_config", "EBADENGINE",
         "npm install --offline --no-audit --no-fund",
         {"package.json": '{"name":"api","version":"1.0.0","engines":{"node":">=26.0.0"}}', ".npmrc": "engine-strict=true\n"}),
    case("h_env04", "env_or_config", "A compatible .NET SDK was not found",
         "dotnet build -nologo", {"app.csproj": CSPROJ, "Program.cs": "System.Console.WriteLine(1);\n",
                                  "global.json": '{"sdk":{"version":"6.0.100","rollForward":"disable"}}'}),
    case("h_env05", "env_or_config", "EJSONPARSE",
         "npm run test", {"package.json": '{\n  "name": "web",\n  "version": "1.0.0",\n  "scripts": {\n    "test": "node --test",\n  }\n}\n'}),

    # ---------------- permission_or_network
    case("h_net01", "permission_or_network", "EADDRINUSE",
         "node dev.js", {"dev.js": js("""
            const http = require('http');
            const api = http.createServer((q, s) => s.end('api')).listen(0, '127.0.0.1', () => {
              const port = api.address().port;
              console.log(`[api] listening on ${port}`);
              http.createServer((q, s) => s.end('admin')).listen(port, '127.0.0.1');
            });
         """, noise=20)}),
    case("h_net02", "permission_or_network", "CERTIFICATE_VERIFY_FAILED",
         f"{PY} sync.py", {"sync.py": py("""
            import http.server, ssl, threading, urllib.request
            srv = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain("cert.pem", "key.pem")
            srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            urllib.request.urlopen(f"https://localhost:{srv.server_address[1]}/", timeout=5)
         """, noise=15)},
         setup=[f'"{OPENSSL}" req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj "/CN=localhost"']),
    case("h_net03", "permission_or_network", "Unable to connect to the remote server",
         f"{PS} health.ps1", {"health.ps1": ps("""
            Invoke-WebRequest -Uri "http://127.0.0.1:9/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
         """, noise=True)}),
    case("h_net04", "permission_or_network", "Failed to connect to 127.0.0.1 port 9",
         "git ls-remote http://127.0.0.1:9/team/repo.git"),
    case("h_net05", "permission_or_network", "ECONNREFUSED",
         "npm view left-pad version --registry=http://127.0.0.1:9/ --fetch-retries=0 --prefer-online"),

    # ---------------- timeout_or_resource
    case("h_res01", "timeout_or_resource", "Stack overflow",
         "dotnet run", {"app.csproj": CSPROJ, "Program.cs": textwrap.dedent("""
            static int Depth(int n) => Depth(n + 1) + 1;
            System.Console.WriteLine("computing category depth...");
            System.Console.WriteLine(Depth(0));
         """)}),
    case("h_res02", "timeout_or_resource", "timed out",
         f"{PY} poll.py", {"poll.py": py("""
            import socket, urllib.request
            hang = socket.socket(); hang.bind(("127.0.0.1", 0)); hang.listen()
            port = hang.getsockname()[1]
            urllib.request.urlopen(f"http://127.0.0.1:{port}/status", timeout=1.5)
         """, noise=25)}),
    case("h_res03", "timeout_or_resource", "aborted due to timeout",
         "node client.mjs", {"client.mjs": js("""
            import http from 'node:http';
            const srv = http.createServer(() => {}).listen(0, '127.0.0.1');
            await new Promise(r => srv.on('listening', r));
            await fetch(`http://127.0.0.1:${srv.address().port}/items`, { signal: AbortSignal.timeout(800) });
         """)}),
    case("h_res04", "timeout_or_resource", "Array buffer allocation failed",
         "node thumbs.js", {"thumbs.js": js("""
            const frames = 1 << 20, frameBytes = 1 << 22;
            console.log(`allocating ${frames} frames`);
            const buf = new ArrayBuffer(frames * frameBytes);
         """, noise=16)}),
    case("h_res05", "timeout_or_resource", "The operation has timed out",
         f"{PS} smoke.ps1", {"smoke.ps1": ps("""
            $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start()
            $port = $l.LocalEndpoint.Port
            Invoke-WebRequest -Uri "http://127.0.0.1:$port/ready" -UseBasicParsing -TimeoutSec 2 | Out-Null
         """)}),

    # ---------------- other (trang thai git, huy co chu dich, ...)
    case("h_oth01", "other", "Merge conflict in price.txt",
         "git merge feature", {"price.txt": "price=10\n"},
         setup=GIT_BASE + ["git checkout -q -b feature", "echo price=12> price.txt", "git commit -q -am raise",
                           "git checkout -q main", "echo price=9> price.txt", "git commit -q -am cut"]),
    case("h_oth02", "other", "already a rebase-merge directory",
         "git rebase main", {"price.txt": "price=10\n"},
         setup=GIT_BASE + ["git checkout -q -b feature", "echo price=12> price.txt", "git commit -q -am raise",
                           "git checkout -q main", "echo price=9> price.txt", "git commit -q -am cut",
                           "git checkout -q feature", "git rebase main"]),
    case("h_oth03", "other", "You are not currently on a branch",
         "git pull", {"a.txt": "1\n"},
         setup=GIT_BASE + ["echo 2> a.txt", "git commit -q -am two", "git checkout -q HEAD~1"]),
    case("h_oth04", "other", "No stash entries found",
         "git stash pop", {"a.txt": "1\n"}, setup=GIT_BASE),
    case("h_oth05", "other", "Git working directory not clean",
         "npm version patch", {"package.json": '{"name":"lib","version":"1.4.2"}', "index.js": "module.exports = 1;\n"},
         setup=GIT_BASE + ["echo module.exports = 2;> index.js"]),
]


def run_case(c: dict) -> dict:
    d = tempfile.mkdtemp(prefix=f"holdout_{c['id']}_")
    env = {**os.environ, **GIT_ENV}
    try:
        for name, content in c["files"].items():
            p = os.path.join(d, name)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
        for s in c["setup"]:  # chuan bi trang thai (output bo qua; co the loi co chu dich)
            subprocess.run(s, shell=True, cwd=d, capture_output=True, env=env, timeout=60)
        try:
            r = subprocess.run(c["command"], shell=True, cwd=d, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=60, env=env)
            out, code = (r.stdout + ("\n" if r.stdout and r.stderr else "") + r.stderr).strip(), r.returncode
        except subprocess.TimeoutExpired:
            out, code = "(timed out)", -1
    finally:
        shutil.rmtree(d, ignore_errors=True)
    for v in sorted({d, d.replace("\\", "/"), d.replace("\\", "\\\\"), os.path.realpath(d)}, key=len, reverse=True):
        out = out.replace(v, "<proj>")
    return {"id": c["id"], "category": c["category"], "marker": c["marker"], "command": c["command"].replace(PY, "python"),
            "exit_code": code, "error": f"Exit code {code}\n{out}",
            "marker_found": c["marker"] in out, "lines": out.count("\n") + 1}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    a = ap.parse_args()
    rows = []
    for c in CASES:
        if a.only and c["id"] != a.only:
            continue
        row = run_case(c)
        flag = "" if row["exit_code"] != 0 and row["marker_found"] else "   <-- CHECK"
        print(f"{row['id']} {row['category']:<22} exit={row['exit_code']:<11} lines={row['lines']:<4}{flag}", flush=True)
        rows.append(row)
        if a.only:
            print(row["error"])
    if not a.only:
        with open(os.path.join(HERE, "holdout.jsonl"), "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
