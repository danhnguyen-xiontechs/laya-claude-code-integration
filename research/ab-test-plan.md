# Plan: A/B test "Context & Tool Pruning" bằng Laya, không proxy (2026-10-05)

## 0. Kiểm tra giả định của approach mới

Đã đối chiếu với code đang cài (`laya` 0.3.27, `laya_router` 0.2.0, Claude Code):

| Giả định | Thực tế | Hệ quả cho plan |
|---|---|---|
| `python -m laya.serve --mode router-skill` | **Không tồn tại.** `laya.serve` là HTTP server (FastAPI, đọc `LAYA_HOST`/`LAYA_LOG_LEVEL`), không có `--mode`, không phải MCP stdio. MCP của router-skill là `python -m laya_router.mcp` (đã đăng ký tên `laya-router`). | Dùng lệnh đã đăng ký. |
| MCP server "lọc bớt Tool Schema thừa" | **Một MCP server không sửa được danh sách tool Claude Code gửi đi.** Nó chỉ cung cấp tool của chính nó (`laya_decide`, `laya_health`, `laya_info`). Schema Read/Edit/Bash/... và tool của MCP khác vẫn được gửi mỗi request. | Pruning phải làm ở **lúc khởi động phiên** (`--allowedTools` / `--disallowedTools` / `--strict-mcp-config`) — xem cơ chế L1. |
| MCP "kiểm soát luồng đọc file" | MCP không chặn được tool khác. Cái chặn được là **hook `PreToolUse`** (trả `deny` + lý do). | Cơ chế L2 dùng hook, Laya quyết định. |
| Claude Code tự gọi MCP để nhận diện intent | Chỉ khi model tự chọn gọi; README router-skill ghi rõ "implicit invocation not guaranteed". Mỗi lần gọi **tốn thêm** token. | MCP-only giữ làm luồng đối chứng. |
| Không proxy → giữ prompt cache, ít latency | **Đúng**, miễn model và tập tool cố định suốt phiên. | Mọi cơ chế dưới đây quyết định 1 lần/phiên hoặc chỉ chặn tool call, không đổi request. |
| Đo bằng `/cost` | Không proxy, không đổi model → token của Claude Code (`--output-format json` → `usage`, transcript JSONL) phản ánh đúng. | Dùng được. Lấy từ JSON thay vì gõ `/cost` tay. |

## 1. Các cơ chế không proxy được thử

- **L1 – Launcher theo intent (pruning thật):** trước phiên, Laya phân loại task (câu `choice` intent, ví dụ bugfix / refactor / docs / lookup) → bảng ánh xạ intent → `--model`, `--allowedTools`, `--strict-mcp-config` (bỏ connector Gmail/Drive/Calendar/Docs khi không cần). Schema bị bỏ thật khỏi mọi request, cache không bị phá vì cố định cả phiên.
- **L2 – Hook `PreToolUse` cho Read/Grep/Glob:** Laya (`noul`: "file này có liên quan task không?") → `deny` file rõ ràng không liên quan. Cần `laya-serve` chạy nền để model nóng (~0.5 s/lần gọi; đây là server quyết định cục bộ, không phải proxy).
- **M – MCP only:** đăng ký `laya-router`, prompt nhắc dùng skill. Đối chứng cho ý tưởng gốc.

## 2. Luồng A/B

| Luồng | Cấu hình | Số lần |
|---|---|---|
| A | Claude Code thuần, model mặc định, đủ MCP | 3 |
| B1 | L1 | 3 |
| B2 | L1 + L2 | 3 |
| M | A + MCP `laya-router` | 1 |

Chung: cùng prompt (nguyên văn ADO), clone sạch tại parent commit của PR, `--max-turns 40`, `--permission-mode acceptEdits`, `--output-format json`.

## 3. Đo

- **Token/chi phí:** input, cache read, cache write, output từ `usage`; số tool schema + kích thước system prompt request đầu (từ transcript). Báo trung vị/min/max.
- **Đọc file:** số Read/Grep/Glob, tổng byte đọc, số lần L2 deny, và **deny sai** (file sau đó PR thật có sửa).
- **Chất lượng:** test pass; Jaccard tập file sửa so với PR; review mù diff (đúng / dùng được sau sửa nhỏ / sai).
- **Latency:** wall time, thời gian Laya trong launcher/hook.

## 4. Tiêu chí

B thắng nếu chi phí trung vị giảm ≥ 20–30% so với A, chất lượng không kém, L2 không deny file PR cần. Một task → chỉ kết luận "pilot further / drop".

## 5. Việc cần làm

1. `workflow/run_task.py`: thêm config `plain|launcher|launcher-hook|mcp`, `--base-commit`, `--run-index`.
2. `workflow/laya_launcher.py` (L1) + bảng ánh xạ intent; `workflow/hooks/laya_read_gate.py` (L2).
3. `workflow/ab_compare.py`: gom kết quả, so diff với `pr.diff`.

## 6. Cần từ bạn

ID task ADO + link PR + repo; lệnh chạy test; xác nhận quota (~10 phiên).
