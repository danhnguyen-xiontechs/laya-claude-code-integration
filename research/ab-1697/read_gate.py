"""L2 - Hook PreToolUse cho Read: hoi Laya file nay co lien quan task khong; chac chan khong -> deny.

Can laya-serve (mac dinh http://127.0.0.1:8000) de model nong. Moi loi -> cho qua (fail open).
Env: LAYA_TASK_FILE (bat buoc), LAYA_URL, LAYA_TIMEOUT (s, mac dinh 8), GATE_MIN (mac dinh 0.15), GATE_LOG.
"""
import json, os, sys, time, urllib.request
from pathlib import Path

Q = {"relevant": {"type": "noul",
                  "instructions": "Is this file likely to be relevant to reading or changing for this task?"}}


def main() -> None:
    ev = json.load(sys.stdin)
    path = (ev.get("tool_input") or {}).get("file_path") or ""
    cwd = ev.get("cwd") or os.getcwd()
    try:
        rel = os.path.relpath(path, cwd)
    except ValueError:
        rel = path
    rec = {"t": time.time(), "file": rel}
    out = None
    try:
        task = Path(os.environ["LAYA_TASK_FILE"]).read_text(encoding="utf-8")[:1500]
        body = json.dumps({"state": {"task": task, "file_to_read": rel.replace("\\", "/")}, "questions": Q,
                           "model": "english", "max_len": 1024}).encode()
        url = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/systemone"
        t0 = time.perf_counter()
        with urllib.request.urlopen(urllib.request.Request(url, body, {"content-type": "application/json"}),
                                    timeout=float(os.environ.get("LAYA_TIMEOUT", "8"))) as r:
            p = json.load(r)["answers"]["relevant"]["noul"]
        rec.update(p=round(p, 4), ms=round((time.perf_counter() - t0) * 1000))
        if p < float(os.environ.get("GATE_MIN", "0.15")):
            rec["decision"] = "deny"
            out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                          "permissionDecisionReason": f"Read gate: {rel} judged unrelated to the task "
                                                                      f"(p={p:.2f}). Read it only if you are sure it is needed."}}
        else:
            rec["decision"] = "allow"
    except Exception as e:  # fail open
        rec.update(decision="error", error=type(e).__name__)
    if os.environ.get("GATE_LOG"):
        with open(os.environ["GATE_LOG"], "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    if out:
        print(json.dumps(out))


if __name__ == "__main__":
    main()
