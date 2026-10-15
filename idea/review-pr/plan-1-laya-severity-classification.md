# Plan 1 — Laya as an independent severity check in `review-pr`

## 1. Objective

Use Laya as a second, independent classifier of finding severity in `review-pr`. When Laya
disagrees with Claude with enough (calibrated) confidence, Claude re-checks that one finding.

Claude stays the reviewer and the final authority on every severity. Laya never changes a
severity, the score, the verdict or the merge assessment by itself.

The same change makes the verdict severity-based and replaces the score-based `Decision`
with a severity-based `Merge assessment` (section 6), so that a PR with only Minor/Suggestion
findings is `Approve with Suggestions` + `Eligible`, not blocked by a score of 99.

## 2. Scope

### In scope
- Severity labels aligned with the skill: `Critical`, `Major`, `Minor`, `Suggestion`.
- Laya classifies each verified finding independently, with `answer_confidence`.
- Code (not Claude) compares Laya with Claude and decides whether a re-check is needed.
- One re-check by Claude per flagged finding, capped per PR.
- Shadow evaluation and confidence calibration before re-checks are enabled.
- Verdict rules based on severity only (the `score < 100 → Request Changes` rule is removed).
- `Merge assessment` (`Eligible` / `Review required` / `Blocked`) replaces `Decision`.

### Out of scope
- Laya reading the PR, the diff or the code; Laya finding or verifying bugs.
- Laya deciding merge, writing or posting comments, or any provider write.
- Any change to the score formula (kept as it is; the score becomes informational).
- A "probability of merge" percentage. Severity alone cannot support a meaningful
  probability; that would need a defined outcome and historical PR data (possible later work).

## 3. Workflow

| Step | Who | What | Changed? |
|---|---|---|---|
| 1 | scripts | Fetch the PR, settle project rules | unchanged |
| 2 | Claude | Review, verify, deduplicate; assign severity with evidence and impact | unchanged, plus `impact` field |
| 3 | `classify-findings.mjs` + Laya | Independent severity per finding | **new** |
| 4 | `classify-findings.mjs` | Compare; mark findings that need a re-check | **new** |
| 5 | Claude | Re-check flagged findings, once each (only in `recheck` mode) | **new** |
| 6 | Claude | Final severity → counts, score, verdict, **Merge assessment** | verdict rule fixed; Decision → Merge assessment |
| 7 | Claude | Report and chat summary | header line updated |

### Step 2 — Claude's initial assessment
Each finding (from the main thread or a group sub-agent) is written to
`pr-<id>.findings.json`:

```json
{ "id": "F3", "file": "src/orders/service.ts", "line": 42, "rule": "Bug",
  "severity": "Major", "issue": "...", "evidence": "...", "impact": "...", "fix": "..." }
```

### Step 3 — Laya's independent classification
One command, one batch call, so it costs Claude a single tool call:

```
node <skill-dir>/scripts/classify-findings.mjs --findings pr-<id>.findings.json --rules <rules file>
```

The script builds Laya's input per finding: `id`, `rule`, `issue`, `evidence`, `impact`, plus the
severity rubric (section 5) and the project's severity overrides. It **does not send Claude's
severity**, and it removes severity words (`critical`, `major`, `minor`, `blocker`, `severe`,
`nit`, ...) from the text so Laya judges independently. No secrets: evidence is already
redacted by the review method.

### Step 4 — Comparison (in code)

| Case | Result |
|---|---|
| Laya failed, timed out, or returned an invalid label | keep Claude; log `unavailable` |
| Laya agrees with Claude | keep Claude |
| Laya differs, `answer_confidence` < calibrated threshold | keep Claude; log only; **no Claude call** |
| Laya differs, `answer_confidence` ≥ threshold | flag for re-check (in `recheck` mode) |

At most **3** re-checks per PR. When more are flagged, take first the ones that cross the merge
boundary (one side says Critical/Major, the other Minor/Suggestion); log the rest.

