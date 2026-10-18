# Final decision: retry-loop-breaker

- **Decision:** INSUFFICIENT_EVIDENCE
- **Decided by:** the user, 2026-10-18
- **Experiment:** 20261018-retry-loop-breaker-agent-01 (Haiku 5.5 subagents, effort xhigh, Jev live, 2 repetitions)
- **Based on:** On 6 small cases (3 impossible, 3 legitimate retries) Haiku 5.5 never looped: it stopped after 1-2 runs on all impossible cases in both arms, so tokens barely moved (A 4.55M -> B 4.44M, -2.4%, inside the run-to-run noise) and pass is 11/12 vs 12/12 (the A miss is the agent declining to rerun). The Mod showed the agent nothing (0 notes, 0 Jev calls) and would have blocked the passing third run of flaky-twice in both repetitions (silent false block); no case is worse in B. The cases were too easy to show value. Top fix: re-measure on cases where the baseline really loops (and fix the fail-fail-pass false block in core.ts).

## What INSUFFICIENT_EVIDENCE means here
No adoption decision either way. The cases were too easy for plain Claude to fail, so this run cannot show a benefit or a harm. The tool stays as it is until a harder set gives a difference.

## Next
- Build a harder case set where the baseline can fail or loop (see `improvements.md`) and re-measure in a new experiment id.
- Fix any false block or wrong output named in `improvements.md` first; they hold whatever the new numbers say.
