#!/usr/bin/env node
// Writes the headline and deviations into manifest.json after the A/B run. Run once: node finalize.mjs
import fs from 'node:fs';
import path from 'node:path';

const f = path.join(import.meta.dirname, 'manifest.json');
const m = JSON.parse(fs.readFileSync(f, 'utf8'));
m.headline = 'On 6 small cases (3 impossible, 3 legitimate retries) Haiku 5.5 never looped: it stopped after 1-2 runs on all impossible cases in both arms, so tokens barely moved (A 4.55M -> B 4.44M, -2.4%, inside the run-to-run noise) and pass is 11/12 vs 12/12 (the A miss is the agent declining to rerun). The Mod showed the agent nothing (0 notes, 0 Jev calls) and would have blocked the passing third run of flaky-twice in both repetitions (silent false block); no case is worse in B. The cases were too easy to show value. Top fix: re-measure on cases where the baseline really loops (and fix the fail-fail-pass false block in core.ts).';
m.evaluation.deviations = [
  "Stand-in wrapper, not the real hook: both arms ran commands through run.mjs (same command); A returned the raw output, B ran the Mod's own functions from hooks/core.ts (classify, decideBefore, recordAfter, Jev live on near-duplicates). The wrapper cannot see non-wrapper Bash calls, so its epoch is the work folder's file hash; the real hook also resets the epoch after any non-read-only Bash call and would therefore block less often.",
  "Observe mode shows nothing to the agent, so B appends the Mod's own denial text to a FAILED run it would have blocked (as the brief asks). On a run that passes the wrapper stays silent and only logs wouldBlock; the real hook in enforce mode would refuse that run before it ran. Two silent would-blocks happened, both on the third (passing) run of flaky-twice: false blocks in enforce mode, none shown to an agent.",
  "The guard never fired visibly and Jev was never asked (0 ambiguous decisions in 24 runs: no agent repeated a command twice and then varied it), so Jev's contribution is not measured by this run.",
  "The independent review (opus, read-only) found 12 issues. The Critical (case, arm and answer in the work folder name) and the measurement Majors/Minors were fixed before measuring (opaque job-<hash> folders, answer key and logs moved out of the work root, package.json protected, grading script written, stop clause removed from the prompt); one measurement Major (wrapper epoch vs the hook) is a stated limit. Two tool Major findings (flaky marking ignores the epoch; fail-fail-pass is blocked) and the Minors were accepted by the user for this run (2026-10-18), not fixed; the tool was not edited.",
  "Arm A was checked mechanically for tool use (subagent_usage.mjs --forbid): 0 forbidden calls in all 12 arm-A runs. 2 arm-B runs (both build-flag) show 1 matching call each; B may look at the tool, so nothing is discarded.",
  "All case agents ran on Haiku 5.5 with effort xhigh, forced by the user; the reviewer ran on opus. Both arms got the same prompt except the one tool sentence; at most 6 agents were in flight; repetition 2 launched B first.",
  "flaky-once and flaky-twice simulate flakiness with a counter file the test itself reads and writes; agents read the test and noticed it is deterministic. flaky-once A r1 declined to rerun after one failure and is graded fail (no passing run), the only non-pass of the 24: an agent-behaviour difference, not a guard effect.",
  "Tokens include cache reads (~85% of all tokens). Synthetic cases, 2 repetitions, one model: directional only. Per-case swings between repetitions of the same arm are 20-40%.",
  "Experiment files were written in the session worktree (branch claude/lucid-dijkstra-a18bb4, after merging main to get the brief and sibling reports); the tool was read at commit 9f2db58. Work folders live in the session scratchpad and are not committed; evidence has the home folder and user name replaced.",
];
fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
