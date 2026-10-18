#!/usr/bin/env node
// finalize_b.mjs - writes improvements.md and the final manifest fields (headline, recommendation, deviations) of the three experiments.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/XionTechs/Laya/.claude/worktrees/hopeful-mestorf-48efe4/reports/skill-tool-lifecycle';
const common = (slug, extra) => [
  'All case agents ran on Haiku 5.5 with effort xhigh by the user\'s decision, whatever the model router would say; the independent reviewers ran on opus (read-only, one per tool).',
  'The three skills are untracked files in the JEV worktree (branch claude/review-5-plans-idea-folder-ce4d36, commit e551872): the measured code is a read-only copy of that working tree. Nothing in the JEV repo was edited. The wrappers import a second copy without the demo gold files, saved run outputs and tests.',
  'The independent review (see agent-review.json) found measurement-design problems that were fixed before any case agent ran (isolation of answer keys, forbid check on both arms, prompt wording, grader matching, case design, re-run procedure) and tool problems that the user accepted for this run (2026-10-18) and that are not fixed. The measurement itself was smoke-tested once on one fixture per tool; the smoke folders, logs and prompts were rebuilt before the real runs.',
  'Directional only: 4 cases, 2 repetitions, 8 runs per arm. Cases are small (8-15 tests, 8-13 files, 20-26 commits) and mostly built by this session from the skills\' own descriptions; case 01 of acc and dcf is the JEV demo, on which the skills\' authors tuned their labels (in-sample). Token noise between repetitions of the same arm and case is large (up to 2-3x on single runs), so differences of a few percent are noise.',
  'Isolation is partial: work folders sit under <home>\\AppData\\Local\\Temp\\rw next to the other arm\'s folders, and the answer keys, harness and JEV copy sit under the session scratchpad, reachable by absolute path. The forbid check ran on BOTH arms and also matched those key/harness paths. Five runs have forbiddenCalls > 0 (dcf-02 B r1: 2, dcf-01 B r2: 1, dcf-03 B r2: 1, dcf-04 B r2: 1, grs-01 A r2: 1); every matched call was read by hand: B agents excluding the tool\'s own `.dead-code/` output folder from a Grep (legitimate), and one A agent writing the word "harness" in a description. No arm-A run used the tool or read a key, so no run was discarded or re-run.',
  'The agents write their own throw-away scripts (differential checks) to the session scratchpad that the harness gives every subagent; that is not tool use. Plain Haiku with effort xhigh often ran randomised old-vs-new comparisons by itself (grs) or listed every call site before answering, so arm A is stronger than a plain model without such habits.',
  'Jev cost per B run was $0.00003-0.0007 (logged by the wrappers); it is not part of the token numbers, which are the case agents\' session tokens only.',
  ...extra,
];

