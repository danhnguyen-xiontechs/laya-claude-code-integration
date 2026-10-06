# audit_report.py - aggregates + summary.md / recommendations.md for audit.py. No LLM, no network.
import os, re, statistics
from collections import Counter, defaultdict
from datetime import datetime

DEAD_SCORE = 0.6          # rule_score at/above which a topic-switch candidate is treated as a switch (HEURISTIC)
TRUNC_KEEP_TOKENS = 4000  # tool-output gate ceiling: keep at most this many tokens per tool result (ASSUMPTION)
EFFORT_CUT = 0.30         # effort gate ceiling: 30% less output on the sessions' easy share (ASSUMPTION, see text)
REVIEW_RE = re.compile(r"review|verify|audit|check|qa\b|critic", re.I)


def write_reports(out, sessions, sess_rows, cost_rows, rebuild_rows, topic_rows, tool_rows, labels, pricing, h):
    pct, usd = h["pct"], h["usd"]
    normal = [s for s in sessions if s["category"] == "normal"]
    N = {s["sid"] for s in normal}
    nrows = [r for r in sess_rows if r["session"] in N]

    # ---------------- A/B tokens and cost
    T = Counter()
    for r in nrows:
        for k in ("input", "cache_read", "cache_creation", "output", "cc_5m", "cc_1h", "thinking_tokens_reported",
                  "requests_main", "requests_subagent", "requests_with_thinking_field", "human_prompts"):
            T[k] += r[k]
        for k in ("cost_input", "cost_cache_read", "cost_cache_write", "cost_output", "cost_total_usd", "cost_main", "cost_subagent"):
            T[k] += r[k]
    tok_total = T["input"] + T["cache_read"] + T["cache_creation"] + T["output"]
    C = T["cost_total_usd"]
    model_cost = Counter()
    for r in cost_rows:
        if r["session"] in N:
            model_cost[r["model"]] += r["cost_input"] + r["cost_cache_read"] + r["cost_cache_write"] + r["cost_output"]

    # ---------------- pricing validation against Claude Code's own cost-state (unit-price check)
    val = []
    for s in sessions:
        cs = s["main"]["meta"]["cost_state"]
        if not cs:
            continue
        for model, mu in (cs.get("modelUsage") or {}).items():
            p = pricing.get(model)
            base = (mu.get("inputTokens", 0) * p["input"] + mu.get("outputTokens", 0) * p["output"]
                    + mu.get("cacheReadInputTokens", 0) * p["cache_read"]) / 1e6
            cc = mu.get("cacheCreationInputTokens", 0)
            c5 = base + cc * p["cache_write_5m"] / 1e6
            c1 = base + cc * p["cache_write_1h"] / 1e6
            val.append((s["sid"][:8], model, mu.get("costUSD", 0), c5, c1))

    # ---------------- C cache rebuilds
    nreb = [r for r in rebuild_rows if r["session"] in N]
    by_cause = defaultdict(lambda: Counter())
    for r in nreb:
        b = by_cause[r["cause"]]
        b["n"] += 1
        b["cc"] += r["cache_creation"]
        b["cost"] += r["write_cost_usd"]
        b["excess"] += r["excess_vs_read_usd"]
    exp = [r for r in nreb if r["cause"] == "likely-expiry"]
    explicit_meta = sum(len(s["main"]["meta"]["explicit_cache_meta"]) for s in sessions)
    write_total = T["cost_cache_write"]

    # ---------------- D/F topic switches and dead context (main stream only)
    cands = [t for t in topic_rows if t["session"] in N]
    flagged = [t for t in cands if t["rule_score"] >= DEAD_SCORE]
    dead_cost, dead_tok_final, dead_examples = 0.0, 0, []
    for s in normal:
        fl = sorted([t for t in flagged if t["session"] == s["sid"]], key=lambda t: t["ts"])
        reqs = s["main"]["requests"]
        comp = s["main"]["meta"]["compact_ts"]
        sess_dead = 0.0
        last_dead = 0
        for r in reqs:
            if not r["ts"]:
                continue
            rt = datetime.fromtimestamp(r["ts"]).isoformat(timespec="seconds")
            dead = 0
            for t in fl:
                tsec = datetime.fromisoformat(t["ts"]).timestamp()
                if t["ts"] < rt and not any(c and tsec < c <= r["ts"] for c in comp):
                    dead = max(dead, t["context_before"])
            dead = min(dead, r["context"])
            sess_dead += dead * pricing.get(r["model"])["cache_read"] / 1e6
            last_dead = dead
        dead_cost += sess_dead
        if reqs:
            dead_tok_final += last_dead
            if last_dead:
                dead_examples.append((s["sid"][:8], reqs[-1]["context"], last_dead))
    labeled = [l for l in labels if l.get("session") in N]
    lab = Counter(l["label"].strip().upper() for l in labeled)
    lab_ceiling = sum(float(l.get("carried_cost_usd") or 0) for l in labeled if l["label"].strip().upper() == "NEW_TASK")
    # rule baseline quality on labeled data
    rule_eval = None
    if labeled:
        tp = sum(1 for l in labeled if l["label"].strip().upper() == "NEW_TASK" and float(l["rule_score"]) >= DEAD_SCORE)
        fp = sum(1 for l in labeled if l["label"].strip().upper() == "SAME_TASK" and float(l["rule_score"]) >= DEAD_SCORE)
        fn = sum(1 for l in labeled if l["label"].strip().upper() == "NEW_TASK" and float(l["rule_score"]) < DEAD_SCORE)
        rule_eval = (tp, fp, fn)

    # ---------------- E tool output
    ntool = [t for t in tool_rows if t["session"] in N]
    kinds = defaultdict(Counter)
    for t in ntool:
        k = kinds[t["kind"]]
        k["n"] += 1
        k["tok"] += t["est_tokens"]
        k["carry"] += t["est_carry_cost_usd"]
        k["big"] += 1 if t["est_tokens"] > TRUNC_KEEP_TOKENS else 0
        k["trunc_save"] += t["est_carry_cost_usd"] * max(0, t["est_tokens"] - TRUNC_KEEP_TOKENS) / max(1, t["est_tokens"])
    tool_tok = sum(k["tok"] for k in kinds.values())
    tool_carry = sum(k["carry"] for k in kinds.values())
    trunc_ceiling = sum(k["trunc_save"] for k in kinds.values())
    doc_carry = sum(k["carry"] for name, k in kinds.items() if name == "Read:doc")
    top_tools = sorted(ntool, key=lambda t: -t["est_tokens"])[:10]

    # ---------------- subagents / review
    sub_cost, review_cost, wf_cost = 0.0, 0.0, 0.0
    sub_types = Counter()
    for s in normal:
        for x in s["subs"]:
            c = sum(r["cost_total"] for r in x["requests"])
            sub_cost += c
            am = x.get("agent_meta") or {}
            desc = f'{am.get("agentType","")} {am.get("description","")}'
            sub_types[am.get("agentType") or ("workflow" if x["is_workflow"] else "?")] += c
            if REVIEW_RE.search(desc):
                review_cost += c
            if x["is_workflow"]:
                wf_cost += c

    # ---------------- effort / thinking
    out_cost = T["cost_output"]
    think_share = (T["thinking_tokens_reported"] / T["output"]) if T["output"] else 0
    effort_ceiling = out_cost * EFFORT_CUT * 0.5  # assume half of prompts are "easy" (ASSUMPTION)

    # ---------------- excluded/uncertain totals
    cat_tot = defaultdict(Counter)
    for r in sess_rows:
        c = cat_tot[r["category"].split(":")[0]]
        c["n"] += 1
        c["cost"] += r["cost_total_usd"]

    # =========================================================== summary.md
    L = []
    w = L.append
    w("# Phase 0 — Claude Code token audit: summary\n")
    w(f"Generated {datetime.now().isoformat(timespec='minutes')} by `audit/audit.py` (passive, no LLM calls). "
      "Source: `~/.claude/projects/**/*.jsonl` incl. subagent transcripts.\n")
    w("**Labels used below:** **[M]** measured from transcript `usage` fields · **[E]** estimated "
      f"(tool-result size = chars/{h['CHARS_PER_TOKEN']:.0f}) · **[H]** heuristic (rule-based, not ground truth) · "
      "**[A]** assumption.\n")
    w("Cost = **API-equivalent normalized cost** using `audit/pricing.json` (list prices). It is *not* Claude "
      "subscription/quota usage: quota is not exposed in transcripts and is not priced this way.\n")
    w("## Dataset\n")
    w("| Category | Sessions | API-equiv. cost |\n|---|---:|---:|")
    for k, c in sorted(cat_tot.items()):
        w(f"| {k} | {c['n']} | {usd(c['cost'])} |")
    w(f"\nPrimary aggregates use **normal** sessions only ({len(normal)} sessions, {T['human_prompts']} human prompts, "
      f"{T['requests_main']} main + {T['requests_subagent']} subagent API requests). Excluded = Laya research project "
      "(routing/workflow experiments, this audit). Uncertain = worktree copies, empty or prompt-less sessions. "
      "See `sessions.csv` `category`.\n")
    w("> Sample is small and dominated by a few long sessions. Treat shares as indicative, not population estimates.\n")

    w("## A. Where do the tokens go? [M]\n")
    w("| Component | Tokens | Share of tokens |\n|---|---:|---:|")
    for k, lbl in (("cache_read", "cache read"), ("cache_creation", "cache creation"), ("input", "uncached input"), ("output", "output (incl. thinking)")):
        w(f"| {lbl} | {T[k]:,} | {pct(T[k], tok_total)} |")
    w(f"\nCache writes by TTL: 5m {T['cc_5m']:,} · 1h {T['cc_1h']:,}.\n")

    w("## B. Where does the cost go? [M × A-pricing]\n")
    w("| Component | Cost | Share |\n|---|---:|---:|")
    for k, lbl in (("cost_cache_read", "cache read"), ("cost_cache_write", "cache write"), ("cost_input", "uncached input"), ("cost_output", "output")):
        w(f"| {lbl} | {usd(T[k])} | {pct(T[k], C)} |")
    w(f"| **total** | **{usd(C)}** | |")
    w(f"\nMain thread {usd(T['cost_main'])} ({pct(T['cost_main'], C)}) · subagents {usd(T['cost_subagent'])} ({pct(T['cost_subagent'], C)}).\n")
    w("By model: " + ", ".join(f"{m} {usd(v)} ({pct(v, C)})" for m, v in model_cost.most_common()) + "\n")
    w("**Pricing validation.** Claude Code writes a `cost-state` record with its own `costUSD` and token totals "
      "(for the *last process run* of a session only, so it cannot validate whole-session totals). Recomputing "
      "those token totals with `pricing.json`:\n")
    w("| Session | Model | Claude Code costUSD | ours, writes@5m | ours, writes@1h |\n|---|---|---:|---:|---:|")
    for v in val:
        w(f"| {v[0]} | {v[1]} | {v[2]:.4f} | {v[3]:.4f} | {v[4]:.4f} |")
    w("\nOne of the two columns should match Claude Code's figure (it depends on the TTL used). A match "
      "confirms the unit prices including the cache-write multiplier.\n")

    w("## C. Cache rebuilds / expiry\n")
    w(f"Explicit expiry metadata (`prompt_cache_likely_expired`, `seconds_since_last_response`, …) found in "
      f"transcripts: **{explicit_meta} records**. This Claude Code version does not persist it, so expiry is "
      f"inferred **[H]**: a request with cache_creation ≥ {h['BIG_CC']:,} tokens whose gap to the previous request "
      "exceeds the TTL actually used (1h if 1h writes were seen in the stream, else 5m; TTL is **[M]** from "
      "`cache_creation.ephemeral_*`).\n")
    w("| Cause [H] | Events | Tokens written | Write cost | Excess vs. reading from cache |\n|---|---:|---:|---:|---:|")
    for cause, b in sorted(by_cause.items(), key=lambda kv: -kv[1]["excess"]):
        w(f"| {cause} | {b['n']} | {b['cc']:,} | {usd(b['cost'])} | {usd(b['excess'])} |")
    if exp:
        ctx = [r["context"] for r in exp]
        gaps = [r["gap_s"] for r in exp if r["gap_s"] != ""]
        w(f"\nLikely expiry: {len(exp)} events; context at rebuild median {int(statistics.median(ctx)):,} "
          f"(max {max(ctx):,}); gap median {int(statistics.median(gaps))/60:.0f} min. Excess cost "
          f"{usd(by_cause['likely-expiry']['excess'])} = **{pct(by_cause['likely-expiry']['excess'], C)} of total cost**.\n")
    w(f"All cache writes cost {usd(write_total)} ({pct(write_total, C)}). 'growth' is normal append-only caching; "
      "only expiry / prefix-invalidated / model-switch writes are avoidable waste.\n")

    w("## D. Topic switching [H]\n")
    w(f"{len(cands)} prompts arrived when the main context was ≥ {h['TOPIC_MIN_CONTEXT']:,} tokens; "
      f"{len(flagged)} have rule_score ≥ {DEAD_SCORE} (low word overlap with the previous 3 prompts, long gap, or "
      "switch keywords). These are **candidates, not ground truth**. `topic-switches.csv` lists the top "
      f"{min(50, len(cands))} for human labeling.\n")
    if flagged:
        cb = [t["context_before"] for t in flagged]
        w(f"Flagged candidates: context before switch median {int(statistics.median(cb)):,}, max {max(cb):,}; "
          f"carried cache-read cost after them (upper bound if /clear had been used, ignores re-reading files): "
          f"{usd(sum(t['carried_cost_usd'] for t in flagged))} (overlapping, not additive across candidates in one session).\n")
    if labeled:
        src = Counter(l.get("label_source") or "human" for l in labeled)
        w(f"**Labels loaded** ({len(labeled)}, source: {dict(src)}): {dict(lab)}. Ceiling over NEW_TASK labels: {usd(lab_ceiling)} "
          f"({pct(lab_ceiling, C)}). Rule baseline at score ≥ {DEAD_SCORE}: TP {rule_eval[0]}, FP {rule_eval[1]}, FN {rule_eval[2]}.\n")
    else:
        w("No human labels yet (`audit/topic-labels.csv`). Topic numbers stay heuristic until labeled.\n")

    w("## E. Tool output [E]\n")
    w(f"Tool results total ≈ {tool_tok:,} tokens when first returned [E]. Each one is then re-sent on every later "
      f"request until compaction. Estimated carry cost ≈ {usd(tool_carry)} ({pct(tool_carry, C)} of total) [E].\n")
    w("| Kind | Events | Est. tokens | Share | >4k-token outputs | Est. carry cost |\n|---|---:|---:|---:|---:|---:|")
    for name, k in sorted(kinds.items(), key=lambda kv: -kv[1]["carry"])[:14]:
        w(f"| {name} | {k['n']} | {k['tok']:,} | {pct(k['tok'], tool_tok)} | {k['big']} | {usd(k['carry'])} |")
    w("\nLargest single outputs:\n")
    w("| Session | Kind | Est. tokens | Later requests | Input |\n|---|---|---:|---:|---|")
    for t in top_tools:
        hint = str(t["input"].get("command") or t["input"].get("file_path") or t["input"].get("pattern") or "")[:70].replace("|", "/")
        w(f"| {t['session'][:8]} | {t['kind']} | {t['est_tokens']:,} | {t['later_requests']} | `{hint}` |")
    w("")

    w("## F. Output / thinking [M]\n")
    w(f"Output tokens {T['output']:,} ({pct(T['output'], tok_total)} of tokens) but {usd(out_cost)} "
      f"(**{pct(out_cost, C)} of cost**). `usage.output_tokens_details.thinking_tokens` is present on "
      f"{T['requests_with_thinking_field']:,} of {T['requests_main'] + T['requests_subagent']:,} requests; where present, "
      f"thinking = {T['thinking_tokens_reported']:,} tokens ({pct(T['thinking_tokens_reported'], T['output'])} of all output). "
      "Thinking is included in output_tokens. Where the field is missing it cannot be separated.\n")

    w("## G. Dead context [H]\n")
    w(f"Definition: on each request, tokens carried from before the most recent flagged topic switch "
      f"(rule_score ≥ {DEAD_SCORE}, not followed by compaction) are counted as dead. Priced at cache-read rate.\n")
    w(f"Estimated dead-context cost: **{usd(dead_cost)} ({pct(dead_cost, C)} of total)** [H]. Example sessions "
      "(final context → estimated dead part):\n")
    for sid, fin, dead in sorted(dead_examples, key=lambda x: -x[2])[:6]:
        w(f"- {sid}: context {fin:,} → dead ≈ {dead:,} ({pct(dead, fin)})")
    w("\nThis is a rough opportunity size. It becomes a measured number only after labeling (section D).\n")

    # ---------------- opportunity table (shared with recommendations.md)
    opp = [
        ("Session continuity", dead_cost, "[H] dead-context cost after flagged switches",
         "Low (suggestion only)", "Low", "context-size + time-gap + word-overlap rule (already used here as candidate generator)",
         "Only if Laya beats the rule on labeled switches"),
        ("Effort / thinking", effort_ceiling, f"[A] {int(EFFORT_CUT*100)}% less output on half of requests",
         "Medium (quality on misjudged prompts)", "High (proxy; effort change may invalidate cache)",
         "prompt length / keyword rule", "Plausible but unproven; needs cache experiment first"),
        ("Review gate", review_cost, "[M] cost of subagents whose type/description matches review|verify|audit|check",
         "High (false negatives skip review)", "Medium", "diff size + risk-signal rule", "Low: deterministic signals carry most of the decision"),
        ("Tool output gate", trunc_ceiling, f"[E] carry cost of tool-output tokens beyond {TRUNC_KEEP_TOKENS:,}/result",
         "Medium (losing needed lines)", "High (hooks cannot rewrite built-in tool output)", "PreToolUse: add Read limit / Grep head_limit / pipe Bash to tail",
         "Low: size limits are the natural rule"),
        ("Documentation gate", doc_carry, "[E] carry cost of Read on .md/.txt files",
         "Low", "Low", "path allow-list", "Low"),
    ]
    non_laya = [
        ("Cache expiry (not a Laya decision)", by_cause["likely-expiry"]["excess"] + by_cause["prefix-invalidated"]["excess"],
         "[H] excess write cost of likely-expiry + prefix-invalidated rebuilds"),
        ("Subagent fan-out (not a Laya decision)", sub_cost, "[M] total subagent cost in normal sessions"),
    ]
    w("## H. Opportunity ceilings (upper bounds, not realized savings)\n")
    w("| Target | Ceiling | % of cost | Basis |\n|---|---:|---:|---|")
    for o in opp:
        w(f"| {o[0]} | {usd(o[1])} | {pct(o[1], C)} | {o[2]} |")
    for o in non_laya:
        w(f"| {o[0]} | {usd(o[1])} | {pct(o[1], C)} | {o[2]} |")
    w("\nSubagent cost by agent type: " + ", ".join(f"{k} {usd(v)}" for k, v in sub_types.most_common(6)) + "\n")
    w("Recommendation and reasoning: see `recommendations.md`.\n")
    open(os.path.join(out, "summary.md"), "w", encoding="utf-8").write("\n".join(L))

    # machine-readable numbers for recommendations.md (written by hand from these)
    import json
    json.dump({"total_cost": C, "opportunities": {o[0]: o[1] for o in opp}, "non_laya": {o[0]: o[1] for o in non_laya},
               "output_cost": out_cost, "think_share": think_share, "tool_carry": tool_carry, "dead_cost": dead_cost,
               "expiry_events": len(exp), "flagged_switches": len(flagged), "candidates": len(cands),
               "labels": dict(lab), "sub_cost": sub_cost, "review_cost": review_cost, "wf_cost": wf_cost},
              open(os.path.join(out, "aggregates.json"), "w"), indent=1)
