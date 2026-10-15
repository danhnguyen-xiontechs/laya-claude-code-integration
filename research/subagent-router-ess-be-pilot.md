# subagent-model-router — pilot on real code (ess-be), 2026-10-15

**Question.** On real stories in a real .NET repo, does routing each subagent's model tier save quota without losing quality?
- Arm **B** = `subagent-model-router` in apply mode, rules only, with escalate-once.
- Arm **A** = subagents that inherit a Sonnet main thread.

**Answer.** On these 6 stories: yes.
- **Pass rate:** B passed everything A passed (12/12 runs green, no escalation needed).
- **Quota:** B used **36%** of A's subagent quota. Without the one story the rules sent to Opus, B used **6%**.

## Setup

- **Repo:** ess-be (ASP.NET Core 8, xUnit, about 5,070 tests), base `develop` @ `fce0c9fb`.
- **Worktrees:** one throwaway git worktree and branch per story × arm (`pilot/S{n}-{A|B}`). Each worktree was restored and built before its run. Everything was removed afterwards and nothing was pushed.
- **Stories:** 6, written for this pilot because most ADO stories have no description. They are below.
- **Prompt:** each story was implemented by one `general-purpose` subagent. Both arms got the same prompt, apart from the worktree path: the story, plus a fixed "definition of done" (0-warning build, suite green, add tests, one Conventional Commit, no push).
- **Arm A:** `model: sonnet`. This stands in for "inherit the main model": the user picked a Sonnet main thread, which matches history, where 75% of subagent spend inherited Sonnet.
- **Arm B:** `route.mjs --mode apply --provider none` on the exact prompt. This is the same `route()` the PreToolUse hook calls. The plan was escalate-once on a failed check (`--escalate-from`).
- **Automatic checks:** run after each subagent, invisible to it.
  - **Hidden tests:** xUnit tests copied in only after the run, then build + full suite, and the hidden tests removed again. They were validated beforehand against a reference implementation: 35/35 pass, and the suite stays green.
  - **"Suite green":** no failures beyond the 17 that fail on a clean checkout on this machine for environment reasons. These are 15 × `CiSignalScriptTests` (no `jq`), one DST test, and `OpenApiSnapshotTests` (CRLF in generated XML docs). So the OpenAPI snapshot gate was blind in this pilot.
  - **S5** also had a structural check: no copies left, no change out of scope, no existing test edited.
  - **S6** had the **build + suite only**, on purpose. It is the weak-check story, where escalation cannot catch a miss.

### Deviation from the planned harness (and why)

- **Plan:** each arm runs as a headless `claude -p` session inside its own worktree, with arm B's hook enabled through that worktree's `.claude/settings.local.json`.
- **Hook verified there:** a smoke run showed `SUBAGENT_ROUTER_MODE=apply` set via the `env` of `settings.local.json`, and the hook returned `haiku`. The subagent ran on `claude-haiku-5-5`, and the router log recorded the decision with the session id.
- **Blocked:** Claude Code's auto-mode safety classifier refused to let this session launch the 12 headless agent sessions from a script, first with `bypassPermissions` and then even with a scoped allow-list.
- **What was run instead:** the subagents were spawned from this session with the Agent tool. Arm A got `model: "sonnet"`, and arm B the tier from `route.mjs`. The routing decision is identical to the hook's, because it is the same function on the same text.
- **Side effect:** the subagents started with this session's cwd. The prompt told them to `cd` into the worktree. All 12 worked only inside their own worktree; this was checked by git log in each worktree, and this repo was untouched.

## Stories (text given to the subagents)