The script prints one summary line (for example
`laya: 7 classified, 5 agree, 1 low-confidence, 1 flagged: F3`) and writes the details to
`pr-<id>.laya.json`. Claude reads only the summary line, plus the flagged findings.

### Step 5 — Re-check (once)
For each flagged finding, Claude re-reads the cited code and decides: keep its severity or
change it, with a one-line reason. Claude's answer is final; there is no second round. The
decision is appended to `pr-<id>.laya.json` (`recheck: kept | changed`, reason).

### Step 6 — Final assessment
Counts and score use Claude's final severities, with the existing score formula unchanged.
Verdict and `Merge assessment` follow section 6.

## 4. Laya contract

Input (per finding, batched):

```json
{ "id": "F3", "rule": "Bug", "issue": "...", "evidence": "...", "impact": "...",
  "rubric": "<section 5 text + project severity overrides>",
  "labels": ["Critical", "Major", "Minor", "Suggestion"] }
```

Output (per finding):

```json
{ "id": "F3", "severity": "Critical", "answer_confidence": 0.91 }
```

- `severity` must be one of the four labels; anything else is `unavailable`.
- Every input `id` must come back exactly once; missing or unknown ids are `unavailable`.
- `answer_confidence` is treated as uncalibrated until section 9 is done. Laya's own docs warn
  it can be over-confident before calibration on a separate data set.

## 5. Severity rubric

Same meaning as `references/review-method.md`. The project's severity overrides are appended
when they exist.

| Severity | Meaning |
|---|---|
| **Critical** | must not merge: security hole, real secret, data loss or corruption, build break, severe production failure |
| **Major** | should not merge: likely bug or regression, missing guard, broken contract, unmet requirement, mandatory project-rule violation, significant maintainability risk |
| **Minor** | safe to merge but should be fixed: localised quality issue, small rule deviation |
| **Suggestion** | optional improvement |

Report statistics line (unchanged format):

```
**Findings:** 🔴 Critical {c} · 🟠 Major {m} · 🟡 Minor {n} · 🔵 Suggestion {s}
```

## 6. Verdict and Merge assessment (replaces `Decision`)

Both are computed by rule from Claude's **final** severities (and, for the merge assessment,
the review's coverage). Neither uses the score, and Laya takes part in neither.

### Verdict (severity-based)

The current rule "no Critical/Major and score `< 100` → `Request Changes`" is removed. It made
`Approve with Suggestions` unreachable and produced contradictions such as score 99 +
`Request Changes` + Merge `Eligible`.

| Verdict | Condition |
|---|---|
| `Request Changes` | at least one Critical or Major |
| `Approve with Suggestions` | no Critical/Major, at least one Minor or Suggestion |
| `Approve` | no findings |

### Merge assessment

| Merge assessment | Condition |
|---|---|
| `Blocked` | at least one Critical or Major |
| `Review required` | no Critical/Major, but the review is incomplete: ledger files not fully read, diff unavailable, or requirements could not be verified (ticket unreadable) |
| `Eligible` | no Critical/Major and the review is complete; Minor/Suggestion findings do not block |

Report header, `Decision` replaced:

```
## PR Review — {Verdict}

**Score:** {score}/100 · **Merge:** {Eligible | Review required | Blocked} · **Coverage:** {n}/{n} files
```

Verdict and merge always agree:

| Findings | Score | Verdict | Merge |
|---|---|---|---|
| 1 Suggestion | 99 | Approve with Suggestions | Eligible |
| 2 Minor, 3 Suggestion | 89 | Approve with Suggestions | Eligible |
| none | 100 | Approve | Eligible |
| 1 Major | 88 | Request Changes | Blocked |
| none, 2 files not read | 100 | Approve | Review required |

- The score formula is unchanged (Critical −30, Major −12, Minor −4, Suggestion −1 capped
  at −5, clamped 0..100). It is informational only: it decides neither verdict nor merge.
- The skill still never votes, approves or merges.
- Laya output is not shown in the report in `shadow` mode. In `recheck` mode, a re-check is
  invisible in the report too; only the final severity appears.

