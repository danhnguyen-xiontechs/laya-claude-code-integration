# Phase 4: Independent review (Opus) → fix accepted findings (Haiku) → reports → Gate B

Input: `capsule-P4.md`. The phase session runs on Haiku; Opus is called once as a subagent.

## 4a. Independent review (one Opus call, after measuring)

Build the closed pack yourself (Haiku): the brief, `design.md`, the diff (`git diff <base>..<commit> --stat` plus the changed hunks, trimmed), the `unit-tests.json` summary, the `summary.json` numbers and the case table (pass/fail and tokens per case and arm). Then spawn **one** read-only Opus subagent (`model: "opus"`) with the pack pasted into its prompt; tell it not to open files and to answer in under ~800 words, as JSON findings plus, when the result is bad, the improvements below.

Review checklist (code): matches the approved scope; edge cases, timeouts, fallback; hidden coupling to Jev/Laya; secrets, unsafe writes; weak or in-sample tests; whether the measurement is really sourced.

A result is **bad** when any of these holds in `summary.json`:
- B costs more tokens than A (`pairedTokens` B > A by more than the noise you saw between repetitions, or > 10% with one repetition) and B does not pass more cases than A. Example: Claude + Jev spends more than plain Claude and helps with nothing.
- Any case is **worse** (passes in A, fails in B).
- The engine was called but changed nothing the agent used (its pick equals the rules / plain order, or the agent overrode it on every case), or it fell back on most calls.
- Recommendation would be `REWORK`, `DROP` or `INSUFFICIENT_EVIDENCE`.

Review checklist (results), case by case:
1. **Where B's extra tokens went**: compare turns and tool calls per case (`usage.modelTurns`, `toolCalls`) and what each arm read (`evidence/texts/<case>.<A|B>.txt`). Typical causes: the tool's output is long or needs a second step to use; the agent re-checks or overrides it; the wrapper is run several times.
2. **Why a case got worse**: read B's answer next to the tool's output and the engine log. Was the tool wrong (bad ranking, wrong edge), or did the agent misread a correct output?
3. **What the engine actually decided**: per call, did Jev/Laya change the rules' result, and was that change right? If it never changes anything, the call is pure cost.
4. **Whether the cases could show value at all**: if plain Claude already passes everything, say the case set is too easy rather than blaming the tool.
5. Cross-check with the code findings above: a known bug may explain the result.

Save `agent-review.json` (`findings: [{ severity: Critical | Major | Minor | Suggestion, finding, ref, proposedFix, resolution }]`) and, when the result is bad, `improvements.md`: a short diagnosis (2-4 sentences, with the numbers), then at most 5 suggestions ranked by expected effect, each with **change** (file/function), **why** (the evidence), **expected effect** (tokens, pass rate) and **how to verify**. Include "drop the engine call / keep rules only" or "drop the tool" when the evidence points there. Put the top suggestion in one sentence at the end of the `headline`.

Stop and hand back the findings list (one line each). **Only the user accepts or rejects findings**: the control session asks (AskUserQuestion), then writes `accepted by the user (<date>)` or `rejected by the user (<date>)` into each `resolution`. A phase session or subagent never accepts for the user.

## 4b. Fix the accepted findings (Haiku, smart-context-trimming enforce)

Started again from `capsule-P4.md` (it lists the accepted findings). One `haiku-case` agent (or the phase session) applies them on the experiment branch, re-runs the tests and rewrites `unit-tests.json`. If a fix changes the tool's behaviour, re-run the affected cases in both arms (same case ids, a new runId; smart-context-trimming off for that re-run). Set each fixed finding's `resolution` to `fixed in <commit>`. A redesign (not a fix) is not done here: it becomes a suggestion for Gate B and a new experiment id.

## 4c. Reports

Set `recommendation` (`ADOPT | PILOT | REWORK | DROP | INSUFFICIENT_EVIDENCE`), `confidence` (LOW/MEDIUM/HIGH), a plain one-to-two-sentence `headline` (tokens A → B, whether any case got worse, what blocks adoption) and `evaluation.deviations` (caveats in plain words) in `manifest.json`, then:

```bash
node .claude/skills/build-skill-tool-workflow/scripts/build_tool_report.mjs "reports/skill-tool-lifecycle/<tool>/<experiment-id>"
```

`report.html` reads top-down: verdict + headline → 4 cards (tokens A → B, cases passed, engine calls/latency, tests · review) → case-by-case table (pass/fail each arm, tokens each arm, change, bar, links to what Claude read) → caveats → collapsed review, tests, all numbers, raw data. A case that passes in A and fails in B is highlighted as **worse** and must be in the headline.

```bash
node .claude/skills/build-skill-tool-workflow/scripts/build_main_report.mjs
```

One row per experiment from its `summary.json`: verdict, tokens A → B, cases passed A → B, engine calls, headline, linking to the per-tool `report.html` (a reference, not a copy), plus "Waiting on you". Check every link opens and no secret or PII is in `evidence/`.

## Gate B (control session)

Send `index.html` and the experiment's `report.html` (SendUserFile, `display: "render"`). In chat: what was built (branch/commit), tests and review, tokens A → B and any worse case, recommendation, the top 1-3 suggestions from `improvements.md` when the result was bad (step 7b), and the one decision needed. Record it in `manifest.approvals.finalDecision` (+ `finalDecisionAt`, and `status` = the decision) + `final-decision.md`, rebuild both reports; "Waiting on you" then drops the experiment. Until then the tool stays behind its flag.
