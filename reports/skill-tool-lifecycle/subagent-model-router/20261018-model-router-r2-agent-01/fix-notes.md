# Round-2 fix notes: subagent-model-router

## What changed
- `scripts/router.mjs`: new `GLOB_RE`; `ruleFeatures` strips glob tokens (`test/*.test.mjs`, `*.js`) before `FILE_RE` counts files. Before, `test/*.test.mjs` matched as the file `.test.mjs`, so a one-file task counted 3 "files" (with the wrapper's "Node.js") and the "checked" rule (`files <= 2`) stopped firing. Once the glob is gone, nothing in the `(it finds ...; ...)` clause matches.
- Why: a glob names the files a test command picks up, not files the subagent must change, so it says nothing about task size.
- `bench/results/route-none.json`, `route-jev.json` re-run (`--provider none`; `--provider jev --k 3`). Rules: 14 haiku / 4 sonnet (cache said 16 / 2). Jev answers unchanged.
- `test/bench.test.mjs`: pins `ruleTier(ruleFeatures(subagentPrompt(task)))` to `route-none.json` for all 18 tasks. `test/router.test.mjs`: one glob test.
- README / SKILL.md: 18 -> 31 tests; stale costs replaced by re-scored ones (`score --run pilot,hf --impute`): rules-only 17%, cascade 20% (was 10% / 14%); pilot 24% (was 13%).

## Tests
- Before the fix (new pin test, old cache): 30 tests, 29 pass, 1 fail (d1-lru: sonnet, expected haiku).
- After: 31 pass, 0 fail, 0 skipped.

## Rule tier of the 6 measured B prompts (`route.mjs --mode apply --provider none`)
| task | before | after |
|---|---|---|
| e1-locate | haiku | haiku |
| e2-count | haiku | haiku |
| r1-rename | haiku | haiku |
| f1-paginate | sonnet | haiku |
| d3-maplimit | sonnet | haiku |
| d5-deps | sonnet | haiku |

## Not done
- Suggestions 3 and 4 (out of scope). B runs not re-run: no new pass/cost evidence.
- "Node.js" in the bench wrapper still counts as a file, so t1/t2 stay on Sonnet; left alone to keep the change small.
