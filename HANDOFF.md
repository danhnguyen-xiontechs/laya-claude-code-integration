# Laya decision engine: handoff (cập nhật 2026-10-01, đã đồng bộ hai máy)

Tài liệu này tóm tắt toàn bộ bối cảnh để tiếp tục ở một session khác. Repo: https://github.com/danhnguyen-xiontechs/laya-claude-code-integration (nhánh `main`).

Dự án được làm trên hai máy:

| | LENOVO2 | ADMIN |
|---|---|---|
| Thư mục | `D:\Laya` | `D:\XionTechs\Laya` |
| OS | Windows 11 | Windows 10 |
| CPU / GPU | Ryzen AI 7 350, không có GPU NVIDIA | có RTX 3070 (chưa dùng) |
| `HF_HOME` | `D:\hf-cache` | `E:\hf-cache` |
| Python của tool Laya | `C:\Users\LENOVO2\AppData\Roaming\uv\tools\laya\Scripts\python.exe` | `C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe` |

Ngày 2026-10-01 repo đã được kéo về `D:\Laya` trên LENOVO2. Bước A và bước D đã chạy lại ở đó và cho **đúng cùng kết quả** (47/60, 50/60, bảng chiến lược giống hệt); chỉ latency khác (trung vị 405 / 467 ms cho A, 482 ms cho proxy). Các file benchmark CPU của LENOVO2 nằm trong `D:\Laya` nhưng **chưa commit vào repo** (xem mục 4).

## 1. Mục tiêu

Task của X-Tek: đánh giá "decision engine" (model nhỏ, chọn trong danh sách cố định, trả về confidence) để thay các LLM call lặp lại kiểu phân loại / routing. Hai ứng viên: **Jev** (API hosted, dữ liệu rời mạng) và **Laya** (mã nguồn mở, self-host). Kết quả cuối: khuyến nghị adopt / pilot further / drop, có số liệu.

Use case đang theo đuổi: **model routing** trước LLM call.

```
Claude Code -> ANTHROPIC_BASE_URL -> router_proxy (Laya chọn tầng) -> Opus / Sonnet / Haiku -> LLM Gateway
```

Hai plan gốc của người dùng (`laya_model_routing_implementation_plan.md`, `laya_self_hosted_performance_benchmark_plan.md`) nằm trên máy LENOVO2 trong `C:\Users\LENOVO2\Downloads`, chưa có trong repo. Criteria Phase 1 của plan vì thế chưa được dùng; criteria hiện tại do Claude tự viết (xem mục 5).

Gateway của X-Tek có 4 model: Haiku 4.5, Sonnet 5.5, Opus 5.5, Fable 5.5. Plan routing chỉ dùng 3: Opus / Sonnet / Haiku.

## 2. Laya là gì (đã kiểm tra trong code và file model)

- Repo: https://github.com/NandhaKishorM/laya, weights: `convaiinnovations/laya` trên Hugging Face, Apache-2.0 (giấy phép base model chưa kiểm tra).
- Model kiểu **BERT encoder**, không sinh văn bản, một forward pass. Fine-tune toàn bộ encoder có sẵn + decision head huấn luyện từ đầu.

| Checkpoint | Base encoder | Tham số | Context mặc định | Ngân sách câu hỏi + lựa chọn |
|---|---|---|---|---|
| `english` | answerdotai/ModernBERT-large | 421M | 512 | 192 |
| `multilingual` | jhu-clsp/mmBERT-base | 322M | 1024 | 256 |
| `typed-decisions` | ModernBERT-large (fine-tune thêm) | 421M | 1024 | 256 |

- Laya tự chọn checkpoint theo ngôn ngữ của input. Trường `routing` trong response và tool `laya_route` là việc chọn checkpoint này, **không phải** chọn LLM.
- Ba loại câu hỏi: `choice` (criteria là object `{lựa chọn: mô tả}`), `score` (criteria là list thấp -> cao), `noul` (có/không).
- Giới hạn: `max_len` / `head_max_len` đặt theo từng request, trần **8192**. Mỗi mô tả lựa chọn bị cắt ở **48 token**. Văn bản vượt giới hạn bị cắt âm thầm (giữ phần đầu).
- Khi nạp model có cảnh báo temperature không hợp lệ cho `choice` từ 11 lựa chọn trở lên; confidence ở đó coi như chưa calibrate.
- **Trường `confidence` của Laya với câu `choice` không phải xác suất cao nhất** và rất thấp (0.00–0.37 trong bài test). Mọi ngưỡng trong dự án này dùng **xác suất cao nhất** (`max(probabilities)`).

