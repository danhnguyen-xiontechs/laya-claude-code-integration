# Task thật đầu tiên: thêm `--json` cho `proxy/router_log.py` (2026-10-05)

Task (`task.txt`): thêm cờ `--json` in tóm tắt theo session dưới dạng mảng JSON, giữ nguyên đầu ra mặc định, tự kiểm tra bằng file mẫu rồi xóa file mẫu. Mỗi cấu hình chạy trong một bản sao riêng của repo, luồng chính Sonnet (trừ baseline). **Mỗi cấu hình chỉ chạy một lần; nhãn đúng/sai là việc của bạn.**

| Cấu hình | Model từng bước | Luồng chính | Diff | Đơn vị chi phí* | Thời gian |
|---|---|---|---|---|---|
| `static` | explore=haiku, plan=opus, implement=sonnet, verify=haiku, review=sonnet | Sonnet, 11 lượt | +13 −1 | 788 | 271 s |
| `laya` | explore=sonnet (p 0.45), plan=sonnet (0.49), **implement=opus (0.45)**, verify=sonnet (0.49), review=sonnet (0.55) | Sonnet, 11 lượt | +16 −1 | 667 | 148 s |
| `baseline` | một luồng Opus, không workflow | Opus, 7 lượt | +11 −2 | **285** | **71 s** |

\*Giả định giá haiku:sonnet:opus = 1:3:5, output 5x, cache đọc 0.1x, cache ghi 1.25x. Chỉ để so tương đối, không phải số quota thật.

## Điều đã thấy (chưa cần bạn review mới nói được)

- **Chia bước đắt hơn một luồng Opus trên task này:** 667–788 so với 285 đơn vị, và chậm gấp 2–4 lần. Luồng chính (điều phối) tốn khoảng 280 đơn vị mỗi lần, gần bằng cả baseline.
- **Laya gần như hòa ba lựa chọn ở mọi bước** (p 0.45–0.55). Nó chọn Sonnet cho 4 bước và Opus cho bước sửa code với xác suất 0.45, nên đây là quyết định yếu.
- **Hook của Laya mất 1.8–4.7 s mỗi lần** (brief dài, CPU bận), cao hơn đo riêng.
- **Lần chạy `laya` đầu tiên bị loại** (`laya-run1-timeouts/`): 3 trong 5 lần gọi Laya quá giờ 3 s, hook im lặng bỏ qua nên các bước đó chạy bằng Sonnet mặc định. Đã chạy lại với `LAYA_TIMEOUT=15`. Báo cáo giờ có cảnh báo khi xảy ra chuyện này.

## Việc của bạn (ground truth)

Đọc `static/final.diff`, `laya/final.diff`, `baseline/final.diff` và điền `review.md` trong mỗi thư mục: model từng bước đủ / thừa / thiếu, và diff có dùng được không. Ba diff cùng một task nên đối chiếu được ngay. Chưa có gì ở đây cho biết model rẻ hơn ở bước nào đã làm kém.

Tệp: `static|laya|baseline/{report.md, review.md, final.diff, result.json}`.
