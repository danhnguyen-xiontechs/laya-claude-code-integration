# event_probe.py - Buoc 1: ghi nguyen JSON stdin cua moi su kien hook de biet lenh Bash loi ban su kien nao.
import json, os, sys, time
raw = sys.stdin.read()
log = os.environ.get("PROBE_LOG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "event_log.jsonl"))
with open(log, "a", encoding="utf-8") as f:
    f.write(json.dumps({"ts": time.strftime("%H:%M:%S"), "argv": sys.argv[1:], "raw": raw}) + "\n")
