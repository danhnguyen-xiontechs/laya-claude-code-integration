# Dead code report: `dcf-01-demo.B.r1`

Run `20261018-005257`, mode **jev**, Tier A threshold p >= 0.9. Tier A = safe to delete in small batches; B = needs a human look; C = kept (rule or JEV), listed for transparency.

## Funnel

| Step | Unused code | Junk |
|---|---|---|
| Discovered | 40 | 16 |
| After keep rules | 16 | 16 |
| Sent to JEV | 16 | 14 |
| JEV answered | 16 | 14 |
| Tier A / B / C | 10/6/24 | 5/4/7 |

JEV: 2 request(s), 10246 input tokens, $0.000430, 1788 ms total (status ok).

Scanned 13 Python files and 3 text files. Excluded: none.

## Tier A: safe to delete (in batches) (15)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C003 | A | orphan_module | `demo_pkg/legacy_report.py:1-11` | `demo_pkg.legacy_report` | 0 refs | likely_dead 1.00 | Delete |
| C006 | A | unused_constant | `demo_pkg/core.py:12` | `LEGACY_TAX_RATE` | 0 refs | likely_dead 1.00 | Delete |
| C011 | A | unused_function | `demo_pkg/core.py:49-53` | `legacy_total` | 0 refs | likely_dead 1.00 | Delete |
| C012 | A | unused_function | `demo_pkg/core.py:56-57` | `_round_cents` | 0 refs | likely_dead 1.00 | Delete |
| C013 | A | unused_class | `demo_pkg/core.py:67-72` | `OldOrderAdapter` | 0 refs | likely_dead 0.99 | Delete |
| C015 | A | unused_method | `demo_pkg/core.py:71-72` | `OldOrderAdapter.adapt` | 0 refs | likely_dead 0.99 | Delete |
| C026 | A | unused_function | `demo_pkg/jobs.py:24-25` | `rebuild_search_index` | 0 refs | likely_dead 0.99 | Delete |
| C027 | A | unused_function | `demo_pkg/legacy_report.py:6-7` | `monthly_report` | 0 refs | likely_dead 1.00 | Delete |
| C028 | A | unused_function | `demo_pkg/legacy_report.py:10-11` | `_format_row` | 0 refs | likely_dead 1.00 | Delete |
| C039 | A | unused_import | `demo_pkg/core.py:3` | `csv` | 0 refs | likely_dead 1.00 | Remove import |
| J004 | A | debug_print | `demo_pkg/cli.py:28` | `print('got here', order.items)` | in `_track`; rule: debug_leftover | debug_leftover 0.99 | Remove call |
| J008 | A | debug_breakpoint | `demo_pkg/formatting.py:20` | `breakpoint()` | in `format_amount`; rule: debug_leftover | debug_leftover 1.00 | Remove call |
| J013 | A | debug_print | `demo_pkg/handlers.py:23` | `print('DEBUG cancel', order)` | in `handle_cancel`; rule: debug_leftover | debug_leftover 0.99 | Remove call |
| J014 | A | debug_log | `demo_pkg/jobs.py:11` | `logger.debug('here 2')` | in `purge_expired_carts`; rule: debug_leftover | debug_leftover 0.90 | Remove call |
| J016 | A | commented_code | `demo_pkg/web.py:46-47` | `print(_ROUTES)` | 2 commented lines parse as code; rule: dead_code_comment | dead_code_comment 0.97 | Delete comment |

## Tier B: review (10)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C009 | B | unused_method | `demo_pkg/core.py:26-27` | `Order.to_legacy_xml` | 0 refs, method of public class | likely_dead 0.99 | Review |
| C016 | B | unused_function | `demo_pkg/debug_tools.py:4-5` | `dump_order` | 0 refs, test refs 2 | test_only 0.99 | Review |
| C022 | B | unused_function | `demo_pkg/handlers.py:40-41` | `replay_events` | 0 refs, reflection in file | dynamic_use_possible 0.67 | Review |
| C023 | B | unused_function | `demo_pkg/hooks.py:4-5` | `notify_warehouse` | 0 refs, reflection in importer | dynamic_use_possible 0.56 | Review |
| C038 | B | unused_function | `tests/test_core.py:13-14` | `_make_legacy_order` | 0 refs | test_only 0.74 | Review |
| C040 | B | unused_import | `demo_pkg/web.py:4` | `os` | 0 refs, reflection in file | likely_dead 0.92 | Review |
| J001 | B | debug_print | `demo_pkg/cli.py:17` | `print('DEBUG args:', args)` | in `main`; rule: intentional_output | debug_leftover 0.99 | Review |
| J005 | B | commented_code | `demo_pkg/core.py:33-35` | `subtotal = 0` | 3 commented lines parse as code; prose: “old implementation, replaced by Order.subtotal()”; rule: dead_code_comment | dead_code_comment 0.85 | Review |
| J009 | B | dead_branch | `demo_pkg/formatting.py:21-22` | `DEBUG_OLD_FLOW` | flag `DEBUG_OLD_FLOW` is set once to a falsy value (demo_pkg/formatting.py:3) and never changed; rule: dead_branch | (not sent) | Review: remove branch or flag |
| J010 | B | dead_branch | `demo_pkg/formatting.py:23-24` | `False` | constant condition `False`; rule: dead_branch | (not sent) | Review: remove branch or flag |

