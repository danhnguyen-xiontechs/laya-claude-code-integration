# Study: wangmiaozero/laya-router-skill (v0.2.0, commit 3f85267)

Nguồn: https://github.com/wangmiaozero/laya-router-skill — Apache-2.0, ~416 dòng Python runtime.

## Nó là gì

Một **Agent Skill + CLI + MCP (tùy chọn)** bọc quanh chính thư viện Laya upstream (`laya.Router`) mà ta đang dùng, cộng backend MLX cho Mac.
Agent (Claude Code, Codex...) *tự quyết định* gọi `laya-router decide "<tóm tắt task>"` và nhận về 6 tín hiệu trong **một lần predict**:

| Câu hỏi | Loại | Ghi chú |
|---|---|---|
| `task_type` | choice, 14 lựa chọn | ≥11 lựa chọn → dính cảnh báo temperature, confidence chưa calibrate (HANDOFF §2) |
| `complexity` | score: trivial/normal/complex/very_complex | |
| `needs_strong_reasoning` | noul | |
| `needs_tools` | noul | |
| `security_sensitive` | noul | |
| `risk` | choice low/medium/high | |

Envelope: `status, backend, device, model, advisory=true, answers, routing, usage`; lỗi → `status=unavailable, fail_open=true`.

## Có giải quyết bài toán của ta không? — **Không trực tiếp**

Bài toán của ta: chọn Opus/Sonnet/Haiku **trước** LLM call (proxy `ANTHROPIC_BASE_URL`).

- Skill này là **advisory, chạy bên trong agent**: lúc agent gọi nó thì model (thường là Opus) đã chạy và đã trả tiền rồi. Nó không đổi model của phiên; README nói rõ "implicit invocation not guaranteed".
- Không có logic map tín hiệu → model, không có proxy, không có xử lý adapt request cho Haiku, session, re-eval… — những phần khó ta đã làm trong `proxy/router_proxy.py`.
- Trường `routing` trong output là **chọn checkpoint Laya** (english/multilingual), không phải chọn LLM — giống cái bẫy đã ghi trong HANDOFF §2.
- Windows chưa từng chạy inference thật (theo README của họ).

## Thứ đáng lấy về

1. **Thay 1 câu `choice` 3 tầng bằng nhiều tín hiệu.** Hiện ta hỏi thẳng haiku/sonnet/opus (sonnet yếu nhất 14/20). Có thể thử: `complexity` (score) + `needs_strong_reasoning` (noul) + `security_sensitive`, rồi ghép bằng luật, ví dụ:
   - `complexity ≤ trivial` và `!needs_strong_reasoning` → haiku
   - `complexity ≥ complex` hoặc `needs_strong_reasoning` p>0.7 → opus
   - còn lại → sonnet
   Đây là thí nghiệm rẻ: chạy lại 60 prompt ở `routing/prompts.csv` và so với 47/60, 50/60.
2. Gửi nhiều câu hỏi trong **một** `predict` (dict questions) — kiểm tra latency có giữ ~460 ms không.
3. `detect_device("auto")` → dùng được RTX 3070 trên máy ADMIN (cần torch CUDA).
4. Log chỉ ghi SHA-256 của task, không ghi text — nên áp cho `proxy/decisions.jsonl` nếu đưa đi pilot.
5. Pattern fail-open: Laya lỗi → để nguyên model gốc.

## Đề xuất bước tiếp

Viết `routing/run_multisignal.py` dùng bộ QUESTIONS (cắt bớt `task_type`), quét luật ghép trên 60 prompt + 8 câu tiếng Việt; nếu thắng 50/60 thì cắm vào `router_proxy.py` sau cờ `ROUTER_STRATEGY=multisignal`.

## Kết quả thử multi-signal (2026-10-05, laya 0.3.21)

`routing/run_multisignal.py` → `routing/multisignal_report.md`. Baseline 47/60 và 50/60; luật cố định 41/38; grid fit trên chính 60 câu chỉ hòa 50/60 nhưng chọn thấp hơn cần 5–11 (baseline 3); latency ~1.8–2.0 s so với ~0.46 s. **Kết luận: bỏ hướng multi-signal**, giữ câu choice 3 tầng; vấn đề còn lại là criteria của sonnet.

Cài đặt router-skill trên ADMIN: venv ở `laya-router/` (junction từ `%LOCALAPPDATA%\laya-router`), MCP `laya-router` scope user; MCP `laya` cũ đã gỡ. Inference thật trên Windows CPU chạy được.
