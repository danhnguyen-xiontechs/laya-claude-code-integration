# retry-loop-breaker

Claude Code mod (function hooks). Stops a test/build command that already failed the same way, with nothing changed since, from running again. Default `observe`: it only logs what it would block (`/retry-guard status`).

- Eligible: plain `npm/pnpm/yarn test`, `npm run build|typecheck|lint`, `tsc`, `jest`, `vitest`, `pytest`, `node --test`, `dotnet test|build`, `go test|build`, `cargo test|build`, `mvn test`, `gradle test`, plus `extraEligible`. Pipes, `&&`, `;`, redirects, env prefixes: never.
- Blocked (enforce only): same normalized command + same error fingerprint + no change, seen `maxIdenticalFailuresBeforeBlock` times (default 2), within `failureRecordTtlMinutes` (30).
- A change: successful Edit/Write/NotebookEdit, a Bash call the engine does not mark read-only, or a prompt asking to rerun. Transient errors, flaky tests, permission denials and interrupts never count.
- JEV (`OPENROUTER_API_KEY`, `typesafe/jev-1.13`): only for near-duplicates of a command at the threshold; blocks only on `block_redundant_retry` ≥ `jevMinConfidence` (0.8); timeout (`jevTimeoutMs` 4000), error or invalid output → allow.
- Main agent only (`mainAgentOnly`). `/retry-guard status`, `/retry-guard reset`.

Limits: the epoch misses edits made outside Claude's tools and is reset by unrelated edits; script aliases are not recognized.

## Run / test

```bash
claude --plugin-dir ./retry-loop-breaker
```

```bash
claude plugin validate retry-loop-breaker && claude plugin test retry-loop-breaker
```

```bash
cd retry-loop-breaker && JEV_LIVE=1 node --test tests/cases.unit.ts
```
