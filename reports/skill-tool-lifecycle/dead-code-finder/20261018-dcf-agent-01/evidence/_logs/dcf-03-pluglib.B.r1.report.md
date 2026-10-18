# Dead code report: `dcf-03-pluglib.B.r1`

Run `20261018-005611`, mode **jev**, Tier A threshold p >= 0.9. Tier A = safe to delete in small batches; B = needs a human look; C = kept (rule or JEV), listed for transparency.

## Funnel

| Step | Unused code | Junk |
|---|---|---|
| Discovered | 22 | 0 |
| After keep rules | 8 | 0 |
| Sent to JEV | 8 | 0 |
| JEV answered | 8 | 0 |
| Tier A / B / C | 4/4/14 | 0/0/0 |

JEV: 1 request(s), 2994 input tokens, $0.000126, 695 ms total (status ok).

Scanned 8 Python files and 2 text files. Excluded: none.

## Tier A: safe to delete (in batches) (4)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C001 | A | orphan_module | `pluglib/compat.py:1-7` | `pluglib.compat` | 0 refs | likely_dead 0.99 | Delete |
| C010 | A | unused_function | `pluglib/compat.py:6-7` | `text_type` | 0 refs | likely_dead 0.99 | Delete |
| C017 | A | unused_constant | `pluglib/text.py:5` | `MAX_LEN` | 0 refs | likely_dead 1.00 | Delete |
| C018 | A | unused_function | `pluglib/text.py:12-13` | `strip_accents` | 0 refs | likely_dead 0.99 | Delete |

## Tier B: review (4)

| ID | Tier | Kind | Location | What | Key evidence | JEV | Action |
|---|---|---|---|---|---|---|---|
| C004 | B | unused_class | `pluglib/builtin.py:5-9` | `Upper` | 0 refs | likely_dead 0.62 | Review |
| C006 | B | unused_class | `pluglib/builtin.py:12-16` | `Reverse` | 0 refs | likely_dead 0.61 | Review |
| C008 | B | unused_class | `pluglib/builtin.py:19-21` | `Experimental` | 0 refs | likely_dead 0.85 | Review |
| C016 | B | unused_function | `pluglib/registry.py:24-25` | `unregister` | 0 refs, test refs 2 | test_only 0.99 | Review |

## Tier C: keep (14)

- C002 orphan_module `pluglib/config.py:1-7` `pluglib.config`: string_ref pluglib.yaml:3
- C003 orphan_module `pluglib/pytest_plugin.py:1-11` `pluglib.pytest_plugin`: string_ref pyproject.toml:6
- C005 unused_method `pluglib/builtin.py:8-9` `Upper.run`: override:Plugin.run
- C007 unused_method `pluglib/builtin.py:15-16` `Reverse.run`: override:Plugin.run
- C009 unused_method `pluglib/builtin.py:20-21` `Experimental.run`: override:Plugin.run
- C011 unused_function `pluglib/config.py:4-7` `load`: string_ref pluglib.yaml:3
- C012 unused_function `pluglib/pytest_plugin.py:4-7` `plugin_names`: decorator @pytest.fixture
- C013 unused_function `pluglib/pytest_plugin.py:10-11` `pytest_configure`: name_convention
- C014 unused_method `pluglib/registry.py:7-10` `Plugin.__init_subclass__`: dunder
- C015 unused_method `pluglib/registry.py:12-13` `Plugin.run`: overridden_in_subclass
- C019 unused_function `pluglib/text.py:16-17` `truncate`: string_ref pluglib.yaml:2
- C020 unused_function `tests/test_plugins.py:6-7` `test_upper`: name_convention
- C021 unused_function `tests/test_plugins.py:10-11` `test_available`: name_convention
- C022 unused_function `tests/test_plugins.py:14-15` `test_unregister_roundtrip`: name_convention

Full evidence and snippets: `candidates.jsonl` (one JSON object per ID).
