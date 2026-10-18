# Dead code report: `dcf-04-shopapp.B.r1`

Run `20261018-102942`, mode **jev**, Tier A threshold p >= 0.9. Tier A = safe to delete in small batches; B = needs a human look; C = kept (rule or JEV), counted here and listed with --full.

## Funnel

| Step | Unused code | Junk |
|---|---|---|
| Discovered | 31 | 3 |
| After keep rules | 12 | 3 |
| Sent to JEV | 12 | 3 |
| JEV answered | 12 | 3 |
| Tier A / B / C | 5/6/20 | 2/1/0 |

JEV: 1 request(s), 5326 input tokens, $0.000224, 779 ms total (status ok).

Scanned 14 Python files and 1 text files. Excluded: none.

## Tier A: safe to delete (in batches) (7)

| ID | Tier | Kind | Location | What | JEV | Action |
|---|---|---|---|---|---|---|
| C017 | A | unused_method | `shopapp/models.py:14-15` | `Order.recalculate_legacy` | likely_dead 0.99 | Delete |
| C022 | A | unused_function | `shopapp/signals.py:16-17` | `_unused_signal_helper` | likely_dead 0.94 | Delete |
| C023 | A | unused_constant | `shopapp/utils.py:4` | `OLD_DATE_FMT` | likely_dead 1.00 | Delete |
| C025 | A | unused_function | `shopapp/utils.py:11-12` | `slug` | likely_dead 1.00 | Delete |
| C028 | A | unused_function | `shopapp/views.py:12-13` | `order_export` | likely_dead 0.91 | Delete |
| J001 | A | debug_print | `shopapp/middleware.py:11` | `print('took', time.time() - start)` | debug_leftover 0.97 | Remove call |
| J002 | A | commented_code | `shopapp/management/commands/purge.py:11-12` | `for o in old_orders():` | dead_code_comment 0.99 | Delete comment |

## Tier B: review (7)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C005 | B | orphan_module | `shopapp/management/commands/purge.py:1-13` | `shopapp.management.commands.purge` | 0 refs, dynamic import in repo | likely_dead 0.54 | Review |
| C008 | B | unused_function | `shopapp/app.py:11-17` | `build` | 0 refs, test refs 2, reflection in file | dynamic_use_possible 0.68 | Review |
| C012 | B | unused_class | `shopapp/middleware.py:15-20` | `DebugToolbarMiddleware` | 0 refs | likely_dead 0.64 | Review |
| C019 | B | unused_class | `shopapp/payments.py:6-8` | `PaypalBackend` | 0 refs | dynamic_use_possible 0.52 | Review |
| C020 | B | unused_constant | `shopapp/settings.py:3` | `URLCONF` | 0 refs | likely_dead 0.86 | Review |
| C024 | B | unused_function | `shopapp/utils.py:7-8` | `today` | 0 refs, test refs 2 | test_only 0.98 | Review |
| J003 | B | debug_print | `shopapp/management/commands/purge.py:10` | `print('purging')` | in `handle`; rule: debug_leftover | intentional_output 0.55 | Review |

## Tier C: keep (20)

Not listed here (kept code). `candidates.jsonl` has them, or run the scan with `--full`.

Full evidence and snippets: `candidates.jsonl` (one JSON object per ID).
