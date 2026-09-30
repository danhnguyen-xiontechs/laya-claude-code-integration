# Routing benchmark (offline, dry-run)

60 synthetic prompts (20 per tier) sent through the proxy as 60 new sessions. Run id `bench-1f9853d8`.
No LLM was called. Cost is an estimate under an assumed price ratio haiku:sonnet:opus = 1:3:5 and equal tokens per task. 'Under-routed' (picked a weaker tier than the label) is the quality-risk proxy.

| Strategy | Exact | Under-routed | of which 2 tiers | Over-routed | Mix h/s/o | Est. cost vs always-opus | Fallbacks | Router overhead (median) |
|---|---|---|---|---|---|---|---|---|
| oracle (nhan dung) | 60/60 | 0 | 0 | 0 | 20/20/20 | 60% | - | - |
| manual: always opus | 20/60 | 0 | 0 | 40 | 0/0/60 | 100% | - | - |
| manual: always sonnet | 20/60 | 20 | 0 | 20 | 0/60/0 | 60% | - | - |
| laya proxy, min_prob=0.0 | 48/60 | 2 | 0 | 10 | 18/16/26 | 65% | 0 | 520 ms |
| laya proxy, min_prob=0.4 | 43/60 | 2 | 0 | 15 | 13/21/26 | 69% | 7 | 520 ms |
| laya proxy, min_prob=0.5 | 40/60 | 2 | 0 | 18 | 5/34/21 | 71% | 30 | 520 ms |
| laya proxy, min_prob=0.6 | 35/60 | 6 | 0 | 19 | 2/43/15 | 69% | 42 | 520 ms |
| laya proxy, min_prob=0.7 | 24/60 | 16 | 0 | 20 | 0/56/4 | 63% | 56 | 520 ms |

LLM routing (Haiku as router): not run, no API access yet.
