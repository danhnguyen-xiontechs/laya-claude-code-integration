# skills-router

A hint layer that suggests which installed skill, slash command, subagent or BMad workflow fits a
request, or says that none is needed. It is the successor to `bmad-help-jev`, which only routed over
the BMad catalog. Claude still makes the final call (see `SKILL.md`).

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
  shortlisted only when the query names it (`/name`, or the full hyphenated name), or contains every
  word of its name, or every word but one common word including a rare one. So "A/B jev vs laya on
  PR severity classify" can reach `review-pr-jev-classify`, but "review this PR" cannot.
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

## Evaluation from history

```
node scripts/mine-history.mjs                       # → ~/.skills-router/eval/cases.jsonl
node scripts/eval.mjs --providers none,laya,laya:multilingual --project-root .
node scripts/eval.mjs --providers jev --allow-hosted   # only after the user agreed: sends mined prompts to OpenRouter
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

## Results on this machine (2026-10-15)

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
- **Jev was not run on mined prompts.** It needs consent. A 5-query synthetic smoke test on this
  worktree's catalog scored 5/5 (BM25 alone also 5/5). Each call took 0.65–1.4 s and cost about
  $0.00006. The choice probability was 1.0 every time, the known over-confidence. Gate values
  ranged from 0.55 to 0.93.
- **The defaults stay as they are**: `provider: none`, cookbook gate/fit 0.3, `bm25Min` 3. They
  suit the intended use, an explicit "which skill should I use for …" question, where suggesting
  something is expected. The dev-picked values fit passive routing of every prompt; use them if
  the shadow-mode hook (see "Shadow mode") is enabled.

## Data leaving the machine

`none`, `laya` and `kev` keep everything local. `jev` sends:
- the request;
- up to 8 shortlisted names and descriptions, with their heads;
- the context fields listed in `SKILL.md`.

`eval.mjs` refuses `jev` without `--allow-hosted`.

## Tests

```
node --test .claude/skills/skills-router/tests/catalog.test.mjs .claude/skills/skills-router/tests/route.test.mjs .claude/skills/skills-router/tests/history-eval.test.mjs .claude/skills/skills-router/tests/shadow.test.mjs
```

Pass the files explicitly: Node 24 fails on a directory argument. The tests cover:
- frontmatter variants, BMad csv, dedupe precedence, `explicitOnly`, the cache and the plugin
  fallback;
- BM25 ranking, abstain and gate logic, overlap detection, and the never-fail paths;
- history mining on a fixture transcript, and the eval metrics.

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
