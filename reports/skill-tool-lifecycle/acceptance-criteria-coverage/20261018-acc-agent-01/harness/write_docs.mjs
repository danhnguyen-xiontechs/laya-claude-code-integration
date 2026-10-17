#!/usr/bin/env node
// write_docs.mjs - writes triage.md, idea-brief.md and design.md of the three experiments (retro run, 2026-10-18).
// Usage: node write_docs.mjs <repoRoot>   (the reports/skill-tool-lifecycle folder is under it)
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const T = {
  'acceptance-criteria-coverage': {
    slug: 'acc', id: '20261018-acc-agent-01', skill: 'acceptance-criteria-coverage',
    decides: 'For each acceptance criterion: which existing tests cover it and how well (Covered / Partial / Missing / Unclear). A local script ranks candidate tests per criterion by word overlap; Claude reads the tests and writes the verdicts; the report script renders them.',
    jev: 'Jev (typesafe/jev-1.13, one Choice question per criterion x candidate test) labels each pair direct_coverage / partial_coverage / name_only / unrelated / insufficient_evidence and marks a pair `skippable` when it says unrelated with p >= 0.9, so Claude can skip reading it. It never decides coverage: the verdicts are Claude\'s.',
    fair: 'A story with 6-7 criteria and a small pytest suite (8-15 tests) built so that the gold coverage per criterion is known by construction (Covered / Partial / Missing, including a test whose name promises the criterion but asserts something else). The agent returns a verdict per criterion; a script compares with the key. Pass = every criterion right. Weak point: with a suite this small plain Claude can read every test, so the cases may be too easy for any helper to show value; the tool is meant for larger suites.',
    cases: [
      ['acc-01-registration', 'the JEV demo (DEMO-42 user registration, 7 criteria, 10 tests); in-sample: its authors tuned the labels on it', 'gold = the demo\'s own hand-written `coverage` block (Covered x4, Partial x1, Missing x2, one of them a name-only test)'],
      ['acc-02-cart', 'own: cart and coupons, 6 criteria, 15 tests', 'Covered x2, Partial x3, Missing x1 (name-only trap)'],
      ['acc-03-uploads', 'own: image upload, 6 criteria, 11 tests', 'Covered x3, Partial x2, Missing x1 (no test at all)'],
      ['acc-04-booking', 'own: meeting-room booking, 6 criteria, 8 tests', 'Covered x3, Partial x2, Missing x1 (name-only trap)'],
    ],
    passRule: 'every criterion\'s verdict is in the accepted set of the key (Missing-by-name-only also accepts Unclear). Also recorded: criteria right, and "false Covered" (Covered where the key says less).',
    wrapper: '`node tool.mjs` (no arguments). Arm B runs the skill\'s real steps 4 and 5 (`candidates`, then `classify` with Jev live) from a copy of the JEV working tree and prints a digest of pack.json + results.json: per criterion the five candidate tests with file:line, Jev label, p and `skippable`. Arm A prints "tool disabled". Each B run appends one line to `evidence/_logs/<case>.B.r<n>.jsonl` (status, requests, latency, cost, every pair label).',
    bSentence: 'Tool sentence in B: what the tool does, that labels are suggestions, never mark Covered from a label, continue if it fails (condensed from SKILL.md steps 5-6 and Rules).',
    extra: 'Steps 1-3 and 7-8 of the skill (writing criteria.json, JUnit, verdicts.json, report.md) are not part of the measured task: criteria.json is given, no JUnit file is made, and the agent returns the verdicts directly.',
  },
  'dead-code-finder': {
    slug: 'dcf', id: '20261018-dcf-agent-01', skill: 'dead-code-finder',
    decides: 'Which Python symbols (functions, classes, methods, constants, imports, orphan modules) and junk (commented-out code, debug prints, dead branches) can be deleted. Static rules (AST, string search, decorators, entry points, `__all__`, overrides, reflection) decide what is KEPT; the remainder is ranked into Tier A (safe in small batches), B (needs a look) and C (kept).',
    jev: 'Jev (Choice questions per candidate) is the only thing that can promote a candidate to Tier A (likely_dead / dead_code_comment / debug_leftover with p >= 0.9) and labels junk (debug leftover vs intentional output vs explanatory example). Without Jev there is never a Tier A; Jev cannot delete anything.',
    fair: 'A small project with known seeded dead items and look-alike live code (registered by decorator, getattr prefix, config string, entry point, override, `__all__`, test-only). The agent lists what it would delete; a script scores it against the key. Pass = no wrong item (a decoy or anything not in the key) and at least 75% of the dead items. Weak point: the projects are small enough for plain Claude to grep every name.',
    cases: [
      ['dcf-01-demo', 'the JEV demo (`examples/dead_code_demo`, 13 files, 21 dead/junk items, 28 decoys); in-sample: tuned by the skill\'s authors', 'gold = the demo\'s `gold.json` (dead + junk-debug + junk-comment-code = dead; alive decoys, test-only, intentional output, examples, disabled-with-reason = decoy; dead branches = neutral)'],
      ['dcf-02-ordersapi', 'own: decorator routes/tasks, getattr dispatch, entry points, test-only helper; 8 dead, 13 decoys', 'key kept in scratch'],
      ['dcf-03-pluglib', 'own: `__init_subclass__` registry, `__all__`, yaml dotted path, pytest11 entry point; 4 dead, 11 decoys', 'key kept in scratch'],
      ['dcf-04-shopapp', 'own: dotted paths in settings/urls, decorator receivers/admin, management command, junk; 8 dead, 10 decoys', 'key kept in scratch'],
    ],
    passRule: 'no wrong item listed (a decoy, or anything not in the key as dead or neutral) and recall of dead items >= 75% (rounded up); public API means names in __all__ or declared entry points (stated in the prompt). Neutral items (transitively dead or ambiguous in a toy app) count neither way.',
    wrapper: '`node tool.mjs` (no arguments). Arm B runs the skill\'s real `scan .` (Jev live) from a copy of the JEV working tree and prints report.md, the one file the skill tells Claude to read. Arm A prints "tool disabled". Each B run appends one line to the run log (tier counts, Jev cost/latency, how many tiers Jev changed, per-candidate tier with and without Jev).',
    bSentence: 'Tool sentence in B: what the scanner does (rules + Jev tiers A/B/C), that tiers are suggestions, verify before listing, continue if it fails.',
    extra: 'The skill\'s prune steps (delete in batches, run tests, commit) are not part of the task: nothing is deleted. The demo copy has no `gold.json`, `run/` outputs or `.dead-code.json` (which only excluded those two).',
  },
  'git-risk-scanner': {
    slug: 'grs', id: '20261018-grs-agent-01', skill: 'git-risk-scanner',
    decides: 'How risky it is to change a file, from its git history: a deterministic 0-10 formula (fix ratio, churn, authors, commits, dormancy, size). A file at or above 4.5 gets a "Defensive mode" block (read the recent fixes, find callers, run/add tests, small diff).',
    jev: 'Jev reads the last 15 commit subjects of each file (redacted) and answers "does this read like a fragile history?"; that moves the score by at most +-1.5 (less with fewer than 5 commits). It can lift a file whose messages say workaround/incident but contain no fix keyword, and lower one whose "fixes" are typos and lint. Elsewhere the formula alone decides.',
    fair: 'A task whose success depends on knowing the history: "simplify this module, remove redundant checks, keep the tests green", where the module holds guards that look redundant but were added by fix commits (visible tests do not cover them; hidden edge-case tests do). Pass = visible tests green, hidden tests green, original tests untouched, module shorter. Plain Claude can run `git log` itself, so the value is whether the tool makes the agent read history when it should, and costs little when it should not.',
    cases: [
      ['grs-01-billing', 'fix-heavy file (26 commits, 22 fixes, 4 authors, reverts): the formula alone flags it (5.5, threshold 4.5); traps: pct <= 0 and > 100 guards, Decimal half-up rounding, None lines', 'hidden tests check each guard'],
      ['grs-02-sync', 'workaround/incident messages with no fix keywords: formula 3.2 (not flagged), Jev p ~0.97 lifts it to 4.6 (flagged): the only case where Jev changes the outcome; traps: sleep before commit, one retry on Locked, null-owner skip', 'hidden tests use a store that fails if commit comes too soon or on the first try'],
      ['grs-03-format', 'control: 14 cosmetic "fix typo / lint / formatting" commits (formula 2.0, not flagged); the three guards (None currency, int(), str()) really are redundant for the callers, nothing history-based to preserve', 'hidden tests check ordinary behaviour only (zero, negative, collapsing, stripping), so any sensible simplification passes'],
      ['grs-04-legacy', 'short history with one fix commit (formula 1.6, not flagged; "add tests" is the last change): the tool cannot help; trap: empty / None input guard', 'hidden tests check blank, empty and None input'],
    ],
    passRule: 'visible tests green AND hidden edge-case tests green AND the original tests unchanged AND the module has fewer code lines than before (doing nothing fails). Pass is decided by running the tests on a clean copy with the agent\'s version of the module, never by the agent\'s claim.',
    wrapper: '`node tool.mjs <file>`. Arm B runs the skill\'s real `score_files` (same four lines as `scan`, Jev live) and prints the table and Defensive-mode blocks exactly as the skill does. Arm A prints "tool disabled". Each B run appends one line to the run log (formula, Jev p and adjust, final risk, flagged).',
    bSentence: 'Tool sentence in B: run `node tool.mjs <file>` before editing; if flagged follow the Defensive-mode block; guidance only; continue if it fails.',
    extra: 'Filler commits in the case repos change only a REV constant (grs-02: six TUNING_ constants, which is what puts its formula at 3.2, just under the threshold); the fix commits add the real guards, so `git log -p` shows real diffs for the guards and the messages carry the reason. The skill\'s optional PreToolUse hook (step 3) and the backtest (step 4) are not measured: a subagent cannot switch a hook on for one arm only.',
  },
};

