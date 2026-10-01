# Laya self-hosted: performance and resource report (CPU)

Measured on 2026-09-30. Script: `laya_benchmark.py`. Raw data: `results/*.csv`, `results/environment.json`.

## Summary

- **One Laya instance on a laptop CPU handles about 3 decisions per second**, with warm latency of **p50 314 ms, p95 331 ms** for one question on a short input (110 tokens).
- **RAM: 4.9 GB** with all 3 checkpoints loaded (the default), **2.0 GB** with only the `english` checkpoint. No CPU use when idle.
- **Inference uses exactly 8 cores** (about 49% of the machine). The server has a single inference thread, so **higher concurrency does not raise throughput**; requests just queue.
- **Latency grows almost linearly with token count**, and putting several questions in one request **saves no time** on CPU.
- **Stable**: 10 minutes of continuous load, 1425 requests, 0 errors, no RAM growth.
- **GPU not measured**: this machine has no NVIDIA GPU. Every CUDA part of the plan is still blank.
- **Preliminary conclusion**: CPU is enough for dev/test and for low load (under roughly 2 requests per second, short inputs). Higher load, or a latency target under 100 ms, needs a GPU measurement before deciding.

## 1. Environment

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| CPU | AMD Ryzen AI 7 350, 8 cores / 16 threads |
| RAM | 31.3 GB |
| GPU | Integrated AMD Radeon 860M (no CUDA) |
| Python | 3.12.14 |
| Laya | 0.3.21 |
| PyTorch | 2.14.0+cpu, 8 intra-op threads by default |
| Checkpoint | `convaiinnovations/laya`: english, multilingual, typed-decisions (English requests are routed to `english`) |
| Device | CPU |
| Power | Plugged in, Balanced power plan |
| Server | `laya-serve` with default settings, called over HTTP `POST /v1/systemone` on localhost |

Question used in every test (except section 6): one `choice` question with 3 options, Bug / Feature / Task, each with a long description.

## 2. Resource footprint

| State | Laya process CPU | Laya process RAM | Whole-machine CPU |
|---|---:|---:|---:|
| System without Laya | - | - | 6.6% (peak 11.4%), 18.1 GB RAM in use |
| Laya idle, models loaded | 0.0% (peak 0.2%) | 4888 MB | 4.2% |
| Laya under inference | 49.3% (peak 51.1%), i.e. 7.9 cores | 4919 MB (peak 5224 MB at 20 questions per request) | 56% |

- RAM by configuration: **3 checkpoints 4.9 GB**, **`english` only 2.0 GB** (`LAYA_MODELS=english`).
- RAM rises slightly with request size (about 300 MB more at a 2928-token request) and then stays flat.
- GPU, VRAM, GPU temperature, power draw: not applicable on this machine.
- CPU temperature: not available through `psutil` on Windows. The CPU frequency `psutil` reports is the nominal value (always 2000 MHz), so it **cannot be used** to detect thermal throttling.

## 3. Cold start

| Mode | Process start to ready | First request | Second request | RAM afterwards |
|---|---:|---:|---:|---:|
| Models loaded at startup (default), run 1 | 9.53 s | 310 ms | 295 ms | 4915 MB |
| Models loaded at startup, run 2 | 9.49 s | 310 ms | 321 ms | 4913 MB |
| Lazy loading (`LAYA_PRELOAD=0`) | 0.55 s | 4719 ms | 276 ms | 1990 MB |

- Process startup: about **0.55 s**. Loading 3 checkpoints: about **9 s**. Loading one checkpoint on the first request: about **4.4 s**.
- In the default mode, the first request is no slower than a warm request.
- These numbers were taken with the model files already in the Windows disk cache. The first start after a reboot will be slower, and the first run on a new machine also has to download 2.2 GB.

## 4. Warm inference (100 requests, 1 question, short 110-token input)

| Avg | Min | Max | p50 | p95 | p99 | Throughput | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 312.7 ms | 281.1 ms | 335.5 ms | 313.6 ms | 331.4 ms | 334.9 ms | 3.20 req/s | 0% |

Latency is very even: p50 and p99 are only 21 ms apart.

## 5. Input size

| Input | Tokens | p50 | p95 | Throughput | RAM |
|---|---:|---:|---:|---:|---:|
| Small (one sentence) | 110 | 316 ms | 333 ms | 3.14 req/s | 4920 MB |
| Medium (title + description) | 196 | 421 ms | 550 ms | 2.30 req/s | 4935 MB |
| Large (plus 8 comments) | 512 | 1055 ms | 1192 ms | 0.93 req/s | 4973 MB |

