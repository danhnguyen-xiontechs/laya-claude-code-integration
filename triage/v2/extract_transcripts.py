# extract_transcripts.py - trich cac lan lenh Bash/PowerShell bi loi tu lich su Claude Code (~/.claude/projects/*/*.jsonl).
# Ghi triage/v2/data/transcript_failures.jsonl (thu muc data/ nam trong .gitignore: chua code/duong dan noi bo).
# Chay:  python triage/v2/extract_transcripts.py
import glob, hashlib, json, os, re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "transcript_failures.jsonl")
ROOT = os.path.expanduser("~/.claude/projects")
SKIP = re.compile(r"doesn't want to proceed|was rejected|interrupted by user|Permission to use|denied by|hook", re.I)


def text_of(c) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict))
    return ""


def main() -> None:
    cases, seen = [], set()
    for f in glob.glob(ROOT + "/*/*.jsonl"):
        proj = os.path.basename(os.path.dirname(f))
        uses = {}
        for line in open(f, encoding="utf-8", errors="ignore"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            for c in (d.get("message") or {}).get("content") or []:
                if not isinstance(c, dict):
                    continue
                if c.get("type") == "tool_use" and c.get("name") in ("Bash", "PowerShell"):
                    uses[c["id"]] = (c["name"], (c.get("input") or {}).get("command", ""))
                elif c.get("type") == "tool_result" and c.get("is_error") and c.get("tool_use_id") in uses:
                    tool, cmd = uses[c["tool_use_id"]]
                    out = text_of(c.get("content"))
                    if not out.strip() or SKIP.search(out[:300]):
                        continue
                    h = hashlib.md5(re.sub(r"\d+", "", out[-1500:]).encode()).hexdigest()
                    if h in seen:
                        continue
                    seen.add(h)
                    cases.append({"id": f"tx{len(cases) + 1:03d}", "source": proj, "tool": tool,
                                  "command": cmd, "error": out, "lines": out.count("\n") + 1})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fo:
        for c in cases:
            fo.write(json.dumps(c, ensure_ascii=False) + "\n")
    print("cases:", len(cases), "| tool:", dict(Counter(c["tool"] for c in cases)))
    print("lines>=5:", sum(c["lines"] >= 5 for c in cases), "| lines>=20:", sum(c["lines"] >= 20 for c in cases))
    for k, v in Counter(c["source"] for c in cases).most_common(15):
        print(f"{v:4d}  {k}")


if __name__ == "__main__":
    main()