## 3. Cài đặt

Trên LENOVO2: cài tay bằng `uv tool install --python 3.12 "laya[serve,mcp]"` (0.3.21), `serve.py` đã vá, MCP đã đăng ký scope user, `HF_HOME=D:\hf-cache`, `LAYA_DEVICE=cpu`. `D:\Laya\.venv` là venv cũ bị hỏng, không dùng.

Trên ADMIN:

- Cài ngày 2026-09-30 bằng `install-laya.ps1` (gói trong thư mục này): `uv tool install --python 3.12 "laya[serve,mcp]==0.3.21"`, torch 2.14.0+cpu. Máy có **RTX 3070** nhưng đang chạy CPU; chưa thử `-Device cuda` (torch bản CPU, có thể phải cài lại torch CUDA).
- Python của tool: `C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe`. Exe: `C:\Users\ADMIN\.local\bin\laya-serve.exe`, `laya-mcp-server.exe`.
- Biến môi trường đã `setx`: `HF_HOME=E:\hf-cache` (model 2.2 GB, **ổ E**), `LAYA_DEVICE=cpu`, `HF_HUB_DISABLE_SYMLINKS_WARNING=1`.
- `serve.py` trong bản cài đã được vá (route `POST /v1/systemone/form` cho Swagger). Nâng cấp Laya sẽ mất bản vá; bản gốc là `serve.py` trong thư mục này.
- MCP `laya` đã đăng ký với Claude Code scope user, có `HF_HOME=E:\hf-cache` trong env (không có thì timeout khi connect). Plan routing **không** dùng MCP.
- Script cài kết thúc với exit code 1 chỉ vì `claude mcp remove` báo chưa có server để xóa; các bước trước đều xong.
- Proxy và các script routing không cần `laya-serve`: chúng nạp Laya trực tiếp qua Python SDK.
- Các script **không còn ghi cứng** `HF_HOME=E:\hf-cache` (đã bỏ ngày 2026-10-01, chưa commit). Chúng dựa vào biến `HF_HOME` do script cài đặt đặt; nếu biến này thiếu, Laya sẽ tải lại model vào `~/.cache`.

## 4. File trong repo

| Đường dẫn | Nội dung |
|---|---|
| `install-laya.ps1`, `serve.py`, `start-laya.bat`, `README.md` | Gói cài cho máy dev khác |
| `routing/prompts.csv` | **60 prompt tổng hợp, 20 mỗi tầng haiku/sonnet/opus**, kèm tín hiệu giả định (`files`, `stack_trace`, `turns`). Viết lại từ đầu, nhãn do Claude đặt |
| `routing/run_routing.py` | Bước A: chạy Laya qua SDK trên 60 prompt, hai biến thể state. Chạy bằng Python của tool |
| `routing/report.md`, `routing/results.json` | Kết quả bước A |
| `proxy/router_proxy.py` | **Bước C: proxy tương thích Anthropic Messages API** (FastAPI, cổng 8787) |
| `proxy/decisions.jsonl` | Log mọi quyết định của proxy |
| `benchmark/run_benchmark.py` | Bước D bản offline: 60 prompt qua proxy, so chiến lược, quét ngưỡng |
| `benchmark/report.md`, `benchmark/results.json` | Kết quả bước D |

File chỉ có ở `D:\Laya` trên LENOVO2, **chưa commit**:

| Đường dẫn | Nội dung |
|---|---|
| `benchmark/laya_benchmark.py`, `benchmark/maxlen_test.py` | Script benchmark hiệu năng CPU (tự mở `laya-serve` ở cổng 8011). Chạy: `uv run --with psutil python laya_benchmark.py [--device cuda]` |
| `benchmark/results/` | CSV thô của benchmark hiệu năng, `environment.json`, `cpu_maxlen.csv` |
| `benchmark/report.summary.md` | Bản tóm tắt hiệu năng tiếng Anh để gửi team (có mục Model và Input length) |
| `benchmark/report.en.md` | Báo cáo hiệu năng bản dài tiếng Anh; chưa có mục Model và `max_len` |
| `test-results.md`, `results10.json` | 10 case Bug/Feature/Task |
| `dist/`, `laya-installer.zip`, `serve.py.patched` | Bản gốc của gói cài; trùng nội dung với các file ở gốc repo |