Latency grows almost linearly with tokens, about **1.8 ms per token** plus roughly 100 ms fixed. An input 4.7 times longer is 3.3 times slower. CPU stays at 8 cores at every size.

## 6. Multiple questions per request (medium input)

| Questions per request | Tokens | Latency p50 | ms per decision | Decisions per second |
|---:|---:|---:|---:|---:|
| 1 | 196 | 415 ms | 417 | 2.40 |
| 5 | 732 | 1998 ms | 399 | 2.50 |
| 10 | 1464 | 3959 ms | 395 | 2.53 |
| 20 | 2928 | 7603 ms | 379 | 2.64 |

Batching 20 questions is only about 9% faster per decision than sending them one by one. The token count grows in step with the number of questions, which means each question is encoded again together with the text. The authors publish a large batching gain on a T4 GPU (7–16 ms per question when batching 10, against 33–40 ms for a single question); on this CPU that gain is almost absent.

## 7. Concurrency (100 requests per level, short input)

| Concurrency | p50 | p95 | p99 | Throughput | CPU peak | RAM peak | VRAM | Errors |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 318 ms | 345 ms | 381 ms | 3.13 req/s | 51.4% | 5005 MB | N/A | 0% |
| 2 | 573 ms | 620 ms | 646 ms | 3.45 req/s | 51.6% | 4958 MB | N/A | 0% |
| 4 | 1237 ms | 1889 ms | 2076 ms | 2.82 req/s | 51.4% | 4959 MB | N/A | 0% |
| 8 | 3459 ms | 3686 ms | 3705 ms | 2.29 req/s | 51.3% | 4951 MB | N/A | 0% |
| 16 | 6867 ms | 7450 ms | 7476 ms | 2.30 req/s | 51.4% | 4955 MB | N/A | 0% |

- Throughput **tops out at about 3.1–3.5 req/s** already at concurrency 1–2, then drops slightly. Latency rises roughly in proportion to the number of requests waiting.
- The cause is in the server code: `laya-serve` runs inference on **a single thread** (`ThreadPoolExecutor(max_workers=1)`), so requests are processed one after another.
- No errors or rejections up to concurrency 16. "Maximum stable concurrency" therefore depends on the acceptable latency, not on errors: for p95 under 1 second the limit is **2 concurrent requests**.
- To raise throughput on CPU, run more instances (each adds 2–4.9 GB RAM and 8 cores) rather than more concurrency.

## 8. Sustained load (10 minutes, concurrency 4)

Total: **1425 requests, 0 errors**, p50 1750 ms, p95 1954 ms, p99 2084 ms, 2.37 req/s.

| Minute | Requests | p50 | p95 | RAM | Process CPU |
|---:|---:|---:|---:|---:|---:|
| 1 | 133 | 1827 ms | 2010 ms | 4954.5 MB | 49.3% |
| 2 | 163 | 1514 ms | 1812 ms | 4954.6 MB | 49.5% |
| 3 | 180 | 1199 ms | 1840 ms | 4954.5 MB | 49.0% |
| 4 | 134 | 1768 ms | 1960 ms | 4954.9 MB | 49.4% |
| 5 | 136 | 1758 ms | 1818 ms | 4955.1 MB | 49.5% |
| 6 | 137 | 1749 ms | 1808 ms | 4955.1 MB | 49.5% |
| 7 | 132 | 1796 ms | 1959 ms | 4955.1 MB | 49.3% |
| 8 | 130 | 1818 ms | 2007 ms | 4955.1 MB | 48.9% |
| 9 | 140 | 1737 ms | 1888 ms | 4955.1 MB | 49.3% |
| 10 | 136 | 1695 ms | 2076 ms | 4955.1 MB | 49.2% |

- **Memory is stable**: RAM moved by only 0.6 MB over 10 minutes, with no sign of a leak.
- **Latency does not drift upward** over time. No crashes and no out-of-memory errors.
- **The machine appears to slow down under prolonged load**: throughput here (2.37 req/s) is lower than in the short concurrency-4 test just before (2.82 req/s), and the `LAYA_THREADS=8` test run straight afterwards (same configuration as the warm test) gave p50 423 ms against 314 ms at the start, about 35% slower. Laptop thermal throttling is the likely cause, but this benchmark cannot measure temperature, so it is **not confirmed**.
- The 30-minute run has not been done.

## 9. PyTorch thread count (`LAYA_THREADS`), 20 requests per setting

