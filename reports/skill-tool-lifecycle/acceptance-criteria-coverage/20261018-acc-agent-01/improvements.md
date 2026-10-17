# Improvements (step 7b): acceptance-criteria-coverage, run 20261018-acc-agent-01

**Diagnosis.** B did not cost more (2.30M -> 2.27M tokens, -1%, paired per-repetition average 1.148M -> 1.136M, B lower in 4 of 8 pairs) and did not help: both arms passed all 8 runs with identical verdicts, so the engine call changed nothing the agent used. Jev marked 118 of 210 (criterion, test) pairs skippable and the B agents cited none of them as evidence for the same criterion, so its skip advice was safe but saved nothing: with 8-15 tests plain Haiku reads every test in 4-7 turns (12-14 tool calls in A, 5-16 in B). The one visible Jev error is the name-only trap in acc-02 AC-05 (test_total_never_negative labelled partial_coverage, p 0.76-0.83; key: Missing), which both arms overrode. The case set is too easy to show value, not evidence that the tool is useless.

## Suggestions, ranked by expected effect
1. **Re-measure where reading all tests is expensive.**
   - **Change:** no tool change; a new experiment (new id) with 2-3 stories of 8-12 criteria each against suites of 60-100 tests in 15+ files (some parametrised, some with shared helpers), gold by construction as here.
   - **Why:** every case here fits in one or two reads, so a candidate shortlist cannot beat "read everything" (A used 12 tool calls, B 5-16).
   - **Expected effect:** if the shortlist works, B reads 5 tests per criterion instead of 60-100 and uses clearly fewer tokens at equal pass rate; if not, the tool is not worth its extra turn.
   - **How to verify:** same harness (harness/make_acc.py generator extended), tokens A vs B and criteria right per run.
2. **Show less per criterion.**
   - **Change:** `jev_skills/ac_coverage/discover.py` / `__main__.py`: default `--top 3` and let the report hide pairs that are skippable.
   - **Why:** 56% of pairs (118 of 210) were skippable and unused; the digest the agents read lists five per criterion.
   - **Expected effect:** shorter first output (fewer input tokens in the first turn) with no change in verdicts.
   - **How to verify:** same four cases, expect identical verdicts and B tokens at or below A.
3. **Make name-only recognisable.**
   - **Change:** `jev_skills/ac_coverage/classify.py` INSTRUCTIONS / LABELS: ask whether an assertion uses the input or value that makes the criterion's scenario distinct (here: a coupon larger than the subtotal), not only whether the name matches.
   - **Why:** the cart trap got partial_coverage p 0.76-0.83; a wrong-direction label can push a weaker agent to Partial.
   - **Expected effect:** name_only or insufficient_evidence for the trap; no change on the real partial cases.
   - **How to verify:** acc-02 AC-05, acc-04 AC-06 and acc-01 AC-04 labels in results.json (the labels are saved in evidence/_logs).
4. **Make `jev.decide` really never raise.**
   - **Change:** `jev_skills/common/jev.py:76-89`: treat a non-object body, non-UTF-8 bytes and `http.client` errors as unavailable.
   - **Why:** review finding (Major, accepted for this run): classify crashes instead of going Claude-only, which breaks SKILL.md step 5.
   - **Expected effect:** no crash path; no effect on pass rate.
   - **How to verify:** unit tests with a fake transport returning `[]`, `null`, bad bytes.
5. **If suggestion 1 shows no gain: keep the candidates script, drop the Jev call.** The candidate shortlist is deterministic and free; the Jev labels cost one request per run (~$0.0006, ~1.3 s) and no case used them.