## 7. Modes and configuration

| `XT_REVIEW_PR_LAYA` | Behaviour |
|---|---|
| `off` (default) | Steps 3–5 skipped; the skill behaves as today (with Merge assessment) |
| `shadow` | Steps 3–4 run and are logged; no re-checks; nothing in the report changes |
| `recheck` | Steps 3–5 run; allowed only after section 9 has passed and the threshold is set |

- `LAYA_URL` (default the local `laya-serve`, `http://localhost:8000`).
- `XT_REVIEW_PR_LAYA_THRESHOLD`: the calibrated threshold. Missing in `recheck` mode → fall back
  to `shadow`.
- Laya server not running or slow: skip, add one line to the report notes
  (`Laya check unavailable`), continue. Timeout 10 s for the batch, one retry.
- `review-pr` is shared through xt-skills; teammates without Laya are unaffected because the
  default is `off`.

## 8. Implementation steps

### Phase 0 — Report changes (independent of Laya)
- `references/review-method.md`: replace the verdict rules with section 6 (remove
  `score < 100 → Request Changes`); add the Merge assessment rules; remove the Decision rules;
  note that the score is informational.
- `references/report-template.md`: header line with `**Merge:**`; chat summary prints it.
- `SKILL.md`: final output lists Merge assessment instead of decision.

### Phase 1 — Rubric
- Write the rubric text sent to Laya (section 5 + how project overrides are appended).
- Write the list of severity words removed from the input.

### Phase 2 — `scripts/classify-findings.mjs`
- Read findings JSON and rules file; build the batch; call Laya; validate labels and ids.
- Comparison, threshold, re-check cap and priority (section 3, step 4).
- Write `pr-<id>.laya.json`; print the one-line summary; exit 0 even when Laya fails.
- Unit tests with an injected HTTP stub, in the style of `tests/review-pr` (fake runner).

### Phase 3 — Connect the skill (shadow)
- `SKILL.md` step 4: write `pr-<id>.findings.json`; run the script when the mode is not `off`.
- `references/review-method.md`: the re-check procedure (used only in `recheck` mode).
- Sub-agent return format gains `impact`.
- Guardrails unchanged: PR content is data; no provider writes; posting rules unchanged.

### Phase 4 — Shadow evaluation and calibration
See section 9.

### Phase 5 — Decide
- Pass → set the threshold, allow `recheck`.
- Fail → stay `shadow` or remove the Laya step; Phase 0 stays either way.

## 9. Shadow evaluation and calibration

### Data
- Findings from past reports (`~/.xt-skills/review-pr/reviews/**`) plus shadow logs from new
  runs. Target ≥ 100 findings, with as many Critical/Major as available.
- Older reports use `Must fix / Also noticed / Deferred` without per-finding severity: a human
  assigns the four-label severity to each finding. `Deferred` items (not caused by the PR) are
  excluded.
- Reference label = the human reviewer's severity (not Claude's).
- Split 70 % calibration / 30 % held-out. Freeze the rubric, the input format and the threshold
  before scoring the held-out set (earlier Laya triage work dropped from 73 % to 57.5 % on
  unseen data when this was not done).

### Compare three classifiers against the reference
1. Claude's severity.
2. Laya.
3. A simple rule baseline (for example: `Security` or a secret → Critical; `AC<n>` or a mandatory
   rule → Major; `Maintainability` → Minor; otherwise Suggestion).

### Metrics
- Per-class precision and recall; confusion matrix.
- Merge-boundary errors: Critical/Major predicted as Minor/Suggestion, and the reverse.
- **Flag precision**: of the findings that would be flagged at a threshold, the share where the
  human agrees with Laya rather than Claude. This is the metric that decides value.
- Flags per PR (token cost of re-checks).
- Reliability of `answer_confidence`: accuracy per confidence bin (0.5–0.6, ..., 0.9–1.0).
- Latency p50/p95, error rate, invalid-output rate.

