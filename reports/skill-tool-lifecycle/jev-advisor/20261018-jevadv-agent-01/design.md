# Design (retro measurement, frozen 2026-10-18 before step 6)

**Tool code measured:** JEV worktree `claude/review-5-plans-idea-folder-ce4d36` at e551872 plus its uncommitted files (`jev_advisor/curator.py`, the `curate` branch of `jev_advisor/__main__.py`); a copy of the package is the engine (scratch `engine/jev_advisor`), nothing is written into the JEV repo.

**Cases (scenarios of JEV `examples/scenarios`, hard set):** h01_layered_config, h03_clock_leak, h05_deadline_budget, h07_payload_trace. Each is a failing pytest run with a 130-310 KB log. The copy given to agents has no `gold.json`; the gold evidence regex and root-cause terms live only in `grade.mjs`.

**Arms (same prompt text, same command `python runtest.py` in a fresh work folder per case/arm/repetition):**
- A: `runtest.py` runs `python -m pytest` and streams the output. No tool. Prompt says no tool is available and not to look for one.
- B: `runtest.py` runs `jev_advisor run` (Jev live, hints shown = arm C of docs/runs): output unchanged, then the advisor block ([local] anchors, up to 3 [jev] hints with p >= 0.6). Log kept in `.tool-output/`.

**Agents:** Haiku 5.5, effort xhigh (forced by the user). Task: diagnosis only (no edits), answer via hand-back as CAUSE / LOCATION / EVIDENCE / RUNS. 2 repetitions; A and B of a case in one message, repetition 2 launched B first; at most 6 agents in flight.

**Pass (scripted, from the hand-back, never the agent's claim):** the answer names the root-cause terms of the case AND quotes the gold evidence line (regex from the scenario's gold.json). Cause-only and evidence-only are reported as diagnostics.

**Tokens:** all tokens of each case agent session from its subagent transcript (`subagent_usage.mjs`), plus turns and tool calls. Engine calls (Jev requests, latency, cost, fallback) from the run files left in each B work folder (`.tool-output/*.run.json|advice.json`).

**Contamination check:** `subagent_usage.mjs --forbid` on arm A (jev_advisor, .jev-advisor, curator, curate, engine path); a contaminated A case is discarded and re-run as `<case>.A2.r<n>`.

**Fallbacks:** Jev error, timeout or pending = advisor prints local hints only; curator omits nothing.
