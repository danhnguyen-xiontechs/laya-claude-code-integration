# settings_merge.py - them/go hook laya_step_router vao settings.local.json cua repo dich, giu nguyen phan con lai.
# Dung:  python settings_merge.py <settings.local.json> add <python.exe> <laya_step_router.py>
#        python settings_merge.py <settings.local.json> remove
import json, os, sys

MARK = "laya_step_router.py"
path, action = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8-sig")) if os.path.exists(path) else {}  # utf-8-sig: PowerShell 5.1 ghi BOM
pre = data.setdefault("hooks", {}).setdefault("PreToolUse", [])


def ours(entry):
    return any(MARK in h.get("command", "") for h in entry.get("hooks", []))


pre[:] = [e for e in pre if not ours(e)]  # luon go ban cu truoc (idempotent)
if action == "add":
    py, script = sys.argv[3], sys.argv[4].replace("\\", "/")
    pre.append({"matcher": "Agent|Task",
                "hooks": [{"type": "command", "command": f'"{py}" {script}', "timeout": 15}]})
if not pre:
    data["hooks"].pop("PreToolUse")
if not data["hooks"]:
    data.pop("hooks")
os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
if data or action == "add":
    json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
elif os.path.exists(path):
    os.remove(path)  # file chi co hook cua minh -> xoa han
print(f"{action}: {path}")