Đã mất khi kéo repo về LENOVO2 (bị ghi đè, không có bản sao): báo cáo hiệu năng bản dài **tiếng Việt** (trước đây là `benchmark/report.md`, nay tên đó là báo cáo bước D) và bài routing 4 tầng cũ (`routing/prompts.csv`, `run_routing.py`, `report.md` phiên bản cũ). Số liệu chính của cả hai còn ở mục 8 và trong `report.en.md`.

Lưu ý: thư mục `benchmark/` hiện chứa hai thứ khác nhau (benchmark routing bước D và benchmark hiệu năng CPU). Nên tách benchmark hiệu năng sang thư mục riêng trước khi commit.

## 5. Bước A: routing 3 tầng (đã xong)

Criteria đang dùng (mỗi mô tả dưới 48 token, chung cho `run_routing.py` và proxy):
- haiku: task tầm thường, cơ học, tra cứu; sửa nhỏ một file; không cần thiết kế hay debug.
- sonnet: task phát triển chuẩn; feature rõ ràng, bug cục bộ, test, refactor trong vài file.
- opus: kiến trúc, migration lớn, root cause nhiều file/service, điều tra security/performance.

| Biến thể state | Đúng | Lệch tối đa 1 tầng | Latency trung vị (CPU) |
|---|---|---|---|
| Chỉ `request` | 47/60 (78%) | 58/60 | 469 ms |
| `request` + tín hiệu | 50/60 (83%) | 60/60 | 552 ms |

- Opus 19/20, haiku 14–17/20, **sonnet yếu nhất 14/20**: 4 câu bị đẩy lên opus, 2 câu có stack trace bị xuống haiku.
- Xác suất cao nhất tách được đúng/sai: dưới 0.5 đúng 64%, 0.5–0.7 đúng 88%, trên 0.7 đúng 7/7 (biến thể chỉ `request`). Khoảng một nửa số câu dưới 0.5.
- Lưu ý: tín hiệu trong CSV do Claude gán theo tầng nên mức tăng 3 câu là lạc quan. Không thể so trực tiếp với 28/60 của bài 4 tầng cũ vì prompt, nhãn, criteria đều mới.

## 6. Bước C: proxy (đã dựng, chạy dry-run)

`proxy/router_proxy.py`, chạy: `<tool python> router_proxy.py`, Claude Code trỏ vào `ANTHROPIC_BASE_URL=http://localhost:8787`.

Hoạt động:
- Nhận `POST /v1/messages`, tạo **compact state** bằng regex: câu người dùng mới nhất (bỏ tool_result và `<system-reminder>`, cắt 2000 ký tự), số file nhắc tới, có stack trace không, số turn. Gọi Laya với `max_len=1024`.
- **Session**: header `x-claude-code-session-id` nếu có; không thì băm `metadata.user_id` + câu đầu tiên của hội thoại (câu này không đổi qua các turn). Chọn model một lần rồi giữ nguyên.
- Request có model haiku (call nền của Claude Code) hoặc không có văn bản người dùng: để nguyên.
- Chỉ thay trường `model`, phần còn lại của request giữ nguyên (điểm này người dùng chưa xác nhận rõ, nhưng đã làm theo).
- Ngưỡng `ROUTER_MIN_PROB` (mặc định 0.5): xác suất cao nhất thấp hơn thì fallback về sonnet.
- Log JSONL vào `decisions.jsonl`; trạng thái ở `GET /router/status`. Streaming (SSE) hỗ trợ cả dry-run lẫn chuyển tiếp.
- Env: `ROUTER_UPSTREAM` (trống = dry-run), `ROUTER_PORT`, `ROUTER_MIN_PROB`, `ROUTER_MODE=laya|off`, `ROUTER_MODEL_HAIKU/SONNET/OPUS`, `ROUTER_LOG`.

**2026-10-01, LENOVO2: đã chạy thật end to end với `ROUTER_UPSTREAM=https://api.anthropic.com`**, qua đăng nhập gói thuê bao công ty (Max) của Claude Code, không dùng API key. Người dùng chạy `claude -p ... --output-format json` với `$env:ANTHROPIC_BASE_URL="http://localhost:8787"` từ PowerShell của họ (CLI gọi từ shell của Claude trong app desktop luôn báo OAuth hết hạn, không dùng được). Kết quả: route sang Haiku và Sonnet đều chạy, `--resume` bám đúng session, 0 lỗi sau các sửa dưới đây.

