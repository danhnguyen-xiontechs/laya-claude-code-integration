# skills-router

A hint layer that suggests which installed skill, slash command, subagent or BMad workflow fits a
request, or says that none is needed. It is the successor to `bmad-help-jev`, which only routed over
the BMad catalog. Claude still makes the final call (see `SKILL.md`).

> **`bmad-help-jev` can be retired.** That skill (branch `feat/bmad-jev-skills`) routes over
> `_bmad/_config/bmad-help.csv` with one Jev decision. The BMad catalog source here reads the same file
> (one entry per skill and action, with its phase and `preceded-by` / `followed-by` metadata), and the
> same decision engine is available with `--provider jev`, plus the other catalog sources. Keep it
> only if something calls it by name.

Node 18+ with the standard library only. No dependencies.

## Files

| File | What it does |
|---|---|
| `scripts/catalog.mjs` | Discovers every source, normalizes entries, dedupes them, caches the catalog |
| `scripts/route.mjs` | Stage 1 BM25 shortlist, stage 2 one decision request, abstain/overlap logic, logging |
| `scripts/context.mjs` | The small repo state sent with a request (branch, dirty, top extensions, `_bmad-output/` count, PR URL) |
| `scripts/decision-provider.mjs` | Shared with `bmad-help-jev`: one call to `jev`, `laya` or `kev` |
| `scripts/mine-history.mjs` | Builds labelled cases from `~/.claude/projects/**/*.jsonl` |
| `scripts/eval.mjs` | Scores BM25-only and each provider, picks thresholds on a dev split |
| `scripts/shadow-hook.mjs`, `scripts/shadow-report.mjs` | Opt-in shadow-mode hook and the join with transcripts (see "Shadow mode") |
| `scripts/shadow-replay.mjs` | Replays mined prompts through the shadow hook and report, as a sanity check |
| `eval/` | Frozen synthetic scenario set (`scenarios.jsonl`, `scenarios.manifest.json`) and the synthetic extra catalog entries |
| `builtin.json` | Claude Code's bundled skills (`code-review`, `loop`, …), which have no file on disk |
| `jev.json` | Provider and thresholds. Per-machine overrides go in `jev.local.json` (gitignored) |

## Catalog

| Source | Where | `source` | Invocation |
|---|---|---|---|
| Project skills | `.claude/skills/*/SKILL.md`, `.agents/skills/*/SKILL.md` | `project` | `/name` |
| User skills | `~/.claude/skills/*/SKILL.md` | `user` | `/name` |
| claude.ai synced skills | `~/.claude/skills/synced/<bucket>/*/SKILL.md` | `plugin:anthropic-skills` | `/anthropic-skills:name` |
| Plugin skills | `<installPath>/skills/*/SKILL.md` of each plugin in `~/.claude/plugins/installed_plugins.json` (user scope, or project scope for this project) | `plugin:<name>` | `/<plugin>:name` |
| Slash commands | `.claude/commands/**/*.md`, `~/.claude/commands/**/*.md` | `project` / `user` | `/dir:name` |
| Subagents | `.claude/agents/*.md`, `~/.claude/agents/*.md` | `project` / `user` | `Agent(subagent_type: "name")` |
| BMad | `_bmad/_config/bmad-help.csv` | `bmad` | `/skill [action]` |
| Bundled | `builtin.json` | `builtin` | `/name` |

- Plugins come from `installed_plugins.json`. Plugins under `plugins/marketplaces/` are listed in a
  marketplace but not installed, so they are skipped. If `installed_plugins.json` is missing, the
  catalog falls back to scanning `~/.claude/plugins/**/skills/` (marketplaces excluded).
- Entry shape: `{ id, name, kind, source, description, head, invocation, explicitOnly, path, shadowed? }`.
- Dedupe is by bare name (the plugin namespace is dropped). Precedence is
  project > user > plugin > bmad > builtin, then skill > command > agent. Shadowed copies are kept
  in `shadowed`. A BMad row shadowed by a real skill gives that skill its phase metadata.
- `explicitOnly` is true when the frontmatter sets `disable-model-invocation: true`, or the
  description says "Trigger only on …", "only on /x", or "only when … explicitly". Such an entry is
  shortlisted only when the query names it (`/name`, or the full hyphenated name), contains every
  word of its name (or every word but one common word, with a rare one among them), or **asks for that
  variant** (see "Variants" below). So "A/B jev vs laya on PR severity classify" can reach
  `review-pr-jev-classify`, but "review this PR" cannot.