const T = {
  'acceptance-criteria-coverage': {
    id: '20261018-acc-agent-01', recommendation: 'INSUFFICIENT_EVIDENCE', confidence: 'LOW',
    headline: 'On 4 small suites (8-15 tests, 6-7 criteria) plain Haiku 5.5 and Haiku with the tool pass every run (8/8 vs 8/8, identical verdicts in all 8 pairs); tokens 2.30M -> 2.27M (-1%, B lower in 4 of 8 pairs), which is noise. Jev marked 118 of 210 pairs skippable and no agent used a skipped test as evidence, but it also labelled the cart "name-only" trap partial_coverage (p 0.76-0.80), which both arms ignored. The suites are too small for any helper to show value; top suggestion: re-measure on a suite of 60+ tests where reading everything is costly.',
    deviations: [
      'In arm B the tool\'s output is a digest of pack.json and results.json written by the neutral wrapper (five candidate tests per criterion with file:line, Jev label, p and skippable), not the raw JSON files the skill leaves in .tool-output/ac/; the skill\'s steps 1-3 and 7-8 (writing criteria.json, JUnit, verdicts.json, report) are not part of the task.',
      'The acc-01 criterion AC-03b is covered by an assertion whose test currently fails (the demo leaves the digit rule unenforced); the prompt tells the agents to judge assertions, not pass/fail. All 8 A and 8 B runs gave Covered, as the key says.',
      'Accepted verdicts: "Missing" also accepts "Unclear" for the two name-only traps (acc-02 AC-05, acc-04 AC-06, acc-01 AC-04); acc-03 AC-02 accepts Covered or Partial; acc-04 AC-05 accepts Partial or Covered (reviewer finding, fixed before the runs).',
    ],
    improvements: `# Improvements (step 7b): acceptance-criteria-coverage, run 20261018-acc-agent-01

**Diagnosis.** B did not cost more (2.30M -> 2.27M tokens, -1%, paired per-repetition average 1.148M -> 1.136M, B lower in 4 of 8 pairs) and did not help: both arms passed all 8 runs with identical verdicts, so the engine call changed nothing the agent used. Jev marked 118 of 210 (criterion, test) pairs skippable and the B agents cited none of them as evidence for the same criterion, so its skip advice was safe but saved nothing: with 8-15 tests plain Haiku reads every test in 4-7 turns (12-14 tool calls in A, 5-16 in B). The one visible Jev error is the name-only trap in acc-02 AC-05 (test_total_never_negative labelled partial_coverage, p 0.76-0.83; key: Missing), which both arms overrode. The case set is too easy to show value, not evidence that the tool is useless.

## Suggestions, ranked by expected effect
1. **Re-measure where reading all tests is expensive.**
   - **Change:** no tool change; a new experiment (new id) with 2-3 stories of 8-12 criteria each against suites of 60-100 tests in 15+ files (some parametrised, some with shared helpers), gold by construction as here.
   - **Why:** every case here fits in one or two reads, so a candidate shortlist cannot beat "read everything" (A used 12 tool calls, B 5-16).
   - **Expected effect:** if the shortlist works, B reads 5 tests per criterion instead of 60-100 and uses clearly fewer tokens at equal pass rate; if not, the tool is not worth its extra turn.
   - **How to verify:** same harness (harness/make_acc.py generator extended), tokens A vs B and criteria right per run.
2. **Show less per criterion.**
   - **Change:** \`jev_skills/ac_coverage/discover.py\` / \`__main__.py\`: default \`--top 3\` and let the report hide pairs that are skippable.
   - **Why:** 56% of pairs (118 of 210) were skippable and unused; the digest the agents read lists five per criterion.
   - **Expected effect:** shorter first output (fewer input tokens in the first turn) with no change in verdicts.
   - **How to verify:** same four cases, expect identical verdicts and B tokens at or below A.
3. **Make name-only recognisable.**
   - **Change:** \`jev_skills/ac_coverage/classify.py\` INSTRUCTIONS / LABELS: ask whether an assertion uses the input or value that makes the criterion's scenario distinct (here: a coupon larger than the subtotal), not only whether the name matches.
   - **Why:** the cart trap got partial_coverage p 0.76-0.83; a wrong-direction label can push a weaker agent to Partial.
   - **Expected effect:** name_only or insufficient_evidence for the trap; no change on the real partial cases.
   - **How to verify:** acc-02 AC-05, acc-04 AC-06 and acc-01 AC-04 labels in results.json (the labels are saved in evidence/_logs).
4. **Make \`jev.decide\` really never raise.**
   - **Change:** \`jev_skills/common/jev.py:76-89\`: treat a non-object body, non-UTF-8 bytes and \`http.client\` errors as unavailable.
   - **Why:** review finding (Major, accepted for this run): classify crashes instead of going Claude-only, which breaks SKILL.md step 5.
   - **Expected effect:** no crash path; no effect on pass rate.
   - **How to verify:** unit tests with a fake transport returning \`[]\`, \`null\`, bad bytes.
5. **If suggestion 1 shows no gain: keep the candidates script, drop the Jev call.** The candidate shortlist is deterministic and free; the Jev labels cost one request per run (~$0.0006, ~1.3 s) and no case used them.
`,
  },
  'dead-code-finder': {
    id: '20261018-dcf-agent-01', recommendation: 'REWORK', confidence: 'LOW',
    headline: 'Plain Haiku 5.5 passes 7 of 8 runs and Haiku with the scanner 8 of 8 (the one A failure listed a "disabled with reason" decoy in the in-sample demo), but B costs 61% more tokens (2.01M -> 3.23M, higher in 8 of 8 pairs) for 1-5 extra turns reading a long report, and in dcf-04 both B runs missed 2 dead items that A found (6/8 vs 8/8). Jev\'s Tier A was precise (0 live items in Tier A of 25 unused-code candidates) but covers only 24 of 41 dead items. Top suggestion: make the report short (Tier A and B only, Tier C as a count).',
    deviations: [
      'The grader was amended after the first answers came back, equally for both arms (the answer key was frozen before any run): multi-line commented-out blocks of the demo (J09, J10) accept every line of the block; transitively dead imports (json in demo core.py, compute_total in legacy_report.py, sys in pluglib/compat.py) and one comment line are neutral. Before the amendment dcf-01 failed in 7 of 8 runs only because of these lines. The pass rule is 0 wrong items and >= 75% of the dead items (changed from 80% by the review).',
      'The scan the B agents read is the skill\'s report.md exactly as the skill says to read it; the wrapper runs the real `scan .` with Jev live. In dcf-01 the report is about 12 KB.',
      'The own fixtures (dcf-02..04) were run through the tool once while they were being built (to check that the keys had no forgotten dead item and that the tool runs); the keys were not tuned toward the tool\'s output, but the fixtures are not blind to it.',
      'dcf-01 is the JEV demo (in-sample for the skill\'s keep rules and for Jev\'s tuning); its gold has 21 dead items and 28 decoys. Without the neutral/block amendments A would have failed 2 of 2 and B 2 of 2 on this case only because of grader matching, which is why they were made.',
      'The shared prompt lists the categories of indirect use (decorator, string, config, entry point, override, public API, tests), which helps A as much as B and pushes both arms toward a ceiling.',
    ],
    improvements: `# Improvements (step 7b): dead-code-finder, run 20261018-dcf-agent-01

**Diagnosis.** B passed 8/8 against A's 7/8 (A's single failure listed a decoy in the in-sample demo, B never did), but B cost 3.23M tokens against 2.01M (+61%, higher in 8 of 8 pairs; 4-5 -> 5-10 model turns, up to 10 turns and 663k tokens in dcf-03 r1) and in dcf-04 both B runs missed two dead items that both A runs found (6/8 vs 8/8, still inside the 75% rule). What Jev decided was right but small: Tier A held 0 live items among 25 unused-code candidates (24 dead, 1 transitively dead; precision 100%), yet only 24 of the 41 dead items were in Tier A; the rest sat in Tier B (Jev p 0.58-0.87 for unreferenced classes such as PaypalBackend, DebugToolbarMiddleware) and the B agents followed the tiers. Jev changed the tier of 4-19 candidates per run versus rules alone, so the call is not pure cost. The extra tokens went to reading a long report (31 Tier C lines on the demo) and then re-checking with Grep/Read. The cases are small enough that plain Haiku greps every name, so the value of ranking cannot show here.

## Suggestions, ranked by expected effect
1. **Shorten what the agent must read.**
   - **Change:** \`jev_skills/dead_code/report.py\`: default report = funnel line, Tier A table, Tier B table; Tier C only as a count (full list behind \`--full\`); drop the long evidence column for Tier A.
   - **Why:** B read the whole report in every run and then verified again (dcf-03 r1: 10 turns); the demo report has 31 Tier C lines nobody needs.
   - **Expected effect:** B tokens close to A (+10% instead of +61%) at the same pass rate.
   - **How to verify:** rerun dcf-02..04 (harness/ in this folder): paired tokens and turns.
2. **Make Tier B items easier to act on.**
   - **Change:** \`jev_skills/dead_code/report.py\` / \`triage.py\`: in Tier B show "0 refs including strings and config" as its own column and sort those first; consider a lower Jev threshold for classes with no string or config reference at all.
   - **Why:** dcf-04 D3/D4 (unreferenced middleware and backend classes) were Tier B with p 0.58-0.75 and both B runs left them out; A listed them.
   - **Expected effect:** recall of B on dcf-04 from 6/8 to 8/8 without new decoys in the list.
   - **How to verify:** dcf-04 and the demo; no decoy in the agents' lists.
3. **Close the keep-rule gap for base-class registration.**
   - **Change:** \`jev_skills/dead_code/discover.py:156-179\`: keep subclasses of a class that defines \`__init_subclass__\` or a metaclass registry.
   - **Why:** review finding (Major, accepted): live Upper and Reverse in dcf-03 had no keep rule and only escaped Tier A because Jev said p 0.62/0.69; a confident wrong Jev would delete them.
   - **Expected effect:** fewer live items one Jev answer away from Tier A.
   - **How to verify:** unit test with an always-delete fake Jev on dcf-03 (harness/ fixtures).
4. **Fix the other accepted Major findings** (side-effect imports and attribute re-exports reaching Tier A; redaction missing DB_PASSWORD-style names; scan running repo code through \`python -m\` sys.path). They did not show in these cases but each can delete live code or leak a value.
5. **Do not drop Jev:** it changed 4-19 tiers per run with no live item in Tier A. If suggestion 1 does not bring the cost down, drop the scanner for projects this small instead.
`,
  },
  'git-risk-scanner': {
    id: '20261018-grs-agent-01', recommendation: 'INSUFFICIENT_EVIDENCE', confidence: 'LOW',
    headline: 'Plain Haiku 5.5 and Haiku with the scanner both pass all 8 runs (visible and hidden tests green), tokens 4.70M -> 4.48M (-4.5%, B lower in 5 of 8 pairs; run-to-run noise on a single A case is 2.5x): the plain agent already read git history or fuzzed old against new and kept every planted guard. Jev changed the outcome where it was meant to (grs-02 formula 3.2 -> 4.6, flagged; grs-03 2.0 -> 0.7), and in 4 of 8 B runs the agent followed the defensive-mode step and added characterization tests (0 of 8 in A), but no case got a different result. Top suggestion: measure on tasks where the reason for a guard exists only in commit messages and the code gives no hint.',
    deviations: [
      'grs-02 is the one case built so that Jev matters (formula 3.2 under the threshold 4.5, Jev p 0.97 lifts it to 4.6); six TUNING_ constants in the file history put the formula there, and the margin is thin (Jev needs p >= 0.93). Jev p was 0.97 in both repetitions.',
      'The filler commits of the case repos change only a REV constant (grs-02: six TUNING_ constants); the guards come from the fix commits. Agents in both arms left REV alone ("something outside the repo may read it"), so every case "simplified" mostly the real redundant line and the structure of the loop.',
      'The "simplified" criterion counts logical code lines (non-blank, non-comment, non-docstring); it is gameable by joining lines, and grs-04 has no planted redundant line, so passing it needs a restructure (all 8 runs did one).',
      'grs-01 and grs-02 flagged in B (6.85 and 4.62), grs-03 and grs-04 did not (0.66; 1.31-1.34).',
      'In 4 of 8 B runs the agent added a new test file (the defensive-mode block says to add a characterization test when none exists); the grader only hashes the original test files, so this is allowed and not scored.',
    ],
    improvements: `# Improvements (step 7b): git-risk-scanner, run 20261018-grs-agent-01

**Diagnosis.** B was not worse and not better: 8/8 against 8/8 passes, tokens 4.70M -> 4.48M (-4.5%, B lower in 5 of 8 pairs; a single A case varies 2.5x between repetitions, grs-04: 574k vs 229k), so the difference is noise. The engine did what it should: Jev p 0.95 on the fix-heavy file (formula 5.5 -> 6.85), p 0.97 on the workaround file (3.21 -> 4.62, crossing the threshold, the only flip it can cause), p 0.06 on the cosmetic-fix file (1.98 -> 0.66). Behaviour changed too: in 4 of 8 B runs the agent followed the Defensive-mode block (read the fixes, added characterization tests), in 0 of 8 A runs. But plain Haiku with effort xhigh already kept every planted guard in all 8 A runs, by reading git log or by running its own old-versus-new fuzz comparison, so there was nothing for the tool to rescue. The case set is too easy for the value of the skill to show.

## Suggestions, ranked by expected effect
1. **Measure where history is the only clue.**
   - **Change:** no tool change; a new experiment (new id) in which the guard looks dead in the code, no test covers it, and the reason is only in a commit message (for example a retry that exists because of one incident), with files long enough that fuzzing old-versus-new is not enough; use at least one real repository file with a long history.
   - **Why:** A kept the guards here because Haiku fuzzed old against new and treated every un-provably-redundant check as live.
   - **Expected effect:** plain Haiku fails some of these, B follows the Defensive-mode step and passes them; or A still passes and the tool is shown to be insurance only.
   - **How to verify:** same harness (harness/make_grs.py generator extended), hidden tests as the gold.
2. **Make the characterization-test step conditional.**
   - **Change:** \`jev_skills/git_risk/risk.py\` guidance(): step 3 says "run the tests that cover this file; add a characterization test only if none exist".
   - **Why:** 4 of 8 B runs wrote new test files although covering tests existed; it costs turns and was not rewarded (all 8 A runs passed without).
   - **Expected effect:** about 1-2 fewer turns on flagged files, no loss of safety.
   - **How to verify:** grs-01/grs-02 turns and tool calls in B.
3. **Fix the fix-regex.**
   - **Change:** \`jev_skills/git_risk/risk.py:15-25\`: \`COSMETIC_RX\` must not veto a subject that also names a real failure (crash, wrong, regression), and \`FIX_RX\` should match fixing/resolve/correct and stop counting "add regression tests" or "bump patch version".
   - **Why:** review finding (Major, accepted for this run): "fix crash when comment is empty" and "fix wrong currency format" score as not-a-fix; the fix ratio carries the largest weight (3 of 10).
   - **Expected effect:** fewer false negatives on exactly the hidden-fragility files Jev is meant to catch.
   - **How to verify:** unit tests on those subjects plus the backtest on a real repository.
4. **Widen the margin where Jev decides.** Jev flips grs-02 only above p 0.93 (adjustment at most 1.5 against a threshold 1.3 above the formula). Either re-derive the threshold with the backtest on a real repo or let Jev's kind (workaround_or_hack, revert_or_incident) set a floor instead of a bounded adjustment. Verify with the backtest \`--with-jev\`.
5. **Keep both parts; do not drop Jev:** it moved the right file over the threshold and the cosmetic file down, at $0.00003-0.0001 per scan and under 1 s.
`,
  },
};

for (const [dir, t] of Object.entries(T)) {
  const exp = path.join(ROOT, dir, t.id);
  fs.writeFileSync(path.join(exp, 'improvements.md'), t.improvements);
  const mf = path.join(exp, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.status = 'WAITING_FOR_USER_FINAL_REVIEW';
  m.recommendation = t.recommendation; m.confidence = t.confidence; m.headline = t.headline;
  m.evaluation.deviations = common(dir, t.deviations);
  m.artifacts.improvements = 'improvements.md';
  delete m.approvals.finalDecision;
  fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  console.log('manifest + improvements', dir);
}
