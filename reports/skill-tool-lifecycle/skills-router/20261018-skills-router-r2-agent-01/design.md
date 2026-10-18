# Experiment plan - skills-router (retro round 2, agent run)

- **Experiment ID:** `20261018-skills-router-r2-agent-01`
- **Plan version:** `agent-retro-v1 (round 2)`
- **Commit measured:** `ada217d` on `claude/skills-router-round2` (based on main 2b36911). Tests: 73/75 pass; the 2 failures are the scenario-file sha256 tests, the same on main.
- **Measurement design:** identical to round 1 (`../20261018-skills-router-agent-01/design.md`), except the B helper prints the line hint first (see below).

## Contracts (changed)

- `node scripts/route.mjs --project-root R --query Q --provider jev --agreement low` prints one line by default; `--json` prints the object (`suggestion`, `alternatives`, `abstain`, `overlaps`, `gate`, `shortlist`, `agreement`, `latencyMs`, `cost`, `error`); `--format json` prints it compact. It never fails: on any error the line says `error:`, exit 0.
- Thresholds, provider settings (`jev.json`), BM25 and the decision request are unchanged.

## Arms

| Arm | The agent runs | It reads |
|---|---|---|
| A (`A-claude`) | `node <work>/pick.mjs` (`lib/a.mjs`) | the listing and "skills-router: disabled in this task" (unchanged from round 1) |
| B (`B-claude-jev`) | the same command, B helper | `skills-router hint: <one line>`, a blank line, then the same listing. The hint is `formatLine` of `route.mjs --json` (Jev live, agreement low). |

Both arms: model `haiku` (claude-haiku-5-5), effort `xhigh`, one fresh subagent per case, arm and repetition, its own work folder (`w/t-<hex>`). The prompt text is the round-1 text; only the work folder and the arm sentence differ. Answer key (`cases.json`) and the round-1 gold are not in the work folders.

## Size check

Listing 29,661 characters; A's text 29,752 (under the 30,000-character Bash cap); B's text 29,661 + 20 + hint (at most 200) + 2, so at most 29,883 (checked before the run: all B outputs below the cap, so none was cut; see `evidence/texts` lengths).

## Cases

The same six cases as round 1 (request and gold copied from the tool's frozen eval set; see `cases.json`): c1 web-test (overlap), c2 web-test-jev-wait (overlap), c3 review-pr-laya-classify (overlap), c4 code-review (implicit), c5 none (flaky test), c6 none (hard negative).

## Pass rule

The `PICK:` line, with a plugin namespace dropped and a leading `/` removed, equals the gold id (`none` for the two none cases). Scored by `collect.mjs` from the gold, never by the agent's claim.

## Contamination check (both arms)

`subagent_usage.mjs --forbid "skills-router|route\.mjs|catalog\.mjs"` on arm A: 0 forbidden calls in 12 runs. `--forbid "scenarios|cases\.json|skill-tool-lifecycle"` on both arms: 0 hits in 24 runs.

## Tokens

All tokens of each case agent's session (input, output, cache read, cache write) from its subagent transcript (`subagent_usage.mjs`), plus turns and tool calls from the same transcript. The Jev call runs inside the B helper: it is counted in `providerCalls` and `providerLatencyMs` (from `_logs`), not in the agent's tokens.
