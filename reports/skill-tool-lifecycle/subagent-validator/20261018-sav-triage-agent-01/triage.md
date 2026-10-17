# Retro triage (2026-10-18): subagent-validator, context-curator, jev_advisor

Source: JEV repo. subagent-validator and context-curator: branch `claude/review-5-plans-idea-folder-ce4d36` (e551872). jev_advisor, scenarios h01-h08: `jev` checkout. All read-only.

## subagent-validator (hook) - NOT MEASURED
- **Decides:** at `SubagentStop`, whether a subagent's diff drifted from its task (out-of-scope file, new dependency, skipped test, protected path). Warn, or block once (needs Jev drift + a rule signal + a declared scope).
- **Jev adds:** one Noul question per hunk "does this hunk serve the task" (p <= 1 - tau = drift). Rules alone give only warnings; Jev is the second key for a block.
- **Fair agent task:** a subagent gets a coding task plus a `<scope>`, and some runs contain seeded drift. Gold = which hunks are drift. But the tool acts only inside the real harness (three hooks on `Agent` + `SubagentStop`), and the outcome that matters (does the main agent catch drift it would have missed, does a block make the subagent revert) needs the validator's hooks on for arm B only. Subagents share this session's hooks, so a hook cannot be on for one arm; a separate `claude -p` session per case would be needed and has no cheap Haiku-subagent form.
- **Why skipped:** the only offline form is `subagent_validator eval` on labelled cases the same author wrote (a classifier benchmark of Jev on hunks, not an A/B of agents, in-sample). Presenting that as an A/B result would be a fake measurement. Recommended future run: real `claude -p` main-agent sessions with the hooks, seeded drift tasks, arm A with the hooks off.

## context-curator (shadow add-on of jev_advisor) - MEASURED
- **Decides:** which captured-output chunks of a long failing pytest log can be left out (replaced by a one-line recovery marker). Rules always win (tracebacks, anchors, summary, ERROR lines kept); a chunk is omitted only if Jev said p(helps explain failure) <= 0.2.
- **Jev adds:** the per-chunk relevance p (reused from the advisor run, no extra call). Without Jev nothing is omitted.
- **Fair agent task:** diagnose the root cause of a failing run from its log (scenarios h02, h04, h06, h07: 130-310 KB logs). Gold = the evidence regex of `gold.json` + the root-cause terms. A = raw pytest output; B = curated view (the tool's `curate` output) with markers and full log path. Measure pass and tokens.
- **Caveat that shapes the design:** the shipped tool is shadow only and never changes what is printed; the wrapper in B prints the curated view so the saving can be measured at all. This is the "active mode" the tool says is not built.

## jev_advisor (test wrapper, base of the curator) - MEASURED
- **Decides:** after a failing, long test run, which log chunks to point at: local parser anchors plus up to 3 Jev hints (p >= 0.6) printed after the unchanged output.
- **Jev adds:** per-chunk Noul relevance for ~80 candidate chunks; local-only (arm B of docs/runs) shows anchors only.
- **Fair agent task:** same as the A/B/C scenario idea of docs/runs (diagnosis only: cause, file:line, quoted evidence) on the hard set h01, h03, h05, h07 (the sc01-sc10 set hit a 30/30 ceiling). 2 arms only: A = plain pytest output, B = advisor with Jev live. Pass = root-cause terms and gold evidence line both in the answer, scored by script.
