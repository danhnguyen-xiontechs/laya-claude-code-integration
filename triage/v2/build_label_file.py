# build_label_file.py - gop log loi (lich su Claude Code + GitHub) thanh file de NGUOI gan nhan.
# Moi case co "suggested" (Sonnet goi y + ly do ngan) de doc nhanh; "label" de trong cho nguoi dien.
# Ghi triage/v2/data/to_label.json. Chay:  python triage/v2/build_label_file.py
import json, os, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from categories import CATEGORIES  # noqa: E402

DATA = os.path.join(HERE, "data")
CLAUDE = os.environ.get("CLAUDE_BIN", r"C:\Users\ADMIN\AppData\Roaming\npm\claude.cmd")
EXCERPT_LINES = 40
PROMPT = """A developer ran a command and it failed. Pick the category that best describes WHERE they should look first.

Categories:
{cats}

Command: {command}
{resolution}Output (last lines):
```
{log}
```

Reply in exactly this format, one line:
<CATEGORY> | <reason, max 15 words>"""


def load(name: str) -> list[dict]:
    p = os.path.join(DATA, name)
    return [json.loads(l) for l in open(p, encoding="utf-8")] if os.path.exists(p) else []


def suggest(c: dict, cwd: str) -> tuple[str, str]:
    cats = "\n".join(f"- {k}: {v}" for k, v in CATEGORIES.items())
    res = f"Known resolution from the issue thread: {c['resolution']}\n" if c.get("resolution") else ""
    prompt = PROMPT.format(cats=cats, command=c.get("command", ""), resolution=res, log=c["excerpt"])
    cmd = [CLAUDE, "-p", "--model", "sonnet", "--tools", "", "--strict-mcp-config", "--no-session-persistence"]
    try:
        out = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8", cwd=cwd, timeout=180).stdout.strip()
        cat, _, why = out.partition("|")
        cat = cat.strip()
        return (cat if cat in CATEGORIES else "UNKNOWN"), why.strip()
    except Exception as e:  # noqa: BLE001
        return "UNKNOWN", f"suggestion failed: {e}"


def main() -> None:
    cases = load("transcript_failures.jsonl") + load("github_failures.jsonl")
    for c in cases:
        c["excerpt"] = "\n".join(c["error"].rstrip().splitlines()[-EXCERPT_LINES:])
    with tempfile.TemporaryDirectory() as cwd, ThreadPoolExecutor(4) as pool:
        sugg = list(pool.map(lambda c: suggest(c, cwd), cases))
    out = [{"id": c["id"], "source": c["source"], "url": c.get("url", ""), "command": c.get("command", ""),
            "resolution": c.get("resolution", ""), "excerpt": c["excerpt"],
            "suggested": s[0], "suggested_reason": s[1], "label": "", "drop": False, "note": ""}
           for c, s in zip(cases, sugg)]
    with open(os.path.join(DATA, "to_label.json"), "w", encoding="utf-8") as f:
        json.dump({"categories": CATEGORIES,
                   "how_to": "Dien 'label' bang 1 key trong categories (de trong = dong y voi 'suggested'). "
                             "'drop': true neu khong phai loi that / khong dung lam test. 'note' tuy y.",
                   "cases": out}, f, ensure_ascii=False, indent=1)
    from collections import Counter
    print(len(out), "cases ->", os.path.join(DATA, "to_label.json"))
    print(Counter(o["suggested"] for o in out))


if __name__ == "__main__":
    main()
