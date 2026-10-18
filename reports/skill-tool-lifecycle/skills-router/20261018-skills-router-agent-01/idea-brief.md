# Idea brief (retro) — skills-router

- **Experiment ID:** `20261018-skills-router-agent-01`
- **Tool:** `.claude/skills/skills-router/` (skill + scripts), measured at commit `56bfcf2` on `main`.
- **Kind of run:** retro measurement of a tool that is already built. Steps 1-3 (brainstorm, Gate A, implementation) are skipped by the user's decision (see `retro-run-brief.md`); `design.md` is the only design step.

## The question this run answers

When an agent has to choose which installed skill (or none) fits a user request, does it choose better, faster or cheaper if it also gets the output of the tool's `route.mjs` (BM25 shortlist, then one TypeSafe Jev decision, `agreement: low`) than if it only has the plain skill listing?

## What plain Claude does today

It sees the skill listing (name + description) and picks from it. Its failure modes are the ones the tool's eval names: wrong plain-vs-variant choice in overlap families (`web-test` vs `web-test-jev-wait`, `review-pr` vs `review-pr-laya-classify`), and a needless skill for a plain question.

## What Jev decides, and what happens when it is wrong

Jev answers one request over the BM25 shortlist: which skill (or `none`), a gate ("does this need a dedicated skill at all?") and a fit score for the top 3. The output is a hint; the agent makes the final call. When Jev is wrong, slow or down the tool returns `suggestion: null` and an `error`, or a BM25-only hint.

## Hypothesis and success criteria (fixed before data)

1. B picks the gold skill (or `none` when none is right) on at least as many cases as A, and no case that A gets right is lost in B.
2. B does not cost more tokens than A by more than the noise between repetitions. The router's own cost (Jev call) is tiny (about $0.00008 per request) and is reported separately.

Tokens and turns are recorded per case; with 6 cases and 2 repetitions the result is directional only.

## Non-goals

No fixing of the tool in this run (open review findings are pre-accepted by the user for this run); no measurement of the shadow hook, Laya or Kev providers, or `--consistency`.
