# Laya on real ADO tasks: effectiveness and recommended usage

Date: 2026-10-02. Data: 45 coding work items from two X-Tek ADO projects (25 from XTP0008_PXP_Production, 20 from XT-Smart-Platform), most recently changed items, read-only. Local only (`ado/`, git-ignored). Items are referenced by ID.

## Bottom line

- Laya is **not reliable enough to pick the model on its own** for real ADO tasks: 25/45 exact (56%) with title + description, 21/45 (47%) with title only. On the earlier synthetic set it scored 78-83%.
- Exact accuracy is **no better than always choosing Sonnet** (25/45 on these labels). Laya's value is not accuracy overall, it is **spotting hard tasks**: it found 13 of 15 Opus-level tasks (87%).
- The better use is **"suggestion for a human reviewer"**, not automatic routing. Auto-downgrade is unsafe (5 tasks routed too low) and auto-upgrade-only gives no token savings.
- Recommendation: **pilot as a suggestion tool** (see "How to use it"), not as an automatic router.

## Method

- Labels (haiku / sonnet / opus) were assigned by one person (Claude) from the task text using a technical-effort criterion, **before** running Laya. No ground truth exists in ADO: Original Estimate and Story Points are empty on almost all items. Labels are subjective.
- Research, review, decision and planning items (not coding work) were excluded: 10 items in total.
- Label distribution: 5 haiku, 25 sonnet, 15 opus.
- Laya (`english` checkpoint, CPU, `max_len` 1024) with the same three criteria as the synthetic test. Two inputs: title only; title + description (cut at 2000 chars) plus file-count and turn signals.

## Results

| Input to Laya | Exact | Under-routed | Over-routed | Within one tier | Median latency |
|---|---|---|---|---|---|
| Title only | 21/45 (47%) | 14 | 10 | 43/45 | 390 ms |
| Title + description | **25/45 (56%)** | **5** | 15 | 44/45 | 719 ms |

By project (title + description): PXP 13/25 (5 under, 7 over); XT-Smart-Platform 12/20 (0 under, 8 over).

Confusion matrix, title + description (rows = label, columns = Laya):

| Label \ Laya | haiku | sonnet | opus |
|---|---|---|---|
| haiku (5) | 2 | 3 | 0 |
| sonnet (25) | 3 | 10 | 12 |
| opus (15) | 1 | 1 | **13** |

Baselines on the same 45 tasks:

| Strategy | Exact | Under-routed |
|---|---|---|
| Always Sonnet | 25/45 | 15 (all opus tasks) |
| Description-length heuristic (<200 chars haiku, <900 sonnet, else opus) | 15/45 | 20 |
| **Laya, title + description** | 25/45 | 5 |

Probability of the top tier as a confidence signal (title + description):

| Top probability | Tasks | Exact | Under-routed |
|---|---|---|---|
| below 0.5 | 13 | 5 | 3 |
| 0.5 to 0.7 | 27 | 17 | 2 |
| 0.7 and above | 5 | 3 | 0 |
| 0.6 and above | 17 | 13 | 0 |

## What this shows

1. **Laya spots hard tasks well:** Opus recall 13/15. The two misses are #1697 and #1712 (AI intent-detection bugs with no description).
2. **It over-escalates routine work:** 12 of 25 Sonnet tasks went to Opus, mostly infra/pipeline and integration tasks with long descriptions. Long, technical text reads as "hard" to it. Used as an automatic router this would cost more, not less.
3. **Under-routing happens on vague items:** all 5 under-routed tasks have top probability 0.44-0.53 and little or no description (bugs #805, #806, #996, #1697, #1712). With title only, it gets worse (14 under-routed).
4. **Description quality drives results.** About half of PXP items had no description. Title-only input gives 47%, versus 56% with a description.
5. **Confidence is useful as a flag:** at probability 0.6 and above, 17 tasks, 13 correct, none under-routed.
6. Real task text differs from synthetic prompts: long prose ("Problem. Today ...") and internal context (product and agent names), which Laya was not tuned for.

## Limits of this evidence

- Labels are one person's judgement, not outcomes. In the live 15-task benchmark Laya routed 4 tasks below the label and all 4 still passed, so "lower than label" is not automatically a failure.
- 45 tasks, two projects, one labeller. Differences of one or two tasks mean little.
- Not tested: Vietnamese text, GPU, other checkpoints, other projects, whether the suggested model actually completes the task.

## How to use it

| Option | Verdict |
|---|---|
| Automatic router, can go down | Not recommended: 5 under-routed, hard tasks may get Haiku |
| Automatic router, upgrade only | Safe but gives no token saving (one-way escalation, plus cache loss on each switch: 47.5k tokens measured) |
| **Suggestion for a human reviewer** | **Recommended** |

Suggested pilot for the reviewer flow:
- Laya reads the title and description when a task is created or groomed and writes a suggested tier and its probability to the task (comment or tag).
- Show the probability: 0.6 and above is a strong hint; below 0.5 means "needs a human look".
- Special handling: if the description is empty, show "no suggestion, add a description" rather than a guess.
- Humans confirm or override; log each override. After 50-100 overrides there is real ground truth to measure Laya and to choose a threshold.
- Cost: about 0.4-0.7 s on CPU per task, no GPU needed.

## Next steps

1. Run the pilot above on one team and collect overrides as ground truth.
2. Have a developer re-label these 45 tasks to replace the single-labeller baseline.
3. Re-test with real outcomes: run a sample of tasks with Haiku and Sonnet and check pass/fail.
4. Test Vietnamese task text, and re-tune criteria (Phase 1 of the original plan) for ADO wording.
