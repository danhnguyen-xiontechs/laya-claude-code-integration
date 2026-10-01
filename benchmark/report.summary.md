# Laya Self-Hosted Performance – Laptop CPU

Measured 2026-09-30. Full details: `report.en.md`. Raw data: `results/`.

## Environment
- Ryzen AI 7 350, 8C/16T
- 31.3 GB RAM
- Laya 0.3.21
- CPU only

## Model
- Encoder-only (BERT-type) classifier, not a generative LLM; one forward pass, no output tokens
- Built on existing open-source encoders, fully fine-tuned, plus a decision head trained from scratch
- English checkpoint: ModernBERT-large, 421M params, 512-token context
- Multilingual checkpoint: mmBERT-base, 322M params, 1,024-token context (100+ languages)
- Typed-decisions checkpoint: ModernBERT-large fine-tune, 421M params, 1,024-token context
- All benchmark requests were English and used the English checkpoint; multilingual not measured
- Laya is Apache-2.0; base-model licences not checked

## Resource
- 4.9 GB RAM with 3 checkpoints
- 2.0 GB with English checkpoint only
- ~8 logical CPU cores during inference
- ~0 CPU when idle

## Performance
- Warm p50: 314 ms
- Warm p95: 331 ms
- Throughput: ~3.2 decisions/sec
- 512-token input: ~1.05 sec p50 (512 is the English checkpoint's limit; longer text is truncated)

## Input length (`max_len`, English checkpoint, one long work item)
- Limit is configurable per request up to 8,192 tokens; default 512
- 512 tokens: 1.1 s, 5.0 GB RAM peak
- 1,024 tokens: 2.7 s, 5.1 GB
- 2,048 tokens: 6.0 s, 5.5 GB
- 4,096 tokens: 15.3 s, 7.2 GB
- 7,636 tokens (cap 8,192): 40.5 s, 12.2 GB
- Cost grows faster than linearly: doubling tokens takes about 2.2–2.6x longer
- Same answer at every length, but confidence fell from 0.53 to 0.24 (single repetitive text; not a quality test)
- Practical ceiling on CPU is 1,024; keep routing inputs short

## Concurrency
- Throughput saturates around 3 req/s
- Requests are processed serially
- p95 < 1 sec at up to 2 concurrent requests

## Stability
- 1,425 requests / 10 min
- 0 errors
- No observable memory growth

## Limitations
- CPU only
- No temperature/power measurement
- One laptop, one benchmark run
- GPU/server performance not measured

## Initial conclusion
- Suitable for local development/testing and low-load usage
- CPU resource usage is significant but manageable
- GPU and server-class CPU benchmark are still needed before production sizing