### Variants

An explicit-only entry whose name extends another entry's name is a variant of it: `web-test-laya-gate`
of `web-test`, `review-pr-jev-classify` of `review-pr`. With no such entry in the catalog, the base is
the longest name prefix it shares with another entry (`review-pr` for the two `-classify` skills).
`variantTokens` diffs the variant against its base:

- **name tokens**: its name minus the base's (`laya`, `gate`; `jev`, `classify`);
- **description tokens**: words and word pairs its description has and the base's lacks
  (`severity check`, `observation`, `rerank`, `netlog`). The words that name sibling variants
  (`laya` in "the -laya-classify variant…") do not count as base words;
- **family token**: a name token in 3+ catalog names, i.e. a provider (`laya`, `jev`).

Generic words never count: stop words, numbers, the base's own words, words in more than
max(2, 10%) of the catalog's descriptions, and a short list (`variant`, `copy`, `plan`, `step`,
`page`, `run`, …). A query asks for the variant when it has:

1. every name token ("judge each step with a confidence **verdict** from **Laya**"), or
2. the family token and one more distinguishing token ("run the **Laya** **severity check**"), or
3. the family token and a word of the base's name ("**test** ticket 12983, dùng **Jev** để đợi trang").

A plain request has none of these: "review this PR", "test ticket 5 and wait for the page",
"classify these log lines by severity" and "restart the laya server" all keep only the base
(`tests/variants.test.mjs`). The variant is then only shortlisted; BM25 or the engine still chooses.
- Only the frontmatter and the first 700 characters of each body are kept. Files are read through a
  16 KB window.
- Cache: `~/.skills-router/cache/catalog-<root hash>.json`, keyed by a SHA-1 of every source file's
  path, mtime and size. Discovery runs every time (readdir and stat only). Files are re-read only
  when that key changes.

Run `node scripts/catalog.mjs --project-root <dir>` for a per-source summary, or add `--json` for
every entry.

## Routing

```
node scripts/route.mjs --query "<request>" [--project-root <dir>] [--provider none|laya|kev|jev] [--k 8] [--json]
```

