"""Bao cao theo buoc cua mot phien Claude Code chay /wf.

Ghep ba nguon theo tool_use_id:
  - hook log (hooks/step_decisions.jsonl): Laya/static chon tang nao, xac suat, thoi gian hook
  - transcript luong chinh: brief day du, resolvedModel, thoi gian, token cua tung subagent
  - transcript tung subagent: so luot, token theo tung message

Dung:  python step_report.py <session_id | duong dan transcript .jsonl> [--out report.md] [--review runs/<ten>/review.md]
"""
import argparse, glob, json, os, sys
from pathlib import Path

HERE = Path(__file__).parent
PROJECTS = Path.home() / ".claude" / "projects"
W = {"haiku": 1, "sonnet": 3, "opus": 5}  # GIA DINH ti le gia, chi de so sanh tuong doi; khong phai cach tinh quota that


def tier_of(model: str) -> str:
    m = (model or "").lower()
    return next((t for t in W if t in m), "?")


def units(u: dict, model: str) -> float:
    w = W.get(tier_of(model))
    if w is None:
        return 0.0
    return w * (u["in"] + 1.25 * u["cw"] + 0.1 * u["cr"] + 5 * u["out"]) / 1000


def read_jsonl(p):
    for line in open(p, encoding="utf-8", errors="replace"):
        try:
            yield json.loads(line)
        except ValueError:
            continue


def sum_assistant(path) -> tuple[dict, int, dict]:
    """(tong usage, so luot assistant, so message theo model); khu trung theo message id."""
    seen = {}
    for d in read_jsonl(path):
        if d.get("type") != "assistant":
            continue
        m = d.get("message", {})
        if m.get("model") in (None, "<synthetic>"):
            continue
        seen[m.get("id") or d.get("uuid")] = m
    u = dict(in_=0, cr=0, cw=0, out=0)
    models = {}
    for m in seen.values():
        x = m.get("usage") or {}
        u["in_"] += x.get("input_tokens", 0) or 0
        u["cr"] += x.get("cache_read_input_tokens", 0) or 0
        u["cw"] += x.get("cache_creation_input_tokens", 0) or 0
        u["out"] += x.get("output_tokens", 0) or 0
        models[m["model"]] = models.get(m["model"], 0) + 1
    return {"in": u["in_"], "cr": u["cr"], "cw": u["cw"], "out": u["out"]}, len(seen), models


def find_transcript(arg: str) -> Path:
    if arg.endswith(".jsonl") and os.path.exists(arg):
        return Path(arg)
    hits = glob.glob(str(PROJECTS / "*" / f"{arg}.jsonl"))
    if not hits:
        sys.exit(f"khong thay transcript cua session {arg} trong {PROJECTS}")
    return Path(hits[0])


def collect(transcript: Path, decisions_path: Path) -> dict:
    session = transcript.stem
    sub_dir = transcript.with_suffix("") / "subagents"
    decisions = {}
    if decisions_path.exists():
        for r in read_jsonl(decisions_path):
            if r.get("session") == session and r.get("tool_use_id"):
                decisions[r["tool_use_id"]] = r
    calls, results = [], {}
    for d in read_jsonl(transcript):
        if d.get("type") == "assistant":
            for b in d.get("message", {}).get("content", []):
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in ("Agent", "Task"):
                    calls.append({"id": b["id"], "input": b.get("input", {}), "ts": d.get("timestamp")})
        elif d.get("type") == "user" and isinstance(d.get("toolUseResult"), dict):
            tur = d["toolUseResult"]
            for b in (d.get("message", {}).get("content") or []):
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    results[b["tool_use_id"]] = tur
    metas = {}
    for mp in glob.glob(str(sub_dir / "*.meta.json")):
        meta = json.load(open(mp, encoding="utf-8"))
        metas[meta.get("toolUseId")] = Path(mp.replace(".meta.json", ".jsonl"))
    steps = []
    for c in calls:
        tur = results.get(c["id"], {})
        sub = metas.get(c["id"])
        usage, turns, models = (sum_assistant(sub) if sub and sub.exists() else ({"in": 0, "cr": 0, "cw": 0, "out": 0}, 0, {}))
        dec = decisions.get(c["id"], {})
        steps.append({"id": c["id"], "agent": c["input"].get("subagent_type", "?"), "brief": c["input"].get("prompt", ""),
                      "requested_model": c["input"].get("model"), "decision": dec,
                      "actual_model": tur.get("resolvedModel") or (next(iter(models), None)), "turns": turns,
                      "usage": usage, "duration_ms": tur.get("totalDurationMs"), "status": tur.get("status", "?")})
    main_usage, main_turns, main_models = sum_assistant(transcript)
    return {"session": session, "steps": steps, "main": {"usage": main_usage, "turns": main_turns, "models": main_models}}


