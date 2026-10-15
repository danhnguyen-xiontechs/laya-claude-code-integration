# Summary Report: Laya & Jev in Claude Code

**Period:** 2026-09-30 → 2026-10-15 · **Repo:** `danhnguyen-xiontechs/laya-claude-code-integration` · **Author:** Danh Nguyen · **Prepared:** 2026-10-15

> **Test levels**
> ✅ **Real**: run end-to-end for real (real ESS environment, real PR, real Claude Code) ·
> 📊 **Offline**: evaluated on a dataset, not inside a real skill run ·
> 🧪 **Unit test**: automated script tests only ·
> 💡 **Idea**: design document only
>
> **Verdict labels:** `ADOPT` ready to use · `PILOT` keep trying, with conditions · `SHADOW` runs alongside, log only · `SHELVED` paused · `DROP` abandoned · `IDEA` not built

---

## 1. Executive summary

**Goal:** evaluate two "decision engines" (small models that pick one answer from a fixed list and return probabilities) as replacements for repeated LLM calls that classify, route or verify. The expected outcome is adopt / pilot / drop, backed by numbers.

**Built:** 14 skill variants (2 of `review-pr`, 10 of `web-test`, 2 of BMad), 5 new skills built from scratch with Jev (`JEV` repo), 8 new tools (model-routing proxy, per-step workflow, ado-classify, error-triage hook, cache-expiry hook, laya-launcher, fast-compact, Laya install package) and about 10 evaluation experiments.

**Key findings:**

1. **Laya (self-hosted) almost never beat a simple baseline.**
   - Model routing cost more than always using Sonnet (1.43x).
   - Error triage reached 57.5%; Sonnet reached 97.5%.
   - In the web-test skills Laya was rarely confident enough to decide on its own (median p ≈ 0.5).
   - **The one exception:** `ado-classify` (a BM25 shortlist, then Laya picks) found the right module for **18/20** real tasks → `PILOT`.
2. **Jev (hosted by TypeSafe, called through OpenRouter) was clearly more accurate than Laya offline.**
   - Write-gate accuracy 96%; page-wait accuracy 96%.
   - About 5× faster than Laya on page-wait (~0.6 s) and nearly free ($0.0185 for 837 calls).
   - **However:**
     - Jev is **confident even when wrong** (median p 0.99), so raising thresholds does not filter out its errors.
     - In real agent runs on ticket 11840, **no variant (Laya or Jev) reduced tokens or turns** compared with the original skill.
     - Data (ESS page text, code excerpts) **leaves the company network**. Claude Code auto mode blocks these calls as "Data Exfiltration". Security has not been consulted.
3. **The real value came from the fixed rules and scripts that shipped with the variants, not from the models:**
   - rule-based element finder `find.mjs`
   - page-ready rules in `wait.mjs`
   - the write-gate network audit
   - the cache-expiry hook
   - fast-compact (254k → 57k tokens in 57 ms, with no model call)
4. **review-pr + Jev: good on a test PR, but failed the real test.** On 10-15, PR 5240 was re-run as a controlled A/B: Claude reviewed once and found 18 findings, then both engines judged those same 18.
   - **Jev:** agreed on 12/18. Every disagreement was an **upgrade** (the safe direction). It kept all 5 Critical findings at Critical. It cost $0.0006 and took 5.6 s per PR.
   - **Laya:** agreed on only 7/18. It downgraded 4 of the 5 Criticals and pushed 3 merge-blocking findings down to Suggestion.
   - **Real test on 8 merged ess-be PRs:** only 2 of 8 of Jev's upward flags were real issues (25%, below the 50% random base rate).
   - → `review-pr-jev-classify` moves back to `SHADOW`. Laya: `DROP`.
5. **5 new skills built from scratch around Jev (`JEV` repo)** all work in real Claude Code: 7 sessions, Claude picked the right skill on its own, 84/84 unit tests pass → `PILOT`. Jev's contribution is uneven: high in `acceptance-criteria-coverage` and `dead-code-finder`, about 50/50 in `subagent-validator`, low in `git-risk-scanner` and `context-curator`.
6. **2 BMad + Jev skills** (`bmad-help-jev`, `bmad-code-review-jev`) are built and well designed (BMad core untouched), but have **unit tests only** (17/17) and have never run against live Jev → they need a pilot before any verdict.
7. **`skills-router`** (a broad skill-suggestion skill, new build): on 199 synthetic scenarios, after round 2, Jev is 91% accurate against BM25 75% and Laya 54–62%; but on 368 real prompts Jev only ties BM25 (50%) and labels are scarce. → `PILOT`: BM25 by default, Jev as an optional second stage.
8. **`subagent-model-router`** (per-subagent model choice, new build): on 18 tasks with an automatic check, rules + escalate on failure pass 18/18 at **14% of the cost** of always using Opus (always-Sonnet 61%, Jev 48%). **Pilot on 6 real ess-be stories:** 6/6 passed, as with Sonnet, at **36% of subagent quota**. → `PILOT` with the best real evidence, the largest quota-saving potential for running many stories in parallel.

**Recommendation:**
- Do not use Laya as an automatic router or classifier.
- `PILOT` ado-classify as a suggestion tool.
- `PILOT` Jev only for the review-pr severity check (as a safety net; Claude still decides) and for write-gate, page-wait and oracle (oracle must never auto-record FAIL), and **only after Security approves sending data off the network**.
- `PILOT` the 5 new Jev skills on a real team repo, alongside a run where Claude does the same work without the skill, for comparison.
- `ADOPT` the rule-based parts now, including the `web-test-laya-ground` skill (the best variant in real runs, thanks to its `find.mjs` rules) and the `fast-compact` plugin (77% context reduction in 57 ms, with no model call).

---

## 2. What Laya and Jev are

| | **Laya** | **Jev** |
|---|---|---|
| Source | Open source (Apache-2.0), github.com/NandhaKishorM/laya | TypeSafe hosted service, via OpenRouter Decisions API |
| Model | BERT-style encoder, 322–421M params (`english`, `multilingual`, `typed-decisions` checkpoints); does not generate text | `typesafe/jev-1.13-20260917` |
| Where it runs | Local machine (CPU), `laya-serve` on port 8000 | Cloud; **data leaves the network** |
| Measured speed | p50 ~0.3–0.9 s for a short question (CPU); 2.8 s with page text; a 4k-token input takes 15 s | p50 ~0.54–0.59 s |
| Cost | $0, but a 2.2 GB model, ~2 GB RAM, 30–40 s start-up | ~$0.00002 per call |
| Question types | `choice`, `score`, `noul` (yes/no) | Same ("System One" API) |
| Measured weaknesses | Probabilities cluster at 0.4–0.6 (under-confident); its `confidence` field is not the top probability; each option description is cut at 48 tokens; probabilities are uncalibrated at 11+ options; weak on Vietnamese | Over-confident (p≈0.99 even when wrong); needs `OPENROUTER_API_KEY`; blocked by Claude Code auto mode |

---

## 3. Overview: every item and how it was tested

