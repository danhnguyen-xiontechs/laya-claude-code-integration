---
name: integration-verifier
description: "After parallel story agents finish, verify the batch together: read each story's result manifest, check that required checks really ran (exit code + log), map ACs to evidence, detect cross-story conflicts (shared files, contracts, duplicate migrations, fixtures, config), merge all branches in an isolated integration worktree and run the required build/test there, then report PASS / FAIL / BLOCKED / REVIEW_REQUIRED per story and for the batch. TypeSafe Jev optionally suggests a category for unclassified failures (shadow only, never changes a status). Never merges. Use on \"/integration-verifier <batch.json> [--jev]\" or when asked to verify/integrate a batch of story branches before merge."
compatibility: Node.js 18+ and git. --jev needs OPENROUTER_API_KEY (hosted call; sends a redacted failure excerpt + story ids + changed paths).
---

# Integration verifier

Parallel story agents can each report success while the combined change is broken. This skill
checks **evidence**, not claims, and checks the **combined** change, not each worktree alone.
Plan: `F:\Download\integration-verifier-plan.md` (phases 1, 2, 3 and 5 are implemented here).

## Steps

1. **Every story agent writes a result manifest** (Phase 1 contract, `references/manifest.md`):
   `.integration/<story-id>.json` committed on its branch (or a path given in the batch file),
   listing changed files, the checks it ran with **exit code and log path**, AC claims with
   evidence, and optionally declared contracts and config keys. When you orchestrate the
   stories, put this requirement in each subagent's brief.
2. **Write the batch file** (`references/manifest.md` §batch): repo, base ref, stories → branches,
   required checks (`name` + shell `cmd`), and optional upstream artifacts:
   `ac_coverage` (acceptance-criteria-coverage matrix) and `review_findings`
   (`review-pr-jev-classify` / `subagent-validator` output). These are **consumed, not re-called**.
3. **Run:**
   ```bash
   node .claude/skills/integration-verifier/scripts/verify.mjs --batch <batch.json> [--out <dir>] [--jev] [--max-jev 3]
   ```
   Exit code: 0 PASS · 1 FAIL · 3 BLOCKED / REVIEW_REQUIRED. Output: `<out>/report.md`,
   `<out>/report.json`, `<out>/logs/combined-*.log`, and with `--jev` `<out>/jev-shadow.jsonl`.
4. **Show the user `report.md`** and stop. v1 never merges, rebases or fixes anything; a human
   decides on every non-PASS item (and on the PASS merge itself).

## What it checks (all deterministic)

| Check | Rule → status |
|---|---|
| Manifest missing / invalid | BLOCKED |
| Required check not recorded, no log file, empty log, or no exit code | BLOCKED (a claim without a log is not evidence) |
| Required check recorded with non-zero exit | FAIL |
| Diff vs declared `changed_files` differ | REVIEW_REQUIRED |
| AC with no evidence (passing check with log, AC-coverage `covered`, or `human` sign-off) | REVIEW_REQUIRED; AC-coverage `uncovered` → REVIEW_REQUIRED; claimed `failed` → FAIL |
| Review finding Blocker / Critical / High for the story | REVIEW_REQUIRED |
| Same fixture / migration / contract / config file changed by ≥2 stories | FAIL (code or generated files: REVIEW_REQUIRED) |
| Two migration files with the same version prefix in one folder | FAIL (`duplicate_migration`) |
| Declared contract: provider signature ≠ consumer's / two providers differ | FAIL (`contract_mismatch` / `contract_divergence`) |
| Same declared config key, different values | FAIL (`config_conflict`) |
| Merge conflict in the integration worktree | FAIL for that story |
| Combined required check fails | FAIL for stories whose files appear in the output; every other story ≥ REVIEW_REQUIRED |
| Combined failure matches environment signature (ECONNREFUSED, exit 127/9009, EACCES …) | BLOCKED, not FAIL |
| No required checks defined / combined checks did not run | BLOCKED |

Story status = worst of its items; batch = worst of all (FAIL > BLOCKED > REVIEW_REQUIRED > PASS).
**PASS only when** the manifest is valid, every required check has a passing log, every AC has
evidence, no conflict touches the story, and the combined checks ran and passed.

## Jev (Phase 5, shadow only)

Failures are clustered by a normalised signature and first classified by rules
(`environment`, `dependency`, `flaky_test`). Only a cluster the rules leave **unclassified** gets
one Jev `choice` call over the fixed set `code_regression, test_data, environment, dependency,
flaky_test, unknown` (≤ `--max-jev` per batch, default 3). The suggestion is printed in the report
column "Jev suggestion (shadow, not used)" and logged; the rule category stays `unknown` and **no
status is computed from it**, so Jev can never turn FAIL, BLOCKED or missing evidence into PASS.
Timeout / error → logged, nothing else changes. Payload: first ≤12 error lines (secrets and emails
redacted, ≤1200 chars), story ids and up to 12 changed paths each. Turn `--jev` on only when hosted
processing of that payload is approved for the project.

## Tests

```bash
node .claude/skills/integration-verifier/tests/fixtures.test.mjs        # 10 hand-labelled fixture batches, no network
node .claude/skills/integration-verifier/tests/fixtures.test.mjs --jev  # + Jev shadow, asserts statuses unchanged
```
