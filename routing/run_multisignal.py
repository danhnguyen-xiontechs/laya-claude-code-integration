"""Thu multi-signal routing (y tuong tu laya-router-skill) tren 60 prompt.

Hoi Laya cac tin hieu complexity / needs_strong_reasoning / security_sensitive / risk
trong mot lan predict, roi ghep bang luat de chon haiku/sonnet/opus.
Chay lai baseline (1 cau choice 3 tang) trong cung lan chay de so sanh cong bang.

Chay: <python co laya> run_multisignal.py
"""
import csv
import itertools
import json
import time
from pathlib import Path

import laya

from run_routing import QUESTION, TIERS, state_request, state_signals

HERE = Path(__file__).parent

# Lay tu laya-router-skill runtime/laya_router/router.py, bo task_type (14 lua chon, chua calibrate)
SIGNALS = {
    "complexity": {"type": "score", "instructions": "Estimate task complexity.",
                   "criteria": ["trivial", "normal", "complex", "very_complex"]},
    "needs_strong_reasoning": {"type": "noul", "instructions": "Would this task benefit from stronger multi-step reasoning?"},
    "security_sensitive": {"type": "noul", "instructions": "Does this task involve security, credentials, permissions, or destructive changes?"},
    "risk": {"type": "choice", "instructions": "Estimate execution risk, advisory only.", "criteria": {
        "low": "ordinary reversible work", "medium": "meaningful change requiring review",
        "high": "destructive, privileged, credential or production change"}},
}


def collect(router, rows, make_state):
    out = []
    for row in rows:
        t = time.perf_counter()
        a = router.predict(make_state(row), {**SIGNALS, **QUESTION}, model="english", max_len=1024)["answers"]
        ms = (time.perf_counter() - t) * 1000
        out.append({"id": row["id"], "expected": row["tier"], "ms": round(ms),
                    "baseline": a["model"]["choice"],
                    "complexity": a["complexity"]["score"],
                    "reasoning": a["needs_strong_reasoning"]["noul"],
                    "security": a["security_sensitive"]["noul"],
                    "risk": a["risk"]["choice"]})
    return out


# --- Luat ghep -----------------------------------------------------------------

def rule_fixed(s):
    """Luat dat truoc, khong nhin du lieu."""
    if s["complexity"] >= 2.0 or s["reasoning"] >= 0.7 or s["risk"] == "high":
        return "opus"
    if s["complexity"] < 1.0 and s["reasoning"] < 0.5:
        return "haiku"
    return "sonnet"


def rule_complexity(lo, hi):
    return lambda s: "haiku" if s["complexity"] < lo else "opus" if s["complexity"] >= hi else "sonnet"


def rule_mix(lo, hi, w):
    """Diem = complexity + w * (reasoning - 0.5) * 2."""
    def f(s):
        x = s["complexity"] + w * (s["reasoning"] - 0.5) * 2
        return "haiku" if x < lo else "opus" if x >= hi else "sonnet"
    return f


def score(res, rule):
    pred = [rule(s) for s in res]
    ok = sum(p == s["expected"] for p, s in zip(pred, res))
    under = sum(TIERS.index(p) < TIERS.index(s["expected"]) for p, s in zip(pred, res))
    per = {t: sum(p == s["expected"] == t for p, s in zip(pred, res)) for t in TIERS}
    return ok, under, per


def grid(res):
    steps = [round(0.25 * i, 2) for i in range(1, 12)]  # 0.25 .. 2.75
    best = {}
    for lo, hi in itertools.combinations(steps, 2):
        best[("complexity", lo, hi, 0)] = score(res, rule_complexity(lo, hi))
        for w in (0.25, 0.5, 1.0):
            best[("mix", lo, hi, w)] = score(res, rule_mix(lo, hi, w))
    return sorted(best.items(), key=lambda kv: (-kv[1][0], kv[1][1]))[:5]


def main():
    rows = list(csv.DictReader(open(HERE / "prompts.csv", encoding="utf-8")))
    router = laya.Router(device="cpu", max_loaded=1, preload=False)
    router.predict({"request": "warm up"}, {**SIGNALS, **QUESTION}, model="english")
    data = {"request_only": collect(router, rows, state_request),
            "request_plus_signals": collect(router, rows, state_signals)}
    (HERE / "multisignal_results.json").write_text(json.dumps(data, indent=1), encoding="utf-8")

    lines = [f"# Multi-signal routing (laya {laya.__version__})", "",
             "Grid search duoc fit tren chinh 60 prompt nay -> la tran tren, khong phai do chinh xac thuc.", ""]
    for name, res in data.items():
        ms = sorted(r["ms"] for r in res)[len(res) // 2]
        lines += [f"## {name} (median {ms} ms / predict, 4 tin hieu + baseline)", "",
                  "| strategy | dung | thap hon can | haiku/sonnet/opus dung |", "|---|---|---|---|"]
        for label, rule in [("baseline choice 3 tang", lambda s: s["baseline"]), ("fixed rule", rule_fixed)]:
            ok, under, per = score(res, rule)
            lines.append(f"| {label} | {ok}/60 | {under} | {per['haiku']}/{per['sonnet']}/{per['opus']} |")
        for (kind, lo, hi, w), (ok, under, per) in grid(res):
            lines.append(f"| grid {kind} lo={lo} hi={hi} w={w} | {ok}/60 | {under} | {per['haiku']}/{per['sonnet']}/{per['opus']} |")
        lines.append("")
    (HERE / "multisignal_report.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