Những gì đã học và đã sửa trong `router_proxy.py` (chưa commit):
- **Chốt chi phí**: request mang `x-api-key` bị từ chối 403 (trừ khi `ROUTER_ALLOW_API_KEY=1`). Chỉ cho đi qua OAuth của gói thuê bao.
- Claude Code gửi **header `x-claude-code-session-id`**, proxy dùng nó làm khóa session. Vấn đề `/compact` đổi câu đầu không còn.
- Claude Code của tài khoản này mặc định `claude-opus-5[1m]`: gửi `model=claude-opus-5` + beta `context-1m`. Mỗi `claude -p` tạo 2 request: một call phụ không tool (preflight, đi thẳng Opus, ~1.2k token) và request chính có ~37 tool. **Chỉ request có `tools` mới được route**; không dùng "model là haiku" làm dấu hiệu call nền nữa, vì khi `--resume` Claude Code tự gửi lại model proxy đã chọn ở lượt trước.
- **Haiku 4.5 từ chối** những gì Claude Code gửi cho Opus; không chuẩn hóa thì Claude Code tự thử lại 3 lần (3 lỗi 400, +1.4 s) rồi mới chạy. `adapt_for_model` cho tầng haiku: bỏ beta `context-1m`, `effort-*`, `mid-conversation-system`; bỏ `output_config.effort`; `thinking adaptive` -> `enabled` với `budget_tokens` 4096 (**không** được tắt hẳn: `context_management.clear_thinking` đòi thinking bật); message role `system` -> `user`. Sonnet 5.5 nhận nguyên request của Opus, không cần sửa.
- Tầng trùng với tầng model đang yêu cầu -> giữ nguyên request (`*_same_tier`).
- **UsageTap** đọc model thật và token (input / cache read / cache creation / output) từ response SSE hoặc JSON, ghi dòng `action: usage` vào log. Phải ép `accept-encoding: identity` (httpx tự thêm gzip). `modelUsage` và `costUSD` trong JSON của Claude Code là **do client tự suy ra**, không phản ánh model thật; chỉ tin log của proxy.
- Log thêm `shape` của request (stream, max_tokens, thinking, số tool, số message, beta, extra_keys).
- Số đo: Laya ~460 ms/quyết định trên CPU; Haiku trả lời "one" với 3.7k input + 32k cache read.

Thêm cùng ngày (phiên tương tác thật + chuỗi `-p --resume` 3 lượt, chạy được từ shell của Claude sau khi người dùng `/login` lại CLI, với env `CLAUDE_*`/`ANTHROPIC_*` của app desktop bị unset):
- Phiên tương tác gửi `max_tokens` 128000 (Haiku tối đa 64000) và message role `system` mang `output_config` -> thêm 2 quy tắc chuẩn hóa cho haiku (cap max_tokens, bỏ `output_config` khi đổi role). Tổng cộng 7 quy tắc trong `adapt_for_model`.
- **Câu đầu của phiên thật là "hi"** -> Laya khóa Haiku cho cả phiên dù việc thật đến sau. Thêm `ROUTER_REEVAL=1` (mặc định): mỗi câu mới của người dùng (không phải vòng tool) được Laya đánh giá lại, **chỉ nâng tầng, không hạ**. Đã thấy hoạt động: "hi" -> haiku, câu tóm tắt README giữ haiku, câu phân tích concurrency -> **nâng lên sonnet**; khi nâng, cache_read về 0 và cache_creation 47.5k token = **chi phí đổi model đo được**.
- **Tiếng Việt**: Laya tự route sang checkpoint `multilingual`, checkpoint này xếp gần như mọi câu tiếng Việt vào haiku (3/8 đúng, 8 câu thử). Ép checkpoint `english` cho tiếng Việt được 5/8 và sai theo hướng nâng tầng. Proxy giờ ép `english` (`ROUTER_LAYA_CHECKPOINT=english`, đặt `auto` để Laya tự chọn). Mẫu rất nhỏ; cần test thêm.
- Tầng Opus mặc định `claude-opus-5` (ID Claude Code đang gửi; người dùng đồng ý giữ mặc định đó). Log cũng thấy `claude-opus-5-5` tồn tại (một call phụ trả về model này).
- Người dùng **đã xác nhận extra usage tắt** trên tài khoản công ty.
- `proxy/router_log.py`: tóm tắt theo session (Laya chọn gì, model nào thật sự trả lời, token), có `--watch`. Claude Code không tự hiện model thật.
- Có 1 lỗi 429 (rate limit) trên call phụ, Claude Code tự thử lại được.
- Khi chạy chuỗi `-p --resume`, mỗi process `claude` tạo cache mới (cache_read 0 ở đầu mỗi lượt); phiên tương tác thì cache nối tiếp. Đo cache nên dùng phiên tương tác.

