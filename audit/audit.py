# audit.py - Phase 0: passive token-waste profiler for Claude Code transcripts.
# Read-only: only reads ~/.claude/projects/**.jsonl, writes CSV/MD into audit/. No LLM, no network.
# Run:  <python> audit.py [--projects-root DIR] [--pricing FILE] [--out DIR] [--include SUBSTR] [--labels FILE]
import argparse, csv, glob, json, math, os, re, statistics, sys
from collections import Counter, defaultdict
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CHARS_PER_TOKEN = 4.0       # ESTIMATE for tool-result / text sizes (transcripts do not store per-block tokens)
BIG_CC = 20_000             # cache_creation >= this counts as a "rebuild" event
TOPIC_MIN_CONTEXT = 30_000  # topic-switch candidates are only interesting when context is already large
MAX_TOPIC_CANDIDATES = 50

# ---------------------------------------------------------------- helpers

def ts(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def read_jsonl(path):
    bad = 0
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                bad += 1
    return out, bad


def est_tokens(n_chars):
    return int(math.ceil(n_chars / CHARS_PER_TOKEN))


def text_of(content):
    """Serialized text length of a message content (str or list of blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict):
                if b.get("type") == "text":
                    parts.append(b.get("text", ""))
                elif b.get("type") == "tool_result":
                    parts.append(text_of(b.get("content")))
                elif b.get("type") == "image":
                    parts.append("x" * 6000)  # ~1.5k tokens placeholder for an image
                else:
                    parts.append(json.dumps(b, ensure_ascii=False))
        return "\n".join(parts)
    return "" if content is None else str(content)


class Pricing:
    def __init__(self, path):
        d = json.load(open(path, encoding="utf-8"))
        self.models = d["models"]
        self.default = d.get("default")
        self.unknown = Counter()

    def get(self, model):
        best = None
        for k in self.models:
            if model and model.startswith(k) and (best is None or len(k) > len(best)):
                best = k
        if best is None:
            self.unknown[model] += 1
            best = self.default
        return self.models[best]

    def cost(self, model, u):
        p = self.get(model)
        M = 1e6
        return {
            "input": u["input"] * p["input"] / M,
            "cache_read": u["cache_read"] * p["cache_read"] / M,
            "cache_write": (u["cc_5m"] * p["cache_write_5m"] + u["cc_1h"] * p["cache_write_1h"]) / M,
            "output": u["output"] * p["output"] / M,
        }

# ---------------------------------------------------------------- parsing

PROMPT_NOISE = re.compile(r"^\s*(<command-|<local-command|<system-reminder>|<task-notification|Caveat:|\[Request interrupted)", re.I)
TEST_RE = re.compile(r"\b(pytest|jest|vitest|mocha|dotnet test|go test|npm (run )?test|cargo test|phpunit|unittest)\b", re.I)
LOG_RE = re.compile(r"\b(logs?|tail|journalctl|docker logs|kubectl logs|Get-Content .*\.log)\b", re.I)


def parse_file(path, pricing):
    """Return one logical stream (main session or one subagent): requests, prompts, tool results, metadata."""
    rows, bad = read_jsonl(path)
    reqs = {}          # message.id -> request (dedupe: one API response spans several JSONL lines)
    order = []
    tool_names = {}    # tool_use_id -> (name, input)
    prompts = []
    tool_results = []
    meta = {"bad_lines": bad, "lines": len(rows), "entrypoints": Counter(), "cost_state": None,
            "compact_ts": [], "explicit_cache_meta": [], "first_ts": None, "last_ts": None,
            "cwd": None, "dup_lines": 0}
    for d in rows:
        t = d.get("type")
        tt = ts(d.get("timestamp", "")) if d.get("timestamp") else None
        if tt:
            meta["first_ts"] = tt if meta["first_ts"] is None else min(meta["first_ts"], tt)
            meta["last_ts"] = tt if meta["last_ts"] is None else max(meta["last_ts"], tt)
        if d.get("entrypoint"):
            meta["entrypoints"][d["entrypoint"]] += 1
        if d.get("cwd") and not meta["cwd"]:
            meta["cwd"] = d["cwd"]
        if t == "cost-state":
            meta["cost_state"] = d
        # Explicit cache-expiry metadata, if this Claude Code version writes it anywhere.
        if t not in ("user", "assistant", "queue-operation", "last-prompt"):
            s = json.dumps(d)
            if "prompt_cache_likely_expired" in s or "seconds_since_last_response" in s:
                meta["explicit_cache_meta"].append(d)
        if t == "system" and d.get("subtype") == "compact_boundary":
            meta["compact_ts"].append(tt)
        if t == "assistant":
            m = d.get("message") or {}
            mid = m.get("id") or d.get("requestId") or d.get("uuid")
            model = m.get("model") or "?"
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tool_names[b.get("id")] = (b.get("name", "?"), b.get("input") or {})
            if model == "<synthetic>":
                continue
            u = m.get("usage") or {}
            if mid in reqs:
                meta["dup_lines"] += 1
                # lines of one response carry identical usage (verified); keep the max to be safe
                r = reqs[mid]
                r["output"] = max(r["output"], u.get("output_tokens") or 0)
                continue
            cc = u.get("cache_creation") or {}
            cc_total = u.get("cache_creation_input_tokens") or 0
            cc5 = cc.get("ephemeral_5m_input_tokens")
            cc1 = cc.get("ephemeral_1h_input_tokens")
            if cc5 is None and cc1 is None:
                cc5, cc1 = cc_total, 0   # older records: assume 5m TTL
            det = u.get("output_tokens_details") or {}
            r = {"id": mid, "ts": tt, "model": model, "input": u.get("input_tokens") or 0,
                 "cache_read": u.get("cache_read_input_tokens") or 0, "cc": cc_total,
                 "cc_5m": cc5 or 0, "cc_1h": cc1 or 0, "output": u.get("output_tokens") or 0,
                 "thinking": det.get("thinking_tokens"), "effort": d.get("effort")}
            reqs[mid] = r
            order.append(mid)
        elif t == "user":
            m = d.get("message") or {}
            c = m.get("content")
            blocks = c if isinstance(c, list) else []
            trs = [b for b in blocks if isinstance(b, dict) and b.get("type") == "tool_result"]
            if trs:
                for b in trs:
                    name, inp = tool_names.get(b.get("tool_use_id"), ("?", {}))
                    body = text_of(b.get("content"))
                    tool_results.append({"ts": tt, "tool": name, "input": inp, "chars": len(body),
                                         "is_error": bool(b.get("is_error")), "preview": body[:120]})
            elif not d.get("isMeta") and not d.get("isSidechain"):
                txt = text_of(c).strip()
                if txt and not PROMPT_NOISE.match(txt):
                    prompts.append({"ts": tt, "text": txt})
    reqs_list = [reqs[i] for i in order]
    reqs_list.sort(key=lambda r: r["ts"] or 0)
    for r in reqs_list:
        r["context"] = r["input"] + r["cache_read"] + r["cc"]
        r["cost"] = pricing.cost(r["model"], r)
        r["cost_total"] = sum(r["cost"].values())
    return {"path": path, "requests": reqs_list, "prompts": prompts, "tool_results": tool_results, "meta": meta}


def classify_tool(name, inp):
    if name == "Bash" or name == "PowerShell":
        cmd = str(inp.get("command", ""))
        if TEST_RE.search(cmd):
            return name + ":test"
        if LOG_RE.search(cmd):
            return name + ":log"
        if re.search(r"\b(git (diff|log|show))\b", cmd):
            return name + ":git"
        if re.search(r"\b(grep|rg|find|Select-String|Get-ChildItem|ls)\b", cmd):
            return name + ":search"
        return name + ":other"
    if name == "Read":
        p = str(inp.get("file_path", ""))
        return "Read:doc" if re.search(r"\.(md|txt|rst)$", p, re.I) else "Read:code"
    if name.startswith("mcp__"):
        return "mcp:" + name.split("__")[1][:20]
    return name


# ---------------------------------------------------------------- session discovery / classification

EXPERIMENT_KW = re.compile(r"(\blaya\b|routing|router_proxy|/wf\b|wf-(explore|plan|implement|verify|review)|benchmark|\bPXP\b|run_task\.py|step workflow|subagent model)", re.I)


def classify_session(project, main, subs):
    """normal | excluded:<reason> | uncertain:<reason>. Never silently drops a session."""
    if project.endswith("-Laya"):
        return "excluded:laya-research-project"
    first = " ".join(p["text"][:500] for p in main["prompts"][:3])
    if EXPERIMENT_KW.search(first):
        return "excluded:experiment-keywords"
    if "claude-worktrees" in project or project.endswith("wt-static"):
        return "uncertain:worktree-or-bench-copy"
    if project.startswith("D--XionTechs-test-"):
        return "uncertain:test-project"
    if not main["prompts"] and not main["requests"]:
        return "uncertain:empty"
    if not main["prompts"]:
        return "uncertain:no-human-prompts"
    return "normal"


def discover(root, include):
    sessions = []
    for proj in sorted(os.listdir(root)):
        pdir = os.path.join(root, proj)
        if not os.path.isdir(pdir):
            continue
        for f in sorted(glob.glob(os.path.join(pdir, "*.jsonl"))):
            sid = os.path.splitext(os.path.basename(f))[0]
            if include and include not in sid and include not in proj:
                continue
            subs = sorted(glob.glob(os.path.join(pdir, sid, "subagents", "**", "agent-*.jsonl"), recursive=True))
            sessions.append((proj, sid, f, subs))
    return sessions


# ---------------------------------------------------------------- analyses

def words(s):
    s = re.sub(r"<[^>]+>", " ", s.lower())
    return {w for w in re.findall(r"[a-zà-ỹ0-9_./-]{3,}", s) if w not in STOP}

STOP = set("the and for that this with you can are not but from have will what when please then into also just của và cho với các một này những được không là có để trong như thì đã đó lại khi".split())
SWITCH_KW = re.compile(r"(\bnew task\b|\banother\b|\bunrelated\b|\bswitch to\b|\bnow (let'?s|i want)|việc khác|task mới|chuyển sang|bây giờ|tiếp theo|làm cái khác)", re.I)


def context_at(reqs, t):
    """Context size of the last request before time t, and index of first request at/after t."""
    prev, idx = None, len(reqs)
    for i, r in enumerate(reqs):
        if (r["ts"] or 0) < t:
            prev = r
        else:
            idx = i
            break
    return (prev["context"] if prev else 0), idx


def next_boundary(t, compacts, end_ts):
    after = [c for c in compacts if c and c > t]
    return min(after) if after else end_ts


def topic_candidates(sess, pricing):
    """Rule-based candidate list (NOT ground truth): low lexical overlap with recent prompts, long gap, or switch keywords."""
    main = sess["main"]
    reqs = main["requests"]
    out = []
    P = main["prompts"]
    for i in range(1, len(P)):
        p = P[i]
        if p["ts"] is None:
            continue
        ctx, idx = context_at(reqs, p["ts"])
        if ctx < TOPIC_MIN_CONTEXT:
            continue
        recent = set().union(*[words(q["text"]) for q in P[max(0, i - 3):i]])
        cur = words(p["text"])
        jac = len(cur & recent) / max(1, len(cur | recent)) if cur else 1.0
        if len(cur) < 5:  # short follow-ups ("tiếp tục đi", "commit đi") have no overlap but rarely start a task
            jac = max(jac, 0.6)
        gap = (p["ts"] - (P[i - 1]["ts"] or p["ts"])) / 60.0
        kw = bool(SWITCH_KW.search(p["text"][:400]))
        score = (1 - jac) * 0.6 + min(gap, 120) / 120 * 0.2 + (0.2 if kw else 0)
        end = next_boundary(p["ts"], main["meta"]["compact_ts"], float("inf"))
        after = [r for r in reqs[idx:] if (r["ts"] or 0) < end]
        # carried-context cost ceiling: if the user had /clear'ed here, the `ctx` tokens would not be re-read
        # on every later request. Priced at each request's cache-read rate (upper bound, ignores re-reading files).
        carried = sum(min(ctx, r["context"]) * pricing.get(r["model"])["cache_read"] / 1e6 for r in after)
        out.append({"session": sess["sid"], "project": sess["project"], "prompt_idx": i,
                     "ts": datetime.fromtimestamp(p["ts"]).isoformat(timespec="seconds"),
                     "gap_min": round(gap, 1), "jaccard_recent": round(jac, 3), "switch_keyword": kw,
                     "rule_score": round(score, 3), "context_before": ctx, "requests_after": len(after),
                     "carried_cache_read_tokens": sum(min(ctx, r["context"]) for r in after),
                     "carried_cost_usd": round(carried, 4),
                     "prev_prompt": P[i - 1]["text"][:300].replace("\n", " "),
                     "prompt": p["text"][:300].replace("\n", " "), "label": ""})
    return out


def cache_rebuilds(sess, stream, pricing, who):
    """Requests with a big cache_creation. Classify the likely cause from measured gaps + TTL of earlier writes."""
    reqs = stream["requests"]
    out = []
    ttl_1h_seen = False
    for i, r in enumerate(reqs):
        prev = reqs[i - 1] if i else None
        if r["cc_1h"]:
            pass
        if r["cc"] >= BIG_CC:
            gap = (r["ts"] - prev["ts"]) if prev and r["ts"] and prev["ts"] else None
            ttl = 3600 if (prev and (prev["cc_1h"] > 0 or ttl_1h_seen)) else 300
            if prev is None:
                cause = "session-start"
            elif any(c and prev["ts"] < c <= r["ts"] for c in stream["meta"]["compact_ts"]):
                cause = "compaction"
            elif prev["model"] != r["model"]:
                cause = "model-switch"
            elif gap is not None and gap > ttl:
                cause = "likely-expiry"
            elif r["cc"] > 0.5 * r["context"] and prev and r["cache_read"] < 0.5 * prev["context"]:
                cause = "prefix-invalidated"   # cache existed but was not reused (effort/tool/system change, etc.)
            else:
                cause = "growth"               # normal: new turn content appended
            p = pricing.get(r["model"])
            write_cost = r["cost"]["cache_write"]
            # excess = what this write cost minus reading the same tokens from cache instead
            excess = write_cost - r["cc"] * p["cache_read"] / 1e6
            out.append({"session": sess["sid"], "project": sess["project"], "stream": who,
                        "ts": datetime.fromtimestamp(r["ts"]).isoformat(timespec="seconds") if r["ts"] else "",
                        "model": r["model"], "gap_s": round(gap) if gap is not None else "",
                        "ttl_assumed_s": ttl, "cause": cause, "context": r["context"],
                        "cache_creation": r["cc"], "cache_read": r["cache_read"],
                        "write_cost_usd": round(write_cost, 4),
                        "excess_vs_read_usd": round(excess, 4), "explicit_metadata": "none"})
        if r["cc_1h"]:
            ttl_1h_seen = True
    return out


def tool_carry(stream, pricing):
    """Each tool result stays in context for every later request (until compaction). Estimated tokens x later requests."""
    reqs = stream["requests"]
    rows = []
    end_ts = float("inf")
    for tr in stream["tool_results"]:
        if tr["ts"] is None:
            continue
        end = next_boundary(tr["ts"], stream["meta"]["compact_ts"], end_ts)
        later = [r for r in reqs if (r["ts"] or 0) > tr["ts"] and (r["ts"] or 0) < end]
        tok = est_tokens(tr["chars"])
        # first later request writes it to cache, the rest read it
        carry_cost = 0.0
        for k, r in enumerate(later):
            p = pricing.get(r["model"])
            carry_cost += tok * (p["cache_read"] if k else (p["cache_write_1h"] if r["cc_1h"] else p["cache_write_5m"])) / 1e6
        rows.append({**tr, "kind": classify_tool(tr["tool"], tr["input"]), "est_tokens": tok,
                     "later_requests": len(later), "carried_token_requests": tok * len(later),
                     "est_carry_cost_usd": carry_cost})
    return rows


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--projects-root", default=os.path.expanduser("~/.claude/projects"))
    ap.add_argument("--pricing", default=os.path.join(HERE, "pricing.json"))
    ap.add_argument("--out", default=HERE)
    ap.add_argument("--include", default=None, help="only sessions whose id or project dir contains this")
    ap.add_argument("--labels", default=os.path.join(HERE, "topic-labels.csv"),
                    help="human-labeled copy of topic-switches.csv (label column: SAME_TASK/NEW_TASK/UNCLEAR)")
    a = ap.parse_args()
    pricing = Pricing(a.pricing)
    os.makedirs(a.out, exist_ok=True)

    sessions = []
    for proj, sid, f, subs in discover(a.projects_root, a.include):
        main_s = parse_file(f, pricing)
        sub_s = []
        for sp in subs:
            s = parse_file(sp, pricing)
            mp = sp[:-6] + ".meta.json"
            s["agent_meta"] = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {}
            s["is_workflow"] = (os.sep + "workflows" + os.sep) in sp or "/workflows/" in sp
            sub_s.append(s)
        # sanity: main and subagent files must not share message ids (else we would double count)
        main_ids = {r["id"] for r in main_s["requests"]}
        overlap = sum(1 for s in sub_s for r in s["requests"] if r["id"] in main_ids)
        sess = {"project": proj, "sid": sid, "main": main_s, "subs": sub_s, "id_overlap": overlap}
        sess["category"] = classify_session(proj, main_s, sub_s)
        sessions.append(sess)

    # ---- per-session rows + cost breakdown
    sess_rows, cost_rows, rebuild_rows, topic_rows, tool_rows = [], [], [], [], []
    for s in sessions:
        streams = [("main", s["main"])] + [("sub:" + os.path.basename(x["path"])[6:-6], x) for x in s["subs"]]
        tot = Counter()
        by_model = defaultdict(Counter)
        for who, st in streams:
            for r in st["requests"]:
                part = "main" if who == "main" else "subagent"
                for k in ("input", "cache_read", "cc", "cc_5m", "cc_1h", "output"):
                    tot[k] += r[k]
                    by_model[(r["model"], part)][k] += r[k]
                tot["thinking"] += r["thinking"] or 0
                tot["thinking_reported_reqs"] += 1 if r["thinking"] is not None else 0
                tot["requests"] += 1
                tot["req_" + part] += 1
                for ck, cv in r["cost"].items():
                    tot["cost_" + ck] += cv
                    by_model[(r["model"], part)]["cost_" + ck] += cv
                    tot["cost_" + part] += cv
            rebuild_rows += cache_rebuilds(s, st, pricing, who)
            for tr in tool_carry(st, pricing):
                tr.update(session=s["sid"], project=s["project"], stream=who, category=s["category"])
                tool_rows.append(tr)
        m = s["main"]
        reqs = m["requests"]
        ctxs = [r["context"] for r in reqs]
        cs = m["meta"]["cost_state"]
        cost_total = sum(tot[k] for k in ("cost_input", "cost_cache_read", "cost_cache_write", "cost_output"))
        dur = ((m["meta"]["last_ts"] or 0) - (m["meta"]["first_ts"] or 0)) / 60.0
        sess_rows.append({
            "session": s["sid"], "project": s["project"], "category": s["category"],
            "start": datetime.fromtimestamp(m["meta"]["first_ts"]).isoformat(timespec="minutes") if m["meta"]["first_ts"] else "",
            "duration_min": round(dur, 1), "human_prompts": len(m["prompts"]),
            "requests_main": tot["req_main"], "requests_subagent": tot["req_subagent"], "subagents": len(s["subs"]),
            "input": tot["input"], "cache_read": tot["cache_read"], "cache_creation": tot["cc"],
            "cc_5m": tot["cc_5m"], "cc_1h": tot["cc_1h"], "output": tot["output"],
            "thinking_tokens_reported": tot["thinking"], "requests_with_thinking_field": tot["thinking_reported_reqs"],
            "context_max": max(ctxs) if ctxs else 0, "context_median": int(statistics.median(ctxs)) if ctxs else 0,
            "context_final": ctxs[-1] if ctxs else 0, "compactions": len(m["meta"]["compact_ts"]),
            "cost_input": round(tot["cost_input"], 4), "cost_cache_read": round(tot["cost_cache_read"], 4),
            "cost_cache_write": round(tot["cost_cache_write"], 4), "cost_output": round(tot["cost_output"], 4),
            "cost_total_usd": round(cost_total, 4), "cost_main": round(tot["cost_main"], 4),
            "cost_subagent": round(tot["cost_subagent"], 4),
            "claude_code_cost_state_usd": round(cs["totalCostUSD"], 4) if cs else "",
            "dup_assistant_lines_merged": m["meta"]["dup_lines"] + sum(x["meta"]["dup_lines"] for x in s["subs"]),
            "bad_lines": m["meta"]["bad_lines"], "main_sub_id_overlap": s["id_overlap"],
            "first_prompt": (m["prompts"][0]["text"][:160].replace("\n", " ") if m["prompts"] else ""),
        })
        for (model, part), c in by_model.items():
            cost_rows.append({"session": s["sid"], "project": s["project"], "category": s["category"],
                              "model": model, "part": part, "input": c["input"], "cache_read": c["cache_read"],
                              "cache_creation_5m": c["cc_5m"], "cache_creation_1h": c["cc_1h"], "output": c["output"],
                              "cost_input": round(c["cost_input"], 4), "cost_cache_read": round(c["cost_cache_read"], 4),
                              "cost_cache_write": round(c["cost_cache_write"], 4), "cost_output": round(c["cost_output"], 4)})
        if s["category"] == "normal":
            topic_rows += topic_candidates(s, pricing)
        s["row"] = sess_rows[-1]

    for r in rebuild_rows:
        r["category"] = next(x["category"] for x in sessions if x["sid"] == r["session"])

    # ---- write CSVs
    def wcsv(name, rows, cols=None):
        path = os.path.join(a.out, name)
        cols = cols or (list(rows[0].keys()) if rows else ["empty"])
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)

    wcsv("sessions.csv", sess_rows)
    wcsv("cost-breakdown.csv", cost_rows)
    wcsv("cache-expiry.csv", rebuild_rows)
    topic_rows.sort(key=lambda r: (-r["rule_score"] * math.log10(1 + r["context_before"])))
    wcsv("topic-switches.csv", topic_rows[:MAX_TOPIC_CANDIDATES])
    tool_rows_sorted = sorted(tool_rows, key=lambda r: -r["est_tokens"])
    wcsv("tool-output.csv", [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k not in ("input",)}
                             | {"input_hint": json.dumps(r["input"], ensure_ascii=False)[:160]}
                             for r in tool_rows_sorted[:500]],
         ["session", "project", "category", "stream", "kind", "tool", "est_tokens", "chars", "later_requests",
          "carried_token_requests", "est_carry_cost_usd", "is_error", "input_hint", "preview"])

    labels = load_labels(a.labels)
    report(a.out, sessions, sess_rows, cost_rows, rebuild_rows, topic_rows, tool_rows, labels, pricing)
    print(f"sessions={len(sessions)} normal={sum(1 for s in sessions if s['category']=='normal')} -> {a.out}")


def load_labels(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if (r.get("label") or "").strip()]


# ---------------------------------------------------------------- report

def pct(a, b):
    return f"{100 * a / b:.1f}%" if b else "n/a"


def usd(x):
    return f"${x:,.2f}"


def report(out, sessions, sess_rows, cost_rows, rebuild_rows, topic_rows, tool_rows, labels, pricing):
    from audit_report import write_reports
    write_reports(out, sessions, sess_rows, cost_rows, rebuild_rows, topic_rows, tool_rows, labels, pricing,
                  dict(pct=pct, usd=usd, CHARS_PER_TOKEN=CHARS_PER_TOKEN, BIG_CC=BIG_CC,
                       TOPIC_MIN_CONTEXT=TOPIC_MIN_CONTEXT))


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    main()
