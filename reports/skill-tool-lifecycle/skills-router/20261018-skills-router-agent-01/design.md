# Experiment plan — skills-router (retro, agent run)

- **Experiment ID:** `20261018-skills-router-agent-01`
- **Plan version:** `agent-retro-v1`
- **Commit measured:** `56bfcf2` on `main` (tool unchanged)

## Design summary

The tool prints a JSON hint for a request: a BM25 shortlist (≤ 8) and one Jev decision (`suggestion`, `alternatives`, `gate`, `overlaps`, `agreement`). This run asks whether a Haiku subagent that has to name the best skill for six real-sounding requests picks better or cheaper with that hint than with the plain skill listing alone.

## Contracts (as built, unchanged)

- `node scripts/route.mjs --project-root R --query Q --provider jev --agreement low` prints one JSON object (`suggestion`, `alternatives`, `abstain`, `overlaps`, `gate`, `shortlist`, `agreement`, `latencyMs`, `cost`, `error`). It never fails: on any error `suggestion` is null.
- `node scripts/catalog.mjs --project-root R --json` lists the catalog (48 entries for the repo copy: 22 project skills, 1 user skill, 14 plugin skills, 11 bundled). The catalog also reads `~/.claude` (user and synced skills) and `~/.skills-router/cache`; each route call appends a line to `~/.skills-router/log.jsonl` (no opt-out).
- Jev settings are the README's shipped opt-in: `provider jev`, `agreement low`, thresholds from `jev.json` (gate 0.3, fit 0.3, none-first abstains).

## What Claude decides vs what the tool decides

| Step | Decides |
|---|---|
| Shortlist, Jev choice, gate, fit, overlaps (arm B) | tool (advisory) |
| Final pick (a skill name, or `none`) | the Haiku subagent, both arms |

## Arms

| Arm | The agent runs | It reads |
|---|---|---|
| A (`A-claude`) | `node <work>/pick.mjs` (`lib/a.mjs`) | the plain listing of the 48 catalog entries (id, kind, source, full description) and "skills-router: disabled" |
| B (`B-claude-jev`) | the same command (`lib/b.mjs`) | the same listing plus the full JSON output of `route.mjs` for the request, Jev live |

The command, the prompt and the output format are the same in both arms. The prompt differs by one sentence: A says no routing tool is available, to decide from the list, and not to use or run the skills-router skill or its scripts (reading other skills is allowed in both arms); B says the helper output also holds the skills-router hint and that the agent makes the final call. Both arms: model `haiku` (claude-haiku-5-5), effort `xhigh`, one fresh subagent per case, arm and repetition, each with its own work folder `w/t-<hex>/{repo,pick.mjs,_h.mjs,common.mjs,request.txt}` (neutral names: no case id, no arm; the helper `_h.mjs` is a copy of `lib/a.mjs` or `lib/b.mjs`, so its content differs by arm). Each helper call appends to `_logs/<case>.<arm>.r<n>.jsonl` (route mode, suggestion, Jev latency, error, cost) and saves the first output to `first/<case>.<arm>.r<n>.txt`; that is `evidence/texts/`.

Prompt (the `Work folder:` line is how `subagent_usage.mjs` finds the transcript):

```
Work folder: <work>
Pick-a-skill task (read-only; do not do the request itself, do not run any skill). A user of the repo at <repo> wrote this request:
"<request>"
Decide which ONE installed skill, slash command or subagent of this setup best fits the request, or "none" when no dedicated skill is needed and Claude should simply answer or do it directly. The helper prints the installed list: run `node "<work>/pick.mjs"`. You may read files in the repo to check a skill.
<arm sentence>
Reply with exactly two lines: `PICK: <skill name exactly as listed, or none>` and one sentence of reasoning.
```

## Cases (6, 2 repetitions; request and gold copied verbatim from the tool's frozen `eval/scenarios.jsonl`, all from its test split)

| Case | Scenario | Category | Request | Gold |
|---|---|---|---|---|
| `c1-webtest-plain-vi` | S071 | overlap | kiểm thử story 29461 trên môi trường dev, xuất báo cáo HTML có ảnh chụp | `web-test` |
| `c2-webtest-jev-wait-vi` | S077 | overlap | test ticket 12983, dùng Jev để đợi trang tải xong và phân loại màn hình | `web-test-jev-wait` |
| `c3-review-laya-severity-en` | S060 | overlap | review this PR and also run the Laya severity check on each finding | `review-pr-laya-classify` |
| `c4-code-review-vi` | S044 | implicit | xem giúp tôi nhánh này có bug không trước khi tôi merge | `code-review` |
| `c5-none-flaky-test-vi` | S094 | none | tại sao test này lúc pass lúc fail nhỉ? | none |
| `c6-none-for-loop-vi` | S172 | hard negative | viết vòng lặp for in ra các số chẵn | none |

Four cases have a skill as gold (three of them in this repo's own `.claude/skills`, two of those variants of a base skill), two need no skill. Pass: the `PICK:` line, with a plugin namespace dropped and a leading `/` removed, equals the gold id (`none` for the none cases). Scored by `score.mjs`, never by the agent's claim. The scenario set has no case for `codebase-task-explorer`, `story-batch-planner` or the other newest skills, so the run does not cover them.

## Answer key

`cases.json` (gold) lives only in the experiment folder. The agents work on a `git archive HEAD` copy from which these were deleted: `reports/`, `report/`, the HANDOFF note, and in `.claude/skills/skills-router/` the `eval/` (the 199 gold scenarios), `tests/` and `README.md` (they quote near copies of the case requests). The tool's own scripts and `SKILL.md` stay and are run from the real folder by the helper. Gold skill names remain in ordinary code and descriptions of the copy (they are the skill names the agent must be able to read); say so in `deviations`.

## Contamination check for arm A

`subagent_usage.mjs <subagentsDir> --forbid "skills-router|route.mjs|catalog.mjs" <workDirs>`; an A case with `forbiddenCalls > 0` is discarded and re-run in a new work folder (`.A2`). A second pass on both arms with `--forbid "scenarios|cases.json|skill-tool-lifecycle"` catches an agent that went for the answer key; a hit in either arm is a contamination.

## Tokens

All tokens of each case agent's session (input, output, cache read, cache write) from its subagent transcript (`subagent_usage.mjs`), plus turns (assistant messages) and tool calls from the same transcript. The Jev call of `route.mjs` runs inside the helper, outside the agent's tokens: its cost and latency are in `usage.providerCalls`, `providerLatencyMs` and the `_logs`.
