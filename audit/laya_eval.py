# laya_eval.py - offline: run local Laya on HUMAN-LABELED topic-switch candidates and compare with the rule baseline.
# Only run after audit/topic-labels.csv has labels (SAME_TASK / NEW_TASK / UNCLEAR). Calls only the local laya-serve.
# Run:  <laya tool python> laya_eval.py [--labels topic-labels.csv] [--url http://127.0.0.1:8000] [--threshold 0.5]
import argparse, csv, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
QUESTION = {"task": {
    "type": "choice",
    "instructions": "Is the new user prompt a continuation of the current work, or the start of a different task?",
    "criteria": {
        "same_task": "The new prompt continues, refines, fixes, tests, commits or asks about the same work as the previous prompts.",
        "new_task": "The new prompt starts unrelated work: a different feature, file area, project or question that does not need the earlier context.",
    },
}}
RULE_THRESHOLD = 0.6  # same as audit_report.DEAD_SCORE


def ask(url, prev, cur, ctx, model="english"):
    state = {"previous_prompts": prev[:1500], "new_prompt": cur[:1500], "context_tokens": str(ctx)}
    body = json.dumps({"state": state, "questions": QUESTION, "model": model, "max_len": 1024}).encode()
    req = urllib.request.Request(url.rstrip("/") + "/v1/systemone", body, {"content-type": "application/json"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as r:
        probs = json.load(r)["answers"]["task"]["probabilities"]
    return probs, time.perf_counter() - t0


def prf(pairs):
    tp = sum(1 for p, g in pairs if p and g)
    fp = sum(1 for p, g in pairs if p and not g)
    fn = sum(1 for p, g in pairs if not p and g)
    tn = sum(1 for p, g in pairs if not p and not g)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    return dict(tp=tp, fp=fp, fn=fn, tn=tn, precision=round(prec, 3), recall=round(rec, 3),
                accuracy=round((tp + tn) / max(1, len(pairs)), 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default=os.path.join(HERE, "topic-labels.csv"))
    ap.add_argument("--url", default=os.environ.get("LAYA_URL", "http://127.0.0.1:8000"))
    ap.add_argument("--model", default="english", help="laya checkpoint: english / multilingual")
    ap.add_argument("--threshold", type=float, default=0.5, help="P(new_task) cut-off; sweep it, do not assume 0.5")
    a = ap.parse_args()
    rows = [r for r in csv.DictReader(open(a.labels, encoding="utf-8-sig"))
            if (r.get("label") or "").strip().upper() in ("SAME_TASK", "NEW_TASK")]
    if not rows:
        sys.exit("no SAME_TASK/NEW_TASK labels in " + a.labels)
    out, lat = [], []
    for r in rows:
        probs, dt = ask(a.url, r["prev_prompt"], r["prompt"], r["context_before"], a.model)
        lat.append(dt)
        out.append({**r, "p_new_task": round(probs.get("new_task", 0.0), 4), "laya_s": round(dt, 3)})
    gold = [r["label"].strip().upper() == "NEW_TASK" for r in out]
    rule = prf(list(zip([float(r["rule_score"]) >= RULE_THRESHOLD for r in out], gold)))
    sweep = {t: prf(list(zip([r["p_new_task"] >= t for r in out], gold))) for t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)}
    with open(os.path.join(HERE, f"laya-eval-{a.model}.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    res = {"model": a.model, "n": len(out), "new_task": sum(gold), "rule_baseline": rule, "laya_by_threshold": sweep,
           "laya_latency_s": {"median": sorted(lat)[len(lat) // 2], "max": max(lat)}}
    json.dump(res, open(os.path.join(HERE, f"laya-eval-{a.model}.json"), "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
