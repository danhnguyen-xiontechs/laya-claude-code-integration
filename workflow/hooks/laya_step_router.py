# laya_step_router.py - hook PreToolUse (matcher Agent|Task): chon model cho moi lan Claude Code goi subagent "wf-*".
#
# Doc JSON tu stdin (tool_input co description, prompt, subagent_type), tao compact state tu brief, hoi Laya, roi tra ve
# updatedInput voi truong "model". Model cua luong chinh khong doi -> khong mat prompt cache cua luong chinh.
#
# Bien moi truong:
#   LAYA_STEP_MODE    off | static | laya   (mac dinh laya)
#   LAYA_STEP_STATIC  bang model theo buoc cho mode static, vd "explore=haiku,plan=opus,implement=sonnet,verify=haiku,review=sonnet"
#   LAYA_STEP_FLOOR   san theo buoc cho mode laya, vd "plan=sonnet"       (khong dat = khong gioi han)
#   LAYA_STEP_CEIL    tran theo buoc cho mode laya, vd "explore=sonnet"
#   LAYA_URL          mac dinh http://127.0.0.1:8000 (laya-serve)
#   LAYA_TIMEOUT      giay, mac dinh 3
#   LAYA_STEP_LOG     file log JSONL, mac dinh step_decisions.jsonl canh file nay
# Fail-open: moi loi (Laya tat, qua gio, JSON la) -> khong in gi, subagent dung model mac dinh cua no.
import json, os, sys, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from laya_common import QUESTION, TIERS, TIER_RANK, compact_state  # noqa: E402

DEFAULT_STATIC = {"explore": "haiku", "plan": "opus", "implement": "sonnet", "verify": "haiku", "review": "sonnet"}
LOG = os.environ.get("LAYA_STEP_LOG") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "step_decisions.jsonl")


def parse_map(s: str) -> dict:
    out = {}
    for part in (s or "").split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            if v.strip() in TIERS:
                out[k.strip()] = v.strip()
    return out


def step_of(subagent_type: str) -> str | None:
    return subagent_type[3:] if subagent_type.startswith("wf-") else None


def ask_laya(state: dict, timeout: float) -> dict:
    url = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/systemone"
    body = json.dumps({"state": state, "questions": QUESTION, "model": "english", "max_len": 1024}).encode()
    req = urllib.request.Request(url, body, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ans = json.load(r)["answers"]["model"]
    return ans["probabilities"]


def main() -> None:
    t0 = time.perf_counter()
    mode = os.environ.get("LAYA_STEP_MODE", "laya")
    if mode == "off":
        return
    d = json.loads(sys.stdin.read())
    ti = d.get("tool_input") or {}
    step = step_of(str(ti.get("subagent_type", "")))
    if step is None:  # chi dung toi cac subagent cua workflow
        return
    brief = str(ti.get("prompt", ""))
    t1 = time.perf_counter()
    state = compact_state(brief, step=step)
    t2 = time.perf_counter()
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "session": d.get("session_id"), "tool_use_id": d.get("tool_use_id"),
           "mode": mode, "step": step, "brief_head": brief[:200], "brief_chars": len(brief),
           "compact_ms": round((t2 - t1) * 1000, 2)}
    tier = None
    if mode == "static":
        tier = {**DEFAULT_STATIC, **parse_map(os.environ.get("LAYA_STEP_STATIC", ""))}.get(step)
    elif mode == "laya":
        try:
            t3 = time.perf_counter()
            probs = ask_laya(state, float(os.environ.get("LAYA_TIMEOUT", "3")))
            rec["laya_ms"] = round((time.perf_counter() - t3) * 1000)
            top = max(probs, key=probs.get)
            rec.update(laya_tier=top, top_prob=round(probs[top], 4), probabilities={k: round(v, 4) for k, v in probs.items()})
            tier = top
            floor = parse_map(os.environ.get("LAYA_STEP_FLOOR", "")).get(step)
            ceil = parse_map(os.environ.get("LAYA_STEP_CEIL", "")).get(step)
            if floor and TIER_RANK[tier] < TIER_RANK[floor]:
                tier = floor
            if ceil and TIER_RANK[tier] > TIER_RANK[ceil]:
                tier = ceil
        except Exception as e:  # Laya tat / qua gio -> khong can thiep
            rec["error"] = f"{type(e).__name__}: {e}"[:200]
    rec["tier"] = tier
    rec["total_ms"] = round((time.perf_counter() - t0) * 1000)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass
    if tier:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                                 "updatedInput": {**ti, "model": tier}}}))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # khong bao gio lam hong luong cua nguoi dung
        pass
