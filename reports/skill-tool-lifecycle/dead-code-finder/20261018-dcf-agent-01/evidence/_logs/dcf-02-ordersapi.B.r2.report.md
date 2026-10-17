# Dead code report: `dcf-02-ordersapi.B.r2`

Run `20261018-010421`, mode **jev**, Tier A threshold p >= 0.9. Tier A = safe to delete in small batches; B = needs a human look; C = kept (rule or JEV), listed for transparency.

## Funnel

| Step | Unused code | Junk |
|---|---|---|
| Discovered | 23 | 6 |
| After keep rules | 7 | 6 |
| Sent to JEV | 7 | 6 |
| JEV answered | 7 | 6 |
| Tier A / B / C | 6/1/16 | 1/1/4 |

JEV: 1 request(s), 4341 input tokens, $0.000182, 701 ms total (status ok).

Scanned 9 Python files and 2 text files. Excluded: none.

## Tier A: safe to delete (in batches) (7)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C004 | A | unused_constant | `ordersapi/core.py:4` | `ROUND_MODE` | 0 refs | likely_dead 1.00 | Delete |
| C006 | A | unused_function | `ordersapi/core.py:27-28` | `legacy_total` | 0 refs | likely_dead 1.00 | Delete |
| C007 | A | unused_function | `ordersapi/core.py:31-32` | `_cents` | 0 refs | likely_dead 0.99 | Delete |
| C016 | A | unused_function | `ordersapi/tasks.py:19-20` | `send_digest` | 0 refs | likely_dead 0.98 | Delete |
| C017 | A | unused_function | `ordersapi/web.py:17-18` | `render_xml` | 0 refs | likely_dead 0.99 | Delete |
| C023 | A | unused_import | `ordersapi/core.py:1` | `json` | 0 refs | likely_dead 1.00 | Remove import |
| J001 | A | commented_code | `ordersapi/cli.py:14-15` | `total = order.total()` | 2 commented lines parse as code; rule: dead_code_comment | dead_code_comment 1.00 | Delete comment |

## Tier B: review (2)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C008 | B | unused_function | `ordersapi/debug.py:1-2` | `dump_order` | 0 refs, test refs 2 | test_only 0.99 | Review |
| J002 | B | debug_print | `ordersapi/cli.py:9` | `print('DEBUG argv', sys.argv)` | in `main`; rule: intentional_output | debug_leftover 0.95 | Review |

## Tier C: keep (20)

- C001 orphan_module `ordersapi/cli.py:1-19` `ordersapi.cli`: string_ref pyproject.toml:6, entry_point
- C002 orphan_module `ordersapi/exporters.py:1-8` `ordersapi.exporters`: string_ref pyproject.toml:8, entry_point
- C003 unused_function `ordersapi/cli.py:8-19` `main`: string_ref pyproject.toml:6, entry_point
- C005 unused_method `ordersapi/core.py:9-10` `Order.__init__`: dunder
- C009 unused_method `ordersapi/exporters.py:2-3` `BaseExporter.export`: overridden_in_subclass
- C010 unused_class `ordersapi/exporters.py:6-8` `CsvExporter`: string_ref pyproject.toml:9, entry_point
- C011 unused_method `ordersapi/exporters.py:7-8` `CsvExporter.export`: override:BaseExporter.export
- C012 unused_method `ordersapi/handlers.py:5-6` `Handler.on_created`: getattr_prefix 'on_'
- C013 unused_method `ordersapi/handlers.py:8-9` `Handler.on_cancelled`: getattr_prefix 'on_'
- C014 unused_function `ordersapi/tasks.py:9-11` `nightly_cleanup`: decorator @task
- C015 unused_function `ordersapi/tasks.py:14-16` `rebuild_index`: string_ref settings.toml:2, decorator @task
- C018 unused_function `ordersapi/web.py:21-23` `list_orders`: decorator @route
- C019 unused_function `ordersapi/web.py:26-28` `health`: decorator @route
- C020 unused_function `tests/test_core.py:9-10` `test_total`: name_convention
- C021 unused_function `tests/test_core.py:13-14` `test_total_for`: name_convention
- C022 unused_function `tests/test_core.py:17-18` `test_dump`: name_convention
- J003 debug_print `ordersapi/cli.py:11` `print('usage: orders <price> <qty>')`: intentional_output 0.98; rule intentional_output
- J004 debug_print `ordersapi/cli.py:16` `print(total_for(order))`: intentional_output 0.84; rule intentional_output
- J005 debug_print `ordersapi/cli.py:17` `print(Handler().dispatch('created', orde`: intentional_output 0.70; rule intentional_output
- J006 debug_print `ordersapi/cli.py:18` `print(sorted(web.ROUTES), sorted(tasks.T`: debug_leftover 0.52; rule intentional_output

Full evidence and snippets: `candidates.jsonl` (one JSON object per ID).