| Setting | p50 | p95 | Throughput | Process CPU | RAM |
|---|---:|---:|---:|---:|---:|
| 2 threads | 797 ms | 921 ms | 1.24 req/s | 12.3% (2.0 cores) | 4916 MB |
| 4 threads | 456 ms | 614 ms | 2.08 req/s | 24.7% (3.9 cores) | 4914 MB |
| 8 threads (default) | 423 ms | 478 ms | 2.34 req/s | 49.0% (7.8 cores) | 4916 MB |
| 16 threads | 466 ms | 542 ms | 2.11 req/s | 89.2% (14.3 cores) | 4925 MB |
| 8 threads, `english` only | 410 ms | 419 ms | 2.47 req/s | 49.3% | **1995 MB** |

- This test ran after the sustained-load test, when the machine had already slowed down, so compare the rows with each other and not with section 4.
- **4 threads is close to 8 threads** (8% slower) while using half the CPU. 16 threads is slower than 8 and takes nearly the whole machine.
- Loading only `english` cuts RAM from 4.9 GB to 2.0 GB with no change in latency.

## 10. CPU vs CUDA

| Metric | CPU (this machine) | CUDA |
|---|---:|---:|
| RAM with models loaded | 4.9 GB (3 checkpoints) / 2.0 GB (1) | not measured |
| CPU during inference | 49% (8 cores) | not measured |
| GPU utilization | N/A | not measured |
| VRAM | N/A | not measured |
| Cold start | 9.5 s | not measured |
| p50 | 314 ms | not measured |
| p95 | 331 ms | not measured |
| Throughput | 3.2 req/s | not measured |
| Max stable concurrency (p95 under 1 s) | 2 | not measured |
| Error rate | 0% | not measured |

For reference, the Laya authors publish these numbers on a Tesla T4: 33–40 ms for a single question and 103–332 questions per second when batching. If that holds for our inputs, a GPU would be roughly 8–10 times faster than this laptop CPU on latency, and more than that on throughput. Those are the vendor's numbers on different inputs and are **not verified here**.

## 11. Answers to the plan's questions (section 17)

1. **RAM for one instance?** 4.9 GB with 3 checkpoints, 2.0 GB with one.
2. **CPU for inference?** 8 cores for the duration of each request, none when idle. It can be capped at 4 cores for about 8% more latency.
3. **GPU/VRAM?** Not measured.
4. **Warm latency?** p50 314 ms, p95 331 ms at 110 tokens; 1055 ms at 512 tokens.
5. **Throughput?** About 3 decisions per second on short inputs, under 1 on long inputs.
6. **Effect of concurrency?** Throughput does not rise; latency grows linearly because the server processes requests serially.
7. **Stable under sustained load?** Yes for memory and errors (10 minutes). There are signs of a roughly 35% slowdown after prolonged heavy load, suspected to be thermal on a laptop.
8. **Is CPU enough, or is a GPU justified?** CPU is enough for dev/test and low load. There are no GPU numbers yet to answer the rest.
9. **Reasonable hardware for deployment?** Not enough data to settle this. Estimate for a CPU-only setup: 4–8 cores and 2–5 GB RAM per instance for about 2–3 decisions per second; this should be re-measured on a server CPU because a laptop is thermally limited.

## 12. What this means for the model-routing use case

- One routing decision on a short input costs about **0.3 s** on CPU. That delay is added before each new task (not each turn, if the chosen model is kept for the session as the routing plan proposes).
- Real prompts with long context cost much more (512 tokens is already 1 second). The input sent to Laya should be trimmed, for example to the user's request sentence only.
- The earlier quality tests (Bug/Feature/Task classification, 4-tier routing) recorded 2.3–2.7 s per request on the same machine, 5–8 times the numbers here. Those two tests ran against a server started by the user, under machine conditions that were not recorded. **The cause of the difference is unknown**; the numbers in this report are the controlled measurements and should be the ones used.

## 13. Limits of this measurement

- CPU only, one laptop, one run per test. Not repeated to obtain confidence intervals.
- Client and server ran on the same machine, so the client also used a (small) share of CPU.
- The thread-count and cold-start tests have few samples (20 requests, 3 starts).
- Temperature and power draw could not be measured.
- This benchmark does not assess decision quality (section 14 of the plan). See `test-results.md` (8/10 on 10 cases) and `routing/report.md` (28/60 on 4 tiers, synthetic data).

## 14. Next steps

1. Re-run this exact script on a machine with an NVIDIA GPU: `uv run --with psutil python laya_benchmark.py --device cuda`, then fill in the table in section 10.
2. Re-run on a server or desktop CPU to remove the laptop's thermal factor.
3. Run the 30-minute sustained-load test alongside a temperature monitor, to confirm or rule out the throttling hypothesis.
4. For dev/test on laptops: use `LAYA_MODELS=english` and `LAYA_THREADS=4` to get down to 2 GB RAM and 4 cores, at the cost of about 8% more latency.
