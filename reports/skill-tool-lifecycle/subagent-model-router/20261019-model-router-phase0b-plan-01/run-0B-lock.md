# Run lock, Phase 0B (calibration)

Locked: 2026-10-19. Machine-checked copy: `run-0B-lock.json`. Hash: sha256 of LF-normalised text.
Status: **locked. No candidate, JEV or grading call has been made. Waiting for the user's explicit OK on this lock and on budget v4.**

## Stories
- Calibration: 15 stories. Evaluable: 13. Pilot-exposed: 1 (`W-19279`, provenance only). Not evaluable: 1 (`W-19358`: full text not recoverable locally; no call is made for it). Per-story status in `story-status-0B.json`.
- Held-out: not used (see below).

## Parameters (read from `run-0B.mjs`)
- Stop (reserve check, USD): 12. No call is made when spent + the next call's cap is above this.
- Runner stop (USD): 15. **A runner stop, not a billing ceiling.** One call can exceed its cap, so spend can pass this by one overrun. Halts the run when passed.
- Starting spend (USD): 0.0775562, the rubric-helper call in `baseline-ledger-0B.json`, counted before the first call. If the ledger is missing or does not match its source, the run halts with no call.
- Per-call caps (USD): haiku 0.1, sonnet 0.4, opus 0.6, grader 0.4.
- Repeat grading: 9 of 39 evaluable outputs (13 stories x 3 tiers), seed `0B-regrade-v1`. Threshold 7 of 9 agree on overall.
- Calls: sequential, no retry, no parallel. Generation 42, grading 42, repeat grading 9, total 93. No JEV.
- CLI: `C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe` (PREFIX_ARGS []).

## Held-out check
- Held-out ids in split: 6. Prompt-bearing inputs checked: 18. Matches: 0. **Result: pass.** No ids are printed or stored.
- Held-out text is not used. Held-out evaluation needs separate approval.

## Split check (resolved, no change to the split)
- `split-0B.json` records assignmentsSha256 `b157d7be96f1c516065a0bbb06fbb34e462d6fb1f181c6ac2b3f551f1a917fa2`. It is reproduced by the 0A pairs method (sha256 of `JSON.stringify` of the id-sorted `[id, split]` pairs). Membership matches the `0B-v1` rule for 21 of 21 stories. The split file has not been edited and its version stays `0B-v1`.
- An earlier note said no serialisation reproduced the hash. That was wrong and is corrected here.
- W-19358 is recorded as `not_evaluable` (see Stories above and `story-status-0B.json`). No candidate, JEV or grading call is made for it.

## Inputs and runner (sha256)
| File | sha256 |
|---|---|
| calibration-stories-0B.json | 53d8c9dc57c51b16f29cecb3c4ab044b3d869231d343ebc859c1479812654ab5 |
| split-0B.json | d45cd695437c99eb05842aa4df986c8ab394725b4134c7ede8af87d2c8e3346f |
| mapping-0B.json | 82b0a210f09dceed4d9d19c7d90c29629a21a398e9b74a781354ed1569f471ba |
| pilot/brief.txt | aed0f90e3241dff0ec5501b18258120b71b874a5fe80c7fba8eae4492b318a64 |
| grader-prompt-0B.txt | 9229a9783c1e1942ad56551512219175a84987ef6b8c43ac66a1976461fdbfd2 |
| pilot/rubric-W-19279.md | cf1769430d168cb702abc8a25898d8e414b46ed565da40e6078f6442681879c2 |
| rubrics/rubric-W-19358.md | bd2ae54efb584e5dce34a1f4725605e329f3beb4b1962821df35c9e83fcfb83d |
| rubrics/rubric-W-19427.md | d654956bdc415433a5765857026316c56e9208661193fdab900762b6548db277 |
| rubrics/rubric-W-20925.md | bdd699f6691eb3cd8492bb11a85475515a2c029e6e03a096570720b0c089760e |
| rubrics/rubric-W-20926.md | e17b946cd16c03a50dfafa75ac53148bc7a2ff1b63e9103a2ed15f45d8ace7ac |
| rubrics/rubric-W-20927.md | c33ad445d092f29c76dce3f5c28bcdb96445afb3511c2da0d27a84866ac31fae |
| rubrics/rubric-W-20932.md | 6c76d90a4c7e4dc0c7950e33d170d6998a557283ff31fe23fd045063a67fe62b |
| rubrics/rubric-W-20934.md | 14d5fadaef76634807e3ca6768fab9658f6cf926de80dd8111819f827a27ec3d |
| rubrics/rubric-W-21635.md | 416256de896a27eb6e7cc7a8dacac85e078fa1abac28df4b97329c4cc704f976 |
| rubrics/rubric-W-21681.md | 02bfa597d280db3233603d201a93d848cefeacf8c0c93b3744c1b72b465647ea |
| rubrics/rubric-W-21996.md | 4a21d846cce0968e17f52dc021d8801a11f6563913922a1d01a857895f40c1a2 |
| rubrics/rubric-W-21998.md | 85ea75b386bc59e3df3b94550b470031b5e66c8e5a2960ec2aff17455ff72bd0 |
| rubrics/rubric-W-22016.md | 974b4df6a5a31a2c8a5b49a7bc32495a8409903655fb11a0838ff687d5886b4f |
| rubrics/rubric-W-22063.md | f96216af24c0c4edc0b1518c38442b2602f1a81f02635bc1af8502edf9ed2d25 |
| rubrics/rubric-W-22080.md | dcfda64496a5e12d48f2debf86f99e8b6dc1018cb79752d5a29b5490fa9eeda2 |
| rubric-lock-0B.md | f7ff9a4c79f88e62a7ed0f082e1518f42fdc50ecf45283a28735486db7fe0bf1 |
| story-status-0B.json | 9010e64a82ea96825fbc41c6610a55a3a74c3fb489f56411a7044164330667de |
| baseline-ledger-0B.json | 825f1143796eb312137d6e9e3dfdfc44908389992e4fa62f77c9c7de18d74d73 |
| rubrics/second-read-raw.json | 7eebc084bb83654b14ef3f8dede313c4e1105242a271fb42a542a7965676a001 |
| run-0B.mjs | 7d01f9f82a4e8e9513ccdc0df0e5dc0dc45515aa7c55d316bbc3a2f6e872510b |

## Other records
- Stub test: `stub-test-0B.md` and `stub-test-0B.json`. Run on scratch copies with a stub CLI (no model call, no spend). The copies do not modify this lock or the runner.
- Budget: `budget-sheet-0B.md` is v4. It supersedes v3, which was never approved (kept as `superseded/budget-sheet-0B-v3-unapproved.md`).
- Rubrics: second read and adjudication in `rubric-drafting-calls-0B.md`. W-19279 was not second-read (deviation logged there).
- Human review of the rubrics: `rubric-human-review.md` (no rubric changes made).
