# Kết quả A/B #1697: Context & Tool Pruning bằng Laya, không proxy (2026-10-06)

Task: pxp-ai bug #1697 (PR4854). Model Opus 5.5 ở mọi cấu hình, 5 lần chạy mỗi cấu hình, xen kẽ theo vòng. Bảng đầy đủ: [COMPARE.md](COMPARE.md).

| Cấu hình | Context cố định (tool / MCP / slash) | Token context lượt đầu | $ trung vị (min–max) | Thời gian trung vị | **Hành vi PASS** |
|---|---|---|---|---|---|
| plain (Claude Code thuần) | 42 / 5 / 179 | ~23.8k | 0.829 (0.557–1.106) | 127 s | 2/5 |
| **launcher (L1)** | **6 / 0 / 0** | **~11.0k** | 0.762 (0.701–0.894) | 201 s | **5/5** |
| launcher-gate (L1 + L2) | 6 / 0 / 0 | ~11.0k | 0.711 (0.596–0.822) | 164 s | 0/5 |
| mcp (MCP laya-router) | 42 / 5 / 179 | ~23.8k | 0.730 (0.480–0.830) | 135 s | 0/5 |

"Hành vi" = `semantic_check.py`: agent kết quả có quy tắc loại trừ rubric bằng cụm mà classifier quét (`NOT for:` / `MUST NOT` / `Non-examples`), agent rubric không tự loại. Kiểm chứng: code gốc fail, PR thật pass. Mọi lần chạy: test của agent pass, test gốc (hồi quy) 4/4, sửa đúng 4 file của PR. 14 test của PR: 0/14 ở mọi lần (khóa câu chữ của PR, chỉ tham khảo).

## Phát hiện

1. **L1 cắt được context thật:** context cố định lượt đầu giảm từ ~23.8k xuống ~11.0k token (−54%), mỗi lượt sau đó đều đọc lại phần này từ cache. Không đổi model, không phá cache.
2. **L1 không làm rẻ hơn rõ rệt trên task này:** trung vị $0.762 so với $0.829, khoảng min–max chồng nhau. Phiên L1 dài hơn (26–28 lượt, output nhiều hơn), ăn mất phần tiết kiệm từ context.
3. **L1 có chất lượng tốt nhất (5/5 so với 2/5).** Giả thuyết, chưa chứng minh: không có 179 lệnh BMad/skill và connector, agent tập trung đọc `prompts/intent_classifier.system.v1.md` nhiều hơn (5–10 lần nhắc tới so với 2–6 ở plain), và chính file này cho biết cụm nào classifier nhận. n=5, một task.
4. **L2 (Laya chặn Read) gây hại: 0/5.** Hook chặn `intent_classifier.system.v1.md` (p 0.105) và `master_agent.py` (p 0.136) ở cả 5 lần, đúng hai file cần để chẩn đoán. Laya không tách được file liên quan: file PR 0.21–0.26, `payment.py` không liên quan 0.21. Không chặn file nào của PR, nhưng chặn file nền tảng. **Bỏ L2.**
5. **MCP-only không giúp gì: 0/5.** Agent gọi `laya_decide` đúng 1 lần mỗi phiên khi được nhắc, nhưng không thay đổi tool/context đã gửi. Kết quả còn kém plain (có thể do lời nhắc làm lệch hướng; n nhỏ).

## Kết luận tạm

- **Pilot further cho L1** (launcher chọn tool/MCP/skill theo intent trước phiên). Cần thêm task (đặc biệt task không phải bugfix) và đo khi model khác nhau.
- **Drop L2 và MCP-only** trong dạng hiện tại.
- Laya ở L1 chỉ phân loại 1 câu (bugfix, p 0.60–0.63). Cùng hiệu quả có thể đạt bằng một profile tĩnh `--tools ... --strict-mcp-config --disable-slash-commands`; giá trị riêng của Laya chỉ thể hiện khi có nhiều loại task cần profile khác nhau. Chưa test.

## Giới hạn

Một task, n=5/cấu hình, nhãn "hành vi" là thước đo do mình đặt (chưa chạy routing live trên Azure). Review mù 20 diff đang chờ (`review/`, chỉ có ở local).
