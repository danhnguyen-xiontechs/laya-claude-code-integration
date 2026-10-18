# Pool check and Jev rerank (offline, ess-be) — 2026-10-18

Follow-up to the failed latency gate (`gate-result.md`), asked by the user: does Jev have room to improve codemap's ranking? Same 12 units, same task texts. Jev runs were approved by the user for ess-be (paths, matched symbols and first header comment line go to OpenRouter; no source bodies). Raw: `pool-check.json`, `order-compare.json` (ids and numbers only); pools stay in `D:/cte-r3/`.

## 1. Is the gold in codemap's pool? (`pool-check.json`)
Pool = codemap top 30 per query, merged, max 96 candidates.

| Filtered (8 units, 27 gold files) | Files |
|---|---:|
| In the printed top 8 (codemap order) | 9 |
| In the pool, below #8 (room for reranking) | 9, in 3 units (e03, e04, e06) |
| Not in the pool (retrieval miss, no reranker helps) | 9 |

A perfect reranker would lift Recall@8 from 0.41 to at most 0.62. Hit@8 stays 6/8: in every unit with gold below #8 there was already a gold file in the top 8. The 2 units with no hit (e07, e08) have no gold in the pool.

## 2. Reranking (`order-compare.json`)
| Order | Recall@8 filtered | Hit@8 filtered | Recall@8 all 12 |
|---|---:|---:|---:|
| codemap order (round-3 default) | 0.411 | 6/8 | 0.497 |
| **rules order** (round-2 default, no model) | **0.536** | 6/8 | **0.580** |
| rules + Jev (batches + global rerank) | 0.536 | 6/8 | 0.580 |

- **The gain comes from the rules, not from Jev.** Rules and Jev have the same mean. Jev is better on e06 (0.625 vs 0.375) and worse on e03 (0.500 vs 0.750). On the other 10 units they are equal.
- Jev cost: 33 calls, $0.003, latency p50 2.4 s / max 3.5 s per unit on top of codemap, 0 fallbacks.
- **The rules order beats the codemap order on ess-be.** On Laya `eval/tasks.json` it was the other way round (codemap 0.633 vs rules 0.467, `guardrail-laya.json`). The round-3 default change (codemap order) was justified on Laya and loses 0.125 Recall@8 on ess-be. Neither order wins on both repos, and each comparison has 5-12 tasks: directional.
- **A possible use for Jev (directional, n = 12):** `none_of_these` won on 6 units, and all 6 have gold files missing from the pool, including all 3 units with no gold in the pool (e07, e08, e12). It never won on the 4 units whose pool held every gold file. As a "the answer is not in this list, search wider" flag that is 6/6 precise and catches 6 of 8 incomplete pools. This was not a pre-registered metric; it needs a held-out check before anyone relies on it.

## 3. What this means for the plan
- Step 3 (Jev rerank) shows no Recall@8 gain over plain rules and no Hit@8 gain over anything. Jev as a reranker is not worth its call here.
- Step 4 (fast path/symbol index) is still needed for latency. Its ranking should be compared against **both** orders (rules and codemap), on ess-be and Laya, since each wins on one repo.
- Jev's `none_of_these` as a "search wider" signal is the only new lead. It would be a small, separate experiment (pre-registered, held-out units).
