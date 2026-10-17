# Improvements (step 7b): dead-code-finder, run 20261018-dcf-agent-01

**Diagnosis.** B passed 8/8 against A's 7/8 (A's single failure listed a decoy in the in-sample demo, B never did), but B cost 3.23M tokens against 2.01M (+61%, higher in 8 of 8 pairs; 4-5 -> 5-10 model turns, up to 10 turns and 663k tokens in dcf-03 r1) and in dcf-04 both B runs missed two dead items that both A runs found (6/8 vs 8/8, still inside the 75% rule). What Jev decided was right but small: Tier A held 0 live items among 25 unused-code candidates (24 dead, 1 transitively dead; precision 100%), yet only 24 of the 41 dead items were in Tier A; the rest sat in Tier B (Jev p 0.58-0.87 for unreferenced classes such as PaypalBackend, DebugToolbarMiddleware) and the B agents followed the tiers. Jev changed the tier of 4-19 candidates per run versus rules alone, so the call is not pure cost. The extra tokens went to reading a long report (31 Tier C lines on the demo) and then re-checking with Grep/Read. The cases are small enough that plain Haiku greps every name, so the value of ranking cannot show here.

## Suggestions, ranked by expected effect
1. **Shorten what the agent must read.**
   - **Change:** `jev_skills/dead_code/report.py`: default report = funnel line, Tier A table, Tier B table; Tier C only as a count (full list behind `--full`); drop the long evidence column for Tier A.
   - **Why:** B read the whole report in every run and then verified again (dcf-03 r1: 10 turns); the demo report has 31 Tier C lines nobody needs.
   - **Expected effect:** B tokens close to A (+10% instead of +61%) at the same pass rate.
   - **How to verify:** rerun dcf-02..04 (harness/ in this folder): paired tokens and turns.
2. **Make Tier B items easier to act on.**
   - **Change:** `jev_skills/dead_code/report.py` / `triage.py`: in Tier B show "0 refs including strings and config" as its own column and sort those first; consider a lower Jev threshold for classes with no string or config reference at all.
   - **Why:** dcf-04 D3/D4 (unreferenced middleware and backend classes) were Tier B with p 0.58-0.75 and both B runs left them out; A listed them.
   - **Expected effect:** recall of B on dcf-04 from 6/8 to 8/8 without new decoys in the list.
   - **How to verify:** dcf-04 and the demo; no decoy in the agents' lists.
3. **Close the keep-rule gap for base-class registration.**
   - **Change:** `jev_skills/dead_code/discover.py:156-179`: keep subclasses of a class that defines `__init_subclass__` or a metaclass registry.
   - **Why:** review finding (Major, accepted): live Upper and Reverse in dcf-03 had no keep rule and only escaped Tier A because Jev said p 0.62/0.69; a confident wrong Jev would delete them.
   - **Expected effect:** fewer live items one Jev answer away from Tier A.
   - **How to verify:** unit test with an always-delete fake Jev on dcf-03 (harness/ fixtures).
4. **Fix the other accepted Major findings** (side-effect imports and attribute re-exports reaching Tier A; redaction missing DB_PASSWORD-style names; scan running repo code through `python -m` sys.path). They did not show in these cases but each can delete live code or leak a value.
5. **Do not drop Jev:** it changed 4-19 tiers per run with no live item in Tier A. If suggestion 1 does not bring the cost down, drop the scanner for projects this small instead.
