"""Gom runs/*/ -> COMPARE.md: token, chi phi, tool, file doc, test an, do trung file voi PR."""
import json, statistics as st
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).parent
PR_FILES = {"ai_agents/flows/assignment_results.py", "ai_agents/flows/assignment_rubric.py",
            "tests/unit/flows/test_assignment_results_routing.py", "tests/unit/flows/test_assignment_rubric_routing.py"}


def junit(x: Path) -> dict:
    if not x.exists():
        return {"passed": None, "total": None}
    s = ET.parse(x).getroot()
    s = s if s.tag == "testsuite" else s.find("testsuite")
    tot, fail, err, skip = (int(s.get(k, 0)) for k in ("tests", "failures", "errors", "skipped"))
    return {"passed": tot - fail - err - skip, "total": tot - skip}


def frac(h: dict) -> str:
    return f"{h['passed']}/{h['total']}" if h["total"] is not None else "-"


def parse(d: Path) -> dict:
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    init, result, tools, reads = {}, {}, Counter(), []
    for line in (d / "events.jsonl").read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "system" and e.get("subtype") == "init":
            init = e
        elif e.get("type") == "result":
            result = e
        elif e.get("type") == "assistant":
            for c in e["message"].get("content", []):
                if c.get("type") == "tool_use":
                    tools[c["name"]] += 1
                    if c["name"] == "Read":
                        reads.append(c["input"].get("file_path", ""))
    u = result.get("usage", {})
    hidden, own, basetests = junit(d / "hidden_tests.xml"), junit(d / "own_tests.xml"), junit(d / "base_tests.xml")
    changed = {f.replace("\\", "/") for f in meta.get("changed_files", [])}
    gate = [json.loads(l) for l in (d / "gate.jsonl").read_text(encoding="utf-8").splitlines()] if (d / "gate.jsonl").exists() else []
    return {"name": d.name, "config": meta["config"], "wall_s": meta["wall_s"], "cost": result.get("total_cost_usd"),
            "turns": result.get("num_turns"), "error": result.get("is_error"),
            "in": u.get("input_tokens", 0), "cache_r": u.get("cache_read_input_tokens", 0),
            "cache_w": u.get("cache_creation_input_tokens", 0), "out": u.get("output_tokens", 0),
            "n_tools_schema": len(init.get("tools", [])), "n_mcp": len(init.get("mcp_servers", [])),
            "n_slash": len(init.get("slash_commands", [])), "models": list((result.get("modelUsage") or {}).keys()),
            "tool_calls": dict(tools), "reads": len(reads), "hidden": hidden, "own": own, "base_tests": basetests,
            "semantic": (meta.get("semantic") or {}).get("pass"),
            "jaccard": round(len(changed & PR_FILES) / len(changed | PR_FILES), 2) if changed else 0.0,
            "changed": sorted(changed), "intent": (meta.get("launcher") or {}).get("intent"),
            "intent_p": (meta.get("launcher") or {}).get("prob"),
            "gate_deny": sum(g.get("decision") == "deny" for g in gate),
            "gate_deny_pr": sum(g.get("decision") == "deny" and g["file"].replace("\\", "/") in PR_FILES for g in gate),
            "gate_ms": round(st.median([g["ms"] for g in gate if "ms" in g])) if any("ms" in g for g in gate) else None}


def main():
    rows = [parse(d) for d in sorted((HERE / "runs").iterdir()) if (d / "meta.json").exists()]
    (HERE / "compare.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    L = ["# A/B #1697 (pxp-ai PR4854)", "",
         "Chi phi = `total_cost_usd` cua Claude Code (khong proxy, khong doi model). **Hanh vi** = semantic_check C1+C2 (thuoc do chinh). "
         "Test agent = test agent tu viet; hoi quy = test goc tren code agent; test PR = 14 test cua PR that (khoa cau chu, tham khao).", "",
         "| run | intent (p) | schema tool / MCP / slash | turns | input | cache read | cache write | output | $ | wall s | Read | hanh vi | test agent | hoi quy | test PR | Jaccard | gate deny (PR) |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        ip = f"{r['intent']} ({r['intent_p']:.2f})" if r["intent"] else "-"
        cost = f"{r['cost']:.3f}" if r["cost"] is not None else "-"
        L.append(f"| {r['name']} | {ip} | {r['n_tools_schema']} / {r['n_mcp']} / {r['n_slash']} | {r['turns']} | {r['in']} | {r['cache_r']} | "
                 f"{r['cache_w']} | {r['out']} | {cost} | {r['wall_s']} | {r['reads']} | {'PASS' if r['semantic'] else 'fail'} | {frac(r['own'])} | {frac(r['base_tests'])} | {frac(r['hidden'])} | {r['jaccard']} | "
                 f"{r['gate_deny']} ({r['gate_deny_pr']}) |")
    by = defaultdict(list)
    for r in rows:
        if r["cost"] is not None:
            by[r["config"]].append(r)
    L += ["", "## Trung vi theo cau hinh", "", "| config | n | $ trung vi | min-max | wall trung vi | hanh vi PASS | Read trung vi |", "|---|---|---|---|---|---|---|"]
    for c, rs in by.items():
        cs = [r["cost"] for r in rs]
        ok = sum(bool(r["semantic"]) for r in rs)
        L.append(f"| {c} | {len(rs)} | {st.median(cs):.3f} | {min(cs):.3f}-{max(cs):.3f} | {st.median(r['wall_s'] for r in rs)} | "
                 f"{ok}/{len(rs)} | {st.median(r['reads'] for r in rs)} |")
    (HERE / "COMPARE.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    main()
