# Dead code report: `dcf-04-shopapp.B.r1`

Run `20261018-005532`, mode **jev**, Tier A threshold p >= 0.9. Tier A = safe to delete in small batches; B = needs a human look; C = kept (rule or JEV), listed for transparency.

## Funnel

| Step | Unused code | Junk |
|---|---|---|
| Discovered | 31 | 3 |
| After keep rules | 12 | 3 |
| Sent to JEV | 12 | 3 |
| JEV answered | 12 | 3 |
| Tier A / B / C | 5/6/20 | 2/1/0 |

JEV: 1 request(s), 5326 input tokens, $0.000224, 1216 ms total (status ok).

Scanned 14 Python files and 1 text files. Excluded: none.

## Tier A: safe to delete (in batches) (7)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C017 | A | unused_method | `shopapp/models.py:14-15` | `Order.recalculate_legacy` | 0 refs | likely_dead 1.00 | Delete |
| C022 | A | unused_function | `shopapp/signals.py:16-17` | `_unused_signal_helper` | 0 refs | likely_dead 0.95 | Delete |
| C023 | A | unused_constant | `shopapp/utils.py:4` | `OLD_DATE_FMT` | 0 refs | likely_dead 1.00 | Delete |
| C025 | A | unused_function | `shopapp/utils.py:11-12` | `slug` | 0 refs | likely_dead 1.00 | Delete |
| C028 | A | unused_function | `shopapp/views.py:12-13` | `order_export` | 0 refs | likely_dead 0.94 | Delete |
| J001 | A | debug_print | `shopapp/middleware.py:11` | `print('took', time.time() - start)` | in `__call__`; rule: debug_leftover | debug_leftover 0.99 | Remove call |
| J002 | A | commented_code | `shopapp/management/commands/purge.py:11-12` | `for o in old_orders():` | 2 commented lines parse as code; rule: dead_code_comment | dead_code_comment 0.99 | Delete comment |

## Tier B: review (7)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C005 | B | orphan_module | `shopapp/management/commands/purge.py:1-13` | `shopapp.management.commands.purge` | 0 refs, dynamic import in repo | likely_dead 0.53 | Review |
| C008 | B | unused_function | `shopapp/app.py:11-17` | `build` | 0 refs, test refs 2, reflection in file | dynamic_use_possible 0.60 | Review |
| C012 | B | unused_class | `shopapp/middleware.py:15-20` | `DebugToolbarMiddleware` | 0 refs | likely_dead 0.70 | Review |
| C019 | B | unused_class | `shopapp/payments.py:6-8` | `PaypalBackend` | 0 refs | likely_dead 0.53 | Review |
| C020 | B | unused_constant | `shopapp/settings.py:3` | `URLCONF` | 0 refs | likely_dead 0.85 | Review |
| C024 | B | unused_function | `shopapp/utils.py:7-8` | `today` | 0 refs, test refs 2 | test_only 0.99 | Review |
| J003 | B | debug_print | `shopapp/management/commands/purge.py:10` | `print('purging')` | in `handle`; rule: debug_leftover | intentional_output 0.52 | Review |

## Tier C: keep (20)

- C001 orphan_module `shopapp/admin.py:1-16` `shopapp.admin`: string_ref shopapp/app.py:12
- C002 orphan_module `shopapp/middleware.py:1-20` `shopapp.middleware`: string_ref shopapp/settings.py:1
- C003 orphan_module `shopapp/payments.py:1-8` `shopapp.payments`: string_ref shopapp/settings.py:2
- C004 orphan_module `shopapp/signals.py:1-17` `shopapp.signals`: string_ref shopapp/app.py:12
- C006 unused_class `shopapp/admin.py:11-16` `OrderAdmin`: decorator @register
- C007 unused_method `shopapp/admin.py:15-16` `OrderAdmin.get_queryset`: 0 refs
- C009 unused_class `shopapp/middleware.py:4-12` `TimingMiddleware`: string_ref shopapp/settings.py:1
- C010 unused_method `shopapp/middleware.py:5-6` `TimingMiddleware.__init__`: dunder
- C011 unused_method `shopapp/middleware.py:8-12` `TimingMiddleware.__call__`: dunder
- C013 unused_method `shopapp/middleware.py:16-17` `DebugToolbarMiddleware.__init__`: dunder
- C014 unused_method `shopapp/middleware.py:19-20` `DebugToolbarMiddleware.__call__`: dunder
- C015 unused_method `shopapp/models.py:4-5` `Order.__init__`: dunder
- C016 unused_method `shopapp/models.py:11-12` `Order.__str__`: dunder
- C018 unused_class `shopapp/payments.py:1-3` `StripeBackend`: string_ref shopapp/settings.py:2
- C021 unused_function `shopapp/signals.py:11-13` `send_confirmation`: decorator @receiver
- C026 unused_function `shopapp/views.py:4-5` `order_list`: string_ref shopapp/urls.py:2
- C027 unused_function `shopapp/views.py:8-9` `order_detail`: string_ref shopapp/urls.py:3
- C029 unused_function `tests/test_views.py:7-9` `test_list`: name_convention
- C030 unused_function `tests/test_views.py:12-13` `test_today`: name_convention
- C031 unused_function `tests/test_views.py:16-18` `test_build_wires_everything`: name_convention

Full evidence and snippets: `candidates.jsonl` (one JSON object per ID).