1. **Shortlist (stage 1).** BM25 (k1 1.2, b 0.75) over name ×3, description ×2 and head ×1, with a
   small stemmer and stop list. Deprecated entries (the description says "deprecated" or "will be
   removed") score half. Explicit-only entries are filtered out as described above. Entries the
   query names go first. The result is the top k ≤ 8 entries with a score above 0.
2. **Decision (stage 2).** One request with three parts:
   - `which`: a Choice over the shortlist plus `none`;
   - `gate`: a Noul, "does this need a dedicated skill or workflow at all?";
   - `fit_0..2`: one Noul per top-3 candidate, "does this skill do the specific thing asked?".

   The state holds the request, the repo context and the top 3 candidates.
3. **Final answer.** The decision abstains when any of these holds:
   - `gate < gateMin`;
   - the top candidate's `fit < fitMin`;
   - `none` ranks first (if `noneAbstain` is set);
   - in BM25-only mode, the top score is below `bm25Min`.

   A query that names an entry always gets that entry. Otherwise the router returns one `suggestion`
   and up to 2 `alternatives`. `overlaps` flags candidates that do the same job: one name contains
   the other's words, or their descriptions share enough words. For each such candidate it adds a
   one-line difference, the description clause with most words the others lack.

`--provider none` stops after stage 1 and labels its answers `low (bm25-only)`. Provider order:
`--provider` → `DECISION_PROVIDER` → `jev.json` (`none`).

Jev's choice probability is almost always 1.0, so it says nothing about confidence. Two options replace
it (both off by default; flags, or `thresholds.agreement`, `thresholds.stabilityMin` and `consistency`
in `jev.json` / `jev.local.json`):

- **Agreement gating** (`--agreement off|low|abstain`). A suggestion is confident only when the
  engine's top-1 is BM25's top-1. On a disagreement, `low` keeps the engine's pick first, makes BM25's
  top-1 the first alternative and labels the answer `low`; `abstain` returns no suggestion (reason
  `disagree`). A query that names an entry is never gated. Output: `agreement: { bm25Top, agree, mode }`.
- **Self-consistency** (`--consistency k`, default 1). k decision calls, in parallel. Round 0 shows the
  shortlist in BM25 order; later rounds shuffle it, and the order of the 3 fit candidates, with a seed
  from the request, so a rerun sends the same requests. The answer is the most-voted top-1 (ties: mean
  probability), gate and fits are means, and `stability` (votes of the winner / rounds) is the
  confidence. `--stability-min x` abstains below x (reason `unstable`). Cost and latency: k calls;
  latency is that of the slowest.

## Evaluation from history

```
node scripts/mine-history.mjs                       # → ~/.skills-router/eval/cases.jsonl
node scripts/eval.mjs --providers none,laya,laya:multilingual --project-root .
node scripts/eval.mjs --providers jev --allow-hosted   # only after the user agreed: sends mined prompts to OpenRouter
node scripts/eval.mjs --providers jev --consistency 3 ...   # k rounds per prompt; reports k=1, k=3, each ± gating
node scripts/eval.mjs --providers jev --run-file ~/.skills-router/eval/run-jev-real.jsonl   # re-score an earlier run offline, no calls
```

**Mining.**
- A typed `/x args` becomes `{query: args, expected: x}`.
- A prompt whose assistant turn called the `Skill` tool becomes `{query, expected: skill}`.
- Any other prompt becomes `{query, expected: null}`.
- Dropped:
  - built-in commands (`/model`, `/clear`, …);
  - slash commands with fewer than 3 words of arguments (`/web-test 22070 dev` says nothing to
    route on);
  - prompts longer than 1500 characters;
  - duplicates;
  - prompts from other sessions or the SDK (`turnOrigin: sdk`, unless `--include-sdk`);
  - task notifications and system-injected messages.
- The cases stay in `~/.skills-router/eval/` because prompts are private.

**Scoring.** Each case is routed against its own project's current catalog (its `cwd`, when that
folder still exists). The repo context is reduced to the PR-URL flag, because the historical git
state is unknown. Raw signals are stored per provider in `run-<provider>.jsonl`, so thresholds can
be picked offline. The split is a SHA-1 of the query with the fixed salt `skills-router-v1`: 60% dev
and 40% test. Thresholds maximize balanced accuracy on dev, the mean of "right skill on skill cases"
and "abstain on none cases".

Metrics:

| Metric | Definition |
|---|---|
| top-1 / top-3 | Expected skill ranked first / in the top 3, abstention ignored, over skill cases |
| wrong | Suggested a different skill, over skill cases |
| miss | Abstained although a skill was expected, over skill cases |
| needless | Suggested a skill when none was expected, over none cases |
| abstain precision | Abstentions where none was expected, over all abstentions |
| latency, cost | p50 / p95 per case; total and per-case cost (Jev only) |

## Results on mined history (2026-10-15)

**Catalog sizes** (raw entries per source → after dedupe):

| Project root | project | user | plugin:anthropic-skills | plugin:typesafe | bmad | builtin | after dedupe |
|---|---|---|---|---|---|---|---|
| this worktree | 1 | 1 | 13 | 1 | – | 11 | 27 |
| `D:\XionTechs\Laya` | 13 | 1 | 13 | 1 | – | 11 | 39 (13 explicit-only) |
| `D:\XionTechs\ess-be` | 236 | 1 | 13 | 1 | 24 | 11 | 172 (78 with shadowed copies) |