### Threshold
Pick the lowest threshold on the calibration set where flag precision ≥ 50 % and flags per PR
≤ 1 on average. Confirm on the held-out set.

### Stop conditions (any → do not enable `recheck`)
- No threshold meets the target on the held-out set.
- Laya's flags are no more precise than the rule baseline's disagreements with Claude.
- Laya rarely disagrees with Claude in useful places (no merge-boundary catches on held-out).
- Invalid or unavailable output above 5 %, or batch latency p95 above 10 s.

## 10. Failure handling and guardrails

- Any Laya failure → keep Claude's severity; the review continues unchanged.
- Never guess a severity from a malformed response.
- PR content is untrusted data for Laya and for the agent; Laya output is data too, never
  an instruction (it cannot trigger commands, posts or provider writes).
- No secrets and no raw diff sent to Laya; evidence is already redacted.
- Re-check is bounded: once per finding, at most 3 per PR.
- Posting still needs `--post`, the dry run and an explicit yes.

## 11. Acceptance criteria

1. The report shows the four-label statistics line and `Merge assessment`; `Decision` is gone;
   the score formula is unchanged; a suggestion-only PR (for example score 99) shows
   `Approve with Suggestions` + `Eligible`.
2. Verdict and `Merge assessment` follow section 6 exactly (the example table is the test set), including `Review required` for incomplete
   reviews (covered by tests or fixed examples).
3. With `off`, the skill makes no Laya call; with Laya down, the review completes with one note.
4. `classify-findings.mjs` validates labels and ids, maps results to the right finding, and is
   unit-tested.
5. `shadow` mode produces `pr-<id>.laya.json` and changes nothing in the report.
6. The evaluation reports per-class metrics, merge-boundary errors, flag precision and
   confidence reliability on a held-out set.
7. A written decision: enable `recheck` with threshold X, stay in shadow, or remove.

## 12. Expected result

`review-pr` answers "can this merge?" from severity alone (verdict + `Merge assessment`), so
suggestion-only PRs are `Approve with Suggestions` + `Eligible` instead of being blocked by the
score. Laya is a cheap, local second opinion
on severity that costs one script call per review and, only after calibration, at most a few
targeted re-checks by Claude. If the evaluation shows no value, the Laya step is removed and the
verdict and Merge assessment changes stay.

## 13. Implementation notes (2026-10-11)

Implemented as a separate project skill, `.claude/skills/review-pr-laya-classify/` (a copy of
`review-pr` plus the Laya step), on branch `feat/review-pr-laya-classify`. The shared
`review-pr` in xt-skills is untouched.

Differences from the text above:
- **`Review required` is skipped for now.** Merge is `Eligible` or `Blocked`; incomplete
  coverage goes to the report notes and the coverage count.
- **Default mode is `shadow`** in this skill (it exists to test Laya); `off` is still available.
- **Timeout is per Laya call** (10 s, one retry, 2 calls in flight), not per batch: one call
  takes about 0.5–1 s on CPU, so a 10 s batch limit would cut off PRs with many findings.
- **`answer_confidence` = Laya's top probability** from `/v1/systemone` (the API returns
  probabilities per label).
- Laya runs on the same rules and instructions as `review-pr` (`~/.xt-skills/review-pr/`), but
  reviews go to `~/.xt-skills/review-pr-laya-classify/reviews/` so both skills can review the
  same PR side by side.

Scripts: `classify-findings.mjs` (step 3–4), `assess.mjs` (verdict, merge, log finalization),
`laya-eval.mjs` (`collect` + `run`, section 9), `laya-severity.mjs` (shared logic).
Tests: `tests/laya.test.mjs` (30 tests, fake Laya server).

First smoke run (4 hand-written findings, real Laya, threshold 0.5 for the demo only):
Laya agreed on 2/4, rated a missing ownership check (Claude: Critical) as Major at 0.36
(below threshold, logged only), and rated a naming suggestion as Minor at 0.59 (would be a
re-check). Not evidence either way; section 9 decides.

## 14. Merge question in parallel (2026-10-11)

