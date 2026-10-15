# review-pr-jev-classify: real-data eval on merged ess-be PRs (2026-10-15)

Skill: `review-pr-jev-classify` @ `1b56660` (branch `claude/review-pr-jev-upgrade-2bbb34`).
Provider Jev (`typesafe/jev-1.13` via OpenRouter), `mode=shadow`, `policy=stable-disagreement`, `k=3`,
yes/no questions on. Nothing was posted to any PR and no Claude re-check was run.

## Verdict

| Criterion (fixed before the run) | Result |
|---|---|
| **A**: ≥ 50 % of Jev's upward flags are `fixed` findings | **FAIL**: 2 / 8 = **25 %** with the tool's labels. A manual reading of the fix commits gives 4–5 / 8 (50–62 %), but that reading was not fixed in advance. |
| **B**: no `fixed` Critical/Major finding is downgraded below the merge boundary by a stable Jev answer | **PASS, but tests nothing**: Jev made no downward answer at all (0 stable downgrades) |

**Recommendation: keep `recheck` in shadow. Do not make it the default.** On real PRs Jev answers
"Major" for almost everything (11 of 14 first answers, every one stable). It flagged 8 of 14
findings, so the flag picks out nothing in particular. Its flags were `fixed` less often (25 %) than all findings together (7 / 14 = 50 %).

## Data and method

The task assumed that many merged PRs already carry AI review threads. That was wrong. Across 197
merged ess-be PRs closed since 2026-07-15 there are 975 system comments and **1** text comment.
The ADO AI-review pilot only ran on `clone-develop` test PRs (5211–5240). Reviews did happen, but
locally (`ess-ado-mr-review`, `bmad-code-review`). They are visible only as later
"address PR N review findings" commits, and the archive they cite
(`projects/ess/_bmad-output/reviews/...`) is in a wrapper repo that this machine cannot reach.

So the findings come from fresh **blind** Claude reviews:

1. **Select.** I took 24 candidate PRs with a later review-fix commit. The user approved Jev for all of them and a
   quota budget of the **8 smallest**: 5231, 5328, 4820, 5264, 5199, 4635, 4431, 4500.
2. **Rewind.** Each run folder from `pr-fetch.mjs` was set back to the **review head** = the parent of the first
   review-fix commit: `sourceCommit`, `files[]`, the patch base..head, and a description replaced with the
   commit list. As a check, PR 4820 lands on `723aaae5`, the same commit its original review file names.
3. **Review.** One subagent per PR followed `review-method.md` and the ess-be rules. It read code only at the
   review head (`git show <head>:path`), never the working tree or any later commit.
   I dropped one finding (5231 F4 "no linked ticket"), because the ess-be rules say a missing ticket is not a finding.
4. **Check.** `classify-findings.mjs --provider jev --mode shadow --policy stable-disagreement --k 3`
5. **Label.** `outcome-labels.mjs` (±5 lines, review head → final PR head).

## Per finding

Codes: C/M/m/S = Critical/Major/Minor/Suggestion. The Jev column is the first answer, then the 3 shuffled answers.
"Fix commit" is my reading of the author's review-fix commit: whether the point was acted on anywhere.

| PR | id | rule | Claude | Jev (first; k=3) | stable | flag | intro | raised | outcome | fix commit |
|---|---|---|---|---|---|---|---|---|---|---|
| 5231 | F1 | DOC-01 | M | M 1.00; MMM | ✓ | – | yes | no | unchanged | **acted on** (LEAVE.md updated, different file) |
| 5231 | F2 | Maint | m | m 0.85; mmm | ✓ | – | yes | no | fixed | acted on |
| 5231 | F3 | TEST-02 | m | M 0.81; MMM | ✓ | ↑ | yes | no | unchanged | **acted on** (mapper tests added in test file) |
| 4820 | F1 | Bug | S | M 0.93; MMM | ✓ | ↑ | yes | no | unchanged | no: deliberate (spec); the original review refuted its Majors |
| 5264 | F1 | TEST-02 | m | M 0.89; MMM | ✓ | ↑ | yes | no | fixed | acted on |
| 5264 | F2 | Spec | S | M 0.72; MMM | ✓ | ↑ | yes | no | unchanged | no |
| 5199 | F1 | DOC-02 | m | M 0.67; MMM | ✓ | ↑ | yes | no | unchanged | **acted on** (attendance docs updated) |
| 5199 | F2 | Maint | S | m 0.67; mmm | ✓ | – | no | no | fixed | acted on |
| 4635 | F1 | Bug | m | M 0.79; MMM | ✓ | ↑ | yes | no | unchanged | no: fail-closed is deliberate |
| 4635 | F2 | TEST-02 | S | M 0.71; MMM | ✓ | ↑ | yes | no | fixed | acted on |
| 4431 | F1 | CACHE-INV | M | M 0.54; MMC | ✗ | – | yes | no | fixed | **rejected**: the author locked in "no invalidation" as the contract |
| 4431 | F2 | TEST-02 | m | M 0.73; MMM | ✓ | ↑ | no | no | unchanged | partly (failure-path test extended) |
| 4431 | F3 | Maint | S | m 0.72; mmm | ✓ | – | yes | no | fixed | acted on |
| 4500 | F1 | VALID | m | m 0.86; mmm | ✓ | – | yes | no | fixed | acted on |