**Chưa xử lý / chưa test:**
- Session lưu trong RAM.
- Chất lượng routing tiếng Việt (mẫu 8 câu). Criteria vẫn là bản Claude tự viết, chưa dùng Phase 1 của plan.
- Subagent của Claude Code đi qua proxy thế nào (chưa quan sát).
- Benchmark Phase 7 thật (A/B/C) chưa chạy; cần bộ task và hạn mức.

## 7. Bước D: benchmark (bản offline, đã chạy)

60 prompt qua proxy như 60 session mới. Không gọi LLM. **Giả định**: tỉ lệ giá haiku:sonnet:opus = 1:3:5, token mỗi task bằng nhau ở mọi model. "Chọn thấp hơn cần" là proxy cho rủi ro chất lượng.

| Chiến lược | Đúng | Chọn thấp hơn cần | Chọn cao hơn cần | h/s/o | Chi phí so với luôn Opus | Fallback |
|---|---|---|---|---|---|---|
| Nhãn đúng | 60/60 | 0 | 0 | 20/20/20 | 60% | – |
| Luôn Opus | 20/60 | 0 | 40 | 0/0/60 | 100% | – |
| Luôn Sonnet | 20/60 | 20 | 20 | 0/60/0 | 60% | – |
| Laya, không ngưỡng | 48/60 | 2 | 10 | 18/16/26 | 65% | 0 |
| Laya, ngưỡng 0.4 | 43/60 | 2 | 15 | 13/21/26 | 69% | 7 |
| Laya, ngưỡng 0.5 | 40/60 | 2 | 18 | 5/34/21 | 71% | 30 |
| Laya, ngưỡng 0.6 | 35/60 | 6 | 19 | 2/43/15 | 69% | 42 |
| Laya, ngưỡng 0.7 | 24/60 | 16 | 20 | 0/56/4 | 63% | 56 |

Kết luận tạm:
- Laya không ngưỡng tốt nhất trên tập này: chi phí 65%, 2 câu chọn thấp, không câu nào lệch 2 tầng.
- **Ngưỡng fallback về Sonnet làm xấu đi**: ở 0.5 một nửa bị fallback, chi phí tăng mà số chọn thấp không giảm; từ 0.6 kéo task opus xuống sonnet. Quy tắc "confidence thấp thì về Sonnet" nên bỏ hoặc hạ xuống 0.4.
- Overhead router: trung vị 520 ms/session trên CPU, tốn một lần mỗi session.
- Số lần chuyển model = 0 theo thiết kế, chưa đo được thực tế.
- LLM routing (Haiku làm router): **chưa chạy**, không có API. `claude -p` trên máy này báo OAuth hết hạn.

## 8. Kết quả từ máy LENOVO2 (script và dữ liệu thô ở `D:\Laya`, chưa commit)

- Bug/Feature/Task 10 case: 8/10. Routing 4 tầng 60 prompt cũ: 28/60, nghiêng opus, Fable không tách được khỏi opus.
- CPU Ryzen AI 7 350: RAM 2.0 GB với `LAYA_MODELS=english`; cold start 9.5 s; warm 110 token p50 314 ms; concurrency không tăng throughput; 10 phút tải 1425 request 0 lỗi; `max_len` 512 -> 1.1 s, 1024 -> 2.7 s, 2048 -> 6.0 s, 4096 -> 15.3 s.
- RAM 4.9 GB khi nạp cả 3 checkpoint; inference dùng 8 nhân; khoảng 3.2 req/s; `max_len` 7636 token -> 40.5 s, 12.2 GB RAM.
- GPU và tiếng Việt chưa đo. Báo cáo dài `benchmark/report.en.md` chưa cập nhật mục Model và `max_len`; bản tóm tắt `report.summary.md` thì đã có.