Added at the user's request: besides the per-finding severity, Laya answers one question per PR,
`block` or `merge`, from the list of findings (issue + impact, no severities, severity words
removed). It runs in parallel with the severity calls and is **log only** in every mode; the
report's merge assessment still comes from Claude's final severities (`assess.mjs`).

- Log: `pr-<id>.laya.json` → `merge: { laya, implied, rule, fromLayaSeverities, status, final, finalStatus }`.
- Evaluation: `laya-eval.mjs run` reports per-PR merge accuracy against the human labels
  (Blocked when any human label is Critical/Major), missed blocks and false blocks, for Laya's
  answer and for the rule on Claude's severities.
- Missed blocks (Laya says merge, reference says Blocked) are the costly error; the merge answer
  must never be used to let a PR through without a separate decision.

First run, PR 5240 (4 Critical, 7 Major; seeded defects, DO NOT MERGE): Laya answered
`merge` at 0.64 — a missed block. The same PR reduced to its 4 Minor/Suggestion findings: `merge`
at 0.59. One PR is not evidence, but it suggests the answer does not follow the findings.

### 14.1 Shorter schemas, merge from severity counts (2026-10-11)

At the user's request both questions were shortened:

- Severity: instructions `How severe is this code-review finding?` (+ project overrides, max 300
  chars); one short line per label.
- Merge: input is only the severity counts of Claude's findings
  (`{"severities": "4 Critical, 6 Major, 4 Minor, 1 Suggestion"}`); criteria
  `block: At least one Critical or Major finding.` /
  `merge: No Critical or Major finding; only Minor, Suggestion, or none.`; `max_len` 128.
  This makes the merge question a counting test: the rule computes it exactly.

Results with real Laya:
- Merge, 10 count combinations: **7/10**. Wrong: `0 Critical, 1 Major` → merge (0.64);
  `0 Critical, 2 Major, 5 Minor, 5 Suggestion` → merge (0.56); `no findings` → block (0.88).
  PR 5240 (4/6/4/1) now → block (0.51), right.
- Severity on PR 5240's 15 findings with the short rubric: 7/15 agree with Claude (9/15 with the
  long rubric); D365-CLAIMS (Critical by project override) still → Minor.

Reading: Laya misses Major-only PRs even when the criteria spell out the rule, so its merge answer
must stay log only; shortening did not improve severities.

### 14.2 Merge input as words, no counts (2026-10-11)

Laya does not count, so the merge input is now the severities present, worst first, as words:
`{"severities": "Critical, Major, Minor"}` (or `"none"`), with criteria
`block: Critical or Major is in the list.` / `merge: Only Minor or Suggestion is in the list, or the list is none.`

Measured on all 16 present/absent combinations of the four severities (real Laya):

| Wording | Right |
|---|---|
| **list of severities (kept)** | **14/16** — wrong: `Critical, Minor, Suggestion` → merge (0.50), `Major, Minor, Suggestion` → merge (0.56) |
| list + `Critical -> block` mapping in the criteria | 13/16 |
| list + mapping in the instructions | 12/16 |
| sentence ("This pull request has Critical and Minor findings.") | 7/16 |
| counts (`4 Critical, 6 Major, ...`, 10 combos) | 7/10 |

Still wrong on 2 of 16 cases that the rule gets right by construction, so the answer stays log only.

### 14.3 Three-state merge policy (2026-10-11)

The merge assessment now has three states, in the code (`assess.mjs`, report header) and in the
Laya question:

| Condition | Merge assessment |
|---|---|
| at least one Critical or Major | 🔴 Blocked |
| no Critical/Major, at least one Minor or Suggestion | 🟡 Eligible with suggestions |
| no findings and a complete review | 🟢 Eligible (`assess.mjs` warns when coverage is incomplete) |

Laya wording, measured on the 16 combinations (real Laya):

| Wording | Right |
|---|---|
| one 3-label question, list of severities | 5/16 |
| one 3-label question, plain-language criteria | 8/16 |
| one 3-label question, short labels (block / notes / clean) | 6/16 |
| one 3-label question, worst severity only | 2/16 |
| **two 2-label questions, combined in code (kept)**: block/merge + empty/has_findings | **14/16** |

