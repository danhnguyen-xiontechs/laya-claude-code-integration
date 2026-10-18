# Idea brief (retro round 2) - skills-router

- **Experiment ID:** `20261018-skills-router-r2-agent-01`
- **Baseline:** round 1, [`20261018-skills-router-agent-01`](../20261018-skills-router-agent-01/report.html) (commit 56bfcf2 on main, REWORK). Its folder is untouched.
- **Tool:** `.claude/skills/skills-router/`, changed on branch `claude/skills-router-round2` (commit `ada217d`, not pushed, not merged).
- **Kind of run:** retro, round 2 of the same tool: apply the top suggestion of round 1, measure again on the same cases, report. Gate B stays with the user.

## The question this run answers

Round 1 found the router right on every request but the hint too expensive: the full JSON (about 2k tokens) came after a 30 KB skill listing, the Bash output was cut, and agents took extra turns to find it (+72% tokens, 25 -> 44 turns, same passes). Does printing the hint as one short line, first, bring the cost of arm B back to arm A's, with the same passes?

## What changed from round 1

- `scripts/route.mjs`: the default output is one line (`suggest: <inv> | why | conf | alt | overlaps | stability | via`, or an abstain or error line); `--json` gives the pretty object as before, `--format json` the compact one.
- The measurement helper (B arm) runs the router once with `--json`, builds the same line, and prints it before the listing. The A arm and the pick prompt are unchanged.

Not applied this round (see `improvements.md` for the next steps): round-1 suggestion 2 (call the router only when uncertain: the harness always calls it, so a gate cannot be measured here), suggestion 3 (new cases: the brief fixes the case set for this round), suggestion 4 (the three Major findings: left open, accepted for this run), suggestion 5 (drop the tool).

## Hypothesis and success criteria (fixed before data)

1. B passes at least as many cases as A, and no case that A passes is lost.
2. B costs no more tokens than A (paired) beyond the noise between repetitions; target B <= 1.1 x A.

Six cases and two repetitions: directional only.