## 8b. Benchmark thật 15 task x 4 chiến lược (2026-10-01, chạy ở LENOVO2, tổng kết 2026-10-02)

Chi tiết: `benchmark/live/full-20261001-1717/report.md` (sinh bằng `benchmark/summarize_live.py`, chấm lại từ `results.rescored.jsonl`). Claude Code thật qua proxy, gói thuê bao, 5 task mỗi tầng haiku/sonnet/opus.

| Chiến lược | Pass | Turns | Wall (s) | Cache-read tok | Model thật trả lời (h/s/o, request) |
|---|---|---|---|---|---|
| Cố định Sonnet | 15/15 | 102 | 519 | 3.1M | 0/66/0 |
| LLM routing (Haiku) | 14/15 | 132 | 873 | 5.8M | 29/17/52 |
| **Laya routing** | **15/15** | 140 | 852 | 5.6M | 34/42/30 |
| Cố định Opus | 13/15 (2 lỗi) | 118 | 800 | 4.9M | 0/0/86 |

- **Chất lượng:** Laya 15/15, ngang cố định Sonnet; hơn LLM routing 14/15 (rớt 1 task haiku). Laya chọn đúng tầng nhãn 7/15, thấp hơn nhãn 4, cao hơn nhãn 4 (LLM routing: 13 đúng, 2 thấp) nhưng vẫn qua hết, nghĩa là nhãn tầng chưa chắc là tầng tối thiểu cần thiết.
- **Chi phí/thời gian:** cả hai kiểu routing đều **chậm và tốn token hơn cố định Sonnet** (wall 850–870 s so với 519 s; cache-read gấp khoảng 1.8x). Nguyên nhân khả dĩ: đổi model giữa phiên làm mất cache (đã đo 47.5k token cache tạo lại mỗi lần nâng tầng) và chạy nhiều turn hơn. Laya rẻ hơn LLM routing (1.43x so với 1.71x) nhưng vẫn đắt hơn cố định Sonnet; rẻ hơn cố định Opus (2.13x).
- **Chi phí tính lại** (`benchmark/estimate_cost.py`, ước tính, không phải từ log thô vì `decisions.jsonl` của lần chạy không có trên máy ADMIN; token chia theo tỉ lệ số request mỗi model, giá giả định haiku:sonnet:opus = 1:3:5, cache-read 0.1x, cache-write 1.25x, output 5x): cố định Sonnet 1.00x, **Laya 1.43x**, LLM routing 1.71x, cố định Opus 2.13x. Tổng của ba dòng đầu khớp với `summary.json` (3552 / 5064 / 6078), nên đơn vị của summary là công thức này; dòng `fixed_opus` trong summary (824) sai, đúng ra khoảng 7580. Phần chia theo model của summary không khớp ước tính này, nên số theo từng tầng chưa chắc. Hai run `fixed_opus` h4, h5 lỗi sau vài giây (nghi rate limit), chưa chạy lại.
- **Cỡ mẫu:** 15 task do Claude viết, 1 lần chạy mỗi chiến lược, nên chênh 14 và 15 không có ý nghĩa thống kê.

## 9. Trạng thái hiện tại và việc dang dở (cập nhật 2026-10-04, chuyển sang máy khác)

**Hướng đang theo đuổi:** chọn model **theo từng bước** của một task bằng subagent + hook (mục 11), thay cho routing theo request bằng proxy (mục 6-8b, đã cho thấy tốn hơn cố định Sonnet: Laya 1.43x). Nhãn do Claude gắn (60 prompt, ADO 122 task) **không phải ground truth**; ground truth phải là chạy thật một task thật và chính người dùng review.

