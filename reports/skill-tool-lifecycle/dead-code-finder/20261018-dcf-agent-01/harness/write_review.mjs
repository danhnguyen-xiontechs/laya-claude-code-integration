#!/usr/bin/env node
// write_review.mjs - agent-review.json of the three experiments from the independent reviewers' findings (opus, read-only).
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const ACC = 'accepted by the user for this run (2026-10-18), not fixed. Tool finding: the tool is not edited in this run.';
const FIXED = (t) => `fixed before the runs: ${t}`;
const ISO = FIXED('work folders moved to <home>\\AppData\\Local\\Temp\\rw (keys, harness, the JEV copy with demo gold files and the case generators stay under the scratchpad); the wrappers import a JEV copy without gold.json/run outputs/tests; the forbid check now runs on BOTH arms and also matches scratchpad, keys, hidden_test, make_*, gold.json, harness. Folders of the other arm remain reachable by path: a residual caveat listed in the manifest deviations.');
const RERUN = FIXED('make() with --arm A only rebuilds the A folders and no longer deletes the B log; a failing forbid check now stops collect instead of recording null.');
const R = {
  'acceptance-criteria-coverage': {
    id: '20261018-acc-agent-01',
    findings: [
      ['Critical', 'The answer key can be read from every work folder (keys, make_acc.py, acc.mjs DEMO_GOLD, jev-src demo gold.json are a few levels up; the A forbid regex does not match them).', 'harness/tools/acc.mjs', ISO],
      ['Critical', 'Arm A can read arm B\'s tool output in sibling folders and arm B is never checked for forbidden reads (forbid only ran over A).', 'harness/retro.mjs:116', ISO],
      ['Major', 'Smoke-run leftovers (.tool-output, a log line) would contaminate acc-02-cart.B.r1.', 'harness/retro.mjs:57', FIXED('all work folders, prompts and logs were rebuilt after the smoke runs; the log is removed per B run at make time.')],
      ['Major', 'Gold of acc-03 AC-02 ("any other type rejected") is ambiguous with one non-allowed type tested.', 'build/out3/keys/acc-03-uploads.json', FIXED('key now accepts Covered or Partial.')],
      ['Major', 'acc-01 AC-03b has a failing test (digit rule not enforced) while the key says Covered; agents that run pytest may downgrade it.', 'harness/tools/acc.mjs', FIXED('the prompt now says to judge what tests assert, not whether they pass.')],
      ['Minor', 'acc-04 AC-05 is borderline (removal asserted, re-booking not).', 'build/out3/keys/acc-04-booking.json', FIXED('key accepts Partial or Covered.')],
      ['Minor', '"Do not change any file" conflicts with the tool writing .tool-output in arm B.', 'harness/tools/acc.mjs', FIXED('prompt says "Do not change any project file".')],
      ['Minor', 'Grader exact-match on the verdict word, tests field unchecked.', 'harness/tools/acc.mjs', FIXED('verdict word is case-normalised; the cited tests are recorded but not scored (kept as is, said in design.md).')],
      ['Minor', 'All-criteria-right pass rule over few cases is coarse.', 'design.md', FIXED('criteria right and false-Covered are reported next to pass/fail in every observedOutcome and in the report notes.')],
      ['Minor', 'Forbid failure produced null instead of stopping; the Python path names the JEV venv (a breadcrumb).', 'harness/retro.mjs:117', RERUN + ' The Python path stays (no other Python 3 is installed); it is the same in both arms.'],
      ['Major', 'jev.decide breaks its "never raises": a JSON body that is not an object or non-UTF-8 bytes raise, so classify crashes instead of going Claude-only.', 'jev_skills/common/jev.py:89', ACC],
      ['Minor', 'A partial batch failure hides the cause (status ok, pairs get "invalid-answer" instead of "timeout").', 'jev_skills/ac_coverage/classify.py:82', ACC],
      ['Minor', 'Unparsable test files are skipped silently; a criterion whose only test is there becomes no_candidates.', 'jev_skills/ac_coverage/discover.py:114', ACC],
      ['Minor', 'Discovery misses nested test classes, unittest.TestCase not named Test*, and custom pytest python_files/classes/functions.', 'jev_skills/ac_coverage/discover.py:118', ACC],
      ['Minor', 'classify imports jev_advisor.redact at module level (ImportError instead of Claude-only) and the criterion text is not redacted.', 'jev_skills/ac_coverage/classify.py:7', ACC],
      ['Minor', 'The report does not validate verdict test references; Unverified rows list nodeids with execution status that read like evidence.', 'jev_skills/ac_coverage/report.py:40', ACC],
      ['Minor', 'Labels cannot become coverage claims, but skippable pairs can steer Claude: in the smoke run Jev labelled the AC-05 name-only trap partial_coverage p=0.83 (the key says Missing).', 'jev_skills/ac_coverage/report.py:33', ACC],
      ['Suggestion', 'Unit tests are weak/in-sample: nothing exercises jev.decide parsing, parametrized tests, duplicate names, an unparsable file, empty criteria, partial batch failure.', 'tests/test_ac_coverage.py:87', ACC],
    ],
  },
  'dead-code-finder': {
    id: '20261018-dcf-agent-01',
    findings: [
      ['Critical', 'The grader could never pass dcf-01 if the agent lists the real debug prints in cli.py: the key for decoy J07 reduced to the bare word "print".', 'harness/tools/dcf.mjs:74-87', FIXED('symbol vs line matching rewritten: an answer entry is a symbol only if it names one (name, a.b, name(), def f(...)); line text is matched as text; keys that are single words are matched as whole words. Checked with the reviewer\'s failing inputs (J07, K10 vs OLD_DATE_FMT, N2).')],
      ['Major', 'Answer lines and key entries were compared the wrong way (OLD_DATE_FMT line hit decoy K10; print("took") never matched N2; short names matched anywhere).', 'harness/tools/dcf.mjs', FIXED('same rewrite; whole-word matching.')],
      ['Major', 'The grader could not handle a method of a dead class or a whole dead module (Experimental.run, PaypalBackend.charge, pluglib/compat.py).', 'harness/tools/dcf.mjs:76,85', FIXED('members of a dead class are neutral; compat module added as a neutral key item.')],
      ['Major', 'Answer keys, scan reports and the other arm\'s prompts were reachable from every work folder; forbid ran on A only.', 'harness/tools/dcf.mjs:139; harness/retro.mjs:116', ISO],
      ['Major', 'The arm-B wrapper logged status ok even when Jev failed (the scan always prints "JEV n sent"), requests hard-coded 1, invalid hard-coded 0.', 'harness/tools/dcf.mjs:61-63', FIXED('status is ok only if at least one candidate has a Jev answer; requests parsed from the report; invalid = sent - answered.')],
      ['Major', 'dcf-03 dead items are ambiguous for a published library and 4/4 recall was required.', 'build/out2/keys/dcf-03-pluglib.json', FIXED('recall rule is now >= 75% (rounded up); the prompt defines public API as __all__ and declared entry points.')],
      ['Major', 'Keys left out plausible items (cli.py registry prints, redundant test import, unicodedata import, the compat module).', 'build/out2/repos/dcf-02-ordersapi/ordersapi/cli.py:17-18', FIXED('added as neutral items.')],
      ['Minor', 'Arm B alone was told to verify its list; the shared prompt lists the decoy categories.', 'harness/tools/dcf.mjs:40-43', FIXED('verify sentence removed from B. The category list stays in both arms (a ceiling risk, noted in deviations).')],
      ['Minor', 'One B folder and its log were used by the smoke run before the real runs.', 'work/dcf', FIXED('everything rebuilt after the smoke runs.')],
      ['Minor', 'All-or-nothing pass rule and lenient matching.', 'harness/tools/dcf.mjs', FIXED('raw counts (dead found, decoys, unlisted, neutral) are in every observedOutcome; unlisted items are reviewed by hand.')],
      ['Suggestion', 'dcf-01 is in-sample; the own fixtures were scanned by the tool while being built.', 'design.md', FIXED('stated in manifest deviations; dcf-01 is reported as in-sample; the scans only checked that the tool runs and the keys have no forgotten dead item.')],
      ['Major', 'Classes registered by a base class\'s __init_subclass__ or a metaclass have no keep rule: live plugins can reach Tier A when Jev says likely_dead >= 0.9.', 'jev_skills/dead_code/discover.py:156-179', ACC],
      ['Major', 'Side-effect imports and attribute re-exports become unused_import candidates with no keep rule; they can reach Tier A.', 'jev_skills/dead_code/discover.py:250-267', ACC],
      ['Major', 'Secret redaction misses DB_PASSWORD / STRIPE_SECRET style names; a secret value went to Jev inside a snippet.', 'jev_advisor/redact.py:20,27', ACC],
      ['Major', 'The "static" scan can execute repo code: python -m puts the current folder first on sys.path (a repo fnmatch.py ran).', '.claude/skills/dead-code-finder/SKILL.md:22', ACC],
      ['Minor', 'Malformed Jev answers accepted (probabilities not checked to be in [0,1]); decide() raises on a non-object body.', 'jev_skills/common/jev.py:5,38,89', ACC],
      ['Minor', 'Prints in helper functions/methods of CLI or command modules are labelled debug_leftover by rule (print("purging") in Command.handle).', 'jev_skills/dead_code/junk.py:176-182', ACC],
      ['Minor', 'Evidence search gaps: hidden folders, Makefile/Dockerfile/*.sh, doctests, class-decorator-registered methods.', 'jev_skills/dead_code/index.py:90,172', ACC],
      ['Minor', 'An old report inside the scan root suppresses the next scan (names in it become string refs).', 'jev_skills/dead_code/report.py:56-62', ACC],
      ['Suggestion', '12 tests only on the in-sample demo; untested: __init_subclass__, side-effect imports, named secrets, probabilities outside [0,1], non-object JSON, stdlib-shadowing repo modules; SKILL.md omits tierCThreshold etc.', 'tests/test_dead_code.py', ACC],
    ],
  },
  'git-risk-scanner': {
    id: '20261018-grs-agent-01',
    findings: [
      ['Major', 'grs-03 was not a control: the hidden tests checked three guards that look redundant and have no history behind them.', 'build/make_grs.py:258-271', FIXED('hidden tests of grs-03 now check ordinary behaviour only; every sensible simplification passes; verified 4/4 on the original.')],
      ['Major', 'The "sleep before commit" trap of grs-02 was not guarded (the retry branch hid it).', 'build/make_grs.py:47-50,232-234', FIXED('test_waits_before_commit now also asserts exactly one commit call.')],
      ['Major', 'The answer key and the other arm\'s files were reachable from every work folder; forbid ran on A only.', 'harness/tools/grs.mjs:139-140; harness/retro.mjs:116', ISO],
      ['Major', 'Arm A\'s sentence restricted ordinary commands and named a "git-risk tool" (a hint).', 'harness/tools/grs.mjs:28', FIXED('A now says: no risk scanner is available; do not look for any skill, script or helper; ordinary git and test commands are fine.')],
      ['Major', 'The re-run procedure rebuilt B folders and deleted the B engine log.', 'harness/retro.mjs:48,52,57', RERUN],
      ['Major', 'The Defensive-mode block says to add a characterization test; the prompt said not to edit tests and the grader failed any change of tests/*.py.', 'harness/tools/grs.mjs:107,119', FIXED('prompt: existing tests must not be edited, adding a new test file is fine (the grader only hashes the original test files).')],
      ['Minor', 'A deleted module graded as error instead of fail; pytest had no timeout.', 'harness/tools/grs.mjs:93,102', FIXED('missing target = fail; 120 s timeout.')],
      ['Minor', 'The "fewer code lines" rule can be gamed (joined lines) and legacy has no planted redundant line.', 'harness/tools/grs.mjs:81-91', 'not fixed (measurement note): the rule counts logical statement lines of non-blank, non-comment, non-docstring lines; grs-04 needs a restructure to pass, which is part of why it is the "tool cannot help" case. Stated in design.md.'],
      ['Minor', 'Some behaviour changes pass the hidden tests (dropping `or 0` on price, a falsy owner check).', 'build/make_grs.py:185-190,243-246', 'not fixed (measurement note): hidden tests cover the planted traps, not every possible change.'],
      ['Minor', 'Jev flips grs-02 only if p >= 0.93 and the case sits on a tuned margin (TUNING_ constants); design.md said filler changes only REV.', 'build/make_grs.py:41; design.md:24,30', FIXED('design.md says the six TUNING_ constants are what puts the formula at 3.2; the Jev p of every call is logged.')],
      ['Minor', 'grs-04 was described as old and dormant, but its history is 34 days.', 'design.md:26', FIXED('description corrected.')],
      ['Major', 'COSMETIC_RX vetoes real fixes that mention comment/format/etc.; fix regex misses "fixing", "fixup", "resolve", "correct" and counts "add regression tests", "bump patch version".', 'jev_skills/git_risk/risk.py:15-25', ACC],
      ['Minor', 'Renames are not followed; a renamed fragile file restarts with no history.', 'jev_skills/git_risk/gitlog.py:60-63', ACC],
      ['Minor', 'No shallow-clone detection; --max-count=20000 and the 200 per-file cap distort age and dormancy.', 'jev_skills/git_risk/gitlog.py:62', ACC],
      ['Minor', 'Empty files are treated as binary; missing/untracked paths are dropped silently.', 'jev_skills/git_risk/gitlog.py:71-80', ACC],
      ['Minor', 'jev.decide raises on a non-object JSON body or non-UTF-8 bytes; the scan crashes instead of falling back to the formula.', 'jev_skills/common/jev.py:76-89', ACC],
      ['Minor', 'Hook: file marked seen before scoring, cache key ignores weights/maxCommits, a Jev outage is cached for that HEAD, import-time failure is not fail-open.', 'jev_skills/git_risk/hook.py:52-70', ACC],
      ['Minor', 'The monotonicity claim is false for size and commits; capped flag set at exactly n == maxCommits.', 'jev_skills/git_risk/risk.py:98,123-131', ACC],
      ['Minor', 'Tests are weak/in-sample (tautology at line 77; threshold tuned on the demo repo); none for renames, merges, shallow clones, CRLF, regex false negatives.', 'tests/test_git_risk.py:77', ACC],
      ['Suggestion', 'Redaction covers commit subjects only; file paths go to Jev unredacted; merge commits are excluded.', 'jev_skills/git_risk/risk.py:166-173', ACC],
    ],
  },
};
for (const [tool, r] of Object.entries(R)) {
  const dir = path.join(root, 'reports', 'skill-tool-lifecycle', tool, r.id);
  const out = {
    reviewer: 'independent read-only subagent (Explore type, fresh context, opus), one per tool; ran the tool\'s unit tests and read the tool, harness, fixtures and keys',
    reviewedAt: '2026-10-18',
    findings: r.findings.map(([severity, finding, ref, resolution]) => ({ severity, finding, ref, resolution })),
  };
  fs.writeFileSync(path.join(dir, 'agent-review.json'), JSON.stringify(out, null, 2) + '\n');
  const n = (s) => out.findings.filter((f) => f.severity === s).length;
  console.log(tool, 'Critical', n('Critical'), 'Major', n('Major'), 'Minor', n('Minor'), 'Suggestion', n('Suggestion'));
}