def fmt(n):
    return f"{n:,}"


def render(r: dict) -> str:
    L = [f"# Workflow run report: session `{r['session']}`", ""]
    L += ["| # | step | brief | hook chose | ran as | turns | fresh in | cache read | cache write | output | secs | status |",
          "|--|--|--|--|--|--|--|--|--|--|--|--|"]
    tot = {"in": 0, "cr": 0, "cw": 0, "out": 0}
    cost = 0.0
    for i, s in enumerate(r["steps"], 1):
        d = s["decision"]
        hook = (f"{d.get('tier', '-')}" + (f" ({d['top_prob']:.2f})" if d.get("top_prob") else "") + f" [{d.get('mode', '?')}]") if d else "no hook record"
        u = s["usage"]
        for k in tot:
            tot[k] += u[k]
        cost += units(u, s["actual_model"] or "")
        secs = f"{s['duration_ms'] / 1000:.0f}" if s["duration_ms"] else "-"
        L.append(f"| {i} | {s['agent']} | {s['brief'][:70].replace('|', '/').replace(chr(10), ' ')} | {hook} | {tier_of(s['actual_model'] or '')} "
                 f"| {s['turns']} | {fmt(u['in'])} | {fmt(u['cr'])} | {fmt(u['cw'])} | {fmt(u['out'])} | {secs} | {s['status']} |")
    m = r["main"]
    mu = m["usage"]
    mcost = sum(units({**mu}, k) * (v / max(1, sum(m['models'].values()))) for k, v in m["models"].items())
    L += ["", f"Main thread: {m['turns']} turns, models {m['models']}, fresh in {fmt(mu['in'])}, cache read {fmt(mu['cr'])}, "
              f"cache write {fmt(mu['cw'])}, output {fmt(mu['out'])}.",
          f"Subagents total: fresh in {fmt(tot['in'])}, cache read {fmt(tot['cr'])}, cache write {fmt(tot['cw'])}, output {fmt(tot['out'])}.",
          f"Cost units (ASSUMED price ratio haiku:sonnet:opus = 1:3:5, output 5x, cache read 0.1x, cache write 1.25x): "
          f"subagents {cost:,.0f}, main thread {mcost:,.0f}, total {cost + mcost:,.0f}.", ""]
    hooked = [s for s in r["steps"] if s["decision"].get("total_ms") is not None]
    if hooked:
        t = sorted(s["decision"]["total_ms"] for s in hooked)
        L.append(f"Hook time per subagent call: median {t[len(t) // 2]} ms, max {t[-1]} ms (n={len(t)}).")
    failed = [s for s in r["steps"] if s["decision"].get("error")]
    if failed:
        L.append(f"WARNING: {len(failed)} step(s) had NO Laya decision (hook error or timeout, so the step ran on the default model): "
                 + ", ".join(f"{s['agent']} ({s['decision']['error'][:40]})" for s in failed) + ". This run is not a valid Laya run.")
    mism = [s for s in r["steps"] if s["decision"].get("tier") and tier_of(s["actual_model"] or "") != s["decision"]["tier"]]
    if mism:
        L.append(f"WARNING: {len(mism)} step(s) ran on a different model than the hook chose: " + ", ".join(s["agent"] for s in mism))
    return "\n".join(L) + "\n"


def review_template(r: dict) -> str:
    L = [f"# Review of workflow run `{r['session']}`", "", "Fill in after reading each step's result and the final diff.", "",
         "Scale for the model: **enough** (a cheaper model would not have done it as well), **too much** (a cheaper model would have done it equally well), "
         "**too little** (the result was weak or wrong because the model was too small).", ""]
    for i, s in enumerate(r["steps"], 1):
        d = s["decision"]
        L += [f"## {i}. {s['agent']}: ran as {tier_of(s['actual_model'] or '')}" + (f", Laya said {d.get('laya_tier')} ({d.get('top_prob')})" if d.get("laya_tier") else ""),
              "", "Brief given:", "", "```", s["brief"][:1500], "```", "",
              "- Model verdict (enough / too much / too little): ", "- What would you have used, and why: ", "- Notes: ", ""]
    L += ["## Final result", "", "- Does the diff do what the task asked (yes / partly / no): ", "- Defects found: ", "- Would you merge it: ", ""]
    return "\n".join(L)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("session")
    ap.add_argument("--decisions", default=str(HERE / "hooks" / "step_decisions.jsonl"))
    ap.add_argument("--out")
    ap.add_argument("--review")
    a = ap.parse_args()
    data = collect(find_transcript(a.session), Path(a.decisions))
    text = render(data)
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text, encoding="utf-8")
    if a.review:
        Path(a.review).parent.mkdir(parents=True, exist_ok=True)
        Path(a.review).write_text(review_template(data), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(text)
