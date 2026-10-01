# Laya on real ADO tasks: effectiveness and recommended usage

Date: 2026-10-02 (updated with a larger sample). Data: **122 coding work items** from two X-Tek ADO projects (84 from XTP0008_PXP_Production, 38 from XT-Smart-Platform), read-only. Local only (`ado/`, git-ignored). Items are referenced by ID.

## Bottom line

- Laya is **not reliable enough to pick the model on its own** for real ADO tasks: 68/122 exact (56%) with title + description, 56/122 (46%) with title only. On the earlier synthetic set it scored 78-83%.
- Exact accuracy is **identical to always choosing Sonnet** (68/122 on these labels). Laya does not beat the trivial baseline on accuracy. What it adds is **spotting hard tasks**: it found 22 of 30 Opus-level tasks (73%), which "always Sonnet" misses entirely.
- **Description quality decides the result.** With a description Laya under-routes only 3 of 75 tasks. Without one it under-routes 17 of 47, almost all of them title-only bugs.
- Recommendation: **pilot as a suggestion for a human reviewer**, not as an automatic router. Show nothing when the description is empty.

## Method

- Sample: 190 items pulled (the most recently changed 30 per project, then 65 per project spread evenly over the full backlog: Bug, Task, User Story, Feature). 68 excluded as not codable work: epics and requirement-level user stories, demos, research, design documents, setup items, and empty-description containers. 122 labelled.
- Labels (haiku / sonnet / opus) were assigned by one labeller (Claude) from the task text, by technical effort, **before** running Laya. ADO has no ground truth: Original Estimate and Story Points are empty on nearly all items. Labels are subjective, and weakest for title-only bugs.
- Label distribution: 24 haiku, 68 sonnet, 30 opus. Types: 43 Bug, 76 Task, 3 User Story.
- Laya `english` checkpoint, CPU, `max_len` 1024, same three criteria as the synthetic test. Two inputs: title only; title + description (cut at 2000 chars) plus file-count and turn signals.

## Results

| Input to Laya | Exact | Under-routed | Over-routed | Within one tier | Median latency |
|---|---|---|---|---|---|
| Title only | 56/122 (46%) | 40 | 26 | 117/122 | 390 ms |
| Title + description | **68/122 (56%)** | **20** | 34 | 120/122 | 573 ms |

Baselines on the same 122 tasks:

| Strategy | Exact | Under-routed |
|---|---|---|
| Always Sonnet | 68/122 | 30 (all opus tasks) |
| Bug -> haiku, everything else -> sonnet | 54/122 | not computed |
| Description-length heuristic (<200 chars haiku, <900 sonnet, else opus) | 44/122 | 63 |
| **Laya, title + description** | 68/122 | 20 |

Confusion matrix, title + description (rows = label, columns = Laya):

| Label \ Laya | haiku | sonnet | opus |
|---|---|---|---|
| haiku (24) | 8 | 16 | 0 |
| sonnet (68) | 12 | 38 | 18 |
| opus (30) | 2 | 6 | **22** |

Does the task have a description? (title + description input)

| Subset | Tasks | Exact | Under-routed | Over-routed |
|---|---|---|---|---|
| Has description | 75 | 46 (61%) | **3** | 26 |
| No description | 47 | 22 (47%) | **17** | 8 |

By type (title + description): Task 45/76 exact, 3 under; Bug 20/43 exact, **17 under**; User Story 3/3. By project: PXP 44/84 (17 under), XT-Smart-Platform 24/38 (3 under).

Top probability as a confidence signal (title + description):

| Top probability | Tasks | Exact | Under-routed |
|---|---|---|---|
| below 0.5 | 51 | 27 | 14 |
| 0.5 to 0.6 | 44 | 22 | 6 |
| 0.6 to 0.7 | 20 | 14 | 0 |
| 0.7 and above | 7 | 5 | 0 |

## What this shows

1. **Laya spots hard tasks:** Opus recall 22/30 (precision 22/40). Hard tasks it misses are mostly AI-behaviour bugs with no description.
2. **It over-escalates routine work:** 18 of 68 Sonnet tasks went to Opus (34 over-routed in total). Long technical descriptions read as "hard". As an automatic router it would cost more, not less.
3. **It under-routes title-only bugs:** 17 of the 20 under-routed tasks are bugs without a description (UI glitches and flow bugs the labeller rated sonnet or opus; Laya answered haiku). A title like "Date picker issues" gives it too little to go on.
4. **It cannot find the easy tasks:** haiku recall 8/24. Small copy and UI tweaks are usually pushed to Sonnet. There is little to save by sending work down to Haiku with this model.
5. **Confidence is useful as a flag:** at probability 0.6 and above, 27 tasks, 19 correct, none under-routed. About 5 in 6 tasks fall below that, so it is a flag rather than a classifier.
6. The synthetic benchmark overstated accuracy. Real tasks use long prose, internal names, and often only a title.

## Limits of this evidence

- Labels are one person's judgement, not outcomes. In the live 15-task benchmark Laya routed 4 tasks below the label and all 4 still passed, so "lower than label" is not automatically a failure. Title-only bug labels are the least certain.
- 122 tasks, two projects, one labeller. Differences of a few tasks mean little. The "always Sonnet" tie depends on 56% of labels being sonnet.
- Not tested: Vietnamese text, GPU, other checkpoints, other projects, whether the suggested model actually completes the task.

## How to use it

| Option | Verdict |
|---|---|
| Automatic router, can go down | Not recommended: under-routing, especially on short bug titles |
| Automatic router, upgrade only | Safe but gives no token saving (one-way escalation, plus cache loss on each switch: 47.5k tokens measured) |
| **Suggestion for a human reviewer** | **Recommended** |

Suggested pilot:
- When a task is created or groomed, Laya reads title + description and writes a suggested tier and its probability to the task (comment or tag).
- **If the description is empty, show "no suggestion, add a description"**, not a guess. This removes 17 of the 20 under-routed cases.
- Probability 0.6 and above: strong hint. Below 0.5: "needs a human look".
- Humans confirm or override, and each override is logged. After 50-100 overrides there is real ground truth to measure Laya and set the threshold.
- Cost: about 0.4-0.6 s on CPU per task, no GPU needed.

## Next steps

1. Run the pilot on one team and collect overrides as ground truth.
2. Have a developer re-label a sample (about 30 tasks, including the title-only bugs) to replace the single-labeller baseline.
3. Re-test with real outcomes: run a sample of tasks with Haiku and Sonnet and check pass/fail.
4. Test Vietnamese task text, and re-tune criteria (Phase 1 of the original plan) for ADO wording.