PR 5328 had 0 findings. Jev's merge answer agreed with the rule on Claude's severities on all 8 PRs.

## Confusion: Claude × Jev × outcome

| Claude → Jev | n | fixed | unchanged |
|---|---|---|---|
| M → M | 2 | 1 (4431 F1, rejected in practice) | 1 |
| m → M (flag ↑) | 5 | 1 | 4 |
| S → M (flag ↑) | 3 | 1 | 2 |
| m → m | 2 | 2 | 0 |
| S → m | 2 | 2 | 0 |

- **Jev's severity by outcome.** Findings Jev rated Major: 3 of 10 fixed. Findings Jev rated Minor: 4 of 4 fixed. On this sample
  Jev's "Major" is a negative signal for `fixed`. The 4 findings where Jev agreed on Minor are all small concrete
  code cleanups that the author applied.
- **Claude's severity by outcome.** Major: 1 of 2. Minor: 3 of 7. Suggestion: 3 of 5. Flat; with n=14 nothing separates.
- **Stability.** 13 of 14 findings were stable over k=3. Stability does not filter anything here: Jev's error is
  consistent, not noisy.

## The yes/no questions

- `already_raised`: 14 of 14 answered `no` locally (no ADO thread existed, so no call was made). This set cannot test it.
- `introduced_by_pr`: 12 yes, 2 no. Both `no` answers are wrong, because both cite lines that the PR added
  (5199 F2 is a test helper and 4431 F2 is a missing test). Outcome: 1 fixed and 1 unchanged, so there is no relation to the outcome.

## Limits of outcome labels

- **`unchanged` can still be real, and here often is.** 3 of 7 "unchanged" findings (5231 F1, 5231 F3,
  5199 F1) were acted on in a different file: a doc or test file, not the cited line. Labels at the cited line ±5 miss
  every DOC-xx and TEST-02 fix that lands elsewhere. Those rule families make up 6 of the 14 findings.
- **`fixed` can be wrong.** 4431 F1 changed lines nearby, but the author kept the behaviour the finding objected to.
- The authors were answering a different review, so a real point that the other review missed shows as `unchanged`.
- n = 14 findings over 8 small PRs (15–426 patch lines). Large PRs, where the review is hardest, are not in the sample.

## Cost

- **Jev:** 8 PRs, 14 findings (each asked k+1 = 4 times, plus 2 yes/no questions and 1 merge question), about 48k input / 3.5k output tokens,
  **$0.0020** total, about 3 s per PR.
- **Claude:** 8 blind review subagents, about 673k subagent tokens in total (80–88k each), on the Max plan.
  Selection and orchestration used `az` and git only.
- **Data sent to OpenRouter:** finding text and code excerpts for these 8 PRs, as approved. No thread text was sent (there was none).

## What would change the recommendation

- **Gate flags on the project rule.** As the PR 5240 note suggested, flag only when the rule's default severity agrees
  with Jev. Re-score this set once the rules file's per-id defaults (TEST-02, DOC-02) are joined in.
- **Widen the outcome label.** Count a fix as "acted on" when the review-fix commit touches the cited
  file *or* the doc/test file the rule names. Under that labelling criterion A reaches the bar (4–5 / 8).
- Review the 16 larger candidates (list in the session notes). That needs another quota approval.
