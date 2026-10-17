# Design — story-batch-planner, agent run `20261017-sbp-agent-01`

Frozen before step 6 (no data had been produced when this was written). The tool itself is not changed by this run.

## Tool under test (as implemented)
- Tool files (read from the base checkout `D:\XionTechs\Laya\.claude\skills\story-batch-planner\`, commit `73c4bda`): `scripts/planner.mjs` (rules, cycles, waves, Jev shadow), `scripts/plan.mjs` (CLI), `scripts/decision-provider.mjs` (OpenRouter call), `config.json`, `test/planner.test.mjs` (14 tests, no network), fixtures `fixtures/*.json`.
- CLI: `node scripts/plan.mjs --in batch.json [--out plan.json] [--jev|--no-jev] [--max-concurrency N] [--summary]`. Prints the human summary with `--summary`, else the JSON plan.
- Engine: deterministic rules decide the edges (explicit ADO link, text reference, contract producer→consumer, same DTO changed by both, migrations, schema readers, shared file/fixture, same module or topical overlap = ambiguous), the cycles, the blocked and incomplete stories, and the waves.
- Jev (`typesafe/jev-1.13`, OpenRouter) is shadow only. It is asked about ambiguous pairs only, capped by `jev.maxCalls` (10). Its label lands in `edges[].jev_suggestion` with `applied: false`. The waves never change.
- Fallback: invalid label, timeout, HTTP error, missing key or budget exhausted → `unknown`, handling `serialize_and_review`, waves unchanged.
- Flag: without `--jev` (or `jev.enabled: false`) the tool is rules only. Arm A never calls it.

## What Claude decides vs what the tool decides
- Tool: the dependency and conflict graph and the wave packing.
- Claude: the final JSON answer. Arm A works from the raw batch JSON alone. Arm B may use or ignore the planner summary.

## Arms (same case set, same prompt text, same model and effort)
Both arms: one fresh subagent per case, `model` from `route.mjs --mode apply --provider none` (expected `haiku`), `effort: "xhigh"`, one repetition, A and B of the same case launched in the same message. Each case gets its own work folder (`scratchpad\sbp\work\<case>.<arm>\`) containing `batch.json` and `plan.mjs`. `batch.json` is the fixture with its `expected` block removed (that block is the answer key; the review found that both arms would otherwise read the answer). Nothing else is changed.

Prompt P (the same text for both arms; the only differences are the work folder path and the B sentence):
> Work folder: `<work folder>`
> Here is a batch of stories (JSON in `<work folder>\batch.json`). Decide which stories can be implemented in parallel by separate agents and in what order. Answer with one JSON object {"waves": [[ids...]], "needs_decision": [ids...]} and one line of reasoning.

Arm B adds: `A planner tool is available: run \`node plan.mjs --summary\` in this folder.`

- `plan.mjs` in arm A is a neutral wrapper that prints `planner disabled` and exits 0. Arm A's prompt never mentions it.
- `plan.mjs` in arm B is a neutral wrapper that runs the real `scripts/plan.mjs --in batch.json --out <scratch>\sbp\_logs\<case>.B.plan.json --jev --summary` in its own folder, prints the planner's summary to stdout, and appends one line to `_logs/<case>.B.jsonl` (waves, Jev shadow counts, Jev labels on the edges). The child process gets `HOME` and `USERPROFILE` pointing at a scratch folder, so the planner's default Jev log (`~/.story-batch-planner/jev-shadow.jsonl`) is not written under the user's home directory.

## Cases and what "pass" means
Each case passes when the agent's final answer is one parseable JSON object with `waves` (array of arrays of batch story ids) and `needs_decision` (array of ids), and all of the following hold. The checks are in `grade.mjs`, which reads the answer text saved from the transcript, not the agent's own claim.

| Case (fixture) | Hard invariants |
|---|---|
| 03-api-dto | S-1 is in an earlier wave than S-2 (S-2 consumes the endpoint S-1 adds). S-1 and S-3 are not in the same wave (both change `LeaveBalanceDto`). |
| 04-migration | S-1 is not in the same wave as S-2 (both add migrations). S-1 is not in the same wave as S-3 (S-3 reads the `employees` table that S-1 changes). |
| 06-explicit | S-1 is in an earlier wave than S-2 (explicit ADO link) and than S-3 (text reference "Builds on S-1"). |
| 07-cycle | S-1, S-2 and S-3 (the cycle) are in no wave and are in `needs_decision`. S-4 (depends on S-3) is in no wave. S-5 (independent) is in some wave. |

Common to all four: each story id appears at most once across `waves`, and every batch story is either in `waves` or in `needs_decision`. Nothing is silently dropped. A story may appear in both `waves` and `needs_decision`; the rules below read `waves` only.

Ordering rule used by the grader: "X is in an earlier wave than Y" holds when Y is not in `waves` (Y deferred to `needs_decision`), or when X and Y are both in `waves` and X's wave index is lower. If X is deferred but Y is scheduled, the rule fails.

Any wave order that satisfies the invariants passes. Pass is a correctness test only: it does not reward parallelism. The number of waves is recorded in `observedOutcome` for each arm as a directional note (not gated); the pair S-2/S-3 in 03 and 06 is not constrained by the fixtures and is not graded.

Case status: `pass` if all invariants hold; `fail` if the answer parses and an invariant breaks; `error` if no final answer could be read from the transcript. A run with no transcript at all is `blocked`.

## Retry rule
If a case agent fails its check, retry it once with `route.mjs --escalate-from <model>`, as the brief says. The retry runs in a new work folder `work/<case>.<arm>.retry/` (same prompt, same batch copy), so the first attempt keeps its own transcript and token count. The first attempt is the scored result. Any retry is recorded separately in `evidence/retries.json` (both attempts' status and tokens) and in the deviations, not merged into the scored table. Tokens of a retry are reported next to the first attempt, never added to it.

## Tokens
- Agent run: `subagent_usage.mjs <subagents folder> <work folder A/B for each case>` gives each case's real API usage (input, output, cache read, cache write) from its transcript. A work folder matching no transcript or two transcripts is `null`, never estimated.
- `usage.providerCalls` = number of Jev shadow calls per case, counted from `_logs/<case>.B.jsonl`. `usage.providerLatencyMs` = median Jev latency of those calls. The review found that a call made without `OPENROUTER_API_KEY` is also counted (latency 0). The log's `valid` and `error` fields are therefore checked, and the number of invalid Jev answers per case is reported next to the call count.
- Only cases that are `pass` or `fail` in both arms enter the token comparison (`build_tool_report.mjs` rule).

## Evidence
- `evidence/texts/<case>.A.txt` = the raw batch JSON the arm-A agent read (the first thing it saw).
- `evidence/texts/<case>.B.txt` = the planner summary the arm-B agent first received (its first `plan.mjs` tool result, taken from its transcript).
- `evidence/answers/<case>.<A|B>.txt` = the agent's final answer text, taken from its transcript. `grade.mjs` reads these.
- `evidence/_logs/` = copies of the planner's `_logs` (pair ids, labels, probabilities, latency; no key or headers).

## Unit tests and review
- Unit tests: `node --test ".claude/skills/story-batch-planner/test/*.test.mjs"` from the repo root (on this Node 24, `node --test <dir>` fails). `unit-tests.json` is written from the real output.
- Review: one read-only `Explore` subagent with a fresh context, routed by `route.mjs`. It reads this design, the idea brief, the tool scripts, the test file and the fixtures, and returns findings. The orchestrator writes them to `agent-review.json` (no finding is fixed here: the tool is not edited).

## Known deviations (stated before the run)
1. The session worktree `.claude\worktrees\skill-build-workflow-review-af9324` is an empty folder with no checkout. The tool, fixtures and workflow are read from the base checkout `D:\XionTechs\Laya` (commit `7849acd`). All writes go into the worktree experiment folder (the worktree path is required by the session's edit guard).
2. Jev is live only on the ambiguous pairs of 03-api-dto and 06-explicit. 04-migration and 07-cycle have no ambiguous pair, so arm B there is rules only.
3. 4 cases x 1 repetition. Results are directional.
4. Fixture 06: S-4 links to OPS-99, which is not in the batch. The fixture expects S-4 in a wave, but the pass rule only requires it to be in `waves` or `needs_decision`. An agent that holds S-4 back in `needs_decision` still passes; the summary notes it as over-caution, not as a failure.
5. The fixtures are synthetic, 3 to 5 stories each.