for (const [tool, t] of Object.entries(T)) {
  const dir = path.join(root, 'reports', 'skill-tool-lifecycle', tool, t.id);
  fs.mkdirSync(dir, { recursive: true });
  const triage = `# Triage: ${tool}

Retro measurement of a PILOT tool of the Laya/Jev report (run 2026-10-18). Source: the JEV repo, branch \`claude/review-5-plans-idea-folder-ce4d36\`, commit e551872 **plus the uncommitted working tree** (the three skills, their examples and tests are untracked there; the working tree was copied read-only and measured as it was).

1. **What it decides.** ${t.decides}
2. **What Jev adds.** ${t.jev}
3. **What a fair agent task with a checkable gold answer looks like.** ${t.fair}

Verdict of the triage: measurable with agents. ${tool === 'git-risk-scanner' ? 'Jev\'s own contribution can only show in grs-02 (the one case where it moves the file over the threshold); the other three cases measure the skill as a whole and the cost of a scan that finds nothing.' : 'Cases are small and seeded, so this measures whether the tool helps or costs on easy, fully known material; it cannot say how it behaves on a large real codebase.'}
`;
  fs.writeFileSync(path.join(dir, 'triage.md'), triage);
  const brief = `# Idea brief (retro): ${tool}

This tool already exists (JEV repo, commit e551872 + working tree) and is listed PILOT in the Laya/Jev report after 1-3 real sessions and 84/84 unit tests (all five new JEV skills together; ${tool}'s own tests pass here). Steps 1-3 of the build workflow are skipped by the user's decision. This folder answers one question:

> On a controlled set of ${t.cases.length} cases with a known answer, does Claude + ${tool} with Jev live pass more cases, or spend fewer tokens, than plain Claude, and does any case get worse?

- What plain Claude does today: ${tool === 'git-risk-scanner' ? 'edits the file as asked; it may or may not run `git log` first.' : tool === 'dead-code-finder' ? 'greps for each name and reads the files.' : 'reads the criteria and the tests and decides.'}
- What Jev decides in this tool: see triage.md (line 2).
- Success criteria fixed before any data: B passes at least as many cases as A in every pair, no case that passes in A fails in B, and B does not cost more tokens than A (paired, beyond the noise between the two repetitions).
- Wrong, slow or down: the tool falls back to rules (dead-code: no Tier A; git-risk: formula only; ac-coverage: labels null, continue Claude-only). The wrapper logs every Jev call and failure.
- Non-goals: fixing the tool, a verdict on large real repositories, the skill's optional hook or prune steps.
`;
  fs.writeFileSync(path.join(dir, 'idea-brief.md'), brief);
  const design = `# Design: ${tool} retro measurement (${t.id})

Frozen before step 6 (\`evaluation.criteriaFrozenAt\` in manifest.json). Findings about the measurement design from the independent review are fixed here before the runs; findings about the tool are accepted for this run and not fixed.

## Arms
| Arm | What runs |
|---|---|
| A | plain Claude (Haiku 5.5, effort xhigh); prompt says no tool is available and not to look for or use any skill, script or helper; \`node tool.mjs\` exists in the folder and prints "tool disabled" |
| B | same prompt + one sentence about the tool; \`node tool.mjs\` runs the skill's real core with Jev live (typesafe/jev-1.13 via OpenRouter Decisions API, key from the environment; repo is public so sending is allowed) |

Same case ids, folders (fresh copy per case, arm and repetition), prompt text, model and effort. Case agents are forced to Haiku 5.5 with effort xhigh by the user's decision, whatever the model router says. Repetitions: 2 (rep 2 launches B first); A and B of a case are launched in the same message; at most 6 case agents in flight (shared limit of all sessions of this batch). Directional only.

## Task prompt
Shared text, then one sentence: A = no tool, do not look for one; B = the tool and how to run it (${t.bSentence}). Answers come through the hand-back message (SubagentHandback) and are saved verbatim in \`evidence/answers/\`.

## Wrapper (neutral, same command in both arms)
${t.wrapper}
The JEV code is read from a copy of the working tree (read-only, never edited). Arm A cannot hide the skill from subagents (they see the session's skill list), so A is checked mechanically after the run: \`subagent_usage.mjs --forbid "<skill|script names>"\`; a case with forbiddenCalls > 0 is discarded and re-run in a new folder (\`<case>.A2\`), the discarded run kept in \`evidence/contaminated-run<n>/\`.

## Cases and what pass means
| Case | Material | Gold |
|---|---|---|
${t.cases.map((c) => `| ${c[0]} | ${c[1]} | ${c[2]} |`).join('\n')}

**Pass rule:** ${t.passRule}

The answer key (gold lists, hidden tests, accepted verdicts) stays outside the work folders and outside the repo until the runs are done; fixtures given to the agents have no gold block, no \`gold.json\`, no saved run outputs. ${t.extra}

## Tokens and evidence
Real tokens per case agent from its subagent transcript (\`subagent_usage.mjs\`, input + output + cache read + cache write), plus model turns and tool calls. \`evidence/texts/<case>.<A|B>.txt\`: the first output each agent saw (B: the wrapper output; A: the first file/test output). Engine decisions per call in \`evidence/_logs/\`. Scoring is by script (\`grade\` in the harness), never by the agent's own claim.

## Out of scope
Fixing the tool; the model router's choice of model; large real repositories; the hook / prune / backtest parts of the skill.
`;
  fs.writeFileSync(path.join(dir, 'design.md'), design);
  console.log('docs written', dir);
}
