# Plan 2 — Verdict từng bước có confidence (bảng điểm quyết định #1)

## Nó làm gì

Sau mỗi bước test, thay vì Claude tự ghi `status`, skill gọi Laya với hai chuỗi ngắn: `expected` (viết sẵn trong plan) và `actual` (Claude mô tả từ text trang hoặc `evaluate_script`). Laya trả `pass` / `fail` / `blocked` kèm confidence. Flow áp luật cứng:

| Kết quả Laya | Ghi vào results.json |
|---|---|
| confidence ≥ 0.85 | status như Laya trả, `verdictBy: "laya"` |
| 0.6 ≤ confidence < 0.85 | status như Laya trả, thêm `review: true` + lý do |
| confidence < 0.6 | `status: "review"`, Claude phải tự chấm và ghi `verdictBy: "model"` |

Claude vẫn có quyền ghi đè, nhưng phải ghi `override: true` kèm lý do. Report hiển thị cột "chấm bởi" và đánh dấu các bước `review`.

## Trước khi apply

Step 4 mục 4: Claude so `actual` với `expected` và ghi `status` ngay. Cơ chế kiểm soát duy nhất là mấy dòng "Rules of honest reporting" trong SKILL.md: đừng retry fail thành pass, blocked không phải fail. Tức là dựa hoàn toàn vào kỷ luật của model trong một lượt đang làm nhiều việc khác (vừa đọc trang, vừa chụp ảnh, vừa ghi file).

Hai vấn đề thực tế:

- Model thuần không có thước đo chắc chắn. "pass" khi text khớp 100% và "pass" khi text gần giống đều được ghi cùng một kiểu. QA đọc report không biết bước nào đáng xem lại.
- Lẫn lộn `blocked` và `fail` xảy ra khi message lỗi mơ hồ. Bảng phân loại ESS/D365 trong skill chỉ phủ các mã HTTP, không phủ message trên UI.

## Sau khi apply

```
bước xong ──► Claude ghi actual (1 câu) ──► laya_decide(expected, actual)
                                              ├─ ≥0.85 → ghi status, đi tiếp
                                              ├─ 0.6–0.85 → ghi status + review
                                              └─ <0.6 → Claude tự chấm, ghi verdictBy=model
```

- Bước rõ ràng (đa số): không tốn lượt model cho việc chấm, và lượt kế tiếp của Claude chỉ cần đọc một dòng kết quả.
- Bước mơ hồ: được đánh dấu rõ trong report, QA biết nhìn vào đâu.
- Có số đo: tỷ lệ bước `review`, tỷ lệ Claude override Laya. Hai con số này nói lên Laya có đáng giữ không.

Lưu ý: Claude vẫn phải viết `actual`. Laya chỉ bỏ phần so sánh, không bỏ phần quan sát. Lợi về token ở đây nhỏ hơn plan 1; lợi chính là **confidence và tính nhất quán**.

## Cách đo trước/sau

1. Dữ liệu có sẵn: mọi `results.json` trong `~/ess-test-runs/*/` đã có cặp `expected`/`actual`/`status`. Không cần đổi skill để thu thập.
2. Gán nhãn tay lại toàn bộ (đây là ground truth, không tin status cũ). Chạy Laya offline theo cách `triage/v2/eval.py`. So với rule đơn giản (actual chứa expected → pass) và với Haiku.
3. Vẽ confidence vs đúng/sai. Nếu đường cong không tách (ca sai có confidence cao như ca đúng) thì plan này dừng, vì luật ngưỡng vô nghĩa.
4. Chỉ khi tách được mới gắn vào skill và chạy cùng ticket, so tỷ lệ review / override.

## Việc cần làm

- [ ] `triage`-style script: `verdict/collect.py` gom expected/actual từ results.json; `verdict/eval.py` chạy Laya, rule, Haiku.
- [ ] Prompt/schema cho Laya: state = `{expected, actual}`, schema = enum `pass|fail|blocked`. Thử thêm `review` thành nhãn thứ tư xem có giúp không.
- [ ] Sửa Step 4 mục 4 SKILL.md và `build_report.mjs` (cột verdictBy, highlight review).
- [ ] Schema results.json thêm `verdictBy`, `confidence`, `review`, `override`.

## Rủi ro

- `actual` do Claude viết có thể "lái" theo expected (viết lại expected thành actual). Khi đó Laya chấm pass đúng theo input nhưng input đã sai. Giảm bằng cách bắt `actual` trích text trang nguyên văn (từ `evaluate_script`), không diễn giải.
- Dữ liệu ban đầu ít (vài run). Cần tích lũy qua ~10 run trước khi kết luận.