**Mined dataset:**
- 383 cases from 238 transcripts.
- 16 cases are labelled with a skill (9 slash commands, 7 `Skill` tool calls); 367 are `none`.
- 0 cases are uncovered (every label is in its project's catalog).
- Most prompts are in Vietnamese.
- Split: dev 227 cases (11 skill), test 156 cases (5 skill).

Thresholds were picked on dev; the table reports the held-out test split, then all cases:

| Router | Thresholds (dev) | top-1 | top-3 | wrong | miss | needless | abstain prec. | p50 latency |
|---|---|---|---|---|---|---|---|---|
| BM25 only | bm25Min 19.5 | 0.20 / 0.50 | 0.20 / 0.56 | 0 / 0 | 1.00 / 0.69 | 0.10 / 0.09 | 0.97 | 5 ms |
| Laya `english` | gate 0.9, fit 0.9 | 0.00 / 0.31 | 0.20 / 0.56 | 0 / 0 | 1.00 / 0.75 | 0.03 / 0.02 | 0.97 | 7.1 s |
| Laya `multilingual` | gate 0.95, fit 0.95 | 0.00 / 0.31 | 0.20 / 0.50 | 0.40 / 0.19 | 0.60 / 0.56 | 0.23 / 0.18 | 0.97 | 3.1 s |

With the shipped defaults on test, the router over-suggests:

| Router | Defaults | needless | wrong |
|---|---|---|---|
| BM25 | bm25Min 3 | 0.79 | 0.80 |
| Laya `english` | gate/fit 0.3 | 0.56 | 1.00 |

Cost was 0 for every run (all local).

Reading:
- **The labels are too few to rank providers.** With 5 skill cases in test, one case moves top-1 by 0.2.
- **Most real skill uses were named explicitly** (`/x`, or the skill name in the prompt). The
  thresholds that win on dev therefore amount to "suggest only when named, otherwise abstain".
- **Laya `english` does not beat BM25 on ranking.** Its gain is fewer needless suggestions on
  Vietnamese chit-chat.
- **Laya `multilingual` is faster but noisier.**
- **Jev was not run on mined prompts in this round** (it needs consent; a later run exists, see
  "Round 2"). A 5-query synthetic smoke test on this
  worktree's catalog scored 5/5 (BM25 alone also 5/5). Each call took 0.65–1.4 s and cost about
  $0.00006. The choice probability was 1.0 every time, the known over-confidence. Gate values
  ranged from 0.55 to 0.93.
- **The defaults stay as they are**: `provider: none`, cookbook gate/fit 0.3, `bm25Min` 3. They
  suit the intended use, an explicit "which skill should I use for …" question, where suggesting
  something is expected. The dev-picked values fit passive routing of every prompt; use them if
  the shadow-mode hook (see "Shadow mode") is enabled.

## Scenario evaluation (synthetic, 2026-10-15)

The mined history has only 16 labelled skill cases, so a second, larger set was written by hand.
**These labels are synthetic and written by Claude, and they are Claude's judgment.** They measure
the router on constructed situations, not on real behaviour. The scenarios were written before any
router output on them was seen, and the file was frozen (split and sha256 in
`eval/scenarios.manifest.json`; `eval.mjs` refuses a changed file).

- `eval/scenarios.jsonl`: 199 prompts, 104 English and 95 Vietnamese, with no real project names,
  paths, ticket or PR numbers. Fields: `id, prompt, lang, category, expected, split`. `expected` is
  an id, `none`, or a list of valid ids (with a `why`); `none` inside a list means abstaining is
  also fine. The split is `sha1(salt + id) < 0.5`: 96 dev, 103 test.
- Categories: explicit 19, implicit 38 (19 English, 19 Vietnamese), overlap 31 (review-pr family 12,
  web-test family 16, BMad 3), none 72, hard-negative 20, typo/short/vague 19. 94 of the 199 expect no
  skill, 12 accept several answers.
- Catalog: this repository's (39 entries: 13 project skills, user, synced and plugin skills, bundled
  skills), customer names scrubbed, plus 5 **synthetic** entries (`eval/catalog-extra.json`) because
  this repository has no plain `review-pr` or BMad skills: `review-pr`, `bmad-code-review`,
  `bmad-create-prd`, `bmad-create-story`, `bmad-dev-story`.
- Overlap rule: the `-laya-classify`, `-jev-classify` and `web-test-*` variants are valid answers only
  when the prompt asks for that variant (names the provider and the feature). A plain request has the
  plain skill as its answer.

```
node scripts/eval.mjs --scenarios eval/scenarios.jsonl --catalog-root <repo> --catalog-extra eval/catalog-extra.json      --providers none,laya,laya:multilingual,jev --allow-hosted
```

Jev was run once on this set (199 calls, its test and dev splits together), against the scrubbed
catalog only. Total cost from the API: **$0.00998** ($0.00005 per call). A later Jev run on the mined
prompts (`run-jev-real.jsonl`) is scored offline in "Round 2".

Thresholds are chosen on dev (max balanced accuracy). Test, then all 199:

| Router | Dev-picked thresholds | top-1 | top-3 | wrong | needless | abstain prec. | accuracy | p50 | cost |
|---|---|---|---|---|---|---|---|---|---|
| BM25 only | bm25Min 10 | 0.67 / 0.64 | 0.83 / 0.77 | 0.05 / 0.07 | 0.02 / 0.02 | 0.65 / 0.68 | 0.72 / 0.73 | 5 ms | 0 |
| Laya `english` | gate 0.85, fit 0.6, none-first off | 0.56 / 0.54 | 0.79 / 0.76 | 0.14 / 0.13 | 0.15 / 0.11 | 0.59 / 0.62 | 0.58 / 0.62 | 6.2 s | 0 |
| Laya `multilingual` | gate 0.95, fit 0 | 0.26 / 0.31 | 0.70 / 0.65 | 0.14 / 0.12 | 0.11 / 0.10 | 0.54 / 0.56 | 0.52 / 0.54 | 2.9 s | 0 |
| Jev | gate 0, fit 0, none-first on | 0.84 / 0.78 | 0.84 / 0.80 | 0.05 / 0.10 | 0.09 / 0.05 | 0.88 / 0.87 | 0.87 / 0.86 | 0.54 s | $0.0100 |

With the shipped defaults (gate/fit 0.3, `bm25Min` 3), all 199:

| Router | wrong | needless | abstain prec. | accuracy |
|---|---|---|---|---|
| BM25 only | 0.29 | 0.59 | 0.81 | 0.53 |
| Laya `english` | 0.27 | 0.39 | 0.65 | 0.52 |
| Laya `multilingual` | 0.62 | 0.68 | 0.79 | 0.31 |
| Jev | 0.10 | 0.04 | 0.86 | 0.85 |

Accuracy per category (all 199, dev-picked thresholds):

| Router | explicit | implicit | overlap | none | hard-negative | typo/short/vague |
|---|---|---|---|---|---|---|
| BM25 only | 0.95 | 0.32 | 0.65 | 0.99 | 0.95 | 0.26 |
| Laya `english` | 0.95 | 0.13 | 0.35 | 0.88 | 1.00 | 0.32 |
| Laya `multilingual` | 0.89 | 0.00 | 0.10 | 0.92 | 0.85 | 0.26 |
| Jev | 1.00 | 0.68 | 0.74 | 0.93 | 1.00 | 0.84 |

Overlap confusions (round 1, before the variant fix; see "Round 2" below). Jev got 8 of 31 wrong and
BM25 11; every Jev error has the same shape, the variant was asked for and the plain skill was
suggested:

| Expected | Suggested | Cases |
|---|---|---|
| `review-pr-laya-classify` | `review-pr` | S060, S061 |
| `review-pr-jev-classify` | `review-pr` | S062, S063 |
| `web-test-laya-gate` | `web-test` | S073 |
| `web-test-jev-wait` | `web-test` | S077 |
| `web-test-jev-ground` | `web-test` | S079 |
| `web-test-laya-wait` or `web-test-jev-wait` | `web-test` | S084 |

The cause is the explicit-only filter: a variant is shortlisted only when the query names it or
contains every word of its name but one common word, and "classify" or "ground" is a rare word. So
the router errs toward the plain skill. Whether a prompt like "run the Laya severity check" counts as
asking for the variant is **my own judgment**; the descriptions say "explicit request". Only
`overlap` has such judgment calls, plus the 12 multi-answer cases (each with a `why`).
Full lists: `confusionOverlap` in the report files.

