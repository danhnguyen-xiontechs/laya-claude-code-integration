# Idea Brief — smart-context-trimming (retrospective)

- **Experiment ID:** `20261016-sct-bench-01`
- **Status:** retrospective — reconstructed from `smart-context-trimming/README.md`; Gate A was not recorded at the time.

## Problem
Long Bash test/build output (dotnet test, npm test, compiler runs) fills Claude's context with passing lines, so the failure evidence costs many tokens.

## Hypothesis
A PostToolUse mod that keeps only original lines (errors, failing tests, exception heads, summaries, head/tail) cuts what Claude reads by >80% without losing any critical line. Jev choosing a strategy per output adds a further cut on the hard cases.

## Intervention
- Kind: hook (Claude Code mod), observe mode by default, `/smart-trim enforce` to trim.
- Jev role: advisory per trimmed output; never writes text, cannot drop mandatory evidence; falls back to rules on timeout / invalid / confidence < 0.6.

## Success criteria
| Metric | Target | Guardrail |
|---|---|---|
| Critical lines lost | 0 | any loss = fail |
| Median size reduction on eligible outputs | ≥ 80% | — |
| Jev added value (C vs B) | measurable on hard cases | no extra loss, latency < 8 s |