**Dang dở, theo thứ tự làm:**
0. **Đã chạy task thật đầu tiên (2026-10-05)**: `workflow/runs/add-json/COMPARE.md`. Ba cấu hình (static, laya, baseline Opus) đã chạy; baseline rẻ nhất (285 đơn vị) và nhanh nhất (71 s), chia bước 667-788; Laya p 0.45-0.55 ở mọi bước. **Chờ người dùng review** `review.md` trong từng thư mục (ground truth). Lần chạy laya đầu bị loại vì hook quá giờ 3 s (3/5 bước không có quyết định); chạy lại với `LAYA_TIMEOUT=15`. Chạy bằng `workflow/run_task.py --name <ten> --config static|laya|baseline --task-file ...` (cần `laya-serve` cổng 8000, `export LAYA_TIMEOUT=15`).
0b. **Task thật thứ hai, lớn hơn (2026-10-05)**: lưu session của proxy ra file, `workflow/runs/persist-sessions/COMPARE.md`. Baseline Opus một luồng vẫn rẻ nhất (657 vs 1203 static vs 1283 laya) và nhanh nhất (118 s vs 271-352 s); cả ba có test qua (15-18). Laya p 0.42-0.53 ở mọi bước. Haiku làm explore cần 18 lượt (Sonnet 3 lượt) nhưng vẫn rẻ hơn về đơn vị. **Chờ người dùng review** `review.md`. Lỗi đã sửa: `run_task.py` truyền đề bài nhiều dòng qua shell bị cmd.exe cắt (giờ gọi `claude` không qua shell).
1. **Chạy thêm task thật** (mục 11, bước 4 của plan): hai task đã cho cùng xu hướng, nên bước hợp lý tiếp theo là xem review của người dùng và quyết định có đáng tiếp tục hướng chia bước không: người dùng chọn task + repo (cỡ vừa, có test/build). Cài workflow: `workflow/setup_workflow.ps1 -Target <repo>`. Chạy 3 cấu hình trong 3 bản sao riêng: `LAYA_STEP_MODE=static`, `laya`, và baseline một luồng Opus. Dùng `workflow/step_report.py <session_id> --out runs/<ten>/report.md --review runs/<ten>/review.md`; **người dùng điền review.md** (model đủ / thừa / thiếu từng bước + đánh giá diff). Cần `laya-serve` ở cổng 8000 cho chế độ laya. Xem thanh Usage trước khi chạy (hai cửa sổ 5 giờ đã cạn ngày 2026-10-01, xem PROGRESS-2026-10-01.md và mục quota bên dưới).
2. **Mốc phải thắng:** bảng model tĩnh theo loại bước (explore=haiku, plan=opus, implement=sonnet, verify=haiku, review=sonnet). Laya chỉ có giá trị nếu phân biệt được bước dễ/khó **trong cùng loại bước** tốt hơn bảng này. Smoke test mới cho Laya chọn Sonnet cả 5 bước.
3. **Chi phí chia bước:** task tầm thường tốn khoảng 3 lần một luồng Sonnet (334 vs 115 đơn vị quy đổi, một lần chạy). Cần task đủ lớn để thấy chia bước có lời không; xem cột chi phí trong báo cáo từng bước.
4. Lỗi phụ cần xử lý khi chạy `-p` tự động: subagent chạy nền, không hỏi được quyền, lệnh ghép `cd ... && git diff` bị từ chối (cho phép `Bash` rộng trong bản sao dùng một lần).
5. Commit và đồng bộ: cả hai máy (LENOVO2, ADMIN) dùng chung repo; đường dẫn Python của tool Laya và `HF_HOME` khác nhau theo máy (mục đầu file).

**Chưa làm / chưa rõ:**
- Gateway X-Tek (upstream thật) và giá thật để thay giá giả định 1:3:5.
- Re-label một mẫu ADO bằng dev thật; test tiếng Việt (checkpoint multilingual xếp gần như mọi câu vào haiku, đã thấy 3/8 đúng); GPU (RTX 3070 trên ADMIN, chưa thử CUDA).
- Task mới trong cùng hội thoại, lưu session ra file, subagent đi qua proxy thế nào: chỉ liên quan hướng proxy, đang gác lại.
- Hỏi security xem dữ liệu có được gửi ra ngoài không (để biết có thử Jev được không).
- Khuyến nghị hiện tại: **pilot further**, ưu tiên Laya như **gợi ý cho người duyệt** (ado/report.md) hơn là router tự động.

**Quota (bài học 2026-10-01):** hai lần chạm giới hạn session (17:58 reset 18:40; 21:33 reset 00:00). Đọc log: chat dùng Fable 5.1 với ngữ cảnh khoảng 316k token mỗi lượt chiếm khoảng một nửa lượng quy đổi; benchmark live tốn 23.6k đơn vị trong đó chiến lược luôn-Opus 32%. Có lượng dùng từ nơi khác không thấy trong log (cửa sổ session bắt đầu 13:40 và 19:00 mà máy này không có hoạt động). Quota là của cả tài khoản. Trước mỗi lần chạy lớn: xem Usage, đặt `--max-turns` thấp, không chạy baseline Opus đầy đủ.

