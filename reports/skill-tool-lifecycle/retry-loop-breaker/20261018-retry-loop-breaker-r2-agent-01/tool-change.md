# Tool change: retry-loop-breaker, round 2

**Diff in plain words**

- `hooks/core.ts`: default `maxIdenticalFailuresBeforeBlock` 2 -> 3. `passed` stores `{ key, epoch }`; a failure marks a key flaky only if it passed at the current epoch (legacy bare strings never do).
- **Flaky epoch rule (review fix, Major):** `flaky` stores `{ key, epoch }`. `decideBefore` exempts a key only while that epoch equals the current one, so after an edit a flaky test counts toward a block again (flaky, edit, 5 identical failures: the 4th and 5th are blocked). A legacy bare-string entry never exempts; the next flaky mark replaces it.
- **Transient rule:** a transient failure (`isTransient`) never marks a key flaky, in the pass-after-fail or the fail-after-pass rule.
- **Near-duplicate:** the flaky exemption applies to the exact key only; the near-duplicate/Jev path ignores `flaky`.
- `types/index.d.ts`: `PassedEntry`, `FlakyEntry`. README line on flaky.
- Tests: unit 13 rewritten, 16/18 updated, 19-21 new; engine test for flaky, real Edit, 5 failures.

**Why.** Before the fix, one flaky observation exempted a key for the whole session.

**Accepted deviations (reviewed, not fixed)**

1. Eligible build commands that change files (e.g. codegen in `npm run build`) do not raise the epoch.
2. `recordAfter` reads the epoch at record time, not at the call's start.
3. Case 4 (changed signature) has no threshold-boundary coverage.
4. `passed` order changed (a new pass moves the key to the end).
5. Plugin version stays 0.1.0 although the default changed.

**Test command**

```
cd retry-loop-breaker && node --test "tests/*.unit.ts"
claude plugin validate retry-loop-breaker && claude plugin test retry-loop-breaker
```

Output: `test-output.txt` (22 pass, 1 live skip; 10/10 engine).
