# Improvements (step 7b): dead-code-finder, run 20261018-dcf-r2-agent-01

Written by an Opus review (read-only, fresh context) against this run's evidence. The token, turn, report-size, pass and Jev numbers were checked against `evidence/run-index.json`, `evidence/grades.json`, `evidence/texts/` and `evidence/_logs/`. The per-run behaviour claims (B runs `cat tool.mjs`, opens `candidates.jsonl`, reads the source files) come from the reviewer's reading of the transcripts and were not re-checked here.

**Diagnosis.** The short report worked as designed: the report B reads is 1.9-4.2 KB (round 1: about 12 KB), and the first output B saw is the report in all 8 runs. The total did not fall, because the agent never relied on the report alone. B used 63 model turns against A's 38 (+66%) and each turn re-reads about 62k cached tokens (A: 54k), so B's 4.34M tokens are +84% against A's 2.36M, higher in 8 of 8 pairs. After the report B still ran `cat tool.mjs`, opened `candidates.jsonl` (6 of 8 runs), grepped and re-checked by hand. Pass: A 7/8, B 7/8. A r2 failed on decoy J14; B r2 failed on `if amount < 0:`, the guard whose only body is `breakpoint()`, which the key does not name. Neither failure is a tool error.

**Engine.** Jev changed 4-19 tiers per run and cost $0.00013-0.00043 per run. Every promotion to Tier A was right, and no decoy reached Tier A. One demotion was wrong: `replay_events` (dead) went to Tier C at p 0.71 and the agents overrode it. Jev changed no answer; every agent re-checked every candidate itself. Two places it may have cost recall: `DebugToolbarMiddleware` and `PaypalBackend` stayed in Tier B (p 0.64 and 0.52) and B missed them in 2 of 2 runs; `Order.to_legacy_xml` (Jev p 0.99) was capped at Tier B as a method of a public class and B missed it in 2 of 2 runs while A found it in 2 of 2.

**Cases.** Too easy to show value: A passes 7 of 8 with no tool, and Haiku reads a whole fixture (8-13 files) in 1-2 turns. A report cannot beat that here.

## Suggestions, ranked by expected effect

1. **Skip the scan for small projects.**
   - **Change:** `jev_skills/dead_code/scan.py` `run`: under about 2,000 lines, print one line ("small project, read it directly") and skip discovery and Jev.
   - **Why:** +66% turns and +84% tokens, with no pass gain on these four cases.
   - **Expected effect:** B within about 10% of A tokens, same pass rate.
   - **How to verify:** rerun dcf-01..04; compare paired tokens and turns.

2. **Add a large case before the next comparison.**
   - **Change:** `harness/make_dcf.py`: one fixture with at least 5k lines and 50+ files.
   - **Why:** this is the only setting where the report could replace reading the code.
   - **Expected effect:** shows whether the tool has any value at all.
   - **How to verify:** the new case, 2 repetitions per arm.

3. **List Jev-only demotions in the report.**
   - **Change:** `report.py` `render` and `triage.py`: one line per item that rules put in Tier B and Jev moved to Tier C.
   - **Why:** `replay_events` was hidden in the Tier C count; agents opened `candidates.jsonl` in 6 of 8 runs.
   - **Expected effect:** fewer `candidates.jsonl` reads, about one turn less.
   - **How to verify:** dcf-01, count reads of `candidates.jsonl`.

4. **Narrow the "public class" cap to `__all__` and entry points.**
   - **Change:** `triage.py`, the public-class rule.
   - **Why:** `Order.to_legacy_xml` was missed in 2 of 2 B runs and found in 2 of 2 A runs.
   - **Expected effect:** demo recall +1.
   - **How to verify:** dcf-01, plus a unit test.

5. **Report a guarded junk line as one block.**
   - **Change:** junk discovery in `discover.py`: when a debug call is the only body of an `if`, report the `if` line range with the action "remove block". Separately, the grader should accept that guard as neutral, as it already does for J09/J10.
   - **Why:** this is B r2's only failure.
   - **Expected effect:** B dcf-01 r2 passes.
   - **How to verify:** dcf-01, plus a unit test on `formatting.py`.

Top suggestion: skip the scan below about 2,000 lines, and judge the tool only on a large case where reading every file costs more than reading the report.