Replay of the 383 mined prompts through the shadow hook and `shadow-report.mjs` (local only, shipped
defaults, each prompt against its own project's catalog; `scripts/shadow-replay.mjs`):

| Router | labelled | agreement | wrong | needless | abstain prec. |
|---|---|---|---|---|---|
| BM25 only | 383 | 0.24 | 3 of 16 | 0.78 | 1.00 |
| Laya `english` | 383 | 0.48 | 4 of 16 | 0.53 | 1.00 |

The direction matches the scenario numbers at defaults (needless 0.59 and 0.39): BM25 over-suggests
the most, Laya less. Absolute numbers are higher on the mined set because its catalogs are larger
and its prompts are mostly plain chat. The "invoked" label is what Claude chose.

Reading:
- **Jev is clearly the best router here**, on constructed prompts. It ranks the right skill first
  more often (0.84 vs 0.67 for BM25 on test), handles implicit, vague and Vietnamese phrasing (implicit
  0.68 vs 0.32), and its default thresholds are already near its dev-picked ones (accuracy 0.85 vs
  0.86), so it needs no tuning. It costs about $0.00005 and 0.5 s per request.
- **Laya does not beat BM25** on this task. Both Laya models are worse on top-1, wrong and needless
  rates, at 3–6 s per call. `multilingual` fails on implicit prompts, including Vietnamese ones.
- **BM25 is good at explicit and none**, weak at implicit and vague (0.3). Its shipped floor of 3
  over-suggests (needless 0.59); a floor near 10 is better for passive use, but BM25 scores depend
  on the catalog size, so pick it per catalog with `eval.mjs`.
- Constructed prompts are cleaner than real ones. Expect real accuracy to be lower; the shadow hook
  measures that.

## Round 2: variants, agreement gating, self-consistency (2026-10-15)

Changes: the variant rule ("Variants" above), agreement gating and self-consistency ("Routing"
above). Same frozen 199 scenarios, same scrubbed catalog (`--catalog-root D:\XionTechs\Laya`).

```
node scripts/eval.mjs --scenarios eval/scenarios.jsonl --catalog-root <repo> --catalog-extra eval/catalog-extra.json --providers none,jev --consistency 3 --allow-hosted
```

One Jev run with 3 rounds per prompt (597 calls) gives every Jev row below: `k = 1` is round 0 alone
(the BM25-ordered request, the same request as plain Jev), `k = 3` combines the 3 rounds
(`withRounds`). `+gate` is `agreement: abstain`. Thresholds are chosen on dev for each row (gate ×
fit × none-first, × `stabilityMin` ∈ {0, 0.5, 0.67, 1} for k = 3). Test, then all 199:

| Router | Dev-picked thresholds | accuracy | overlap acc. | top-1 | wrong | needless | miss | p50 / p95 | cost (199 prompts) |
|---|---|---|---|---|---|---|---|---|---|
| BM25 only | bm25Min 10 | 0.74 / 0.75 | 0.75 / 0.81 | 0.70 / 0.69 | 0.04 / 0.03 | 0.02 / 0.02 | 0.42 / 0.42 | 10 / 14 ms | 0 |
| Jev | gate 0, fit 0.7, none-first on | **0.92 / 0.91** | **1.00 / 1.00** | 0.90 / 0.86 | 0.00 / 0.00 | 0.02 / 0.01 | 0.12 / 0.16 | 526 / 619 ms | $0.0102 |
| Jev + gating | gate 0, fit 0, none-first on | 0.82 / 0.82 | 0.75 / 0.81 | 0.90 / 0.86 | 0.00 / 0.01 | 0.04 / 0.02 | 0.30 / 0.31 | 526 / 619 ms | $0.0102 |
| Jev k = 3 | gate 0, fit 0, none-first on, stability ≥ 0.5 | 0.89 / 0.89 | 1.00 / 1.00 | 0.90 / 0.85 | 0.00 / 0.02 | 0.11 / 0.06 | 0.10 / 0.13 | 561 / 688 ms | $0.0305 |
| Jev k = 3 + gating | gate 0, fit 0, none-first on | 0.81 / 0.81 | 0.75 / 0.81 | 0.90 / 0.85 | 0.00 / 0.01 | 0.07 / 0.03 | 0.30 / 0.31 | 561 / 688 ms | $0.0305 |

Round 1 for comparison (all 199): BM25 0.73 accuracy, overlap 0.65; Jev 0.86, overlap 0.74.
Latency is per prompt, prompts with an empty shortlist (no call) included; k = 3 runs its calls in
parallel. Cost is the API's own figure: $0.00005 per call. This round spent **$0.0305** in total
(the k = 1 rows reuse round 0 of the same run).

Accuracy per category (all 199):

| Router | explicit | implicit | overlap | none | hard-negative | typo/short/vague |
|---|---|---|---|---|---|---|
| BM25 only | 0.95 | 0.32 | 0.81 | 0.99 | 0.95 | 0.26 |
| Jev | 1.00 | 0.63 | 1.00 | 0.99 | 1.00 | 0.84 |
| Jev + gating | 1.00 | 0.42 | 0.81 | 0.97 | 1.00 | 0.68 |
| Jev k = 3 | 1.00 | 0.68 | 1.00 | 0.92 | 1.00 | 0.79 |
| Jev k = 3 + gating | 1.00 | 0.42 | 0.81 | 0.96 | 1.00 | 0.68 |

At the shipped defaults (gate/fit 0.3), all 199: Jev 0.89 accuracy (wrong 0.02, needless 0.04),
Jev + gating 0.81 (0.01, 0.01), BM25 (floor 3) 0.55 (0.24, 0.59).

**Agreement split** (Jev k = 1, its dev thresholds, all 199; cases where Jev suggests something):

| | suggestions | right | wrong | needless | precision |
|---|---|---|---|---|---|
| BM25 top-1 = Jev top-1 | 70 | 69 | 0 | 1 | 0.99 |
| they differ | 19 | 19 | 0 | 0 | 1.00 |

**Real prompts, offline** (no Jev call: the existing `run-jev-real.jsonl`, 368 of the 383 mined
prompts with a decision, 16 labelled with a skill; BM25's top-1 is the shortlist head stored in the
same rows). Jev at its dev thresholds (gate 0.45, fit 0.6):

| | suggestions | right | wrong | needless | precision |
|---|---|---|---|---|---|
| BM25 top-1 = Jev top-1 | 24 | 6 | 1 | 17 | 0.25 |
| they differ | 21 | 2 | 1 | 18 | 0.10 |

| Router (368 real prompts, all / test) | accuracy | top-1 | wrong | miss | needless |
|---|---|---|---|---|---|
| BM25 (bm25Min 19.5, round-1 report) | 0.89 / 0.88 | 0.50 / 0.20 | 0 / 0 | 0.69 / 1.00 | 0.08 / 0.09 |
| Jev | 0.88 / 0.87 | 0.50 / 0.20 | 0.13 / 0.40 | 0.38 / 0.40 | 0.10 / 0.11 |
| Jev + gating, same thresholds | 0.92 / 0.91 | 0.50 / 0.20 | 0.06 / 0.20 | 0.56 / 0.60 | 0.06 / 0.06 |
| Jev + gating, dev-picked (gate 0.8, fit 0.75) | 0.94 / 0.93 | 0.50 / 0.20 | 0 / 0 | 0.69 / 1.00 | 0.03 / 0.04 |

(`node scripts/eval.mjs --providers jev --run-file ~/.skills-router/eval/run-jev-real.jsonl`
re-scores a run offline. Gating at the same thresholds keeps 3 named suggestions, so its needless
count is 20, not 17.)

Reading:
- **The variant fix is the gain.** All 8 of Jev's overlap errors are gone (31/31), and BM25's overlap
  accuracy rises from 0.65 to 0.81. Hard negatives stay at 0.95 (BM25) and 1.00 (Jev). Three
  Vietnamese variant prompts (S073, S077, S079) are shortlisted only through the family rule; Jev gets
  them, and BM25 alone still abstains on them.
- **Agreement gating hurts on the synthetic set.** When BM25 and Jev differ, Jev was right 19 times
  out of 19: those are the implicit and vague prompts BM25 cannot rank. Abstaining on them costs 9
  points of accuracy.
- **On real prompts gating helps.** A disagreement there is mostly a needless suggestion (precision
  0.10, against 0.25 when they agree). Gating at the same thresholds halves wrong and needless
  suggestions and drops 2 of 8 correct ones. The labels are few (16 skill cases; 5 in test), so this
  is a direction, not a measurement.
- **Self-consistency adds little for 3× the cost.** Jev barely depends on the shortlist order: only 4
  of the 169 prompts with a call change their top-1 when the order is shuffled. Of the 165 unanimous
  answers, 149 are right, so stability 1.0 does not separate right from wrong. k = 3 scores 0.89
  against 0.91.
- **To ship as the Jev opt-in:** Jev, k = 1, with `agreement: low`. It keeps the best accuracy on the
  synthetic set and flags the disagreements that, on real prompts, are mostly needless. For passive
  routing (the shadow hook), use `agreement: abstain`. `jev.local.json`:

  ```json
  { "provider": "jev", "thresholds": { "gateMin": 0.3, "fitMin": 0.3, "noneAbstain": true, "agreement": "low" } }
  ```

## Data leaving the machine

`none`, `laya` and `kev` keep everything local. `jev` sends:
- the request;
- up to 8 shortlisted names and descriptions, with their heads;
- the context fields listed in `SKILL.md`.

`eval.mjs` refuses `jev` without `--allow-hosted`.

## Tests

```
node --test .claude/skills/skills-router/tests/catalog.test.mjs .claude/skills/skills-router/tests/route.test.mjs .claude/skills/skills-router/tests/history-eval.test.mjs .claude/skills/skills-router/tests/shadow.test.mjs .claude/skills/skills-router/tests/scenarios.test.mjs .claude/skills/skills-router/tests/variants.test.mjs
```

Pass the files explicitly: Node 24 fails on a directory argument. The tests cover:
- frontmatter variants, BMad csv, dedupe precedence, `explicitOnly`, the cache and the plugin
  fallback;
- BM25 ranking, abstain and gate logic, overlap detection, and the never-fail paths;
- history mining on a fixture transcript, and the eval metrics;
- variant tokens and shortlisting with hard negatives, agreement gating, self-consistency
  (shuffling, vote combining, per-round fits), and the eval helpers that re-score k rounds offline.

A fake provider stands in for the decision servers, so the tests need none.

## Shadow mode

A `UserPromptSubmit` hook that routes every prompt locally and logs what the router *would* suggest.
It changes nothing: it prints no output (nothing is added to the prompt), never blocks, and always
exits 0, even on bad input, a dead server or an unwritable log. It is **not registered anywhere**;
you decide when to enable it.

- **Provider:** `none` (BM25, a few tens of ms). With `SKILLS_ROUTER_SHADOW_PROVIDER=laya` it uses
  laya-serve when `/health` answers within 300 ms, else falls back to `none`. `jev` is never used.
- **Log:** `~/.skills-router/shadow.jsonl` (outside the repo; override with
  `SKILLS_ROUTER_SHADOW_LOG`). One line per prompt: `t`, `session`, `transcript`, `cwd`, `hash` (SHA-1
  of the whitespace-normalized prompt, 12 chars), `prompt` (first 300 characters), `suggestion`,
  `confidence`, `abstain`, `reasons`, `alternatives`, `provider`, `latencyMs`, `error`.
  The prompt text is private: do not commit or share this file.

**Enable.** Paste into `.claude/settings.local.json` (this project only), or `~/.claude/settings.json`
(every project; then use the absolute path of this folder instead of `$CLAUDE_PROJECT_DIR`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/skills/skills-router/scripts/shadow-hook.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

If the file already has a `hooks` block, add the inner `{ "hooks": [...] }` object to its existing
`UserPromptSubmit` array instead of replacing it.

**Report.** After some days of use:

```
node scripts/shadow-report.mjs [--log ~/.skills-router/shadow.jsonl] [--json]
```

It joins each log line with its transcript by session id and prompt hash. The transcript gives what
Claude invoked in that turn: the `Skill` tool, or a typed `/command`, else "none". It reports the
number of labelled cases (`labelled`, `unmatched` for lines it could not find), `agreement`,
`wrongRate`, `missRate`, `needlessRate` and `abstainPrecision`, with the same definitions as the
eval above. `--json` adds one row per prompt.

**Read it carefully.** The "invoked" label is what Claude chose, not necessarily the correct skill.
Claude may skip a skill that would have helped, or use one it should not. Agreement measures how
often the router and Claude's own judgment coincide, and a mismatch is a case to look at, not
proof the router was wrong. Prompts that come from a skill's own expansion are not separated from
real user prompts.

**Uninstall.** Remove the `UserPromptSubmit` entry from the settings file you edited (the hook
runs on the next prompt after the file is saved). Optionally delete `~/.skills-router/shadow.jsonl`.
Nothing else was installed.

## Next steps

- **(a) Shadow-mode hook. Done**: see "Shadow mode" above. The next step is to enable it, collect a
  few hundred prompts, then pick thresholds from `shadow-report.mjs` rather than from the 16 labelled
  cases of the mined history.
- **(b) Description-quality lint.** Build a confusion matrix from the eval (expected vs suggested)
  and flag skill pairs that are often confused or whose descriptions overlap strongly (the
  `sameJob` test). Then suggest sharper descriptions, or an explicit "plain X goes to Y" sentence,
  as `review-pr-*-classify` already has.
- **(c) Skill chains.** Use BMad `preceded-by` / `followed-by` metadata (already kept on
  `entry.bmad`) and skill co-occurrence in mined history ("after `bmad-create-story`, users run
  `bmad-dev-story`"). With these, the router can suggest the next skill after one finishes, not
  only the first one.
