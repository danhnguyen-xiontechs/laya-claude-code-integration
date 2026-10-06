# test_cache_expiry_gate.py - black-box tests for hooks/cache_expiry_gate.py (UserPromptSubmit hook).
# The hook runs as a subprocess with realistic stdin JSON, exactly as Claude Code calls it.
# Isolation: the hook is copied into a temp dir (so its decision log lands there, not in hooks/), and
# TMP/TEMP point to that dir (so block-once state files are isolated). Everything is removed afterwards.
# Run:  <python> hooks/tests/test_cache_expiry_gate.py          (writes hooks/tests/results.json)
import glob, json, os, shutil, statistics, subprocess, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.normpath(os.path.join(HERE, "..", "cache_expiry_gate.py"))
PRICING = os.path.normpath(os.path.join(HERE, "..", "..", "audit", "pricing.json"))
sys.path.insert(0, os.path.join(HERE, "fixtures"))
import build as fx  # noqa: E402

LAT = []      # (tag, seconds)
RESULTS = []  # (test, expected, actual)


class Env:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="cegate_")
        self.hook = os.path.join(self.dir, "cache_expiry_gate.py")
        shutil.copy(HOOK, self.hook)
        self.log = os.path.join(self.dir, "cache_expiry_gate.log.jsonl")
        self.n = 0

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def transcript(self, records, raw_lines=()):
        self.n += 1
        return fx.write(os.path.join(self.dir, f"t{self.n}.jsonl"), records, raw_lines)

    def run(self, stdin, tag, **env):
        e = {**os.environ, "TMP": self.dir, "TEMP": self.dir, "CACHE_GATE_PRICING": PRICING}
        for k in ("CACHE_GATE_MODE", "CACHE_GATE_MIN_CONTEXT", "CACHE_GATE_CONFIRM_S"):
            e.pop(k, None)
        e.update({k: str(v) for k, v in env.items()})
        data = stdin if isinstance(stdin, str) else json.dumps(stdin)
        t0 = time.perf_counter()
        p = subprocess.run([sys.executable, self.hook], input=data, capture_output=True, text=True, env=e, timeout=30)
        LAT.append((tag, time.perf_counter() - t0))
        out = json.loads(p.stdout) if p.stdout.strip() else None
        return p, out

    def log_entries(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as f:
            return [json.loads(x) for x in f if x.strip()]


def prompt(path, text="continue please", sid="s1"):
    return {"session_id": sid, "transcript_path": path, "cwd": "D:/x", "hook_event_name": "UserPromptSubmit",
            "permission_mode": "default", "prompt": text}


def decision(p, out):
    if p.returncode == 2:
        return "BLOCK"
    if out and out.get("decision") == "block":
        return "BLOCK"
    if out and out.get("systemMessage"):
        return "WARN"
    return "ALLOW"


class Base(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.now = time.time()

    def tearDown(self):
        self.env.close()

    def check(self, name, expected, p, out):
        actual = decision(p, out)
        RESULTS.append({"test": name, "expected": expected, "actual": actual, "rc": p.returncode,
                        "stderr": p.stderr.strip()[:200]})
        self.assertEqual(p.returncode, 0, p.stderr)  # never crash / never exit 2
        self.assertEqual(actual, expected)
        return actual

    def big_expired(self, ttl="1h", ctx=200_000):
        age = 2 * 3600 if ttl == "1h" else 10 * 60
        return self.env.transcript([fx.user(age + 30, self.now), fx.assistant(age, self.now, ctx, ttl=ttl)])


class CoreCases(Base):
    def test_A_large_context_expired_blocks(self):
        t = self.big_expired()
        p, out = self.env.run(prompt(t), "blocked")
        self.check("A large ctx + expired (1h TTL) -> BLOCK", "BLOCK", p, out)
        r = out["reason"]
        for s in ("Cache expired", "idle", "TTL 60 min", "200k", "$", "/clear", "/compact", "again within 10 min"):
            self.assertIn(s, r)
        logs = self.env.log_entries()
        self.assertEqual(logs[-1]["action"], "blocked")
        self.assertEqual(logs[-1]["ttl_s"], 3600)
        self.assertEqual(logs[-1]["context"], 200_000)
        # 200k * ($8 1h write - $0.20 read) / 1M for claude-opus-5-5
        self.assertAlmostEqual(logs[-1]["est_extra_usd"], 1.56, places=2)

    def test_B_retry_same_prompt_allows(self):
        t = self.big_expired()
        p1, o1 = self.env.run(prompt(t), "blocked")
        p2, o2 = self.env.run(prompt(t), "allowed-retry")
        self.check("B first attempt -> BLOCK", "BLOCK", p1, o1)
        self.check("B same prompt again within window -> ALLOW", "ALLOW", p2, o2)
        self.assertEqual([x["action"] for x in self.env.log_entries()], ["blocked", "allowed-after-confirm"])

    def test_C_different_prompt_after_block(self):
        # Design: confirmation is per session + last-request timestamp, NOT per prompt text.
        # Any prompt in the window counts as "I saw the warning, continue".
        t = self.big_expired()
        self.env.run(prompt(t, "continue please"), "blocked")
        p, out = self.env.run(prompt(t, "something completely different"), "allowed-retry")
        self.check("C different prompt within window -> ALLOW (confirmation is per session)", "ALLOW", p, out)

    def test_C2_retry_after_window_blocks_again(self):
        t = self.big_expired()
        self.env.run(prompt(t), "blocked", CACHE_GATE_CONFIRM_S=1)
        time.sleep(1.2)
        p, out = self.env.run(prompt(t), "blocked", CACHE_GATE_CONFIRM_S=1)
        self.check("C2 retry after confirm window expired -> BLOCK again", "BLOCK", p, out)

    def test_C3_state_is_per_session(self):
        t = self.big_expired()
        self.env.run(prompt(t, sid="sA"), "blocked")
        p, out = self.env.run(prompt(t, sid="sB"), "blocked")
        self.check("C3 confirmation in session A does not unlock session B -> BLOCK", "BLOCK", p, out)

    def test_C4_block_once_full_flow(self):
        # old session -> BLOCK -> retry ALLOW -> Claude answers (new request appended) -> next prompt ALLOW
        t = self.big_expired()
        p1, o1 = self.env.run(prompt(t), "blocked")
        p2, o2 = self.env.run(prompt(t), "allowed-retry")
        with open(t, "a", encoding="utf-8") as f:
            f.write(json.dumps(fx.assistant(1, time.time(), 210_000)) + "\n")
        p3, o3 = self.env.run(prompt(t, "next question"), "normal")
        self.check("C4 flow: block", "BLOCK", p1, o1)
        self.check("C4 flow: retry", "ALLOW", p2, o2)
        self.check("C4 flow: next prompt after Claude answered -> ALLOW", "ALLOW", p3, o3)
        self.assertFalse(glob.glob(os.path.join(self.env.dir, "cache_expiry_gate_*.json")), "state file left behind")

    def test_D_below_threshold_allows(self):
        t = self.big_expired(ctx=50_000)
        p, out = self.env.run(prompt(t), "normal")
        self.check("D ctx 50k + expired -> ALLOW", "ALLOW", p, out)

    def test_D2_threshold_is_configurable(self):
        t = self.big_expired(ctx=50_000)
        p, out = self.env.run(prompt(t), "blocked", CACHE_GATE_MIN_CONTEXT=40_000)
        self.check("D2 ctx 50k with MIN_CONTEXT=40000 -> BLOCK", "BLOCK", p, out)

    def test_E_idle_shorter_than_ttl_allows(self):
        t = self.env.transcript([fx.assistant(30 * 60, self.now, 200_000, ttl="1h")])
        p, out = self.env.run(prompt(t), "normal")
        self.check("E ctx 200k, idle 30 min < 1h TTL -> ALLOW", "ALLOW", p, out)

    def test_F_slash_commands_ignored(self):
        t = self.big_expired()
        for cmd in ("/compact", "/clear", "  /compact keep the plan"):
            p, out = self.env.run(prompt(t, cmd), "normal")
            self.check(f"F slash command {cmd.strip()!r} -> ALLOW", "ALLOW", p, out)
        self.assertEqual(self.env.log_entries(), [])

    def test_I_warn_mode(self):
        t = self.big_expired()
        p, out = self.env.run(prompt(t), "blocked", CACHE_GATE_MODE="warn")
        self.check("I warn mode -> WARN (systemMessage, not blocked)", "WARN", p, out)
        self.assertNotIn("decision", out)
        self.assertEqual(self.env.log_entries()[-1]["action"], "warned")

    def test_J_off_mode(self):
        t = self.big_expired()
        p, out = self.env.run(prompt(t), "normal", CACHE_GATE_MODE="off")
        self.check("J off mode -> ALLOW, no log", "ALLOW", p, out)
        self.assertEqual(self.env.log_entries(), [])


class TTLCases(Base):
    def test_ttl_5m_expired(self):
        t = self.env.transcript([fx.assistant(10 * 60, self.now, 200_000, ttl="5m")])
        p, out = self.env.run(prompt(t), "blocked")
        self.check("TTL 5m writes, idle 10 min -> BLOCK", "BLOCK", p, out)
        self.assertEqual(self.env.log_entries()[-1]["ttl_s"], 300)
        self.assertIn("TTL 5 min", out["reason"])

    def test_ttl_5m_fresh(self):
        t = self.env.transcript([fx.assistant(2 * 60, self.now, 200_000, ttl="5m")])
        p, out = self.env.run(prompt(t), "normal")
        self.check("TTL 5m writes, idle 2 min -> ALLOW", "ALLOW", p, out)

    def test_ttl_1h_not_expired_at_10min(self):
        t = self.env.transcript([fx.assistant(10 * 60, self.now, 200_000, ttl="1h")])
        p, out = self.env.run(prompt(t), "normal")
        self.check("TTL 1h writes, idle 10 min -> ALLOW", "ALLOW", p, out)

    def test_ttl_1h_seen_earlier_last_request_read_only(self):
        # last request only read cache (no writes); an earlier request wrote 1h -> TTL stays 1h
        t = self.env.transcript([fx.assistant(40 * 60, self.now, 180_000, ttl="1h"),
                                 fx.assistant(10 * 60, self.now, 200_000, ttl="1h", write=0)])
        p, out = self.env.run(prompt(t), "normal")
        self.check("1h write earlier, last request read-only, idle 10 min -> ALLOW", "ALLOW", p, out)

    def test_sidechain_ignored(self):
        # a recent subagent (sidechain) request must not reset the main-thread idle clock
        t = self.env.transcript([fx.assistant(2 * 3600, self.now, 200_000),
                                 fx.assistant(60, self.now, 30_000, sidechain=True)])
        p, out = self.env.run(prompt(t), "blocked")
        self.check("recent sidechain request ignored, main idle 2h -> BLOCK", "BLOCK", p, out)


class FailOpen(Base):
    def test_G_missing_transcript(self):
        p, out = self.env.run(prompt(os.path.join(self.env.dir, "nope.jsonl")), "normal")
        self.check("G missing transcript -> ALLOW", "ALLOW", p, out)

    def test_H_malformed_stdin(self):
        for i, bad in enumerate(("{not json", "", "null", "[]", '"text"')):
            p, out = self.env.run(bad, "normal")
            self.check(f"H malformed stdin #{i} {bad!r} -> ALLOW", "ALLOW", p, out)

    def test_unexpected_structure(self):
        t = self.big_expired()
        for i, d in enumerate(({"prompt": "x"}, {"transcript_path": 123, "prompt": "x"},
                               {"transcript_path": t, "prompt": None, "session_id": None},
                               {"transcript_path": t, "prompt": ["a"]})):
            p, out = self.env.run(d, "normal")
            self.check(f"unexpected stdin structure #{i} -> no crash", decision(p, out), p, out)
        # #2: prompt None + valid big expired transcript is a legitimate block; #0/#1/#3 must allow
        self.assertTrue(all(r["actual"] == "ALLOW" for r in RESULTS[-4:] if "#2" not in r["test"]))

    def test_malformed_transcript(self):
        t = self.env.transcript([], raw_lines=('{"type":"assistant","usage":', "garbage", '{"type": "assistant", "message": "x", "usage": 1}'))
        p, out = self.env.run(prompt(t), "normal")
        self.check("malformed transcript lines -> ALLOW", "ALLOW", p, out)

    def test_bad_timestamp(self):
        rec = fx.assistant(2 * 3600, self.now, 200_000)
        rec["timestamp"] = "yesterday"
        t = self.env.transcript([rec])
        p, out = self.env.run(prompt(t), "normal")
        self.check("unparseable timestamp -> ALLOW", "ALLOW", p, out)

    def test_missing_usage_fields(self):
        rec = fx.assistant(2 * 3600, self.now, 200_000)
        rec["message"]["usage"] = {"output_tokens": 5}
        t = self.env.transcript([rec])
        p, out = self.env.run(prompt(t), "normal")
        self.check("usage without input/cache fields (ctx=0) -> ALLOW", "ALLOW", p, out)

    def test_missing_cache_metadata(self):
        # no cache_creation breakdown -> TTL unknown. Idle 10 min is past 5m but inside 1h:
        # must not block on a guess.
        t = self.env.transcript([fx.assistant(10 * 60, self.now, 200_000, cache_meta=False)])
        p, out = self.env.run(prompt(t), "normal")
        self.check("no cache TTL metadata, idle 10 min -> ALLOW (unknown TTL treated as 1h)", "ALLOW", p, out)

    def test_missing_cache_metadata_long_idle(self):
        t = self.env.transcript([fx.assistant(3 * 3600, self.now, 200_000, cache_meta=False)])
        p, out = self.env.run(prompt(t), "blocked")
        self.check("no cache TTL metadata, idle 3h -> BLOCK (expired under any TTL)", "BLOCK", p, out)

    def test_read_error(self):
        # a directory as transcript path -> open() raises PermissionError/IsADirectoryError on Windows/Linux
        d = os.path.join(self.env.dir, "dir.jsonl")
        os.mkdir(d)
        p, out = self.env.run(prompt(d), "normal")
        self.check("unreadable transcript (directory) -> ALLOW", "ALLOW", p, out)

    def test_unknown_model_pricing(self):
        t = self.env.transcript([fx.assistant(2 * 3600, self.now, 200_000, model="claude-future-9")])
        p, out = self.env.run(prompt(t), "blocked")
        self.check("unknown model -> still BLOCK, cost text degrades", "BLOCK", p, out)
        self.assertIn("a full cache rebuild", out["reason"])

    def test_empty_transcript(self):
        t = self.env.transcript([])
        p, out = self.env.run(prompt(t), "normal")
        self.check("empty transcript (new session) -> ALLOW", "ALLOW", p, out)


class RealTranscripts(Base):
    """Read-only runs on real transcripts for latency. Skipped if none exist."""
    def test_real_latency(self):
        files = sorted(glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")), key=os.path.getsize)
        if not files:
            self.skipTest("no real transcripts")
        largest, smallest = files[-1], next((f for f in files if os.path.getsize(f) > 50_000), files[0])
        for i in range(10):
            self.env.run(prompt(largest, sid=f"real_big_{i}"), "real-large-session")
            self.env.run(prompt(smallest, sid=f"real_small_{i}"), "real-small-session")
        RESULTS.append({"test": f"real transcripts read-only ({os.path.getsize(largest)//1_000_000} MB largest)",
                        "expected": "no crash", "actual": "no crash", "rc": 0, "stderr": ""})


def stats(xs):
    xs = sorted(xs)
    p95 = xs[min(len(xs) - 1, int(round(0.95 * (len(xs) - 1))))]
    return {"n": len(xs), "min_ms": round(xs[0] * 1000, 1), "median_ms": round(statistics.median(xs) * 1000, 1),
            "p95_ms": round(p95 * 1000, 1), "max_ms": round(xs[-1] * 1000, 1)}


if __name__ == "__main__":
    res = unittest.main(exit=False, verbosity=2).result
    by_tag = {}
    for tag, s in LAT:
        by_tag.setdefault(tag, []).append(s)
    summary = {"tests_run": res.testsRun, "failures": len(res.failures), "errors": len(res.errors),
               "skipped": len(res.skipped), "checks": RESULTS,
               "latency": {k: stats(v) for k, v in by_tag.items()}}
    json.dump(summary, open(os.path.join(HERE, "results.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(summary["latency"], indent=1))
    sys.exit(0 if res.wasSuccessful() else 1)
