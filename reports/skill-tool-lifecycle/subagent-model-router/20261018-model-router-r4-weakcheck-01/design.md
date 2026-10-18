# Design: round 4 (weak checks, harder cases)

Frozen by the control session 2026-10-18T14:42Z, before any data. A change after the first result is a deviation (user approval, dated line here, both results kept).

## Case set (built in P2, in this folder under `cases/`)
- **6 cases**, Node coding tasks, each harder than round 3's d1/d4 (aim: tasks where Haiku has a real chance to be subtly wrong: edge cases, ordering, numeric precision, concurrency limits, spec-literal error text, off-by-one in ranges).
- Every case has:
  - `task.md`: the prompt, identical in both arms;
  - `check.mjs` (**visible, weak**): put in the work folder; the agent may run it; the cascade escalates only when it fails. It covers the happy path only;
  - `hidden/strict.mjs` (**hidden, strict**): never copied into the work folder; the grader runs it after the agent ends;
  - `ref/good/` (correct solution) and `ref/wrong/` (subtly wrong solution, the kind of mistake a weak model makes).
- At least 4 of 6 cases have a weak check (wrong ref passes visible, fails strict); up to 2 may be control cases with a strict visible check.

## Offline gate (runs first, `scripts/offline_gate.mjs`, no agent spend)
For every case: good ref passes visible and strict; for weak-check cases, wrong ref **passes visible and fails strict**; for control cases, wrong ref fails visible. Gate passes only if all hold. Also `route.mjs --cascade --mode apply --provider none` routes all 6 to haiku first (else record the tier and keep the case).

## Runs (P3)
- 6 cases × 2 arms × 2 repetitions = 24 first attempts, plus B escalations. Effort `high` for case agents (same as round 3). Fresh work folder per run and per escalation.
- Usage from transcripts (`subagent_usage_local.mjs` from round 3), price via `scripts/pricing.mjs`.

## Metrics (definitions fixed here)
- `strictPass(arm)` = final runs passing the hidden strict check / 12.
- `silentMiss(arm)` = final runs with visible pass and strict fail / 12.
- `price(arm)` = sum of price-weighted cost of all runs incl. escalations (USD).
- `priceChange` = (price(B) − price(A)) / price(A).

## Success criteria (Gate B input; a recommendation, the user decides)
- **ADOPT-ready**: strictPass(B) ≥ strictPass(A) − 1/12 **and** silentMiss(B) ≤ silentMiss(A) + 1/12 **and** priceChange ≤ −50%.
- **PILOT stays**: price saving holds but silentMiss(B) − silentMiss(A) is 2/12 or more: the cascade needs strong checks; document that as a precondition.
- **REWORK**: strictPass(B) < strictPass(A) − 2/12, or priceChange > −30%.
- **INSUFFICIENT_EVIDENCE**: Haiku passes strict on every case first time (the set is still too easy), or the offline gate fails.
