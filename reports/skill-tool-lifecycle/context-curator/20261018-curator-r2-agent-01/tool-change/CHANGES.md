# curator round 2: changes (suggestion 1 only, plus 2 review Majors)

Patch: `curator-r2.patch` (engine-baseline -> engine-src for `jev_advisor/`, JEV original -> new for `tests/test_curator.py`). Changed: `jev_advisor/curator.py`, `jev_advisor/config.py`.

**What changed**
- `curator.DEFAULTS`: new `view: "pointers"`, `pointerTop: 12`; `alwaysKeep` and `omitMaxP` unchanged. New constants `VIEWS`, `PREVIEW_CHARS = 120`, `ANCHOR_SLOTS = 4`.
- `plan()`: same keep/omit decisions. Adds `anchors` (parser failure anchors) and `match` (pinning line) as new keys in `<run>.curate.json`.
- New `rank(cur)` (review Major 1, so Jev's scores can reach the list): (a) at most 4 failure anchors, line order; (b) chunks Jev scored above `omitMaxP`, by p descending (a regex-pinned chunk with such a p counts here); (c) the remaining failure anchors, then regex-pinned chunks (label `pinned`, or `pinned (JEV p=0.05)` when scored low); (d) unanswered kept chunks. Ties keep line order; omitted chunks are never listed.
- New `pointers(data, cur, log_rel, top)`: the same status line as `render`, up to `top` lines `#k lines A-B · kind · label · preview`, and a footer `N more kept chunks not listed · open the first pointer: Read <log> offset A limit N`.
- `curate(cfg, run_id, omit_max_p=None)`: same signature. It writes the view chosen by `curator.view`; an unknown view raises `ValueError`. With `view: "curated"` the output is the round-1 `render` output; on h04 it is identical to the round-1 engine's apart from the run name.
- `config.load()` (review Major 2): keeps a `curator` object from `.jev-advisor.json`, and a non-object raises `ConfigError`. `curator.view`, `pointerTop`, `omitMaxP` and `alwaysKeep` now work from the config file. `evaluate()` and the CLI flags are unchanged.

**Not done in this round**
- Suggestion 2 is not applied. WARNING protection is deferred until a held-out check: a trial `^WARNING\b` pinned 178 of 408 h04 chunks instead of 38. `omitMaxP` was not re-evaluated held-out, and no gold file was opened.
- The review Minors are still open: the Read hint covers only the first pointer, the status-line count means curated decisions, the footer wording, test gaps, the anchor preview, and the CLI message.

**Smoke check (h04_session_fixture, real pytest run; full log 320,309 bytes, 4,976 lines)**
- Fake advice with p=0.05 for all 80 chunks sent to Jev: pointer view **1,727 bytes**. Top 12 = 6 failure anchors (#1-4, plus #5-6 as overflow, since no chunk is above the cut), then 6 regex-pinned noise ERROR chunks (#8 has JEV p=0.05, the others are unanswered). Sample: `smoke-h04.pointers.txt`.
- Same but c01 = 0.95: 1,748 bytes. The list is #1-4 anchors, #5 lines 32-32 (`JEV p=0.95`), #6-7 anchors, then #8-12 pinned noise (sample: `smoke-h04-c01hi.pointers.txt`). Before this fix the same chunk ranked #45.
- `view: curated`, same advice: 272,372 bytes, the same as round 1.

**Tests (python from JEV .venv, run in scratch trees, -p no:cacheprovider)**
| suite | baseline (test-tree-baseline) | changed (test-tree) |
|---|---|---|
| tests/test_curator.py | 5 passed | 14 passed (9 new) |
| advisor base (parser_and_advisor, redact_and_client, runner) | 24 passed | 24 passed |
| whole `tests` | 84 passed | 93 passed |
There were no baseline failures and no skips.
