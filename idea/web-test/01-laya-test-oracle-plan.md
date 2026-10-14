# Plan 01 — Laya Test Oracle / State Verification

## 1. Mục tiêu

Dùng Laya như một **micro-decision engine** để xác định nhanh một bước E2E đã đạt expected result hay chưa, thay vì bắt Claude phải tự reasoning cho mọi bước verification đơn giản.

Laya **không thay Claude trong việc hiểu ticket, tạo test plan hay phân tích bug**. Laya chỉ nhận một state nhỏ, có cấu trúc rõ ràng, rồi chọn một trong số ít kết quả cố định.

---

## 2. Use case

Ví dụ test case:

> Expected: Sau khi submit leave request, hiển thị toast `Leave request submitted` và request có status `Pending`.

Browser state sau action:

```json
{
  "expected": "Toast says 'Leave request submitted' and request status is Pending",
  "observed": [
    "Leave request submitted successfully",
    "Status: Pending"
  ],
  "url": "/leave/requests/123",
  "loading": false
}
```

Laya quyết định:

```text
PASS
FAIL
NOT_READY
AMBIGUOUS
```

Kèm confidence/score để quyết định có cần Claude kiểm tra lại hay không.

---

## 3. BEFORE — Web-test hiện tại

Flow hiện tại về cơ bản:

```text
Browser action
    ↓
wait for UI
    ↓
read page text / small state
    ↓
Claude compares Actual vs Expected
    ↓
Claude decides PASS / FAIL / continue
```

Trong skill hiện tại, việc verify thuộc execution loop; skill cũng đã yêu cầu chỉ lấy state cần thiết và tránh snapshot thừa để giảm token. `navigate_page` và snapshot có thể tạo context cost đáng kể. fileciteturn0file0L138-L148

### Vấn đề

- Claude phải thực hiện rất nhiều micro-verification.
- Mỗi verification có thể tạo thêm model turn hoặc reasoning.
- Nhiều quyết định là classification đơn giản, lặp lại.
- Cost/latency tăng theo số step.

---

## 4. AFTER — Có Laya

```text
Browser action
    ↓
wait until stable
    ↓
extract compact observed state
    ↓
Laya
    ├── PASS
    ├── FAIL
    ├── NOT_READY
    └── AMBIGUOUS
            ↓
    high confidence?
       ├─ YES → continue
       └─ NO  → Claude verifies
```

Claude vẫn là fallback cho các case khó.

### Nguyên tắc

- Rule-based checks vẫn được ưu tiên khi có thể.
- Laya chỉ xử lý semantic verification.
- Confidence thấp không được phép tự động kết luận.
- Không cho Laya xem raw DOM lớn.

---

## 5. Cách apply vào skill

### A. Tạo một local verifier service

Ví dụ:

```text
laya-verifier
POST /verify
```

Input tối thiểu:

```json
{
  "expected": "...",
  "observed": ["..."],
  "context": "leave-request-submit"
}
```

Output:

```json
{
  "decision": "PASS",
  "confidence": 0.96
}
```

### B. Chèn verifier vào execution loop

Hiện tại skill:

```text
Act → Wait → Observe → Claude verifies → Record result
```

Sau khi tích hợp:

```text
Act → Wait → Compact Observe → Laya Verify
                                  │
                                  ├─ high confidence → Record result
                                  └─ low confidence → Claude Verify
```

### C. Compact observation extractor

Không truyền toàn bộ DOM.

Chỉ lấy:

- expected text hiện diện hay không
- target value
- toast/message
- relevant row/cell
- current URL
- loading/error indicators
- một số field explicitly named trong AC

---

## 6. Khi nào Laya được dùng?

### Dùng Laya

- text/state matching
- simple business-state verification
- success/failed state classification
- UI state readiness
- simple form-result verification

### Không dùng Laya

- visual judgement
- complex root cause analysis
- multi-page reasoning
- ambiguous business rules
- requirement interpretation

---

## 7. Fallback policy

```text
confidence >= threshold
    → accept Laya decision

confidence < threshold
    → Claude review

unsupported state
    → Claude review
```

Đề xuất ban đầu:

```text
PASS / FAIL auto-accept: chỉ khi confidence cao
NOT_READY / AMBIGUOUS: ưu tiên Claude fallback
```

Threshold phải được benchmark bằng dữ liệu thật, không hard-code theo cảm tính.

---

## 8. Benchmark plan

Lấy các execution logs cũ của web-test và tạo dataset:

```text
expected
actual
final human/Claude verdict
```

Đo:

1. Exact accuracy
2. False-pass rate
3. False-fail rate
4. Uncertain rate
5. Laya latency
6. Claude turns saved
7. Tokens saved

### Safety metric quan trọng nhất

**False PASS phải cực thấp.**

Một false PASS nguy hiểm hơn nhiều false FAIL vì có thể khiến bug lọt qua.

---

## 9. Success criteria

PoC được xem là có giá trị khi:

- Laya đạt accuracy đủ cao trên các micro-verification đã chọn.
- False PASS gần 0 hoặc nằm dưới ngưỡng chấp nhận được.
- Có measurable reduction về Claude turns/tokens.
- Không làm flow test chậm hơn đáng kể.
- Các case khó vẫn được Claude xử lý bình thường.

---

## 10. Kỳ vọng thực tế

Đây là use case **an toàn nhất để PoC đầu tiên** vì output space nhỏ, input compact và decision boundary dễ kiểm soát.

Mục tiêu không phải “Laya giỏi hơn Claude tổng thể”.

Mục tiêu là:

> **Laya làm tốt hơn việc repetitive verification đơn giản vì nó được chuyên môn hóa cho đúng decision.**