## Tier C: keep (31)

- C001 orphan_module `demo_pkg/cli.py:1-36` `demo_pkg.cli`: string_ref pyproject.toml:7, entry_point
- C002 orphan_module `demo_pkg/hooks.py:1-5` `demo_pkg.hooks`: string_ref demo_pkg/cli.py:32
- C004 orphan_module `demo_pkg/plugins.py:1-11` `demo_pkg.plugins`: string_ref pyproject.toml:10, entry_point
- C005 unused_function `demo_pkg/cli.py:13-24` `main`: string_ref pyproject.toml:7, entry_point
- C007 unused_method `demo_pkg/core.py:16-18` `Order.__init__`: dunder
- C008 unused_method `demo_pkg/core.py:20-21` `Order.__repr__`: dunder
- C010 unused_function `demo_pkg/core.py:45-46` `public_discount`: string_ref demo_pkg/core.py:9, public_api
- C014 unused_method `demo_pkg/core.py:68-69` `OldOrderAdapter.__init__`: dunder
- C017 unused_function `demo_pkg/formatting.py:10-11` `format_money_eu`: string_ref config/settings.json:3
- C018 unused_function `demo_pkg/handlers.py:16-19` `handle_refund`: getattr_prefix 'handle_'
- C019 unused_function `demo_pkg/handlers.py:22-24` `handle_cancel`: getattr_prefix 'handle_'
- C020 unused_method `demo_pkg/handlers.py:33-34` `OrderActions.archive_order`: string_ref demo_pkg/handlers.py:28
- C021 unused_method `demo_pkg/handlers.py:36-37` `OrderActions.restore_order`: string_ref demo_pkg/handlers.py:28
- C024 unused_function `demo_pkg/jobs.py:10-14` `purge_expired_carts`: string_ref config/jobs.yaml:3
- C025 unused_function `demo_pkg/jobs.py:17-21` `export_nightly`: string_ref config/jobs.yaml:6
- C029 unused_method `demo_pkg/plugins.py:5-6` `BaseExporter.export`: overridden_in_subclass
- C030 unused_class `demo_pkg/plugins.py:9-11` `CsvExporter`: string_ref pyproject.toml:10, entry_point
- C031 unused_method `demo_pkg/plugins.py:10-11` `CsvExporter.export`: override:BaseExporter.export
- C032 unused_method `demo_pkg/web.py:31-32` `OrderEncoder.default`: override:json.JSONEncoder.default
- C033 unused_function `demo_pkg/web.py:35-37` `list_orders`: decorator @app.route
- C034 unused_function `demo_pkg/web.py:40-42` `render_pdf`: decorator @register
- C035 unused_function `tests/conftest.py:11-13` `reset_env`: decorator @pytest.fixture
- C036 unused_function `tests/test_core.py:5-6` `test_total`: name_convention
- C037 unused_function `tests/test_core.py:9-10` `test_dump`: name_convention
- J002 debug_print `demo_pkg/cli.py:19` `print('usage: demo-orders PRICE [PRICE .`: intentional_output 0.98; rule intentional_output
- J003 debug_print `demo_pkg/cli.py:22` `print(describe(order))`: intentional_output 0.69; rule intentional_output
- J006 commented_code `demo_pkg/core.py:39-40` `    cents = math.floor(subtotal * 108)`: explanatory_example 0.90; rule dead_code_comment
- J007 commented_code `demo_pkg/core.py:62-63` `    order = Order([("pen", 2.5)])`: explanatory_example 1.00; rule explanatory_example
- J011 commented_code `demo_pkg/handlers.py:6` `    dispatch("refund", order)`: explanatory_example 1.00; rule explanatory_example
- J012 commented_code `demo_pkg/handlers.py:18` `notify_payments(order, partial=True)`: intentional_disabled_with_reason 1.00; rule intentional_disabled_with_reason
- J015 debug_print `demo_pkg/jobs.py:20` `print(f'Exported {len(orders)} orders to`: intentional_output 0.96; rule debug_leftover

Full evidence and snippets: `candidates.jsonl` (one JSON object per ID).
