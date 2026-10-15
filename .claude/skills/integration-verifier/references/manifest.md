# Artifact contract

## Story result manifest (`integration-verifier/story-result@1`)

Each story agent commits `.integration/<story-id>.json` on its branch (one file per story so
branches never conflict on it). Paths in `log_path` are relative to the batch file's folder.

```json
{
  "schema": "integration-verifier/story-result@1",
  "story_id": "S2",
  "branch": "story/S2",
  "claimed_status": "done",
  "summary": "Adds the profile title helper.",
  "changed_files": ["src/profile.js", "tests/profile.test.js"],
  "checks": [
    { "name": "test", "cmd": "npm test", "exit_code": 0, "log_path": "logs/S2-test.log" }
  ],
  "acceptance_criteria": [
    { "id": "AC1", "claimed": "met", "evidence": [ { "type": "check", "name": "test" } ] },
    { "id": "AC2", "claimed": "met", "evidence": [ { "type": "human", "by": "qa-lead" } ] }
  ],
  "contracts": {
    "provides": [ { "name": "api.getUser", "signature": "getUser({ id })" } ],
    "consumes": [ { "name": "api.getUser", "signature": "getUser(id)" } ]
  },
  "config": { "app.pageSize": 20 }
}
```

Required: `schema`, `story_id`, `changed_files`, `checks`, `acceptance_criteria`.
`claimed_status` and `summary` are recorded but **never** count as evidence.
`claimed` per AC: `met` | `failed` | `unknown`.

## Batch file

```json
{
  "batch_id": "sprint-42-batch-1",
  "repo": "../ess-be",
  "base": "main",
  "required_checks": [
    { "name": "build", "cmd": "npm run build" },
    { "name": "test", "cmd": "npm test", "timeout_ms": 600000 }
  ],
  "stories": [ { "id": "S1", "branch": "story/S1" }, { "id": "S2", "branch": "story/S2", "manifest": "manifests/S2.json" } ],
  "artifacts": { "ac_coverage": "ac-coverage.json", "review_findings": "review-findings.json" }
}
```

- `ac_coverage`: `[{ "story": "S1", "ac": "AC1", "status": "covered" | "uncovered", "test": "…" }]`
- `review_findings`: `[{ "story": "S1", "severity": "High", "title": "…" }]` (from
  `review-pr-jev-classify` or `subagent-validator`; not re-run).

The combined run uses `git worktree add --detach <tmp> <base>`, merges each story branch in batch
order with `--no-ff`, runs `required_checks` there, then removes the worktree (`--keep-worktree`
to inspect it). The repository's own branches are never changed.
