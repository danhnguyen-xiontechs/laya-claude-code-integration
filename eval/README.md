# Laya vs Jev: offline A/B + live checks for the four web-test skills

Report: [REPORT.html](REPORT.html) / [REPORT.md](REPORT.md) (generated; do not edit by hand).

| Step | Command | Needs |
|---|---|---|
| Build datasets | `node eval/data/build-datasets.mjs` | repo only |
| Replay the same requests through Laya and Jev | `node eval/run-ab.mjs` | `laya-serve` on :8000, `OPENROUTER_API_KEY` |
| Score with each skill's own rules | `node eval/analyze.mjs` | raw results |
| Extra arm: earlier steps as context | `node eval/run-context-arm.mjs` | both engines |
| Live `wait.mjs`, both skills, real headless Edge | `node eval/live-wait.mjs` | Edge, both engines; own port 9334 + throwaway profile |
| Live gate/verdict/oracle on the 6 stored runs | `node eval/live-scripts.mjs` | both engines |
| Report | `node eval/make-report.mjs` | results |

`questions.mjs` holds the decisions copied verbatim from the skill scripts, so both engines get exactly what the skills send.
Never point these at port 9222 (the ESS role browser). Hand-written data is in `data/handwritten.mjs`; its labels are true by construction, not real run data.
