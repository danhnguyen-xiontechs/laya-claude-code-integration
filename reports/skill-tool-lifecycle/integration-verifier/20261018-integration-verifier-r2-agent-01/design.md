# Design — integration-verifier, round 2 agent run `20261018-integration-verifier-r2-agent-01`

Frozen before step 6. Same case set, gold, prompts, arms, model and effort as `20261018-integration-verifier-agent-01`; only the tool changes. Built by `make_tasks.mjs` (copied unchanged from round 1 except the experiment id in comments), measured by `collect.mjs` and `grade.mjs`, summarised by `finalize.mjs`.

## What changed in the tool (round-2 candidate)
Branch `claude/integration-verifier-round2` from `main`. Two top suggestions of round 1's `improvements.md` applied, nothing else:
1. **Verdict-first report**: `renderMarkdown` prints `BATCH: <status>`, one `<id>: <status> - <top reason>` line per story, and the combined-run line first; the tables move below `## Details`.
2. **Coverage row must cite a test that exists on the story branch**: a `covered` AC-coverage row is evidence only if its `test` path exists on the story branch (`git cat-file`); otherwise the AC has no evidence and the story is REVIEW_REQUIRED with the reason.

Not changed: the rules for checks, manifests, cross-story conflicts, merge, Jev (shadow, never changes a status), and the four open Major review findings of round 1 (accepted for this run, see `agent-review.json`).

## Arms (identical to round 1)
- Both: one fresh subagent per case/arm/repetition, `model: haiku` (claude-haiku-5-5), `effort: xhigh`, own work folder `<case>.<A|B>.r<n>` with a fresh copy of the fixture. A and B of a case in the same message; repetition 2 launched B first; at most 6 case agents in flight.
- Prompt: identical text in both arms except the work folder and one sentence (A: no verifier, decide yourself; B: run `node verify-batch.mjs`).
- `verify-batch.mjs` is the same command in both arms: A prints `verifier disabled`; B runs `verifyBatch` from this branch with `jev: true, maxJev: 3`, prints `report.md` and logs one line to the private `_logs`.

## Cases (unchanged)
c1 to c6 as in round 1 (`design.md` of `20261018-integration-verifier-agent-01`). Gold is the same, including c6 S2 = PASS. **Known consequence:** c6's fixture cites `tests/count.test.js`, which exists in no commit; the round-2 tool now says REVIEW_REQUIRED for S2 (as the plain agents did in round 1), so c6 stays "wrong against gold" in both arms. This is reported as a fixture flaw, not as a tool win. The new behaviour is covered by unit tests with two c6 variants (missing test, present test).

## Pass, tokens, forbidden check
Same as round 1: a case passes when the hand-back answer parses and the batch and every story status equal gold (scored by `grade.mjs`). Tokens from `subagent_usage.mjs` per work folder. Arm A is checked with `subagent_usage.mjs --forbid` (integration-verifier, verify.mjs, decision-provider, gold, logs, B folders, private folder); a contaminated A case is re-run as `<case>.A2.r<n>`.

## Known limits
Six tiny two-story batches, two repetitions: directional. The gold for c6 is inherited (see above). Jev is called only in c5.