| # | Item | Kind | Engine | Test level | Verdict |
|---|---|---|---|---|---|
| A1 | `review-pr-laya-classify` | Applied to existing skill (`review-pr`) | Laya | ✅ PR 5240 ×2 · 🧪 42/42 | `DROP` (Laya falls short; A2 has all its features) |
| A2 | `review-pr-jev-classify` | Applied to existing skill (A/B) | Laya / Jev | ✅ PR 5240 ×2 + 8 merged ess-be PRs · 🧪 87/87 | `SHADOW` (real test failed the criteria) |
| A3 | `web-test-laya-wait` | Applied to `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` model, `ADOPT` rules |
| A4 | `web-test-laya-verdict` | Applied to `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` |
| A5 | `web-test-laya-gate` | Applied to `web-test` | Laya | ✅ staging (no write steps) · 📊 | `DROP` model, `ADOPT` audit |
| A6 | `web-test-laya-oracle` | Applied to `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` |
| A7 | `web-test-laya-ground` | Applied to `web-test` | Laya | ✅ dev ×3 | `ADOPT` skill (thanks to `find.mjs` rules; Laya barely involved) |
| A8 | `web-test-jev-wait` | Applied to `web-test` | Jev | ✅ staging · 📊 · 🧪 7/8 | `PILOT`* |
| A9 | `web-test-jev-verdict` | Applied to `web-test` | Jev | ✅ dev + staging · 📊 · 🧪 10/11 | `DROP` (not by default) |
| A10 | `web-test-jev-gate` | Applied to `web-test` | Jev | ✅ staging · 📊 · 🧪 11/12 | `PILOT`* |
| A11 | `web-test-jev-oracle` | Applied to `web-test` | Jev | ✅ staging · 📊 · 🧪 11/12 | `PILOT`* (never auto-FAIL) |
| A12 | `web-test-jev-ground` | Applied to `web-test` (A/B) | Laya / Jev | ✅ Laya only · 🧪 6/6 (Jev path never run for real) | Not enough data |
| A13 | `bmad-help-jev` | Applied to existing skill (BMad `bmad-help`) | Jev / Laya / Kev | 🧪 9/9 (never run against live Jev) | Not enough data |
| A14 | `bmad-code-review-jev` | Applied to existing skill (BMad `bmad-code-review`) | Jev / Laya / Kev | 🧪 8/8 (never run against live Jev) | Not enough data |
| B1 | Router proxy (picks Haiku/Sonnet/Opus) | New tool | Laya | ✅ real Claude Code + 15-task benchmark | `SHELVED` |
| B2 | Per-step model workflow | New tool | Laya | ✅ 2 real tasks | `DROP` |
| B3 | Error-triage hook | New tool | Laya | 📊 89 real failures + 40 held-out | `DROP` |
| B4 | `ado-classify` (suggests code module) | New tool | BM25 + Laya | 📊 20 real ESS tasks | `PILOT` |
| B5 | Cache-expiry gate hook | New tool | No model (rules) | ✅ in use · 🧪 29 tests | `ADOPT` |
| B6 | `laya-launcher` (trims tools/context by intent) | New tool | Laya | ✅ manual + 5-run A/B | `PILOT` (as static flags) |
| B7 | `fast-compact` plugin | New tool | Jev tried and dropped; runs on rules | ✅ 1 session · 📊 · 🧪 13 tests | `ADOPT` (merged into `main`, PR #3) |
| B8 | Laya Windows install package | New tool | Laya | ✅ installed on 2 machines | `DONE` |
| D1 | `acceptance-criteria-coverage` | New skill (`JEV` repo) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` |
| D2 | `dead-code-finder` | New skill (`JEV` repo) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` |
| D3 | `git-risk-scanner` (+ hook) | New skill (`JEV` repo) | Jev | ✅ 2 sessions · 📊 · 🧪 | `PILOT` |
| D4 | `subagent-validator` (hook) | New skill (`JEV` repo) | Jev | ✅ 3 runs · 📊 · 🧪 | `PILOT` |
| D5 | `context-curator` | New skill (`JEV` repo) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` (shadow) |
| D0 | `jev_advisor` (test wrapper, base of D5) | New tool (`JEV` repo) | Jev | ✅ A/B/C 30 runs · 🧪 | `PILOT` |
| E1 | `skills-router` (broad skill suggestion, inspired by `bmad-help`) | New skill | BM25 + Jev / Laya (optional) | ✅ 368 real prompts · 📊 199 scenarios · 🧪 65/65 | `PILOT` (BM25 default, Jev optional) |
| F1 | `subagent-model-router` (per-subagent model choice) | New skill + hook | Rules + Jev (optional) | ✅ 6 real ess-be stories (36% quota) · 📊 18-task benchmark · 🧪 20/20 | `PILOT` (best real evidence) |
| C1–C9 | Evaluation experiments (section 8) | Research | Laya / Jev | 📊 / ✅ | See section 8 |

\* Provided Security approves sending data off the network. For the `web-test` skills, the "wrong tab" bug is fixed on branch `claude/web-test-fixes-4fdcd7` and needs a re-run on ESS.

---

## 4. Group A1–A2: `review-pr` + Laya / Jev

### 4.1 The original `review-pr` (`xt-skills` repo, `xt-dev-tools` plugin)
- Reviews one PR (Azure DevOps / GitHub / GitLab) against the project's rules. Claude reads the whole diff and assigns Critical / Major / Minor / Suggestion to each finding.
- Scores from 100 down (Critical −30, Major −12, Minor −4, Suggestion −1). The verdict is score-based: anything below 100 means "Request Changes".
- Read-only by default; `--post` posts comments only after confirmation. No extra model step and no execution log. Unit tests: **65/65 pass**.

### 4.2 The three versions compared

| | `review-pr` (original) | `review-pr-laya-classify` | `review-pr-jev-classify` |
|---|---|---|---|
| Who sets severity | Claude | Claude; Laya checks independently (advisory) | Claude; Laya **or** Jev checks (`--provider laya\|jev`) |
| Questions handed to the engine | — | (1) `severity` per finding, one of 4 levels; severity words are removed so the engine is not led. (2) `merge_gate` per PR: Blocked when P ≥ 0.29 | Identical (same input, same thresholds) |
| Modes | — | `off` / `shadow` (default, log only) / `recheck` (Claude re-checks up to 3 findings the engine disputes) | Same |
| Verdict / merge | Score-based | **3 states from severity:** 🔴 Blocked / 🟡 Eligible with suggestions / 🟢 Eligible; score is informational only | Same |
| Extra output | `report.md` | `findings.json`, `laya.json`, `run-notes.json`, `execution-log.html` (real tokens), one folder per review | Plus `.jev.json` (tokens and cost per call) |
| Data leaves machine | No (beyond Claude) | No | **Yes**, with Jev |
| Unit tests | 65/65 | **42/42 pass** | **51/51 pass** |

### 4.3 First run: PR 5240 (`ess-be`, a test PR with seeded defects), 2026-10-13, shadow mode

| | Laya | Jev |
|---|---|---|
| Claude reviewer model | Opus 5.5 | Sonnet 5.5 |
| Findings from Claude | 15 | 17 |
| Engine agreed with Claude | 10/15 (67%) | 11/17 (65%) |
| Direction of disagreement | **Downgrades (dangerous):** the AUTHZ data-leak finding went from Critical to Minor | **Upgrades (safer):** all 4 Minors went to Major at p 0.68–0.97 |
| Confidence | Low and flat (0.28–0.56) | Near 0 or 1; does not separate right from wrong |
| Merge question | Blocked (P 0.549), matches the rule | Blocked (P 1.0), matches the rule |
| Engine step time per PR | 15.9 s | 6.5 s |
| Engine step cost | $0 | $0.0005 |
| Claude turns / input tokens | 18 / 2.25M | 9 / 1.06M |

**Caveat:** this was **not a controlled A/B**. The two runs used different reviewer models, so the findings differed. The re-run in section 4.4 fixes this.

### 4.4 Controlled re-run: PR 5240, 2026-10-15

**How it ran:** Claude (Opus 5.5) reviewed once, then Laya and Jev both judged the **same** findings file. Shadow mode; nothing was posted to the PR.

**Claude's review:**
- 18 findings: 5 Critical, 8 Major, 4 Minor, 1 Suggestion → 🔴 Blocked, coverage 8/8.
- 22 turns, 3.14M input tokens (98% cache reads), 24.9k output tokens, about 5 minutes.

| | Laya | Jev |
|---|---|---|
| Agreed with Claude | 7/18 (39%) | **12/18 (67%)** |
| Criticals kept at Critical | 1/5 (4 downgraded) | **5/5** |
| Direction of disagreement | 6 down, 5 up | **6 up, 0 down** |
| Disagreements crossing the merge boundary (Critical/Major ↔ Minor/Suggestion) | 8, including 3 merge-blocking findings pushed to Suggestion (TH-04 D365 call in a loop, TH-03, C-03) | 4, all Minor → Major (TEST-02, RATE, Bug, DOC-API) |
| Confidence | 0.28–0.44 (all low) | 0.47–1.00 |
| Merge question | Blocked, P 0.60 (correct) | Blocked, P 1.00 (correct) |
| Time (18 findings + merge question, in parallel) | 18.2 s (median 1.66 s per call) | **5.6 s** (median 0.54 s per call) |
| Cost | $0 | $0.0006 (14.2k input / 0.9k output tokens) |

**Compared with the 10-13 runs:**
- Jev kept the same pattern: upgrades only, about 2/3 agreement.
- Laya got worse: from 10/15 down to 7/18, and it now disagrees in both directions.
- Both engines still upgrade Minor findings to Major.

Logs: `~/.xt-skills/review-pr-jev-classify/reviews/…/pr-5240/20261015-093824-ab/`.

### 4.5 Verdict for the review-pr group

**`review-pr-jev-classify` with `--provider jev`: `PILOT`.**
- Jev only upgrades and missed no Critical, so it fits the role of a **safety net**: when Jev rates a finding higher, Claude takes one more look (`recheck` mode, at most 3 findings per PR), and Claude still decides.
- Cost is close to zero, plus about 6 s per PR.

**Still needed before switching on `recheck`:**
1. Runs on several real PRs (not a seeded-defect PR).
2. Human labels, to tell whether Jev's 4 Minor → Major upgrades are right or false alarms.
3. A way to pick which findings to re-check. Jev is always very confident (0.89–0.97 on all 4 upgrades), so a probability threshold filters almost nothing; selection has to rely on the cap of 3 per PR, and that needs measuring.
4. Security approval for sending code excerpts to OpenRouter.

**`review-pr-laya-classify` (Laya): `DROP`.**
- Agreement is low, and Laya pushes merge-blocking findings down to Suggestion.
- The skill's other improvements are all in the Jev version too: 3-state verdict, findings file, execution log, one folder per review.

**`merge_gate` question:** both engines were right in both runs, but it is log-only for now. Laya's margin is very thin: in trials the threshold was 0.29 and the lowest correct value was 0.299.

### 4.6 Upgrade on 2026-10-15 (branch `claude/review-pr-jev-upgrade-2bbb34`, commit `1b56660`)
- **Picking findings for Claude to re-check without a threshold** (`stable-disagreement` policy):
  - Jev is asked 3 more times, with the option order shuffled each time.
  - A finding is flagged only when all 3 answers match, differ from Claude's severity, and cross the merge boundary. At most 3 per PR.
  - On PR 5240: 17/18 findings were stable 3/3. Only F14–F17 (Minor → Major) were flagged, filtering out 2 of Jev's 6 disagreements with Claude (F9 and F18 do not cross the merge boundary). $0.003 for 109 calls.
- **2 new yes/no questions** (logged only; they do not change the review):
  - `introduced_by_pr` ("caused by this PR?"): yes on 18/18. Correct, since every cited line is newly added, but this test PR cannot tell the question apart from always answering yes.
  - `already_raised` ("already raised in a thread?"): yes on 17/18, matching the earlier AI review threads (5 findings checked by hand).
- **Labels from real outcomes** (`outcome-labels.mjs`): compares the commit at review time with the PR's final commit; a finding whose code region changed afterwards is labelled `fixed`. Tested only with fake data, not yet on a real PR.
- **2 log bugs fixed:** the `rules` field now uses the project's rule ids and overrides; the execution-log header shows both providers.
- 🧪 **87/87 tests pass.** Not merged, and `recheck` is not switched on for real PRs: it needs labels from many PRs to tell whether the flags are right.

### 4.7 Real test on 8 merged ess-be PRs (2026-10-15, commit `515b077`)
- **How:**
  - 8 merged ess-be PRs: 5231, 5328, 4820, 5264, 5199, 4635, 4431, 4500.
  - These PRs have almost no review threads on ADO, so Claude re-reviewed each PR blind, at the commit **before** the author's fixes. 14 findings in total.
  - Jev ran in shadow mode (`stable-disagreement`, k=3, plus both yes/no questions).
  - Labels came from `outcome-labels.mjs`: a finding the author later fixed counts as a real issue.
- **Criterion A (≥ 50% of Jev's upward flags are real issues): failed.** Only 2 of 8 flags were later fixed (25%), while the base rate across all findings is 50%. So Jev's flags did **worse than random**. Jev rated 10 of 14 findings Major and was very stable: consistently wrong, not noisy.
- **Criterion B (no merge-blocking finding downgraded): passed,** but it tests nothing, since Jev downgraded nothing.
- **The labels may undercount:** 3 of the 7 "unchanged" findings were actually fixed in a doc or test file rather than at the cited line. Counting those, A would reach about 50–62%. That reading was not fixed before the run, so it is not used for the verdict.
- **The 2 yes/no questions taught nothing:** `already_raised` was always no, because the PRs have no threads; `introduced_by_pr` was wrong both times it said no.
- **Bright spot for Claude itself:** Claude's review matched what the developer later fixed on several PRs (5264, 5199).
- **Cost:** Jev $0.002. Claude about 673k subagent tokens (against the Max quota).
- **Limits:** only 14 findings on small PRs, which is weak evidence.

**New verdict:** `review-pr-jev-classify` moves from `PILOT` to `SHADOW` (runs alongside, log only).
- The idea "Jev only upgrades, so it can be a safety net" **does not hold on real PRs**: on PR 5240 the upgrades looked right because the PR had seeded defects, but on real PRs Jev mostly bumps everything to Major.
- To try again: flag only when the project rule's default severity agrees with Jev, and count fixes made in the doc or test file the rule points to.

---

## 5. Group A3–A12: `web-test` + Laya / Jev

### 5.1 The original `web-test`
- Fetches the ADO ticket (`gemseducation/GEMS-HR-SCM`) and builds test cases from the ACs (plus negative / edge / regression cases).
- Opens a browser per role (chrome-devtools MCP, with playwright-cli as fallback) and takes a screenshot at every step.
- **Claude decides** pass / fail / blocked for each step. Before write steps it asks the user once (D365 is shared).
- Produces `report.html` and `execution-log.html` (with real tokens). No unit tests.

### 5.2 The five "plans": which decision is handed to the engine

| Plan | How the original does it | What the variant hands to the engine | Threshold / fallback |
|---|---|---|---|
| **wait** | Claude loops `wait_for` + snapshot | `wait.mjs` asks three questions in one call: has the page finished loading (ready/loading/error), which screen is it (one of 12 ESS screens), is it a login page | p ≥ 0.6. Rules decide first; the engine is asked only when the rules are stuck |
| **verdict** | Claude records the status | `verdict.mjs`: the engine picks pass/fail/blocked from `expected` and `actual` | ≥ 0.85 recorded automatically; 0.60–0.85 recorded with a review flag; < 0.60 left to Claude |
| **gate** | One question to the user | `gate.mjs`: the engine labels each step write or read. If the engine or the keyword rule disagrees with Claude, Claude must re-check. `netlog.mjs` records every write (non-GET) request for audit | p(write) ≥ 0.5 → suspect; Claude can never downgrade a step it marked write |
| **oracle** | Claude records the status | `oracle.mjs`: rules check first, then the engine, then Claude | Pass needs p ≥ 0.95, fail needs p ≥ 0.85; anything else → review |
| **ground** | Claude reads a snapshot to get uids | `find.mjs`: exact-name rule, then the engine ranks 2–15 candidates, then a short list | p ≥ 0.8 and ≥ 0.25 ahead of the runner-up |

- **Laya versions** call `localhost:8000` (local CPU). The engine is always optional: when it is off or fails, the skill falls back to rules or to Claude.
- **Jev versions** are mechanical copies of the Laya versions, with the engine switched to OpenRouter. They keep the same questions, labels and thresholds, and add a one-time consent step plus a separate cost log.
- **The exception:** `jev-ground` is an A/B copy with a `--provider` switch, and its default is still Laya.

### 5.3 Laya vs Jev: offline evaluation (2026-10-14, `eval/REPORT.md`)

| Plan | Metric | Laya | Jev |
|---|---|---|---|
| **gate** (24 held-out cases) | Missed writes / reads wrongly flagged as writes / accuracy | 1/12 · 9/12 · 58% | **0/12 · 1/12 · 96%** |
| **wait** (51 pages) | Finished pages correctly confirmed ready | 0/24 | **72/72** |
| | App pages wrongly called login | 14/44 | **0/132** |
| | Page-state accuracy | 70.6% | **96.1%** |
| | Live test on Edge (8 scenarios) | 5/8 | **8/8** |
| **verdict** (73 steps) | Decides alone / precision when deciding | 37% / 82% | 96% / 88% |
| | 20 real steps only: precision when deciding | 67% | **52%** (poor) |
| **oracle** (81) | Decides alone / false passes | 2.5% / 0 | 69% / 0 (but 3 of 30 passing steps marked fail) |
| **Latency p50** | gate / verdict / oracle / wait | 579 / 648 / 863 / 2820 ms | 538 / 537 / 568 / 586 ms |
| **Cost** | | $0 (2.2 GB model) | $0.0185 for 837 calls |

### 5.4 Real agent runs: ticket 11840, 2026-10-15 (one fresh session per variant, read-only)

Most runs used staging, because dev was throttled by D365 (429).

| Variant | Tokens | Time | Engine decided / passed to Claude | Result |
|---|---|---|---|---|
| web-test (original) | 87k | 281 s | – | PASS |
| laya-verdict | 96k | 559 s | 0 / 4 | PASS |
| jev-verdict | 97k | 572 s | 2 / 0 | PASS |
| laya-wait | 100k | 222 s | 4 by rules / 1 timeout | PASS⚠️ |
| jev-wait | 92k | 219 s | 4 / 0 | PASS⚠️ |
| laya-oracle | 97k | 195 s | 0 by Laya / 1 | PASS⚠️ |
| jev-oracle | 94k | 217 s | 1 wrong "fail", corrected by Claude | PASS⚠️ |
| laya-gate | 101k | 233 s | 1 dispute, overruled | PASS |
| jev-gate | 96k | 168 s | 2 correct reads | PASS |

⚠️ Because of a bug, `wait.mjs` and `oracle --observe` read a hidden tab, so the engine never saw the page under test.

**Real-run verdict:** no variant reduced tokens or turns compared with the original. Jev cost $0.00002–0.0013 per run.

### 5.5 Real runs on ESS dev, 2026-10-09 → 10-12 (`ess-test-runs/`)

| Ticket | Skill | Turns / time | Result |
|---|---|---|---|
| 19358 | laya-wait | 20 / 2 min | BLOCKED (test data belongs to another employee) |
| 19358 | web-test (original) | 27 / 2 min | PASS |
| 11840 | web-test (original) | 19 / 3 min | BLOCKED, 1 case |
| 11840 | laya-verdict | **38** / 3 min | PASS, but Laya was never confident enough |
| 11840 | laya-oracle | 35 / 3 min | BLOCKED, 1 case; 0 steps decided by Laya |
| 11840 | laya-ground | **16** / 2 min | PASS; every step solved by rules |
| 11840 | jev-ground (running Laya) | 24 / 3 min | BLOCKED, 1 case; Jev path never run |
| 11840 | laya-ground | 22 / 2 min | PASS; every step solved by rules |

On ticket 11840 the test account has no actual hours, so the key "0 vs 55" bug case has never been reproduced.

### 5.6 Recommendations for `web-test`

| Skill | Recommendation |
|---|---|
| jev-gate | `PILOT`: use Jev alone, drop the OR with the keyword rule, keep the network audit (100% recall, 1/12 false flags) |
| jev-wait | `PILOT`: filter page text before sending, keep the regexes, let `error` win over `login` |
| jev-oracle | `PILOT`: keep PASS at 0.95, **never auto-record FAIL** |
| jev-verdict | `DROP` as default: weak on steps that refer to other steps; consider merging into oracle |
| **laya-ground** | `ADOPT`: **the variant most worth using.** Real runs on 11840: PASS both times; compared with the original it took fewer turns (16 vs 19), fewer input tokens (1.4M vs 1.7M), less time (2 vs 3 min), and never had to read a page snapshot. **The gain comes from the `find.mjs` rules, not from Laya:** of 77 logged element lookups, the rules solved 58 (75%) and 16 returned a short list for Claude to pick from. Laya decided only 3 times (during trials on 10-08) and **got all 3 wrong at p = 1.0**, including one pick for a "Submit" button. → Use this skill with Laya **off** (or merge `find.mjs` into the original `web-test`). Note: the baseline run covered 3 cases, the ground run 2. |
| Remaining Laya versions (wait, verdict, gate, oracle) | `DROP` the model. Move the `wait.mjs` rules and the gate network audit into the original `web-test` (`ADOPT`) |

### 5.7 Bug fixes on 2026-10-15 (branch `claude/web-test-fixes-4fdcd7`, commit `0adb7a7`)
- **Wrong tab:** a new `page-select.mjs` picks the tab in a clear order (skip hidden tabs, prefer the focused tab, then the most recently loaded one), plus a `--url <route>` option to name the page. When it cannot tell, it stops and lists the tabs instead of guessing. Used by `wait.mjs`, `oracle --observe` and `find.mjs` in every copy.
- **Other fixes:** the BOM in `results.json`, the argument order of `launch-role.ps1`, and the stale comment in `jev-gate/gate.mjs`.
- **Gate check before every click** (`gate.mjs --check-action`), in both the Jev and Laya versions: if a click looks like a write on a step marked read-only, it stops and asks.
- 🧪 **206/206 tests pass** across all 11 copies. The `live-wait` eval re-ran with identical results.
- **Not re-run on ESS** (needs you to pick an environment), so the wait/oracle real-run results in section 5.4 are still from before the fix.

---

## 6. Group A13–A14: BMad (`bmad-help`, `bmad-code-review`) + Jev

**Background:**
- BMad is a set of workflow skills installed separately in each project: `ess-be` has about 80 skills, `ess-fe` fewer.
- The two new skills are **thin wrappers**: they copy nothing and change nothing in BMad core. At run time they read that project's own BMad install.
- Jev adds only a hint (bmad-help) or one review layer (bmad-code-review); the original skill still decides.
- The provider can be switched: `jev` (default), `laya`, or `kev` (a local Jev).
- **Plan:** `idea/jev-applicability-plan.md`.
- **Code:** branch `feat/bmad-jev-skills` (commit `9651d01`, 2026-10-15), pushed but not merged.

### 6.1 `bmad-help` vs `bmad-help-jev`

| | `bmad-help` (original) | `bmad-help-jev` |
|---|---|---|
| What it does | Reads the project's skill catalog and existing artifacts, then advises on the next step | Same, but first Jev picks at most one skill to suggest |
| What Jev does | — | **Request 1:** picks one skill across the whole catalog, plus a yes/no question "does this question need a skill at all?". **Request 2:** re-ranks the top 3 (also reading the first 700 characters of each SKILL.md), plus a yes/no question "does this skill do what was asked?". Threshold 0.3, taken from the TypeSafe cookbook and not re-measured |
| Who decides | Claude | Still `bmad-help` (Claude). Jev's pick is only a hint; the answer ends with whether it was followed ("agreed") or not ("overridden") |
| Data leaving the machine | None | The question, the catalog descriptions, the first 700 characters of up to 3 SKILL.md files, and file names under `_bmad-output/`. No file contents and no code |
| Measurement | — | One log line per run. An `--eval` mode reports the wrong-suggestion and needless-suggestion rates on labelled questions |

### 6.2 `bmad-code-review` vs `bmad-code-review-jev`

| | `bmad-code-review` (original) | `bmad-code-review-jev` |
|---|---|---|
| What it does | 4 default reviewer layers run in parallel, then triage verifies each finding and rates it high / medium / low / false | Same, plus a 5th layer, "Project Rules (Jev)" |
| What Jev does | — | **Once per project:** classifies the project's rules (semantic / mechanical / not a rule), with the files each rule applies to. **Each review:** for every pair (semantic rule, hunk inside that rule's scope), asks a yes/no question "does the added code break this rule?". Pairs above the threshold become findings |
| Who decides | Claude (triage) | Still Claude's triage: Jev's findings are verified like any other. Jev writes no text, sets no severity and makes no merge decision |
| Data leaving the machine | None | The added lines of each hunk (plus up to 12 surrounding lines), file paths and rule texts. Consent is asked once per project |
| Measurement | — | The triage verdict of each Jev finding is recorded, giving precision and false findings per review |
| Permanent wiring | — | The layer can be added in `_bmad/custom/bmad-code-review.toml` (BMad's own customization mechanism), with no wrapper needed |

### 6.3 Test level and verdict

**Test level:**
- 🧪 **Unit tests** with a fake provider: `bmad-help-jev` 9/9 pass, `bmad-code-review-jev` 8/8 pass (re-run 2026-10-15).
- **Dry run:** the reading and parsing code was run against the real BMad installs of `ess-be`, `ess-fe` and `pxp-workspace` (per the plan).
- ❌ **Never run against live Jev.** This machine has no `~/.bmad-jev/` log, and `ess-be` has no `jev-rules.generated.json`.

**Verdict: not enough data yet.** The design is sound: BMad core is untouched, it adapts to each project, and Jev only suggests. But so far there are only unit tests. The next step is the pilot in plan §5, with criteria fixed in advance:
- **`bmad-help-jev`:** about 60 labelled questions on `ess-be` and `ess-fe`. Keep it if both the wrong-suggestion rate and the needless-suggestion rate drop compared with no suggestion.
  - TypeSafe's cookbook reports, on a 182-skill catalog: wrong suggestions down from 16.8% to 7.3%, needless suggestions down from 9.8% to 4.0%. These are vendor numbers, not verified here.
- **`bmad-code-review-jev`:** 10 merged PRs of `ess-fe`. Keep it if it catches rule violations the 4 existing layers miss, with at most 1 false finding per PR after triage.
- **Before the pilot:** Security must approve sending questions / diffs to OpenRouter; otherwise use Kev (local).

---

## 7. Group B: new tools built from scratch

### B1. Router proxy: Laya picks Haiku / Sonnet / Opus per request · ✅ Real · `SHELVED`
- **Built:** `proxy/router_proxy.py`, an Anthropic-compatible proxy on port 8787. It rejects any request carrying an API key and only lets the subscription's OAuth login through, so nothing is billed outside the plan.
- **Tested:** run for real with Claude Code on 2026-10-01, with 0 errors after 7 request-normalisation rules. Live benchmark: 15 tasks × 4 strategies.
- **Results:**
  - Estimated cost relative to always-Sonnet: **Sonnet 1.00x**, Laya 1.43x, LLM router 1.71x, always-Opus 2.13x.
  - Pass rate: Sonnet 15/15, Laya 15/15.
  - Every model switch rebuilt **47.5k cache tokens**.
- **Verdict:** per-request routing is structurally more expensive than always using Sonnet.

### B2. Per-step model workflow (5 `wf-*` subagents + a hook that asks Laya) · ✅ Real · `DROP`
- **Tested:** 2 real tasks in this repo.
- **Results:**
  - Task 1 cost units: single-thread Opus 285, Laya 667, static 788.
  - Task 2: 657, Laya 1283, static 1203.
  - Laya p was only 0.42–0.55 (close to a tie between options); the hook took 1.8–4.7 s.
- **Verdict:** single-thread Opus is cheaper and faster. The human quality review has not been done.

### B3. Error-triage hook: Laya tags the error type when a tool fails · 📊 Offline (real data) · `DROP`
- **Round 1** (45 self-made failures): Laya 36%, regex 87%.
- **Round 2** (89 real failures, labels reviewed by the user): Laya **28%**, rules 33%, target 80%.
- **Held-out** (40 new logs): Laya 57.5% (0.7 s), **Sonnet 97.5%** (4.8 s, ~$0.007/log).

### B4. `ado-classify`: suggests the code module for an ADO task · 📊 Offline (real data) · `PILOT`
- **How:** BM25 shortlists 8 of 27 modules, then Laya picks one → returns code paths.
- **Tested:** 20 real, completed ESS tasks. The answer key comes from the `.cs` files each task's commit changed.
- **Results:** **18/20**, ~1.1 s. Laya alone (27 options): 6/20; BM25 alone: 9/20.
- **Still missing:** not integrated into Claude Code (MCP), not compared with Haiku, no A/B during real coding. The CLI takes 8–12 s per call because it reloads the model.

### B5. Cache-expiry gate hook · ✅ In use · 🧪 29 tests pass · `ADOPT`
- **What it does:** blocks once before a prompt is sent if a large cache has expired and would be rebuilt. No model; takes 65–90 ms.
- **Real use:** 9 blocks between 10-05 and 10-11; the user chose to continue each time. Each rebuild costs an estimated extra $0.26–3.64.

### B6. `laya-launcher` + `claude` shim · ✅ Tried for real · `PILOT` (as static flags)
- **How:** Laya guesses the intent, then the launcher restricts the session's `--tools` / MCP / slash commands.
- **A/B on pxp-ai #1697** (Opus, 5 runs per configuration):
  - Fixed context fell from 23.8k to 11.0k tokens (−54%); cost fell about 8%.
  - Pass rate: L1 5/5, plain 2/5.
- **Caveat:** the gain **comes from the flag set, not from Laya** (Laya always answered "bugfix"). The L2 Read gate blocked files the task needed (0/5) → `DROP`.

### B7. `fast-compact` plugin · ✅ 1 real session · 🧪 13 tests · `ADOPT`
- **Jev for choosing what to keep:** Jev kept 0 of 38 still-needed calls (none cleared p 0.5), while rules kept 38/38 → Jev dropped.
- **Rule version:** 254k → 57k tokens (−77%) in 57 ms, with no model call.
- **Verdict:** ready to use. The plugin is opt-in (the user invokes it), runs on rules, so it costs no tokens and sends no data out. Merged into `main` (PR #3, 2026-10-15). Remaining: watch it on a few more real sessions (only 1 so far).

### B8. Laya Windows install package · ✅ Installed on 2 machines · `DONE`
- `install-laya.ps1` (uv + Python 3.12, `laya==0.3.21`), with a patched `serve.py` (adds a Swagger form) and `start-laya.bat`.

---

## 8. Group C: evaluation experiments (research)

| # | Experiment | Data | Key result | Verdict |
|---|---|---|---|---|
| C1 | 10-sentence Bug/Feature/Task smoke test | 10 hand-written sentences | 8/10, 2.3 s per sentence | Smoke check only |
| C2 | 3-tier routing (step A) | 60 synthetic prompts | 47/60 (prompt only), 50/60 (with signals) | Signals were optimistic |
| C3 | Multi-signal routing | 60 prompts | No better than step A, 4× slower | `DROP` |
| C4 | Offline benchmark (step D) | 60 prompts | Adding thresholds made it worse | Replaced by the live benchmark (B1) |
| C5 | Laya CPU performance | Synthetic load | p50 314 ms, 3.2 decisions/s, 1425 requests / 0 errors; a 4k-token input takes 15 s | Fine for dev; GPU not measured |
| C6 | Laya suggests a model tier for ADO work items | 122 real items | 56%, **tied with "always Sonnet"** | Only as a hint for a human |
| C7 | Token audit (Phase 0) | 12 real sessions ($295) | Cache reads are 97% of tokens / 49% of cost; the most "dead context" could save is 2.4% | Use rules; Laya on hold |
| C8 | Study of the third-party `laya-router` skill | Code review | Advisory only; runs after the model has already been paid for | Does not solve routing |
| C9 | Ideas: security guardrail, triager MCP, observation routing | — | — | `IDEA` |

---

## 9. Group D: new skills built from scratch with Jev (`JEV` repo)

**Background:**
- A separate repo, `danhnguyen-xiontechs/JEV`. It holds 5 skills written from the plans in `docs/ideas/`; each is a project skill backed by a standard-library-only Python package.
- **Shared rule:** Jev is only a suggestion layer; rules or Claude make the final call. When Jev fails, a skill never makes a stronger claim.

**How they were tested:**
- 🧪 **Unit tests:** 84 tests, all pass (re-run 2026-10-15).
- 📊 **Offline:** each skill has its own demo/eval set, built by Claude from synthetic data with known answers.
- ✅ **Real (2026-10-15):** 7 real Claude Code sessions (headless, Sonnet), with natural prompts that did not name the skill.
  - Claude picked the right skill on its own 4 times out of 4.
  - The runs exposed 2 real bugs and 3 weak spots that the unit tests had missed; all were fixed.
  - Cost: about $1.18 for Claude, under $0.003 for Jev.

### 9.1 The 5 skills (and the underlying `jev_advisor`)

| # | Skill | What it does | What Jev does | Real test 2026-10-15 | Verdict |
|---|---|---|---|---|---|
| D1 | `acceptance-criteria-coverage` | Builds an AC ↔ test matrix (Covered / Partial / Missing / Failed) | Classifies each (AC, test) pair. A pair marked `unrelated` with p ≥ 0.9 is a test Claude can skip | ✅ Matrix correct for all 5 ACs | `PILOT` |
| D2 | `dead-code-finder` | Finds dead code and junk (debug prints, commented-out code) | Classifies the candidates left after the keep rules. An item reaches Tier A "safe to delete" only when Jev confirms it | ✅ Correct findings; exposed a bug where a live class landed in Tier A (fixed) | `PILOT` |
| D3 | `git-risk-scanner` | Scores file risk from git history; a hook turns on "defensive mode" before a risky file is edited | Reads commit messages and adjusts the formula score within a fixed bound | ✅ Hook works; Claude at first chose to run without Jev (instructions fixed) | `PILOT` |
| D4 | `subagent-validator` | Hook that checks whether a subagent's diff drifts from its task / scope | Asks per hunk "does this serve the task?". It blocks only when Jev **and** a rule both point at the same file | ✅ Blocked once, no loop, no false alarm; exposed a snapshot bug in repos with a `.gitignore` (fixed) | `PILOT` |
| D5 | `context-curator` | Trims long test logs before Claude reads them (shadow mode only so far) | Marks log chunks that are safe to leave out | ⚠️ Trimmed only 2.2% of a hard log, so Claude extracted it by hand | `PILOT` (shadow) |
| D0 | `jev_advisor` (base of D5) | Test wrapper that adds "look here first" hints to long failure logs | Points at the chunks worth reading | A/B/C, 30 runs: all 3 arms 30/30 correct | `PILOT` (benefit not shown) |

### 9.2 How much does Jev contribute? (measured on the demo sets)

| Skill | Without Jev | With Jev | Jev's share |
|---|---|---|---|
| D1 ac-coverage | Claude has to read all 30 pairs itself | Jev labelled 30/30 pairs correctly. Claude could skip 16/30 pairs (52% of the test code) without missing a relevant one. Cost $0.0007 | **High:** Jev is the main filter. Claude doing it alone has not been measured |
| D2 dead-code | Keep rules: 0 decoys in Tier A, but Tier A is also empty (0/14 dead items); junk labels 79% correct | 10/14 dead items reach Tier A with still 0 decoys; junk labels 100% correct | **High for "safe to delete".** The safety comes from the keep rules (28 decoys → 0). In the real run Jev called a live class dead (p 0.91) |
| D3 git-risk | The formula already flags 2/2 risky files (P = R = 1.0) | Still 2/2. Correlation with the "fix or incident" label rises from 0.28 to 0.58, but correlation with the number of later fixes is unchanged (0.44 → 0.43) | **Low:** the formula does the work; Jev mainly adds reasons to the warning |
| D4 subagent-validator | A scope rule cannot tell whether a hunk serves the task | Clean separation: drifting hunks p 0.03–0.05, on-task hunks p 0.92–0.97. 5/5 drifts caught, 4/5 blocked, no false blocks (0/4). README hunks are ambiguous (0.54–0.6) | **About 50/50:** a block needs both Jev and a rule |
| D5 curator | — | Easy logs: 69–92% trimmed. Hard logs (h01–h08): only 11–39%, because Jev sees at most 80 chunks. No evidence lost at threshold 0.2 | **Low on hard logs**, which is exactly where it matters most |
| D0 advisor | No wrapper: 30/30 correct | Rules only: 30/30. With Jev: 30/30. One Jev hint pointed the wrong way (Claude ignored it). In the real h05 run, a p 0.73 hint pointed at a red herring | **Not measurable yet:** the easy set hit the ceiling; the hard set h01–h08 is built but not yet run |

**Data sent to OpenRouter:**
- D1: AC text and test code.
- D2: code snippets.
- D3: commit messages.
- D4: diff hunks.
- D5 / D0: test-log chunks.

### 9.3 Verdict for group D

**All 5 skills work and are decent → `PILOT`.** But Jev's contribution is uneven; it is not 50/50 everywhere:
- **High:** D1, D2. Jev is the main classifier and was accurate on the demos.
- **About 50/50:** D4. A block needs both Jev and a rule.
- **Low or not yet measurable:** D3, D5, D0. Rules / the formula do most of the work; Jev adds little, or its benefit has not been measured.

**What it takes to reach `ADOPT`:**
1. Commit the code. The 5 skills are currently **uncommitted** in worktree `claude/review-5-plans-idea-folder-ce4d36`.
2. Run them on a real team repo (for example `ess-be`), not only on demos.
3. Measure Claude doing the same work without the skill, to see what the skill actually saves.
4. Run each scenario several times, because LLM behaviour varies between runs.
5. Get Security approval for sending data to OpenRouter.
6. Decide whether to register the 2 hooks (D3, D4) in `.claude/settings.json`. They are not on by default.

---

## 10. Group E: `skills-router`: broad skill suggestion (new build, Jev optional)

**Idea:**
- Inspired by `bmad-help`, but wider. `bmad-help` only suggests among BMad skills; `skills-router` suggests across **all** installed skills, slash commands and subagents.
- The router is only a hint layer; Claude still decides. It also dares to say "no skill needed".

**How it works:**
- **Multi-source catalog:** project skills, user skills, skills synced from claude.ai, installed plugins, slash commands, subagents, the BMad catalog and Claude Code's bundled skills. It deduplicates by precedence and detects skills that trigger only on an explicit command. On `ess-be` it has 172 entries after deduplication.
- **Two-stage routing:** BM25 shortlists the top 8, then (optionally) one request to an engine (`laya`, `kev` or `jev`): which skill, a gate "does this need a skill at all?", and a fit score for the top 3.
- **Default is `none` (BM25 only):** nothing leaves the machine.
- **Also built:** a tool that mines the transcript history, an eval harness, and a shadow-mode `UserPromptSubmit` hook (not registered in `settings.json`) to collect real labels over time.
- **Code:** branch `claude/skills-router-62fc74`, 3 commits (`1f097b4`, `3aa3ffa`, `b604a57`), not pushed.

**Test level:**
- 🧪 **Unit tests:** 46/46 pass (re-run 2026-10-15).
- 📊 **Offline on 199 synthetic scenarios** (written fresh in the style of the history; the dev/test split was frozen before any run).
- ✅ **Real data:** 368 prompts mined from your own Claude Code history (15 skipped as possible secrets). Only 16 prompts carry a specific skill label.

### 10.1 Results on 199 synthetic scenarios

All 199 scenarios, thresholds chosen on dev:

| Router | Right first time | Wrong suggestion | Needless suggestion | Overall accuracy | Latency (p50) | Cost |
|---|---|---|---|---|---|---|
| BM25 | 64% | 7% | 2% | 73% | 5 ms | $0 |
| Laya (english) | 54% | 13% | 11% | 62% | 6.2 s | $0 |
| Laya (multilingual) | 31% | 12% | 10% | 54% | 2.9 s | $0 |
| **Jev** | **78%** | 10% | 5% | **86%** | 0.54 s | $0.0100 for 199 calls |

- **Jev wins clearly on hard prompts:** implicit-intent prompts (the skill is not named) 68% (BM25 32%, Laya 13% and 0%); short, vague or misspelled prompts 84% (BM25 26%).
- **At the shipped default thresholds** (gate / fit 0.3): Jev keeps 85% accuracy, while BM25 drops to 53% (needless 59%) and Laya english to 52% (needless 39%).
- **Jev's errors on look-alike skills:** 8/31 wrong (BM25 11/31). Every error has the same shape: the user asked for a variant (for example "run the Laya severity check") but the router suggested the plain `review-pr`. The cause is the "only when named" filter.
- **Laya does not beat BM25** on this task and is 3–6 s slower per call.

### 10.2 Results on real prompts (368 prompts from history)

| Router | Right first time | Wrong suggestion | Needless suggestion | Latency (p50) |
|---|---|---|---|---|
| BM25 | 50% | 0% | 8% | 5 ms |
| Laya (english) | 31% | 0% | 2% | 7 s |
| Laya (multilingual) | 31% | 19% | 17% | 3 s |
| **Jev** | **50%** | 13% | 10% | 0.55 s |

- **Jev only ties BM25**; it does not beat it. Real cost: **$0.0215** for 325 calls (about $0.00007 each), no errors.
- **Too few labels:** only 16 cases carry a skill label, 5 of them in the test split. A 1–2 case difference is noise. Most real prompts are plain chat (no skill needed) and in Vietnamese.
- **At the default thresholds:** Jev is wrong 19% and needless 22% of the time, against 50% and 77% for BM25.
- **Jev's probability is not "always 1.0":** only 25% of calls reach 0.95 or higher. Over-confidence does not produce wrong skills here; it produces needless suggestions on prompts that need no skill (84 of 309 "no skill" prompts still got a skill on top from Jev).
- **Replaying the 383 prompts through the shadow hook** (local, default thresholds): BM25 over-suggests 78% of the time, Laya english 53%, the same direction as the scenario results.

### 10.3 Why the two tables disagree

- **Scenarios are situations built by Claude:** cleaner, more balanced, with labels set by Claude (including 12 cases that accept several answers and the "asked for a variant" rule). They show **how well the router handles different kinds of prompts**, and Jev clearly leads there. Real accuracy is likely lower.
- **Real prompts** show actual behaviour, but there are too few labels to conclude, and most are plain chat.
- Both point the same way: **Jev is fast, cheap, no worse than BM25, and better on implicit or vague prompts**, but there is no real-data evidence that it clearly beats BM25.

### 10.4 Verdict for `skills-router`: `PILOT`

- **Keep BM25 as the default:** it ties Jev on real prompts, is instant and free, and sends nothing out.
- **Jev as an optional second stage**, for when the user explicitly asks "which skill should I use". There it is clearly better on scenarios, at 0.5 s and a fraction of a cent per call.
- **Do not use it to route every prompt passively:** needless suggestions are still high, and thresholds picked from 16 labels are not trustworthy yet.
- **Laya has no place in this task:** it is no better than BM25 at picking a skill and much slower.

**Still to do:**
1. Switch on the shadow hook for a while to collect real labels (the label is "which skill Claude invoked", which is not necessarily the right one).
2. Fix the look-alike skills problem: when the user asks for a variant, do not suggest the plain skill.
3. Tune the BM25 threshold per catalog: the default of 3 is too low, and the best value is about 10 on scenarios and 19 on real prompts.
4. Build the deferred ideas: a description-quality lint from the confusion matrix, and skill-chain suggestions.

**Data sent to Jev in the real-prompt run:** the prompt (first 600 characters), the names and descriptions of up to 8 candidate skills (with the first 500 characters of each SKILL.md), and a yes/no flag for whether the prompt contains a PR URL. No file paths, project names or file contents. The descriptions of the matching projects' skills also left the machine.

### 10.5 Round 2 (2026-10-15, commit `5e23728`)
- **Variant fix:** the router puts a variant on the shortlist when the prompt has words that set it apart from its base skill (laya, jev, "severity check", …). Jev now gets **31/31** look-alike scenarios (up from 23/31). Overall accuracy rose to **91%** (from 86%); BM25 75%.
- **Agreement gating (idea 4):**
  - On the scenarios it lowers accuracy to 82%, because whenever BM25 and Jev disagreed, Jev was right (19/19).
  - On the 368 real prompts (computed offline, no new Jev calls), skipping disagreements cuts wrong suggestions from 13% to 6% and needless ones from 10% to 6%, at the cost of 2 of 8 correct suggestions.
- **Self-consistency k=3 (idea 5) does not help:** only 4 of 169 prompts changed answer when the order was shuffled, at 3× the cost.
- **Recommended setup:** when the user asks explicitly, Jev with k=1, marked "low confidence" on disagreement; for the shadow hook, skip on disagreement.
- This round cost $0.03. 🧪 **65/65 tests pass.**

---

## 11. Group F: `subagent-model-router`: picking the model for each subagent (new build)

**Why:**
- If the company later runs about 20 subagents in parallel (one story each), quota will be spent mostly according to the subagents' models.
- Per-request model choice lost because switching models breaks the prompt cache. A subagent has its own context, so choosing its model **does not break the main thread's cache**.

**How it works:**
- **A `PreToolUse` hook on the Agent tool:** sets `model` for a subagent when the caller has not set one. Tested for real with `claude -p`: the subagent ran on Haiku while the main thread stayed on Sonnet. There is also a `route.mjs` CLI for orchestrators.
- **Tier choice:** by rules (subagent type, task verbs, number of files/ACs, whether tests exist), optionally with Jev plus agreement gating and self-consistency.
- **Escalate on failure:** run at the chosen tier; if the automatic check fails, retry once one tier up.
- **Defaults:** shadow mode (log only), rules only. The hook is not registered in `settings.json`.
- **Code:** branch `claude/subagent-model-router-f7f0e3` (`c83ddf5`, `2b90d97`, `a487901`), not pushed.

**Real history on this machine (132 subagents):**
- Subagents were 28% of spend ($136 of $479, at list price).
- 98% of subagents set no model, so they inherited the main thread's: Sonnet 75%, Opus 24%, Haiku almost 0%.
- Per the price table used in the benchmark, Haiku costs about 1/20 of Sonnet per token, so the savings come mainly from moving light work to Haiku.

**Benchmark of 18 tasks with an automatic check** (explore, small fix, refactor, test-writing, design/debug):

| Model choice | Pass | Cost vs always-Opus |
|---|---|---|
| Always Opus | 18/18 | 100% |
| Always Sonnet | 18/18 | 61% |
| **Rules only + escalate on failure** | **18/18** | **14%** |
| Jev | 18/18 | 48% |
| Jev + gating + self-consistency | 18/18 | 51% |

- **Haiku solved 17/18 tasks.** The remaining one (d5-deps) failed on Haiku because it took the spec too literally; escalated to Sonnet, it passed. A failed Haiku attempt costs about $0.01, cheaper than trying to predict it.
- **Jev is cautious:** it never picked too low a tier, but it chose Sonnet for 12 tasks Haiku solved, so it costs about 3.5× rules + escalation. Jev was stable on 16/18 tasks when asked 3 times.
- **Benchmark cost:** about $4 (pilot of 6 tasks × 3 models $2.72; round 2 labelling the other 12 tasks Haiku-first $1.32).

**Verdict: `PILOT`, the largest quota-saving potential in the whole project.**
- **Stories with tests or ACs:** rules + escalate on failure, no Jev needed.
- **Stories without an automatic check:** Jev + agreement gating, since nothing would catch a wrong model choice.
- **Collect subagent results in one batch** to wake the main thread less (round 2 cost a third of the pilot's main-thread spend this way).

**Limits:**
- Small synthetic tasks, one run per task and model.
- 23 of 54 result cells are inferred, assuming "a pass at a lower tier means a pass above it".
- Not tried on tasks without an automatic check, nor on real stories.

**Next:** try it on a few real stories with ACs (`ess-be` / `ess-fe`), and switch the hook on in shadow mode to compare with the models actually used.

### 11.1 Pilot on ess-be with real stories (2026-10-15, commit `5efd93a`)
- **How:**
  - Claude wrote 6 realistic user stories for ess-be (validation, search filter, a bug fix with a trap, a new endpoint, a 10-file refactor, a story needing a design decision), each with ACs and hidden tests.
  - Each story was done by one subagent, comparing two arms on throwaway worktrees:
    - A: always Sonnet;
    - B: the router picks the model, with escalate-on-failure.
- **Results:**

| Story | A: Sonnet | B: Router | Escalated |
|---|---|---|---|
| S1 validation | ✅ $0.326 | Haiku ✅ $0.020 | no |
| S2 search filter | ✅ $0.241 | Haiku ✅ $0.024 | no |
| S3 bug fix with a trap | ✅ $0.428 | Haiku ✅ $0.023 | no |
| S4 new endpoint | ✅ $0.763 | Haiku ✅ $0.029 | no |
| S5 10-file refactor | ✅ $0.191 | Haiku ✅ $0.014 | no |
| S6 design (build and suite only) | ✅ $0.229 | **Opus** ✅ $0.666 | no |
| **Total** | **$2.18** | **$0.78 (36%)** | 0 |

- **Both criteria met:** the router passed every story the Sonnet arm passed, with diff quality no worse (on S6, Opus followed ess-be's dependency-injection rule better); subagent quota was only **36%** of arm A's (the bar was ≤ 50%).
- **Three caveats:**
  - **4 of the 5 Haiku picks came from a bug** in the rules: the phrase "do not change them" in the prompt made the rules treat coding stories as read-only. Without it, S1, S2, S4 and S5 would have run on Sonnet. Even so, Haiku passed all 5 stories. The bug is fixed in commit `24bd4b6`, branch `claude/router-readonly-fix` (20/20 tests).
  - **Escalation never triggered,** so the retry-one-tier-up path is still untested.
  - **Subagents did not run through the real hook:** auto mode blocks launching `claude -p` sessions from a script, so the session spawned the subagents itself with the model `route.mjs` chose (the same routing logic as the hook). Also, ess-be already has 17 failing tests on a clean checkout, so "suite green" means no new failures.
- **Verdict:** still `PILOT`, and now the `PILOT` with the best real evidence in the project.
  - Stories with an automatic check: rules + escalate on failure.
  - Stories without a check: never start on Haiku.
  - Next: re-run on 15–20 real ADO stories after the bug fix, to see real misses and escalations.

<!-- BEGIN agent-budget-governor -->
### 11.2 `agent-budget-governor`: budget and concurrency policy under the router (2026-10-16)

- **What:** a child module of `subagent-model-router` (`scripts/governor.mjs`, policy in `governor.json`, batch CLI `scripts/govern.mjs`). The router proposes a tier; the governor returns an `execution_profile` (model, max turns, timeout, retry limit, per-story cap, `review_required`, `reason_codes`, `fallback_mode`, run/queue/stop). Budgets are abstract units, no prices in code; usage is labelled `actual` or `estimated`, JEV/routing overhead counted separately, and a share of the batch (20%) is reserved for verification. JEV is shadow-only (recorded, not executed); in `guarded` mode it may only raise a tier. `route.mjs` behaviour is unchanged; the governed path is opt-in.
- **Unit tests (no network, 9 new, 29/29 pass with the old ones):** security override beats a 0.99-confidence JEV "fast"; JEV lower answer ignored on high-risk; incomplete input → safe default + review; JEV failure → rules only; budget exhaustion → `needs_approval` stop with the reserve untouched; concurrency queue by priority, dequeued on release; retry bounded with one escalation; stall detection; estimated never reported as measured.
- **Real JEV (5 calls, k=1, ~1.2 s each), 5 sample stories:**

| Story | JEV tier | Governor tier | Slot | Reason |
|---|---|---|---|---|
| lookup | fast | fast | run | JEV agrees |
| auth fix (security) | balanced | strong + review | run | JEV lower ignored (high risk) |
| rename | balanced | balanced | run | JEV agrees |
| DB migration | balanced | strong + review | queued | JEV lower ignored; concurrency 3 |
| design, ambiguous ACs | strong | strong + review | queued | ambiguous → review |

- Same batch with the key removed: every story got `fallback_mode: rules_only`, same tiers. No spawn blocked.
- **Verdict:** `SHADOW`. JEV picked a lower tier than the risk rules on 2 of 5 stories (both high-risk), which is exactly what the governor must block; no evidence yet that JEV adds value over static tiers. Next: Phase 3 static-tier baseline on real batches with actual usage, then decide whether to keep the JEV call.
<!-- END agent-budget-governor -->

---

<!-- BEGIN integration-verifier -->
## `integration-verifier`: checking a batch of parallel stories together (new build, Jev optional)

- **What:** after parallel story agents finish, check **evidence** (exit code + log), not claims, and check the **combined** change: merge every story branch into an isolated integration worktree and run the required build/test there. Statuses: `PASS` / `FAIL` / `BLOCKED` / `REVIEW_REQUIRED`, per story and for the batch. Never merges.
- **Built (plan phases 1, 2, 3, 5):** per-story result manifest `.integration/<story>.json`; per-story check (required check without a log → BLOCKED, AC without evidence → REVIEW_REQUIRED); cross-story rules (same fixture / migration / contract / config file, duplicate migration version, declared contract mismatch, config key conflict); combined run; environment signatures (ECONNREFUSED, exit 127…) → BLOCKED instead of FAIL. Consumes `acceptance-criteria-coverage` and `review-pr-jev-classify` artifacts, does not re-call them. Code: `.claude/skills/integration-verifier/`.
- **Jev (shadow only):** one `choice` call per failure cluster the rules cannot classify, over a fixed set (`code_regression`, `test_data`, `environment`, `dependency`, `flaky_test`, `unknown`). The suggestion is shown as a label; **no status is computed from it**, so Jev cannot turn FAIL / BLOCKED / missing evidence into PASS.
- **Quick test (2026-10-16):** 10 small, hand-labelled fixture batches (throwaway git repos), plus unit rules.

| Case | Expected | Result | Caught by |
|---|---|---|---|
| all green | PASS | PASS ✅ | — |
| contract mismatch (declared) | FAIL | FAIL ✅ | `contract_mismatch` + combined test |
| contract mismatch (undeclared) | FAIL | FAIL ✅ | combined test only |
| duplicate migration `0002_*` | FAIL | FAIL ✅ | `duplicate_migration` (tests were green) |
| fixture changed by one story breaks another's test | FAIL | FAIL ✅ | combined test |
| config key set differently | FAIL | FAIL ✅ | `config_conflict` |
| missing log / no manifest / check not run | BLOCKED | BLOCKED ✅ | evidence rules |
| AC claim only + story's own test failed | FAIL | FAIL ✅ (S1 REVIEW_REQUIRED) | evidence rules |
| environment-only failure (ECONNREFUSED) | BLOCKED | BLOCKED ✅ | environment signature |
| all green + High review finding | REVIEW_REQUIRED | REVIEW_REQUIRED ✅ | consumed findings |

- **Result:** 10/10 correct, **0 false PASS** (the key metric). Jev: **3 calls** (the 3 unclassified clusters), ~0.5–1.2 s each, ~$0.00002 per call; statuses identical with and without Jev (asserted). Category: 2/3 match the hand labels; the fixture case (label `test_data`) came back `code_regression` p=0.90.
- **Limits:** synthetic fixtures only; failure-to-story attribution is by file names in the output, so it often names both stories (a story that is not named still drops to REVIEW_REQUIRED, never PASS); a fixture changed by only one story is caught only by the combined test, not by a cross-story rule; plan phases 4 (labelled evaluation harness on real batches) and 6 (guarded pilot) not done.
- **Verdict:** `PILOT` for the deterministic verifier; Jev stays `SHADOW`: on this small set it adds nothing the rules decide on, and missed the one `test_data` case.
<!-- END integration-verifier -->
<!-- BEGIN story-batch-planner -->
## `story-batch-planner`: which stories can run in parallel (new build, Jev shadow)

**Why:** before spawning one agent per story (for example 20 stories), find which stories touch the same module, API/DTO, schema or test fixture, so parallel agents do not each pass alone and then fail to integrate.

**What was built** (`.claude/skills/story-batch-planner/`, plan phases 1 + 3):
- **Rules (phase 1):** explicit ADO links and "depends on S-2" in the text → hard order; an endpoint/DTO that one story adds and another calls → producer before consumer; same file, fixture or DTO changed by both → serialize; two migrations, or a migration + a reader of the same table → serialize, marked *protected*; same module only, topical overlap, or an incomplete story → `unknown`, serialized and sent to review.
- **Graph:** cycles are reported (Tarjan); their members and dependents are not scheduled (no order invented). Incomplete stories run alone in a final wave. `maxConcurrency` (4) splits wide waves.
- **Output:** the §6 JSON (`stories`, `edges` with evidence/source/confidence, `waves`, `blocked_or_review_required`, `assumptions`) plus `dispatch[]` (one task text per story, by wave) for `subagent-model-router`'s `route.mjs`, and a human summary.
- **Jev shadow (phase 3):** ambiguous pairs only, closed labels `independent / shared_module_or_contract / depends_on_A / depends_on_B / unknown`, at most 10 calls per plan. The answer is stored in `jev_suggestion` (`applied:false`, with provenance) and never changes the waves. Error / timeout / invalid label / over budget → `unknown`. Protected pairs can never become parallel. Jev is off by default.

**Quick test** (8 hand-written batches, 27 stories: independent, shared module, API/DTO, migration, fixture contention, explicit dependency, cycle, incomplete + hidden dependency). 14 unit tests pass (fake provider, no network).

| Metric (rules only) | Result |
|---|---|
| False-parallel (dependent/conflicting pairs in the same wave) | **0 / 13** |
| Dependency recall (ordering edges found) | **7 / 8** |
| Cycle reported / incomplete story sent to review | yes / yes |
| Over-serialized (independent pairs put in different waves) | 4 / 12 |

- The missed dependency: "overtime report from approved timesheets" needs "timesheet approval" but names no shared file or API. Rules still put it in a later wave as `unknown` (no false-parallel), but without a direction.
- Over-serialization is the price of being conservative: topical overlap ("payslip", "leave balance") is serialized until someone confirms.

**Jev shadow, real calls** (7 ambiguous pairs; the eval was run twice by mistake → 14 calls, $0.00034 in total, about 0.4–1 s each):
- Found the hidden dependency above: `depends_on_A` at 0.97 (both runs).
- Matched the label on 3 of 5 labelled pairs. Misses: two checkout stories in the same module that are really independent → `shared_module_or_contract` (0.84–0.89, wrong in the safe direction); an incomplete story "Timesheet fixes / Misc." → `depends_on_A` 0.74 instead of `unknown` (confident on a vague story).
- Never suggested `independent` with high probability; one pair flipped between runs (`shared_module_or_contract` 0.43 → `independent` 0.44).

**Verdict: SHADOW.** The rule baseline is usable now with Jev off (0 false-parallel on the fixtures). Jev adds the direction of hidden dependencies, but it is overconfident on vague stories and unstable at low probability, so keep it as a logged suggestion only. **Limits:** hand-written synthetic fixtures labelled by the same author (Claude), 27 stories, no real ADO batch; regex extraction, no repository index. **Next:** run it on one real sprint batch from ADO, have a human label it, and compare manual / rules / rules + Jev (plan phase 2).
<!-- END story-batch-planner -->
<!-- BEGIN retry-loop-breaker -->
## Retry Loop Breaker: Claude Code mod (plan 02, Jev optional)

**Why:** Claude sometimes reruns the same failing test or build with nothing changed, wasting turns. Not every retry is waste (after an edit, after a network error, on a flaky test), so the mod must detect *no progress*, not just "this failed before".

**How it works:**
- **A Claude Code mod** (`retry-loop-breaker/`, function hooks, `tool.call` on Bash). Only plain validation commands are eligible (`npm test`, `dotnet test/build`, `pytest`, `go test`, `cargo test`, `tsc`, … plus a configurable list). Pipes, `&&`, redirects, env prefixes, deploy/git/data commands are never touched.
- **After a failed run:** stores a small record per session (`$.state`): normalized command, error fingerprint (FNV hash of the error lines with times, durations, temp paths, hex and UUIDs masked), short summary, mutation epoch; TTL 30 min, at most 50 records. Raw logs are never kept.
- **Before the next run:** same command + same fingerprint + same epoch, seen `maxIdenticalFailuresBeforeBlock` times (default 2) → in `enforce` mode returns `{ deny }` with a short reason and next step; in `observe` mode (the default) only logs `would_block`.
- **What counts as a change:** a successful Edit/Write/NotebookEdit (from any agent), a Bash command that is not read-only by the engine's own check, or the user typing "rerun / try again / chạy lại". Transient errors (ECONNRESET, 429, 503, NuGet feed…) and flaky tests (seen both pass and fail) are never blocked. Permission denials, interrupts and background runs are not counted as failures.
- **Jev only on ambiguity:** when the command is *similar* (token Jaccard ≥ 0.6, same runner) to one that already reached the threshold. Fixed enum `allow_retry | block_redundant_retry | uncertain_allow`, strict validation, 4 s timeout; blocks only on `block_redundant_retry` with p ≥ 0.8. Timeout, error or invalid output → allow.
- **Main agent only** by default; `/retry-guard status` and `/retry-guard reset` (the installed API supports slash commands).
- **Phase 0 checked on the installed build** (Claude Code 2.1.300, generated types 2.1.295): `tool.call` input is the tool's arguments plus `agentId` (absent on the main loop); a non-zero exit comes back as `isError: true` with `text` "Exit code N…"; returning `{ deny }` without calling `next` refuses the call and the tool never runs; `$.state` is session-scoped and survives hot reloads. `claude plugin validate` passes; `tsc` clean.

**Quick test (small fixtures, not a pilot):**

| Case (§12) | Result |
|---|---|
| Exact same failing test, no change | blocked on the 3rd run (threshold 2), on the 2nd with threshold 1 |
| Same build, same compiler errors (elapsed time differs) | blocked |
| Rerun after a successful edit | allowed |
| Same command, different failure | allowed (count restarts) |
| Transient network error | allowed |
| Flaky test (fail → pass → fail) | allowed |
| Near-duplicate, other test/project | Jev `allow_retry` 1.00, or not similar enough → allowed |
| Near-duplicate, same test with an extra flag | Jev `block_redundant_retry` 0.95–0.99 |
| Permission denial | not recorded, allowed |
| Side-effect / compound command | ineligible, untouched |
| Jev timeout / invalid JSON / out-of-enum / low confidence | allowed |
| User asks for a retry | new epoch, allowed |
| New session / other workspace / TTL expired | no leak |

- 8 engine tests (`claude plugin test`, real engine) + 14 unit tests: all pass. **0 false blocks.** 4 real Jev calls, about 0.5–0.65 s each.
- Not measured yet: precision/recall on real sessions, tokens or turns saved. The mod is **not installed** anywhere; default is `observe`.

**Verdict: PILOT** (observe mode on real work first; enforce only after the would-block log shows ≥ 80% precision).

**Limits:** the epoch is a proxy (an edit outside Claude's tools, e.g. in the IDE, is not seen; any unrelated edit unblocks); a command run through a script alias is not eligible; Jev sees only the two commands and a one-line error summary.
<!-- END retry-loop-breaker -->
<!-- BEGIN codebase-task-explorer -->
## Group G: `codebase-task-explorer`: where to start in a codebase (new build, Jev optional)

**Goal:** before a bug investigation, feature tracing, refactor or new feature, give Claude a short ranked list of files to read first, with evidence, instead of browsing blindly. Discovery only: no fixing.

**Phase 0 — codemap (JordanCoin/codemap):** not installed before. Installed release **v4.6.0** (`codemap-full_4.6.0_windows_amd64.zip`, SHA-256 checked against `checksums.txt`, bundles `ast-grep`) into `~/tools/codemap` (no Go/brew/scoop on this machine). `codemap doctor`: binary OK; project config, Claude hooks and `.mcp.json` are MISS (not set up — on purpose, we only call the CLI). Capabilities seen: `find -json -limit` (lexical over paths + symbols, importer counts, hub flag), `--importers <file> --json`, `--deps`, `--diff`, `--topology`; `codemap mcp` exposes **19 tools** (find, find_file, get_structure, get_file_context, get_dependencies, get_importers, get_hubs, get_diff, …). Every answer has a coverage status: on this repo **partial** (2/238 JS and 14/17 Python imports unresolved). Not tested on a C# repo.

**How it works** (`.claude/skills/codebase-task-explorer/`, script `scripts/explore.mjs`):
- **Modes:** `bug`, `feature`, `refactor`, `new-feature`; output is a handoff (starting points, evidence, path, hypotheses, unknowns, Jev contribution).
- **Broad pool:** one `codemap find` per query (Claude gives 3–6 different vocabularies); merge, keep why each file matched. If codemap is missing: a **labelled fallback** (git ls-files + rg, no importer data).
- **Mechanical cleanup only:** dedupe, drop vendor/build/generated/binary. **Rules (C):** per-query score + multi-query bonus + mode priors.
- **Jev (D):** choice batches of 24 options + `none_of_these`, keep top-4 per batch by *local* rank, one global rerank of survivors; probabilities never compared across batches. Guards: ≤6 calls, ≤24k chars per request; any failure → rules order. Opt-out: `--provider none` / `CODEBASE_EXPLORER_JEV=off`; skipped for exact file/symbol. Jev sees paths, matched symbols, importer counts and each file's **first header comment line** — no source bodies.
- 5 unit tests (mocked Jev: batching, survivors, global pass, guards, fallback, none_of_these, cleanup) pass.

**Quick pilot** (5 tasks on this repo covering all 4 modes, labels = known files; Recall@5; `eval/results-2026-10-16.json`):

| Task | B: codemap-only | C: rules | D: rules + Jev |
|---|---|---|---|
| bug: merge verdict wrong | 0.50 | 0.50 | 1.00 |
| feature: subagent model choice | 0.50 | 1.00 | 1.00 |
| refactor: `decide()` signature | 0.33 | 0.33 | 0.67 |
| new-feature: another write-gate | 0.00 | 0.50 | 1.00 |
| bug: grounding clicks wrong button | 0.00 | 0.00 | 1.00 |
| **Mean** | **0.27** | **0.47** | **0.93** |

- Jev: **15 calls** (3 per task: 2 batches + global), ~0.6 s per call, **$0.0011** total. `none_of_these` never won. Fallback engine alone (no codemap): B 0.17, C 0.27.

**Caveats:** only 5 tasks; tasks and labels were written by Claude on its own repo; D also sees the header comment line, C does not (part of the gain may come from that text, not Jev's judgment); the repo's laya/jev twin copies make "any copy" labels easier; baseline A (plain Claude) and the Claude verification step were not measured; no C# repo.

**Verdict: `PILOT`** — Jev's batch ranking looks clearly better than rules on this small set, cheaply. Before adopting: 30–50 real tasks on a C#/.NET repo (with a C+header arm to separate the header effect), and measure A.
<!-- END codebase-task-explorer -->
<!-- BEGIN smart-context-trimming -->
## Smart Context Trimming (Claude Code Mod + Jev, plan 01)

**What:** a Claude Code Mod (`smart-context-trimming/`) that hooks Bash `tool.call` for test/build commands (`dotnet test/build`, `npm test`, `jest`, `pytest`, `tsc`, `cargo`, `go test`…). When the output is long (≥250 lines or ≥20 KB), Claude gets only the **original lines that matter**: errors, failed tests with their assertion details, exception heads with the first 6 frames, fatal lines, summaries and exit status, plus the first 5 and last 15 lines. The full raw output is saved under `~/.claude/smart-context-trimming/raw/` and the compact result points to it. Default **observe** (measures, changes nothing); `enforce` trims; `/smart-trim off|observe|enforce|status` per session, or the `SMART_TRIM_MODE` env variable.

**Jev's role (optional, enforce only):** one decision per trimmed output: a strategy choice (`errors_only / errors_and_stack / errors_and_warnings / keep_full_output`) and one yes/no per *optional* candidate (repeated warnings, deeper stack frames), at most 12. Jev never writes text. Mandatory evidence is kept whatever Jev says, so a wrong answer can only make the output longer. Candidate text is redacted (keys, Bearer tokens, passwords, connection strings, JWTs, long hex) and capped at 12 KB. Timeout 8 s; confidence < 0.6, invalid JSON, unknown strategy, extra or out-of-range answers → the rules result.

**Phase 0 (installed CLI 2.1.300, engine types 2.1.295), proven live with `claude -p --plugin-dir`:**
- Success: `{ result: { ...result, stdout } }` replaces what Claude reads ✔.
- Non-zero exit: core answers `{ isError, result: string }`. A hook's own `{ isError, result }` is **refused (schema error)**; a spread of core's answer with a new `text` is **ignored**; `{ result: { stdout } }` **drops the error flag** (not allowed). Only `{ deny: text }` keeps the error flag, so that is what the mod returns for failed runs.
- Permission denials, interrupted / background / image / core-persisted results and unmatched commands pass through untouched.
- **Finding:** for a failed command, Claude Code itself has already cut the text to about 5 000 head + 5 000 tail characters (`... [N characters truncated] ...`) **before** any hook sees it. In a live run that core cut hid one of three failing tests. The mod cannot recover it without rewriting the command (outside the MVP), so most failed outputs are under the threshold today.

**Quick test (10-fixture corpus + fake-Jev failure arms):**

| fixture | baseline | rules | rules + Jev (real) | lost critical |
|---|---:|---:|---:|---:|
| long passing dotnet test | 27.4 KB | 1.6 KB (−94%) | — (no optional candidates) | 0 |
| 3 failing tests | 22.9 KB | 3.4 KB (−85%) | — | 0 |
| dotnet compiler errors | 19.7 KB | 1.5 KB (−93%) | — | 0 |
| exception + 25-frame stack | 10.7 KB | 1.7 KB (−84%) | 1.7 KB (−84%), `errors_only` p=0.83, 1.2 s | 0 |
| 300 warnings + FATAL | 35.1 KB | 2.4 KB (−93%) | 2.4 KB (−93%), p=0.97, 0.5 s | 0 |
| secret-like strings | 18.6 KB | 2.0 KB (−89%) | 1.7 KB (−91%), p=0.94, 0.5 s | 0 |
| malformed log, short, unmatched, piped to `tail` | — | unchanged byte-for-byte | unchanged | 0 |

- Median reduction on eligible outputs: **89% (rules) / 91% (rules + Jev)**. **0 lost critical diagnostics** in every arm, and every kept line is checked to be an original line, verbatim.
- Jev failure arms (timeout, invalid JSON, HTTP 500, transport error, unknown strategy, low confidence, "drop everything", `keep_full_output`) all fall back correctly, none stalls past 2 s, and the criticals stay. Secrets never appear in the Jev request.
- **3 real Jev calls** in total (all valid). 21 Node unit tests and 7 engine tests (`claude plugin test`) pass. Live end-to-end in enforce: 27.4 KB → 1.7 KB with the raw-log pointer, and Claude read the summary correctly.

**Verdict: PILOT (rules), Jev SHADOW.** The rules alone do almost all the saving; Jev adds about 2 points, and only on outputs that have optional candidates. Not measured yet: real request tokens, task success and re-read rate (Phase 4). Next: an opt-in exit-code wrapper so failed runs avoid core's 10 KB cut, then threshold calibration on real sessions.
<!-- END smart-context-trimming -->

## 12. Overall conclusions

| Question | Answer |
|---|---|
| Can Laya replace repeated LLM calls? | **Mostly no.** It works only on short text with ≤ 8–10 options and a pre-filter (ado-classify). It is weak on long logs, many options and Vietnamese, and its probabilities are too flat to set thresholds on. |
| Is Jev better? | **Yes, clearly more accurate**, and cheap and fast. On review-pr it agreed 12/18 and only ever upgraded (Laya: 7/18). But it is over-confident, sends data off the network, and has not reduced tokens in real `web-test` agent runs. |
| Does per-request or per-step model choice save money? | **Per request or per step: no**, because switching models loses the prompt cache. **Per subagent: yes**, because a subagent has its own context; on the benchmark, rules + escalate on failure cost only 14% of always-Opus (section 11). |
| Can agreement gating and self-consistency replace thresholds? | **Agreement gating: useful on noisy real data** (skills-router: wrong suggestions 13% → 6%), but harmful on clean data. **Self-consistency: no**, because Jev almost always gives the same answer when the order is shuffled (skills-router: only 4/169 prompts changed; review-pr: 17/18 stable). |
| Is a broad skill router worth building? | **Yes, as an option.** `skills-router`: Jev is best on synthetic scenarios (91% after round 2) but only ties BM25 on real prompts. Laya has no place here. It needs more real labels via the shadow hook. |
| What about the new skills built around Jev? | **They work and are decent, but Jev's contribution is uneven.** Jev does the main work in acceptance-criteria-coverage and dead-code-finder; about 50/50 in subagent-validator; little in git-risk-scanner and context-curator. All measured on synthetic demos so far. |
| What delivered real value? | The **fixed rules and scripts**: `find.mjs`, the `wait.mjs` rules, the network audit, the cache-expiry gate, fast-compact, and limiting tools with static flags. |

---

## 13. Risks and notes

- **The repo is public** but contains real data:
  - `ado/items*.json`: 190 PXP / XT-Smart-Platform work items.
  - `audit/*.csv`: prompts and paths from other projects.
  - `ess-test-runs/`: ESS tickets and screenshots (on branch `claude/laya-jev-skill-comparison-fe1001`).
  - → Make the repo private, or remove these files from git history.
- **Jev sends data to OpenRouter / TypeSafe:** ESS page text (which may contain employee names) and PR code excerpts. Security has not been asked. Claude Code auto mode blocks these calls.
- **Quality of evidence:**
  - Most labels were set by Claude; samples are small; each configuration usually ran once.
  - Costs use an assumed 1:3:5 price ratio, not real X-Tek gateway prices.
  - No **write** step has been tested in real ESS.
- **Known bugs** (the 4 below were fixed on 2026-10-15 on separate branches, not merged):
  - `wait.mjs` / `oracle --observe` read the wrong tab.
  - PowerShell writes `results.json` with a BOM, which breaks `record.mjs`.
  - A comment in `jev-gate/scripts/gate.mjs` still quotes Laya's numbers.
  - `review-pr-jev-classify`: the `rules` field in the logs ignores the project's rule ids and overrides (log only). The execution-log header shows only the provider that `assess.mjs` ran last.

- **`subagent-model-router`:** the real pilot had only 6 stories, written by Claude; escalation never triggered; subagents did not run through the real hook.
- **`review-pr-jev-classify`:** the real test had only 14 findings; labels count only fixes at the cited line, so they may miss fixes in doc/test files.
- **`skills-router`:** the labels of the 199 scenarios were set by Claude; real prompts carry only 16 skill labels; the descriptions of the project's skills are also sent to Jev when it is used; the shadow hook is not switched on, and its real latency has not been measured.
- **The 2 BMad + Jev skills:** never run against live Jev; the 0.3 thresholds come from the cookbook and have not been measured on our data.
- **The 5 new Jev skills (`JEV` repo):** the code is uncommitted; numbers come from synthetic demos built by Claude; there is no comparison with Claude doing the work alone; each real scenario ran once.

---

## 14. Open items and suggested next steps

1. Ask Security whether data may be sent to Jev / OpenRouter, or measure **Kev** (a local Jev, not yet measured).
2. The wrong-tab bug is fixed (branch `claude/web-test-fixes-4fdcd7`); what remains is repeating the agent runs 2–3 times per variant (estimated ~40M tokens).
3. `review-pr-jev-classify`: run Jev in shadow on 5–10 real PRs, have a person label the disagreements, then decide whether to switch on `recheck`.
4. ado-classify: build the MCP server, compare with Haiku, and A/B it during real development.
5. Move `find.mjs` and the `wait.mjs` rules into the original `web-test`; watch `fast-compact` on a few more real sessions (already merged into `main`).
6. Remove the sensitive data from the public repo.
7. The 5 new Jev skills: commit the code, run them on a real team repo, measure Claude doing the same work alone; run the hard log set h01–h08 for `jev_advisor`.
8. Pilot the 2 BMad + Jev skills per the plan: about 60 labelled questions for `bmad-help-jev`; 10 merged `ess-fe` PRs for `bmad-code-review-jev`.
9. `skills-router`: (the look-alike skills problem was fixed in round 2) switch on the shadow hook to collect real labels, pick the BM25 threshold per catalog; only then decide whether Jev should be the default second stage.
10. `subagent-model-router`: merge the bug fix (`claude/router-readonly-fix`), then re-run on 15–20 real ADO stories to see real misses and escalations; switch the hook on in shadow mode.
11. Review and merge the new branches: `claude/skills-router-62fc74`, `claude/subagent-model-router-f7f0e3`, `claude/review-pr-jev-upgrade-2bbb34`, `claude/web-test-fixes-4fdcd7`.

---

## Appendix

### A. Unit test summary (re-run 2026-10-15)

| Skill / tool | Tests | Result |
|---|---|---|
| `review-pr` (original) | 65 | 65 pass |
| `review-pr-laya-classify` | 42 | 42 pass |
| `review-pr-jev-classify` | 51 | 51 pass |
| `web-test-jev-wait / gate / verdict / oracle` | 8 / 12 / 11 / 12 | All pass; each suite skips 1 test because Jev consent is already on for this machine |
| `web-test-jev-ground` | 6 | 6 pass |
| Original `web-test` and the 5 `web-test-laya-*` skills | 0 | No unit tests (only probes in `idea/web-test/gate/`) |
| `hooks/cache_expiry_gate` | 29 (41 checks) | Pass (per `hooks/tests/report.md`) |
| `fast-compact` | 13 | Per its branch report; not re-run |
| 5 new Jev skills + `jev_advisor` (`JEV` repo) | 84 | 84 pass (re-run 2026-10-15) |
| `bmad-help-jev` / `bmad-code-review-jev` | 9 / 8 | All pass, with a fake provider (re-run 2026-10-15) |
| `skills-router` | 65 | 65 pass, with a fake provider (round 2, 2026-10-15) |
| `subagent-model-router` | 19 | 19 pass, with a fake provider |
| `review-pr-jev-classify` (upgrade) | 87 | 87 pass |
| 11 `web-test` copies (bug fixes) | 206 | 206 pass |

### B. Timeline

| Date | Work |
|---|---|
| 09-30 | Laya installed; CPU performance benchmark |
| 10-01 | Install package, routing step A, router proxy live with Claude Code, 15-task live benchmark |
| 10-02 | Benchmark summary (Laya 1.43x), 122 ADO items |
| 10-04 → 10-05 | Per-step workflow (2 real tasks), audit Phase 0, cache-expiry hook, `laya-router` study |
| 10-06 | Context-trimming A/B on #1697, `laya-launcher` |
| 10-07 → 10-08 | Error triage (stopped), ado-classify 18/20, `web-test-laya` skill |
| 10-09 | Split into 5 `web-test-laya-*` skills; real runs on dev (11840, 19358) |
| 10-11 | `review-pr-laya-classify` |
| 10-13 | Real run on PR 5240; `review-pr-jev-classify`, `web-test-jev-ground`; plan for Jev on BMad |
| 10-14 | 4 `web-test-jev-*` skills; offline Laya vs Jev evaluation; `JEV` repo: smoke test, `jev_advisor`, A/B/C 30 runs |
| 10-15 | Agent runs on ticket 11840 (dev + staging); `fast-compact`; controlled A/B re-run on PR 5240; 5 new Jev skills + 7-session real test; 2 BMad + Jev skills; `skills-router` (evaluated on 199 scenarios and 368 real prompts, then round 2); `subagent-model-router` (18-task benchmark); `review-pr-jev-classify` upgrade; `web-test` bug fixes |

### C. Where the code lives

| Branch | Content |
|---|---|
| `main` | Install package, routing, proxy, benchmark, workflow, ado, ado-classify, audit, hooks |
| `claude/laya-jev-skill-comparison-fe1001` (latest, **not merged into main**) | All 12 skills, `eval/`, `triage/`, `ess-test-runs/` |
| `research/laya-router-skill` (not merged) | Multi-signal routing, #1697 A/B, `laya-launcher` |
| `main` (merged from `claude/fast-jev-compaction-worktree-f61594`, PR #3) | `fast-compact` |
| `feat/bmad-jev-skills` (pushed, not merged) | `bmad-help-jev`, `bmad-code-review-jev`, `idea/jev-applicability-plan.md` |
| `claude/skills-router-62fc74` (not pushed) | `skills-router`, shadow hook, 199 scenarios, round 2 |
| `claude/subagent-model-router-f7f0e3` (not pushed) | `subagent-model-router`, 18-task benchmark |
| `claude/subagent-router-pilot-*` (not pushed) | ess-be pilot report (`research/subagent-router-ess-be-pilot.md`) |
| `claude/router-readonly-fix` (not pushed) | Router "read-only" bug fix |
| The real review-pr test session's branch (not pushed) | `research/review-pr-jev-real-eval.md` |
| `claude/review-pr-jev-upgrade-2bbb34` (not pushed) | `review-pr-jev-classify` upgrade |
| `claude/web-test-fixes-4fdcd7` (not pushed) | Bug fixes for the 11 `web-test` copies, per-click gate check |
| `xt-skills` repo | The original `review-pr` |
| Repo `danhnguyen-xiontechs/JEV`, branch `jev` | Jev smoke test, `jev_advisor`, A/B/C |
| `JEV` repo, worktree `claude/review-5-plans-idea-folder-ce4d36` (**uncommitted**) | 5 new Jev skills, demos/evals, `docs/runs/realtest/` |
| Not committed | `eval/AGENT-RUNS-REPORT.*`, the 10-15 agent-run results, `.xt-skills/` (PR 5240 review logs) |

### D. Main data sources
`HANDOFF.md`, `PROGRESS-2026-10-01.md`, `benchmark/report*.md`, `eval/REPORT.md`, `eval/AGENT-RUNS-REPORT.md`, `idea/web-test/report-*.md`, `idea/review-pr/plan-1-laya-severity-classification.md`, `triage/LAYA-ERROR-TRIAGE-REPORT.md`, `ado-classify/docs/REPORT.md`, `audit/summary.md`, `hooks/tests/report.md`, `.xt-skills/review-pr-*/reviews/`, `ess-test-runs/`. `JEV` repo: `README.md`, `docs/runs/realtest/report.md`, `examples/*/run/`, `docs/runs/curator/shadow-eval.txt`, `docs/runs/abc/`.