| # | Story | Kind / size | Check |
|---|---|---|---|
| S1 | **Validate leave request fields and dates up front.** Add rules to `CreateLeaveRequestRequestValidator`: LegalEntityId/LeaveType required, StartDate not default, EndDate ≥ StartDate when present, Comment ≤ 1000 chars, attachment rules unchanged. | validation, small | 13 hidden tests |
| S2 | **Search my certificates by keyword.** Optional `search` on `GET /api/certificate`: case-insensitive substring of Title/CertificateTypeId/Notes, trimmed, blank = no filter, ANDed with status/type, applied before pagination, never sent to D365. | new filter, small–medium | 11 hidden tests (service + controller) |
| S3 | **Bug: bank-account save returns 500.** Covers `{"data": null}` (NRE before the guard) and an empty PersonnelNumber that still writes to D365 (taken from ess-be's real `deferred-work.md`). Null data must behave like an empty list. A blank PersonnelNumber must give `ApplicationException` (400, not `D365Exception`) with no D365 call. | bug fix, small, with a trap: the catch-all re-wraps exceptions as `D365Exception` | 5 hidden tests |
| S4 | **`GET /api/staff-levels/{staffLevel}`.** Returns a `RecordResponse<StaffLevelDto>`. Case/whitespace-insensitive, 404 via `NotFoundException`, served from the same cache as the list (one D365 call). | small endpoint following an existing pattern | 6 hidden tests |
| S5 | **Use the shared OData escaper.** Replace the private `EscapeODataString` copies in 5 service folders (10 files) with `ODataFilterHelper.EscapeString`. Behaviour preserved, no test edited, nothing out of scope. | refactor, multi-file | structural script + suite |
| S6 | **Make swallowed batch deserialization failures visible.** `GetAsList`/`GetAsOrDefault` are static extensions with about 75 call sites and no logger in scope. *Decide* how, then log the index and type without D365 text (SEC-02), keep return values, and explain the design and rejected alternatives in the commit body. | design decision, medium | **weak: build + suite only** |

## Results

Cost is list-price USD (prices in `scripts/pricing.mjs`), computed from the subagent transcripts. On a Max plan this is the quota proxy.

| Story | A tier | A pass | A cost | A wall | B tier (rule why) | B pass | B cost | B wall | Escalation |
|---|---|---|---:|---:|---|---|---:|---:|---|
| S1 validation | sonnet | ✅ | 0.326 | 4.4 min | haiku (lookup, acs:5, checked) | ✅ | 0.020 | 2.6 min | — |
| S2 search filter | sonnet | ✅ | 0.241 | 3.7 min | haiku (lookup, acs:5, checked) | ✅ | 0.024 | 8.2 min | — |
| S3 bug fix | sonnet | ✅ | 0.428 | 8.3 min | haiku (lookup, checked) | ✅ | 0.023 | 6.1 min | — |
| S4 new endpoint | sonnet | ✅ | 0.763 | 11.8 min | haiku (lookup, acs:4, checked) | ✅ | 0.029 | 8.6 min | — |
| S5 refactor | sonnet | ✅ | 0.191 | 6.7 min | haiku (lookup, acs:4, checked) | ✅ | 0.014 | 5.1 min | — |
| S6 design (weak check) | sonnet | ✅ suite | 0.229 | 6.5 min | **opus** (hard:1 "alternatives", acs:5) | ✅ suite | 0.666 | 7.2 min | — |
| **Total** | | **6/6** | **2.177** | | | **6/6** | **0.775 (36%)** | | **0** |

Token detail per run:

| run | turns | output tokens | cache read | cache write |
|---|---:|---:|---:|---:|
| S1 A/B | 12 / 14 | 226 / 256 | 0.72M / 0.93M | 72k / 80k |
| S2 A/B | 11 / 20 | 592 / 189 | 0.72M / 1.66M | 37k / 60k |
| S3 A/B | 22 / 21 | 727 / 383 | 1.59M / 1.62M | 41k / 51k |
| S4 A/B | 39 / 24 | 1390 / 2131 | 3.07M / 2.02M | 54k / 64k |
| S5 A/B | 9 / 14 | 400 / 183 | 0.56M / 0.93M | 30k / 36k |
| S6 A/B | 11 / 16 | 487 / 236 | 0.70M / 1.12M | 33k / 87k |

The output-token counts look low because the transcripts record only the final usage block of each turn. The cost is dominated by cache reads and writes, which are complete.

- **Haiku was not slower overall.** It needed somewhat more turns on S2 and S5, but the wall time was similar. S2-B (8.2 min) and S4-A (11.8 min) were the slow outliers.
- **Wall times are noisy:** up to 10 subagents ran at once on one 12-core machine, each running `dotnet build` and the 5,000-test suite.

### Criteria (fixed before the run)

- **Criterion A, B passes everything A passes with diff quality not worse: MET.**
  - Both arms 12/12 on hidden tests and the suite, and both passed S5's structural check.
  - The diff review below found no B diff worse than its A twin.
- **Criterion B, B's subagent quota ≤ 50% of A's: MET, 36%.**
  - The five haiku stories cost 5.6% of their Sonnet twins: $0.110 vs $1.948.
  - The single Opus pick (S6, $0.666 vs Sonnet's $0.229) is 86% of B's spend.

### Diff-quality review (A vs B)

- **S1.** Both are minimal and in scope (validator + tests). B compares EndDate by calendar date, a stricter reading of "same day is valid". A compares full timestamps like the service does. Both pass the hidden tests; B's reading is arguably closer to the story. Not worse.
- **S2.** Near-identical designs (private `ApplySearchFilter` after the status filter, XML `<param>` doc, existing controller tests updated). B wrote more tests. Not worse.
- **S3.** Both caught the trap.
  - A added `catch (ApplicationException) { throw; }` ahead of the generic catch and null-guards `request` itself.
  - B moved both guards *before* the `try`, which is cleaner.
  - Not worse.
- **S4.** Both regenerated `openapi.json`.
  - A refactored `GetAllAsync` into a shared `GetCachedAsync`.
  - B called `GetAllAsync` from the lookup and added controller tests. It also reverted whitespace drift that snapshot regeneration caused in unrelated docs.
  - Neither added a rate-limit attribute, which matches the list endpoint (the global default).
  - Not worse.
- **S5.** Same 10 files and the same mechanical change (A: +37/−61, B: +37/−57). Neither touched tests. Not worse.
- **S6** (the weak-check story; this is where the tier mattered and no test could tell).
  - **A (Sonnet):** an optional `ILogger?` plus an **ambient static logger** set in `Program.cs`. The diff is small (3 files) and no call site changed. It does add mutable static state, which sits awkwardly with ess-be's CA-04 (DIP, "inject dependencies via the constructor") and makes tests order-sensitive.
  - **B (Opus):** a **required `ILogger` parameter**, with all 72 call sites in 15 services updated mechanically. 5 static helpers became instance methods, and `CalibrationBatchService` gained an injected logger. Its commit body rejects exactly the ambient-logger design that A chose. The diff is bigger (18 files) but more consistent with the repo's DI rules.
  - Both log only the index, type and exception *type* (SEC-02 safe), and both keep the return values.
  - **Verdict:** B is at least as good. It is the better fit for the conventions, at the cost of a larger diff. A reviewer could reasonably prefer either, but neither is wrong, and the suite cannot distinguish them.

## What the rules chose and why

| | rule tier | why (features) | without the false positive |
|---|---|---|---|
| S1, S2, S4, S5 | haiku | `lookup` + `checked` (+ size `acs:4/5`) | sonnet |
| S3 | haiku | `lookup` + `checked` | haiku |
| S6 | opus | `hard:1` (the word "alternatives" in AC4) + `acs:5` | opus |

- **Finding 1, a read-only false positive.**
  - **Cause:** the fixed definition-of-done line "Ignore those 17 and **do not change them**" matches `READ_ONLY_RE`. With a light verb present ("Read its CLAUDE.md"), the rules call every story a *lookup* and subtract a tier.
  - **Effect:** that sent S1/S2/S4/S5 to haiku instead of sonnet.
  - **Outcome:** it happened to work, and it is exactly why B was so cheap, but it was an accident of wording.
  - **Fix:** a `do not change` that refers to tests or other files is not a read-only task. Treat it as read-only only when there are no editing verbs.
- **Finding 2, Haiku was enough for every checked story here.** These were small and medium, well-specified stories in a repo with a strong CLAUDE.md and existing patterns to copy. That includes the bug with a trap and the 10-file refactor. This repeats the synthetic benchmark's result (rules + cascade, 14% of always-Opus) on real code.
- **Finding 3, the "hard" signal is the one that costs.** One keyword ("alternatives") sent S6 to Opus, which is 86% of B's spend, and Sonnet produced an acceptable answer for a third of the price.
  - Whether Opus was *needed* there is a judgement call: its design fits the repo better, and nothing would have caught a worse design.
  - For stories without an automatic check, paying for the stronger model is the intended behaviour.

## Escalations

None. All five haiku runs passed their hidden tests and the suite on the first try, so the cascade was never exercised on real code in this pilot. It was exercised in the synthetic benchmark.

## Caveats

- **Sample size:** 6 stories × 1 run per arm. There is no variance estimate, and a Haiku miss rate of perhaps 1 in 10 would not show at this size.
- **Story authorship:** I wrote the stories myself, with technical notes that pin method names so hidden tests can compile. Real ADO stories are vaguer, which favours stronger models.
- **Arm A emulation:** arm A is `model: sonnet` set explicitly, standing in for inheritance. Main-thread and orchestrator costs are not counted in either arm: this session's own cost, and in production the parent's re-wake per hand-back.
- **OpenAPI gate:** the snapshot gate was blind on this machine (CRLF), so API-surface drift was reviewed by hand only.
- **Commit identity:** the subagents had no git identity. They committed with per-command `-c user.name/email`; some used the user's email. Nothing was pushed, and the branches are deleted.

## Recommendation for the 20-story parallel workflow

1. **Stories with an automatic check** (hidden or acceptance tests, plus a suite that runs in the subagent's worktree): use **rules-only routing + escalate-once** (`provider none`). No prompt leaves the machine, routing takes about 2 ms, and on this evidence about 95% of the subagent quota is saved on routine stories. Make the check part of the orchestrator, not the subagent: run it after the hand-back and escalate on failure.
2. **Fix the `READ_ONLY_RE` false positive first.** Then routine checked stories will go to **sonnet** by design rather than haiku by accident.
   - **Option A, conservative:** keep that and accept about 50–60% savings vs Sonnet, from the Opus/Sonnet split only.
   - **Option B, cheaper (my recommendation):** add an explicit rule that a story with a hidden-test check and ≤ 2 named production files starts on **haiku**. This pilot plus the benchmark say Haiku + cascade is safe there, and the cascade bounds the downside.
3. **Stories without an automatic check:** these are design work, refactors judged by review, and docs. Use **Jev gate+sc** (or rules with a floor of sonnet). Do not route them to haiku, since nothing will catch a miss. Expect the occasional Opus pick, as here.
   - Jev's value is on these stories, not on checked ones: in the benchmark it sent most coding to sonnet, which costs more when a check plus the cascade would have been enough.
   - Jev requires accepting that prompts go to OpenRouter.
4. **Keep the parent cheap.** Twenty hand-backs each wake the orchestrator, so batch the result collection. Put the run, check and escalate loop in a script, if the environment allows the orchestrator to launch headless sessions. Here the auto-mode classifier did not, so that needs an explicit permission rule from the user.
5. **Before rolling out:** repeat with 15–20 real ADO stories, after the regex fix, so that a non-zero escalation rate becomes visible.

Raw data (prompts, check outputs, diffs, `measure.jsonl`) was kept in the session scratchpad. The hidden tests and story texts are reproduced here in summary.