## 10. Lưu ý khi làm việc

- Chạy lại `run_routing.py` hay `run_benchmark.py` sẽ ghi đè `report.md` / `results.json` đã commit (latency khác theo máy). Dùng `git checkout -- <file>` nếu không muốn đổi.
- Sửa file bằng `sed -i` trong Git Bash đổi CRLF thành LF trên cả file; tránh dùng.
- PowerShell 5.1: `curl` là alias khác, dùng `curl.exe` hoặc `Invoke-RestMethod`. Không có `&&`. `claude mcp add ... -- <exe>` bị PowerShell nuốt `--`, chạy bằng Git Bash.
- `python` không có trên PATH; dùng Python của tool Laya (mục 3), đặt `PYTHONIOENCODING=utf-8` để in bảng.
- Proxy in-process giữ một lock inference; benchmark dùng cổng 8787 của proxy, không cần `laya-serve`.
- Người dùng giao tiếp bằng tiếng Việt; báo cáo gửi team viết tiếng Anh, ngắn gọn dạng gạch đầu dòng.

## 11. Workflow theo bước: subagent + hook (2026-10-02, LENOVO2)

Yêu cầu mới của người dùng: (1) nhãn do Claude/Fable gắn (60 prompt, ADO) **không phải ground truth**, ground truth phải là chạy thật một task thật và chính người dùng review; (2) chọn model theo cả work item là quá thô, cần **đổi model giữa các bước trong cùng một task** (người dùng nghiêng về subagent của Claude Code, chưa chốt); (3) hỏi compact trước khi gọi Laya có lâu không.

Đã làm (thư mục `workflow/`, xem `workflow/README.md`):
- Cơ chế xác nhận thật: hook `PreToolUse` (matcher `Agent|Task`) chạy cả ở `claude -p`; `tool_input` có `description`, `prompt`, `subagent_type`, `run_in_background`; trả `updatedInput` với `model` thì model của subagent đổi (đối chứng: không hook thì kế thừa Sonnet). Liên kết hook <-> transcript luồng chính <-> transcript subagent bằng `tool_use_id` (`meta.json` của subagent có `toolUseId`; `toolUseResult` trong transcript chính có `resolvedModel`, `totalTokens`, `totalDurationMs`).
- `hooks/laya_step_router.py` (3 chế độ `LAYA_STEP_MODE`: off / static / laya; fail-open; chỉ chạm subagent `wf-*`), `hooks/laya_common.py` (QUESTION, regex, compact state; **proxy cũng import từ đây**, đã kiểm hành vi không đổi), 5 agent `agents/wf-*.md`, lệnh `commands/wf.md`, `setup_workflow.ps1` (cài/gỡ, idempotent, merge `settings.local.json`; đã bắt và sửa lỗi BOM của PowerShell 5.1), `step_report.py` (báo cáo theo bước + mẫu `review.md`).
- Smoke test `/wf` trên task đổi tên hàm trong bản sao repo: 5 bước chạy, Laya chọn Sonnet cho cả 5 (p 0.50-0.62), model thật khớp, diff đúng.
- Câu hỏi 3: compact 0.03 ms; Laya 450-630 ms (brief ngắn) tới 750-1230 ms (brief 500-970 ký tự do luồng chính viết); cộng 0.5-1.2 s mỗi lần gọi subagent.
- Chi phí: task tầm thường tốn khoảng 3 lần so với một luồng Sonnet (334 vs 115 đơn vị quy đổi), một lần chạy.

Chưa làm: chạy một **task thật** của X-Tek (người dùng chọn task + repo, tự review `runs/<ten>/review.md`); so ba cấu hình static / laya / baseline Opus; chưa có bằng chứng Laya phân biệt bước dễ/khó tốt hơn bảng tĩnh theo loại bước (mốc bắt buộc phải thắng).

Bẫy gặp phải: Git Bash đổi `/wf` thành `C:/Program Files/Git/wf` (dùng `MSYS_NO_PATHCONV=1`); subagent ở `-p` chạy nền và không hỏi được quyền, lệnh ghép `cd ... && git diff` bị từ chối với quy tắc Bash hẹp; `proxy` giờ phụ thuộc `workflow/hooks/laya_common.py`.
