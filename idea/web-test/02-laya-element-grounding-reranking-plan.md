# Plan 02 — Laya Element Grounding / Candidate Reranking

## 1. Mục tiêu

Dùng Laya để chọn **đúng browser element từ một tập candidate nhỏ**, thay vì để Claude phải đọc và reasoning trên nhiều DOM elements mỗi lần cần click/fill/select.

Đây là hướng có tiềm năng lớn về **token saving**, vì browser observation/snapshot trong web-test có thể rất tốn context.

Skill hiện tại đã ghi nhận `navigate_page` và snapshot tạo context cost đáng kể, đồng thời khuyến nghị snapshot có chọn lọc. fileciteturn0file0L138-L143

---

## 2. Use case

Instruction:

```text
Click Submit
```

Browser có candidate elements:

```text
A. Cancel
B. Save Draft
C. Submit
D. Submit & Continue
E. Delete
```

Laya chọn:

```text
C
```

hoặc:

```json
{
  "candidate": "C",
  "confidence": 0.94
}
```

Có thêm option `NONE` khi không có candidate phù hợp.

---

## 3. BEFORE — Web-test hiện tại

```text
User intent / test action
        ↓
Claude receives page state / snapshot
        ↓
Claude identifies target element
        ↓
Claude clicks/fills/selects
```

### Vấn đề

- DOM/page snapshot có thể rất lớn.
- Nhiều elements không liên quan.
- Claude phải làm grounding reasoning lặp lại.
- Candidate có thể nhiều và dễ gây nhầm.
- Snapshot được lặp lại ở nhiều step.

---

## 4. AFTER — Có Laya

Architecture đề xuất:

```text
Browser DOM
    ↓
Deterministic candidate extraction
    ↓
5–15 relevant candidates
    ↓
Laya semantic ranking
    ↓
Best candidate / NONE
    ↓
Browser action
```

Claude chỉ cần đưa task intent hoặc action goal cho controller.

### Critical rule

**Không đưa toàn bộ DOM vào Laya.**

Laya chỉ nhận candidate set đã được prune.

---

## 5. Cách apply vào skill

### A. Candidate extractor

Từ browser state, local controller trích:

- element UID/ref
- role
- visible text
- aria-label
- placeholder
- name
- nearby label
- enabled/disabled
- visible/hidden

Ví dụ:

```json
[
  {
    "id": "17",
    "role": "button",
    "text": "Submit",
    "enabled": true
  },
  {
    "id": "18",
    "role": "button",
    "text": "Save Draft",
    "enabled": true
  }
]
```

### B. Deterministic pre-filter

Filter trước bằng rule:

- hidden → remove
- disabled nếu action yêu cầu active → remove
- wrong role → remove
- exact text match → boost
- explicit aria-label match → boost

Chỉ giữ khoảng 5–15 candidates.

### C. Laya reranking

Input:

```text
Goal: click Submit
Candidates:
1. Cancel
2. Save Draft
3. Submit
4. Submit & Continue
```

Output:

```text
3
0.94
```

### D. Safety guard

Nếu:

```text
confidence < threshold
```

hoặc có nhiều candidates quá giống nhau:

```text
→ Claude fallback
```

---

## 6. Đặc biệt phù hợp với workflow hiện tại

Skill đã quy định:

- ưu tiên snapshot UIDs/refs thay vì coordinates
- snapshot chỉ khi cần UID
- reuse UID khi page chưa thay đổi
- tránh đọc lại toàn bộ DOM. fileciteturn0file0L138-L143

Laya có thể trở thành layer semantic đứng giữa **candidate extraction** và **browser action**.

---

## 7. BEFORE vs AFTER

### BEFORE

```text
Page
 ↓
large snapshot
 ↓
Claude
 ↓
find element
 ↓
action
```

### AFTER

```text
Page
 ↓
local extraction
 ↓
candidate pruning
 ↓
Laya
 ↓
selected UID
 ↓
action
```

Điểm khác biệt lớn nhất:

> Claude không còn phải consume toàn bộ DOM chỉ để tìm một button/input.

---

## 8. Benchmark plan

Từ các web-test runs, tạo dataset:

```text
instruction
candidate elements
correct element
```

Đo:

1. Top-1 accuracy
2. Top-3 recall
3. NONE accuracy
4. False selection rate
5. Laya latency
6. Snapshot tokens before/after
7. Claude turns before/after

### Safety metric

**Wrong click rate.**

Wrong click vào action nguy hiểm như Approve / Reject / Delete có thể gây side effect.

Do đó PoC đầu tiên nên chỉ chạy trên read-only hoặc low-risk actions:

```text
Open
Search
Filter
Next page
Select tab
Expand section
```

Sau đó mới mở rộng sang submit/write actions.

---

## 9. High-cardinality rule

Nếu candidate > 15–20:

```text
Do not send all candidates to Laya.
```

Thay vào đó:

```text
DOM
 ↓
role/text/attribute filtering
 ↓
small candidate set
 ↓
Laya
```

Nếu vẫn ambiguous:

```text
→ Claude fallback
```

Điều này phù hợp với hướng nghiên cứu web-agent hiện nay: candidate pruning/grounding được dùng để giảm search space trước khi planner/LLM xử lý.

---

## 10. Success criteria

PoC có giá trị khi:

- Top-1 accuracy cao trên candidate sets đã được prune.
- Wrong click gần 0 trên safe actions.
- Giảm đáng kể lượng DOM context đưa vào Claude.
- Không làm browser control chậm hơn.
- Laya failure có fallback về Claude.

---

## 11. Kỳ vọng thực tế

Đây là use case mình đánh giá **có tiềm năng token-saving lớn nhất** trong ba plan.

Điểm quan trọng là không dùng Laya như “browser agent nhỏ”.

Hãy dùng nó như:

> **semantic reranker cho một candidate set nhỏ đã được local controller prune.**
