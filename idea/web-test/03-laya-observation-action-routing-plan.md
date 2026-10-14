# Plan 03 — Laya Observation / Action Routing

## 1. Mục tiêu

Dùng Laya như một **control-plane decision engine** để chọn bước tiếp theo trong execution loop của web-test.

Ví dụ:

```text
WAIT
ACT
VERIFY
DIAGNOSE
RETRY
STOP
```

Thay vì Claude phải tự reasoning cho các micro-decision lặp lại sau mỗi browser action.

---

## 2. Use case

Ví dụ sau khi click Submit:

```text
Last action: click Submit
Spinner: visible
Toast: none
Network: request pending
Expected: request submitted
```

Laya:

```text
WAIT
0.97
```

Sau khi chờ:

```text
Spinner: gone
Toast: none
Network: 500
Expected: success
```

Laya:

```text
DIAGNOSE
0.99
```

---

## 3. BEFORE — Web-test hiện tại

Trong execution loop hiện tại, Claude phải:

```text
Act
 ↓
Wait for UI
 ↓
Inspect state
 ↓
Decide what to do next
 ↓
Maybe snapshot
 ↓
Maybe verify
 ↓
Maybe inspect network
 ↓
Maybe retry
 ↓
Continue
```

Skill đã có các rule khá rõ về khi nào wait, khi nào lấy evidence, khi nào diagnostics, và khi nào retry. fileciteturn0file0L138-L148 fileciteturn0file0L151-L165

Nhưng những quyết định này vẫn có thể lặp hàng chục lần trong một run.

---

## 4. AFTER — Có Laya

```text
Browser action
     ↓
compact observation
     ↓
Laya action router
     ↓
┌─────────────┐
│ WAIT        │
│ ACT         │
│ VERIFY      │
│ DIAGNOSE    │
│ RETRY       │
│ STOP        │
└─────────────┘
     ↓
controller executes next action
```

Claude được gọi khi:

- state ambiguous
- confidence thấp
- cần reasoning mới
- cần root cause analysis
- cần thay đổi kế hoạch

---

## 5. Các decision nên giao cho Laya

### A. WAIT or continue

Input:

```text
loading = true
request = pending
expected text = absent
```

Output:

```text
WAIT
```

### B. VERIFY or ACT

Nếu expected state đã xuất hiện:

```text
VERIFY
```

Nếu chưa:

```text
ACT
```

### C. DIAGNOSE

Nếu page đã ổn định nhưng có error:

```text
DIAGNOSE
```

### D. RETRY

Nếu failure có dấu hiệu transient:

```text
RETRY
```

Nếu failure là deterministic business error:

```text
DO_NOT_RETRY
```

### E. STOP

Nếu test đã đủ evidence:

```text
STOP
```

---

## 6. Cách apply vào skill

### A. Tạo compact state schema

Ví dụ:

```json
{
  "lastAction": "click Submit",
  "loading": false,
  "expectedPresent": false,
  "errorVisible": true,
  "httpStatus": 500,
  "requestPending": false,
  "previousAttempts": 1,
  "pageChanged": true
}
```

### B. Gọi Laya sau mỗi significant browser action

Không phải mọi tool call đều cần Laya.

Chỉ gọi sau:

- click
- fill + submit
- navigation
- wait timeout
- error state
- unexpected page state

### C. Map decision → tool

Ví dụ:

```text
WAIT
→ wait_for / find

VERIFY
→ compact state extraction

DIAGNOSE
→ network + console diagnostics

RETRY
→ execute same action once

STOP
→ record result / move case
```

### D. Claude escalation

```text
if confidence < threshold:
    call Claude
```

Claude nhận compact state, không cần nhận toàn bộ history nếu không cần.

---

## 7. BEFORE vs AFTER

### BEFORE

```text
Browser
 ↓
Claude
 ↓
reason
 ↓
choose next step
 ↓
tool
 ↓
Claude
 ↓
reason again
```

### AFTER

```text
Browser
 ↓
compact state
 ↓
Laya
 ↓
next micro-action
 ↓
browser

            ↘ ambiguous
              ↓
            Claude
```

Mục tiêu là biến Claude từ:

> “controller của mọi browser step”

thành:

> “high-level planner + escalation handler”.

---

## 8. Không dùng Laya để thay thế deterministic rules

Skill hiện tại đã có những rule deterministic rất tốt:

```text
429 / D365 throttling → blocked
401 claims challenge → blocked
502/503/504 → blocked
400 invalid business input → fail
500 → fail
```

fileciteturn0file0L151-L158

Không nên đưa các rule rõ ràng này cho Laya.

Architecture nên là:

```text
Deterministic rule
      ↓
known case?
 ├─ YES → execute rule
 └─ NO  → Laya semantic routing
              ↓
         ambiguous?
              ↓
            Claude
```

---

## 9. Benchmark plan

Dataset:

```text
state before decision
correct next action
```

Nguồn dữ liệu:

- execution logs
- failed runs
- manual replay
- Claude traces

Đo:

1. Action-routing accuracy
2. Wrong-action rate
3. Retry precision
4. Unnecessary-wait rate
5. Unnecessary-diagnose rate
6. Laya latency
7. Claude turns saved
8. Tokens saved

### Safety metric

Không được để Laya tự thực hiện write action chỉ vì confidence cao.

Các action có side effect vẫn phải đi qua existing write-action gate của skill. Skill hiện tại đã yêu cầu xin OK trước các submit/approve/reject/cancel/upload/edit actions vì chúng tác động vào shared D365. fileciteturn0file0L92-L96

---

## 10. Success criteria

PoC được xem là đạt khi:

- Laya phân loại tốt các state lặp lại.
- giảm số lần Claude phải quyết định bước tiếp theo.
- giảm wait/snapshot/diagnostic thừa.
- không làm tăng false retry hoặc wrong action.
- các state khó vẫn escalation lên Claude.

---

## 11. Kỳ vọng thực tế

Đây là use case biến Laya thành **System 1 control layer** cho web-test.

Nó phù hợp nhất khi decision set nhỏ và ổn định:

```text
WAIT / VERIFY / DIAGNOSE / RETRY / STOP
```

Không nên dùng Laya để lập kế hoạch end-to-end hoặc tự suy luận root cause.

Mục tiêu là:

> **Laya xử lý phản xạ lặp lại; Claude xử lý reasoning mới.**
