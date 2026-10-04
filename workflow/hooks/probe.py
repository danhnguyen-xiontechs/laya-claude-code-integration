# probe.py - Buoc 0: ghi nguyen JSON stdin cua hook PreToolUse va (tuy chon) ep model cua subagent.
# PROBE_SET_MODEL=haiku -> tra updatedInput voi model do. PROBE_LOG = file log.
import json, os, sys, time
raw = sys.stdin.read()
log = os.environ.get("PROBE_LOG", os.path.join(os.path.dirname(__file__), "probe_log.jsonl"))
with open(log, "a", encoding="utf-8") as f:
    f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "raw": raw}) + "\n")
model = os.environ.get("PROBE_SET_MODEL")
if model:
    d = json.loads(raw)
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                             "updatedInput": {**d.get("tool_input", {}), "model": model}}}))
