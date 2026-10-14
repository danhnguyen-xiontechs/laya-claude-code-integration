# ablate2.py - thi nghiem phu 2: loi do cach viet mo ta category hay do model?
# Bien the A: 8 nhom cu, mo ta chua ten loi cu the (cung muc chi tiet voi regex trong eval.py).
# Bien the B: tach thanh nhom con theo ten loi cu the, Laya chon nhom con roi gop ve 8 nhom.
# Moi bien the chay tren 2 kieu input: 30 dong cuoi va doan nhieu tu khoa loi nhat.
# Chay:  python triage/ablate2.py   -> in tien do tung case, ghi triage/ablate2_results.json
import json, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import categories  # noqa: E402
import eval as ev  # noqa: E402
from chunker import clean, chunk  # noqa: E402

# A: moi mo ta <= 48 token, liet ke thong bao loi dien hinh
CONCRETE = {
    "dependency_missing": "ModuleNotFoundError: No module named 'pkg', Cannot find module 'pkg', Cannot find package, NU1101, command not found, is not recognized.",
    "import_or_path": "Cannot find module './local', ImportError: cannot import name, does not provide an export named, FileNotFoundError: No such file or directory, can't open file.",
    "syntax_or_type": "SyntaxError, TypeError, NameError, ReferenceError: x is not defined, AttributeError: object has no attribute, error CS1002, error TS2322 not assignable to type.",
    "test_assertion": "AssertionError, assert 1 == 2, Expected: / Received:, Expected values to be strictly deep-equal, FAILED test, DID NOT RAISE.",
    "env_or_config": "KeyError on os.environ, Missing required environment variable, JSONDecodeError in config file, npm Missing script, Couldn't find a project to run, requires Python 3.x.",
    "permission_or_network": "PermissionError, EPERM, EACCES, Access is denied, ConnectionRefusedError, ECONNREFUSED, ENOTFOUND, Could not resolve host, address already in use.",
    "timeout_or_resource": "TimeoutError, TimeoutExpired, timed out, MemoryError, JavaScript heap out of memory, RecursionError, Maximum call stack size exceeded.",
    "other": "git errors: nothing to commit, pathspec did not match, would be overwritten, aborted; or no clear error.",
}

# B: nhom con -> nhom cha
FINE = {
    "py_missing_package": ("dependency_missing", "Python ModuleNotFoundError: No module named 'third_party_package' (pip package not installed)."),
    "node_missing_package": ("dependency_missing", "Node: Cannot find module 'express' or Cannot find package 'zod' (npm package not installed)."),
    "dotnet_missing_package": ("dependency_missing", "dotnet restore error NU1101: unable to find package."),
    "missing_cli": ("dependency_missing", "Shell: command not found, or is not recognized as an internal or external command."),
    "py_bad_import": ("import_or_path", "Python ImportError: cannot import name, or No module named 'project.submodule'."),
    "node_bad_import": ("import_or_path", "Node: Cannot find module './relative/path', or does not provide an export named."),
    "file_not_found": ("import_or_path", "FileNotFoundError: No such file or directory, or can't open file."),
    "syntax_error": ("syntax_or_type", "SyntaxError: invalid syntax, or compiler error CS1002 ; expected."),
    "type_error": ("syntax_or_type", "TypeError: unsupported operand type(s), or TS2322 not assignable to type."),
    "undefined_name": ("syntax_or_type", "NameError / ReferenceError: x is not defined, or AttributeError: object has no attribute."),
    "assert_failed": ("test_assertion", "Test failed: AssertionError, assert 100 == 90, Expected: / Received:, strictly deep-equal."),
    "expected_exception": ("test_assertion", "pytest Failed: DID NOT RAISE expected exception."),
    "missing_env_var": ("env_or_config", "KeyError: 'DATABASE_URL' or Missing required environment variable."),
    "bad_config_file": ("env_or_config", "JSONDecodeError while reading a config file."),
    "missing_project_or_script": ("env_or_config", "npm error Missing script, or dotnet Couldn't find a project to run."),
    "wrong_runtime_version": ("env_or_config", "Package requires Python 3.11 or a different Node version."),
    "permission_denied": ("permission_or_network", "PermissionError, EPERM, EACCES: operation not permitted, Access is denied."),
    "connection_failed": ("permission_or_network", "ConnectionRefusedError, ECONNREFUSED, socket address already in use."),
    "dns_failure": ("permission_or_network", "ENOTFOUND, getaddrinfo failed, Could not resolve host."),
    "timeout": ("timeout_or_resource", "TimeoutError, subprocess TimeoutExpired, operation timed out."),
    "out_of_memory": ("timeout_or_resource", "MemoryError, or JavaScript heap out of memory."),
    "stack_overflow": ("timeout_or_resource", "RecursionError: maximum recursion depth, or Maximum call stack size exceeded."),
    "git_state": ("other", "git: nothing to commit, pathspec did not match, local changes would be overwritten, aborting."),
}
FINE_Q = {k: v[1] for k, v in FINE.items()}

INPUTS = {
    "tail30": lambda L, ch: ev.tail_text(L),
    "kwchunk": lambda L, ch: ch[ev.kw_chunk(ch)]["text"],
}
VARIANTS = {f"{v}-{i}": (v, i) for v in ("A", "B") for i in INPUTS}


def main() -> None:
    cases = [json.loads(l) for l in open(os.path.join(HERE, "dataset", "cases.jsonl"), encoding="utf-8")]
    hits = {k: 0 for k in VARIANTS}
    ms = {k: [] for k in VARIANTS}
    rows = []
    for c in cases:
        L = clean(c["error"])
        ch = chunk(L)
        row = {"id": c["id"], "gold": c["category"]}
        for k, (v, i) in VARIANTS.items():
            cats = CONCRETE if v == "A" else FINE_Q
            a, t = ev.laya({"command": c["command"], "output_tail": INPUTS[i](L, ch)}, {"category": categories.question(cats)})
            p = a["category"]["probabilities"]
            raw = max(p, key=p.get)
            pred = raw if v == "A" else FINE[raw][0]
            hits[k] += pred == c["category"]
            ms[k].append(t)
            row[k] = [pred, raw, round(p[raw], 3)]
        rows.append(row)
        print(c["id"], c["category"], {k: row[k][0] for k in VARIANTS}, flush=True)
    n = len(cases)
    summary = {k: {"accuracy": round(hits[k] / n, 3), "p50_ms": round(statistics.median(ms[k]))} for k in VARIANTS}
    with open(os.path.join(HERE, "ablate2_results.json"), "w", encoding="utf-8") as f:
        json.dump({"n": n, "summary": summary, "rows": rows}, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
