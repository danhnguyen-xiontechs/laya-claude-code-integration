# Laya decision engine: handoff (cập nhật 2026-09-30, máy ADMIN)

Tài liệu này tóm tắt toàn bộ bối cảnh để tiếp tục ở một session khác. Thư mục làm việc: `D:\XionTechs\Laya`. Máy: Windows 10, PowerShell, user `ADMIN`. Đây là máy thứ hai; máy đầu (`LENOVO2`, thư mục `D:\Laya`) giữ các file benchmark CPU và bài routing 4 tầng cũ, **không có trên máy này**.

## 1. Mục tiêu

Task của X-Tek: đánh giá "decision engine" (model nhỏ, chọn trong danh sách cố định, trả về confidence) để thay các LLM call lặp lại kiểu phân loại / routing. Hai ứng viên: **Jev** (API hosted, dữ liệu rời mạng) và **Laya** (mã nguồn mở, self-host). Kết quả cuối: khuyến nghị adopt / pilot further / drop, có số liệu.

Use case đang theo đuổi: **model routing** trước LLM call.

```
Claude Code -> ANTHROPIC_BASE_URL -> router_proxy (Laya chọn tầng) -> Opus / Sonnet / Haiku -> LLM Gateway
```

Hai plan gốc của người dùng (`laya_model_routing_implementation_plan.md`, `laya_self_hosted_performance_benchmark_plan.md`) nằm trên máy LENOVO2 trong `Downloads`, **chưa có trên máy này**. Criteria Phase 1 của plan vì thế chưa được dùng; criteria hiện tại do Claude tự viết (xem mục 5).

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

## 3. Cài đặt hiện tại trên máy này

- Cài ngày 2026-09-30 bằng `install-laya.ps1` (gói trong thư mục này): `uv tool install --python 3.12 "laya[serve,mcp]==0.3.21"`, torch 2.14.0+cpu. Máy có **RTX 3070** nhưng đang chạy CPU; chưa thử `-Device cuda` (torch bản CPU, có thể phải cài lại torch CUDA).
- Python của tool: `C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe`. Exe: `C:\Users\ADMIN\.local\bin\laya-serve.exe`, `laya-mcp-server.exe`.
- Biến môi trường đã `setx`: `HF_HOME=E:\hf-cache` (model 2.2 GB, **ổ E**), `LAYA_DEVICE=cpu`, `HF_HUB_DISABLE_SYMLINKS_WARNING=1`.
- `serve.py` trong bản cài đã được vá (route `POST /v1/systemone/form` cho Swagger). Nâng cấp Laya sẽ mất bản vá; bản gốc là `serve.py` trong thư mục này.
- MCP `laya` đã đăng ký với Claude Code scope user, có `HF_HOME=E:\hf-cache` trong env (không có thì timeout khi connect). Plan routing **không** dùng MCP.
- Script cài kết thúc với exit code 1 chỉ vì `claude mcp remove` báo chưa có server để xóa; các bước trước đều xong.
- Trên máy này không cần `laya-serve`: proxy và các script nạp Laya trực tiếp qua Python SDK.

## 4. File trong `D:\XionTechs\Laya`

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

Đã test dry-run: route, sticky, bỏ qua call haiku, stream. Mỗi lần gọi Laya khoảng 0.5 s.

**Chưa xử lý / chưa test:**
- Nhận biết task mới trong cùng hội thoại: model chọn ở câu đầu giữ suốt session.
- Sau `/compact` câu đầu đổi, session bị coi là mới.
- Đổi model có thể làm hỏng request dùng tham số model đích không hỗ trợ (thinking, beta header).
- Session lưu trong RAM.
- **Chuyển tiếp tới upstream thật chưa chạy lần nào** (chưa có gateway, không có API key).

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

## 8. Kết quả từ máy LENOVO2 (không tái tạo được ở đây)

- Bug/Feature/Task 10 case: 8/10. Routing 4 tầng 60 prompt cũ: 28/60, nghiêng opus, Fable không tách được khỏi opus.
- CPU Ryzen AI 7 350: RAM 2.0 GB với `LAYA_MODELS=english`; cold start 9.5 s; warm 110 token p50 314 ms; concurrency không tăng throughput; 10 phút tải 1425 request 0 lỗi; `max_len` 512 -> 1.1 s, 1024 -> 2.7 s, 2048 -> 6.0 s, 4096 -> 15.3 s.
- GPU và tiếng Việt chưa đo. Báo cáo dài (`benchmark/report.md`, `report.en.md`) trên máy đó chưa cập nhật mục Model và `max_len`.

## 9. Việc tiếp theo

1. **Có upstream** (gateway X-Tek hoặc API key): đặt `ROUTER_UPSTREAM`, chạy proxy thật với Claude Code, xác nhận request đổi model không bị lỗi tham số; chạy D thật (token, chi phí, chất lượng câu trả lời, số lần chuyển model); thêm chiến lược LLM routing (Haiku) vào `run_benchmark.py`, có thể dùng chính proxy với `ROUTER_MODE=off`.
2. Thay giá giả định 1:3:5 bằng giá thật của gateway.
3. Lấy plan gốc từ máy LENOVO2, thay criteria Phase 1 rồi chạy lại A và D.
4. Dataset thật 50–100 task từ ADO; nhãn theo tiêu chí kỹ thuật thống nhất.
5. Nhận biết task mới trong session; xử lý `/compact`; lưu session ra file.
6. Đo GPU (RTX 3070) với torch CUDA; test tiếng Việt / checkpoint multilingual.
7. Hỏi security xem dữ liệu có được gửi ra ngoài không, để biết có thử Jev được không.

## 10. Lưu ý khi làm việc trên máy này

- PowerShell 5.1: `curl` là alias khác, dùng `curl.exe` hoặc `Invoke-RestMethod`. Không có `&&`. `claude mcp add ... -- <exe>` bị PowerShell nuốt `--`, chạy bằng Git Bash.
- `python` không có trên PATH; dùng Python của tool Laya (mục 3), đặt `PYTHONIOENCODING=utf-8` để in bảng.
- Proxy in-process giữ một lock inference; benchmark dùng cổng 8787 của proxy, không cần `laya-serve`.
- Người dùng giao tiếp bằng tiếng Việt; báo cáo gửi team viết tiếng Anh, ngắn gọn dạng gạch đầu dòng.