The empty/has_findings question was right 16/16; both errors come from block/merge
(`Critical, Minor, Suggestion` → 0.50 and `Major, Minor, Suggestion` → 0.56, both let through).
Correct single-severity blocks score 0.87–0.95, but some correct answers are as low as 0.50, so
no confidence threshold separates the two errors cleanly. Laya's merge answer stays log only.

### 14.4 Block threshold instead of the top label (2026-10-11)

Both remaining errors were near-ties that fell on the merge side (a missed block). A missed block
costs far more than a false block, so the decision is now `Blocked` when Laya's P(block) ≥
`mergeBlockThreshold`, not when `block` is the top label.

With the severity-list wording there are only 16 possible inputs, and Laya is deterministic, so
measuring all 16 covers the whole input space for this model and wording (not a sample).

P(block) on the 16 inputs: must-block 0.444–0.948; can-merge 0.306–0.495. The ranges overlap
(0.444–0.495), so no threshold gets 16/16.

| Threshold | Right | Missed blocks | False blocks |
|---|---|---|---|
| top label (≈ 0.50) | 14/16 | 2 (`Critical, Minor, Suggestion`, `Major, Minor, Suggestion`) | 0 |
| **0.44 (default)** | **14/16** | **0** | 2 (`Minor` 0.495, `Suggestion` 0.460) |

Same score, but every error is now on the safe side. The margin is thin (0.444 vs 0.460), so the
threshold must be re-measured after any change to the wording or the Laya model
(`XT_REVIEW_PR_LAYA_MERGE_BLOCK` or `laya.json` → `mergeBlockThreshold`). Still log only.

### 14.5 merge_gate with the skill's own labels ("S2") — applied (2026-10-11)

The user's manual test showed a better question: one 3-label `merge_gate` question over the
findings' text (with Claude's severity), plain-language criteria. Labels were then renamed to the
skill's own states so Laya answers exactly what the report shows.

```json
"state": { "text": "Claude severity: Critical Finding: ... Evidence: ... Impact: ... Project context: rule AUTHZ.\n\nClaude severity: Minor Finding: ..." },
"questions": { "merge_gate": { "type": "choice",
  "instructions": "Based on the findings and their severity, is the PR Blocked, Eligible with suggestions, or Eligible?",
  "criteria": {
    "Blocked": "At least one Critical or Major finding exists. The PR must not be merged.",
    "Eligible with suggestions": "No Critical or Major findings exist, but one or more Minor or Suggestion findings exist. The PR can be merged with suggestions.",
    "Eligible": "No findings exist, and the review is complete. The PR is eligible to merge." } } }
```

Findings are sorted worst first, so a cut at `max_len` (1024) only drops the mildest ones.
Decision: `Blocked` when P(Blocked) ≥ 0.29, else the more likely eligible state.

Measured on 4 finding sets x 16 severity combinations (real Laya; the input contains finding text,
so these are samples, not the whole input space):

| Question | Right | Missed blocks | False blocks |
|---|---|---|---|
| user's labels (block / merge_with_suggestions / merge), top label | 56/64 | 0 | 8 |
| + "Minor does not block" sentences in the criteria (3 variants) | 52–54/64 | 0–3 | — |
| skill labels, top label | 59/64 | 5 | 0 |
| **skill labels, Blocked at ≥ 0.29** (threshold chosen on sets A-C; set D 16/16) | **60/64** | **0** | 4 |
| same, through the skill's code (`buildMergeState` format) | 59/64 | 0 | 5 |

PR 5240 (15 real findings): Blocked, P(Blocked) 0.54, agrees with the rule.

Remaining errors are all Minor-only PRs blocked (safe side). The margin is thin (lowest
must-block P(Blocked) 0.299 on sets A-C), so the threshold must be re-measured after any change to
the wording or the Laya model. Still log only.
