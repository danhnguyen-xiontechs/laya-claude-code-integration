# run_routing.py - Buoc A: routing 3 model (haiku / sonnet / opus) bang Laya Python SDK, khong can server.
# Chay:  <uv tool dir>\laya\Scripts\python.exe run_routing.py
import csv, json, os, time
from collections import Counter
from pathlib import Path

os.environ.setdefault("LAYA_DEVICE", "cpu")
os.environ.setdefault("LAYA_MODELS", "english")
from laya import Router

HERE = Path(__file__).parent
TIERS = ["haiku", "sonnet", "opus"]
QUESTION = {"model": {
    "type": "choice",
    "instructions": "Which model tier should handle this coding request?",
    "criteria": {  # moi mo ta giu duoi 48 token
        "haiku": "Trivial, mechanical or lookup task: a small edit in one file, formatting, renaming, a short factual question. No design or debugging needed.",
        "sonnet": "Standard development task: implement a well defined feature, fix a localized bug, write tests or refactor within a few files.",
        "opus": "Hard task: architecture or system design, large migration, root cause analysis across many files or services, security or performance investigation.",
    },
}}


# Criteria nguyen van tu Phase 1 cua laya_model_routing_implementation_plan.md (de so sanh voi ban tren)
PLAN_CRITERIA = {
    "opus": "Use for complex reasoning, architecture, difficult debugging, or broad cross-cutting changes",
    "sonnet": "Use for normal coding, implementation, refactoring, and standard debugging",
    "haiku": "Use for simple edits, lookups, formatting, or lightweight repetitive tasks",
}
QUESTION_PLAN = {"model": {"type": "choice", "instructions": "Which model should handle this task?", "criteria": PLAN_CRITERIA}}


def state_request(row):
    return {"request": row["prompt"]}


def state_signals(row):
    return {"request": row["prompt"], "files_mentioned": row["files"],
            "has_stack_trace": row["stack_trace"], "conversation_turns": row["turns"]}


def run(router, rows, make_state, question=QUESTION):
    out = []
    for row in rows:
        t = time.perf_counter()
        res = router.predict(make_state(row), question, model="english", max_len=1024)
        ms = (time.perf_counter() - t) * 1000
        a = res["answers"]["model"]
        probs = a["probabilities"]
        out.append({"id": row["id"], "expected": row["tier"], "predicted": a["choice"],
                    # `confidence` cua Laya voi choice khong phai max(p); dung xac suat cao nhat lam nguong
                    "confidence": max(probs.values()), "laya_confidence": a.get("confidence"),
                    "probabilities": probs, "ms": round(ms)})
    return out


def summarize(name, res):
    n = len(res)
    ok = sum(r["expected"] == r["predicted"] for r in res)
    near = sum(abs(TIERS.index(r["expected"]) - TIERS.index(r["predicted"])) <= 1 for r in res)
    lines = [f"## {name}", "", f"- Accuracy: **{ok}/{n}** ({ok / n:.0%}); within one tier: {near}/{n}",
             f"- Predicted distribution: {dict(Counter(r['predicted'] for r in res))}",
             f"- Latency: median {sorted(r['ms'] for r in res)[n // 2]} ms", "",
             "| expected \\ predicted | " + " | ".join(TIERS) + " |", "|---|" + "---|" * len(TIERS)]
    for e in TIERS:
        lines.append(f"| {e} | " + " | ".join(
            str(sum(r["expected"] == e and r["predicted"] == p for r in res)) for p in TIERS) + " |")
    lines += ["", "| top probability | n | accuracy |", "|---|---|---|"]
    for lo, hi in [(0, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.01)]:
        b = [r for r in res if lo <= r["confidence"] < hi]
        acc = f"{sum(r['expected'] == r['predicted'] for r in b) / len(b):.0%}" if b else "-"
        lines.append(f"| {lo:.1f}-{min(hi, 1.0):.1f} | {len(b)} | {acc} |")
    wrong = [r for r in res if r["expected"] != r["predicted"]]
    lines += ["", "Wrong: " + (", ".join(
        f"#{r['id']} {r['expected']}->{r['predicted']} ({r['confidence']:.2f})" for r in wrong) or "none"), ""]
    return "\n".join(lines)


def main():
    rows = list(csv.DictReader(open(HERE / "prompts.csv", encoding="utf-8")))
    router = Router()
    router.predict({"request": "warm up"}, QUESTION)
    results = {"request_only": run(router, rows, state_request),
               "request_plus_signals": run(router, rows, state_signals),
               "plan_criteria_request_only": run(router, rows, state_request, QUESTION_PLAN),
               "plan_criteria_plus_signals": run(router, rows, state_signals, QUESTION_PLAN)}
    (HERE / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    report = "# Laya routing, 3 tiers, 60 synthetic prompts\n\n" + "\n".join(summarize(k, v) for k, v in results.items())
    (HERE / "report.md").write_text(report, encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
