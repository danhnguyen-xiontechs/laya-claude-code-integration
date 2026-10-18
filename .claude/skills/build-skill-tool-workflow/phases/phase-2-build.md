# Phase 2: Build (Haiku 5.5 xhigh)

Input: `capsule-P2.md` (approved design, branch, files, test command). Output: commits on the experiment branch and `unit-tests.json`. smart-context-trimming in `enforce` mode.

## 3. Implement

Dedicated branch/worktree, repo conventions, provider behind a narrow adapter so tests can use a fake, no secrets in fixtures, shadow/advisory by default for a new decision engine, flag off = old behaviour so arm A stays runnable.

## 4. Tests

Run the whole relevant suite (unit, contract, integration such as `claude plugin test`). Minimum for a Jev/Laya integration: valid answer, borderline threshold, malformed answer, timeout / provider down, each mode, fallback, no unintended writes, redaction. Write `unit-tests.json` from the real output: skipped ≠ pass, not run = `notRun`. No measurement with failing tests. On Node 24 `node --test <dir>` fails ("Cannot find module"): pass files or a quoted glob, `node --test "<dir>/*.test.mjs"`, and use the same command in `unit-tests.json`.

End with a hand-back of 5 lines or fewer: branch + commit, tests passed/failed, anything blocked.
