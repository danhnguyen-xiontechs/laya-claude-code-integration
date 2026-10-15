## Laya in the web-test skill — results (2026-10-09)

**Goal:** check whether Laya (small local decision model, free, CPU) can make the `web-test` skill cheaper or more reliable. Each idea is a separate skill so it can be measured on its own against plain `web-test`.

| Skill | What Laya does | Result |
|---|---|---|
| `web-test-laya-wait` | Decides when a page has finished loading | ❌ No gain. Laya said "still loading" on 20/20 polls of a finished page. Delays came from the agent picking wrong wait text. |
| `web-test-laya-gate` | Second opinion on which test steps write data | ⚠️ Safety only. Catches more write steps than keywords (missed 1/12 vs 8/12), but wrongly flags 9/12 read steps. Not a cost saver. |
| `web-test-laya-verdict` | Judges pass / fail / blocked for each step | ❌ Worse. Confident on only 2/17 steps; the agent re-judged the rest. 38 model turns vs 19 for plain web-test. |
| `web-test-laya-oracle` | Same, but rules first and stricter PASS threshold | ❌ Worse. The rule check worked; Laya decided no step. 35 model turns vs 19. |
| `web-test-laya-ground` | Finds the button/field to click without reading a page snapshot | ✅ Best run: 16 turns vs 19, input 1.4M vs 1.7M, output 6k vs 9k, 2 min vs 3. **But all 17 element lookups were solved by simple rules — Laya was never used.** |

All numbers: same ticket (#11840), dev, one run per skill.

**Conclusion**
- Laya (zero-shot) did not improve any of the five skills. Where it was asked, it was mostly unsure, and sometimes confidently wrong (e.g. picked an unrelated "Attendance" link at 100% confidence).
- The one real gain is **rule-based element grounding** (`find.mjs` in `web-test-laya-ground`). It can move into plain `web-test` without Laya.

**Caveats:** one run per skill, runs done back to back, and the ground run covered 2 cases vs 3. Re-run 2–3 times per skill in fresh sessions before deciding.

**Next steps (proposed)**
1. Add rule-based `find.mjs` to `web-test` and re-measure.
2. Optional: an offline test with paraphrased targets ("go to previous month" instead of "Previous month") to see if Laya beats rules there. Fine-tuning Laya is the only other path to better accuracy.
