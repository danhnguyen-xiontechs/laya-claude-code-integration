# Laya ADO Task Classification — Scope Update v2

**Ngày:** 2026-10-07  
**Trạng thái:** Research / POC  
**Mục tiêu của thay đổi:** Thu nhỏ scope của plan ADO classification để phản ánh đúng workflow thực tế khi developer được giao **một task**, thay vì bắt đầu bằng bài toán batch classification 50–2000 work item.

---

## 1. Thay đổi scope

Plan trước tập trung vào việc lấy một dataset lớn từ ADO rồi benchmark Laya, TF-IDF và Claude Haiku.

Scope mới bắt đầu nhỏ hơn:

```text
Developer được giao 1 ADO task
        ↓
Tool fetch task từ ADO
        ↓
Scan source code để tạo candidate module list
        ↓
Laya đọc Title + Description
        ↓
Laya chọn:
  - Area / Module
  - Type
  - Confidence
        ↓
Claude Code dùng kết quả để tiếp tục coding
```

Mục tiêu của phase này không phải chứng minh Laya đã đủ chính xác trên toàn bộ project.

Mục tiêu trước mắt là xác định:

> **Laya có phù hợp để làm một bước classification nhỏ, cố định label, nằm ngay trước workflow coding hay không?**

Đây vẫn là bài toán decision engine, nhưng được thu nhỏ về một workflow có thể chạy thật trên **một task**.

---

## 2. Vì sao scope này thực tế hơn

Laya không phải model để tự khám phá toàn bộ project.

Nó cần một tập lựa chọn đã được định nghĩa trước:

```text
Task
  ↓
Laya
  ↓
chọn 1 option trong danh sách có sẵn
```

Ví dụ:

```text
Area options:
- Employee
- Payroll
- Attendance
- Leave
- Authentication
- ...

Type options:
- Bug
- Feature
- Task
- Enhancement
```

Vì vậy câu hỏi quan trọng không phải:

> “Laya có tự biết project có những module nào không?”

mà là:

> “Ta có thể tạo candidate options từ project hiện tại một cách tự động hay không?”

Scope mới giải quyết việc này bằng cách **scan source code trước**, sau đó dùng kết quả scan để tạo `options.json`.

---

# 3. Architecture của POC

```text
                 ┌──────────────────────┐
                 │      ADO Task        │
                 │                      │
                 │ Title                │
                 │ Description          │
                 │ Work item metadata   │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │  ADO Fetcher         │
                 │                      │
                 │ fetch 1 task         │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ Source Code Scanner  │
                 │                      │
                 │ detect modules       │
                 │ namespaces           │
                 │ projects/folders     │
                 │ controllers/services │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ project-options.json │
                 │                      │
                 │ Area candidates      │
                 │ Type candidates      │
                 └──────────┬───────────┘
                            │
                 ┌──────────┴───────────┐
                 │                      │
                 ▼                      ▼
          Title + Description      Candidate options
                 │                      │
                 └──────────┬───────────┘
                            ▼
                       ┌────────┐
                       │  Laya  │
                       └────┬───┘
                            │
                            ▼
                Area + Type + Confidence
                            │
                            ▼
                      Claude Code
                            │
                            ▼
                     Coding workflow
```

---

# 4. Source code scan để tạo module list

## 4.1 Vì sao cần bước này

Laya không thể nhận:

```text
"Which module is this task about?"
```

rồi tự invent:

```text
Employee
Payroll
Leave
...
```

Nó cần danh sách lựa chọn cụ thể.

POC sẽ lấy danh sách này từ source code hiện tại.

Ví dụ project .NET:

```text
src/
├── Employee/
├── Payroll/
├── Attendance/
├── Leave/
├── Authentication/
└── Notification/
```

hoặc project có dạng:

```text
Company.ESS.Employee
Company.ESS.Payroll
Company.ESS.Attendance
Company.ESS.Leave
Company.ESS.Authentication
```

Scanner có thể phát hiện các candidate module dựa trên:

- top-level project/folder
- namespace
- assembly/project name
- controller/service grouping
- các convention đặc trưng của project

POC ban đầu **không cần giải quyết hoàn hảo việc module detection**.

Mục tiêu chỉ là tạo được một candidate list đủ hợp lý để đưa cho Laya.

---

# 5. Output của source scanner

Ví dụ:

```json
{
  "project": "ESS",
  "areas": [
    {
      "id": "employee",
      "label": "Employee",
      "description": "Employee profile, personal information and employee management"
    },
    {
      "id": "payroll",
      "label": "Payroll",
      "description": "Salary, payslip and compensation related functionality"
    },
    {
      "id": "attendance",
      "label": "Attendance",
      "description": "Attendance, working hours, check-in and check-out"
    },
    {
      "id": "leave",
      "label": "Leave",
      "description": "Leave request, approval, balance and leave history"
    }
  ],
  "types": [
    {
      "id": "bug",
      "label": "Bug",
      "description": "Existing behavior is incorrect or not working as expected"
    },
    {
      "id": "feature",
      "label": "Feature",
      "description": "A new capability or user-facing behavior needs to be implemented"
    },
    {
      "id": "task",
      "label": "Task",
      "description": "A technical or implementation task that is not primarily a bug or new product feature"
    }
  ]
}
```

### Important

Source scanner chỉ giúp tạo **candidate list**.

Nó không quyết định task thuộc module nào.

Quyết định vẫn do Laya thực hiện.

---

# 6. Một task thực tế

Ví dụ developer được giao:

```text
ADO #1234

Title:
Fix employee image upload for large files

Description:
Users cannot upload profile images larger than 5MB.
The API returns 413 when the uploaded image is larger than
the configured limit. The expected behavior is to accept the
image and process it through the existing image storage flow.
```

Tool sẽ fetch task:

```json
{
  "id": 1234,
  "title": "Fix employee image upload for large files",
  "description": "Users cannot upload profile images..."
}
```

Sau đó scanner cung cấp:

```text
AREA OPTIONS

Employee
Payroll
Attendance
Leave
Authentication
Notification
```

và:

```text
TYPE OPTIONS

Bug
Feature
Task
```

Laya nhận cả task text và candidate options.

---

# 7. Laya output

Ví dụ:

```json
{
  "area": {
    "label": "Employee",
    "confidence": 0.94
  },
  "type": {
    "label": "Bug",
    "confidence": 0.98
  }
}
```

Có thể giữ thêm toàn bộ probabilities:

```json
{
  "area": {
    "winner": "Employee",
    "probabilities": {
      "Employee": 0.94,
      "Payroll": 0.02,
      "Attendance": 0.01,
      "Leave": 0.01,
      "Authentication": 0.01,
      "Notification": 0.01
    }
  },
  "type": {
    "winner": "Bug",
    "probabilities": {
      "Bug": 0.98,
      "Feature": 0.01,
      "Task": 0.01
    }
  }
}
```

## Confidence

Confidence **không nên hiểu là “xác suất task chắc chắn đúng 94%”** ngay từ đầu.

Ở POC:

```text
confidence = probability của option đứng đầu
```

Sau này mới cần benchmark/calibration để xem:

```text
confidence >= 0.90
```

thực sự tương ứng với tỷ lệ đúng gần 90% hay không.

---

# 8. Description quá dài xử lý thế nào?

Đây là một phần cần test riêng của POC.

Laya có context hữu hạn; không nên giả định rằng một ADO description dài vài nghìn token sẽ được giữ nguyên.

Scope ban đầu dùng pipeline:

```text
Title
+
Description
    ↓
normalize
    ↓
truncate / extract
    ↓
Laya
```

Ưu tiên thử theo thứ tự:

### Strategy A — Title + đầu description

```text
Title
+
first N tokens/chars of Description
```

Đây là baseline đơn giản nhất.

### Strategy B — Extract phần có giá trị

Nếu ADO description có cấu trúc:

```text
Description
Expected
Actual
Reproduction steps
Acceptance criteria
```

thì ưu tiên giữ những section quan trọng thay vì chỉ lấy đầu document.

### Strategy C — Summary bằng LLM

Chưa làm ở scope này.

Lý do:

```text
Long description
    ↓
LLM summarize
    ↓
Laya classify
```

sẽ làm mất một phần lợi ích của Laya local/cheap.

POC trước mắt cần xem Laya có đủ tốt với preprocessing đơn giản hay không.

---

# 9. Không dùng Laya thì workflow là gì?

Đây là baseline thực tế để so sánh.

```text
ADO task
   ↓
Claude Code đọc title + description
   ↓
Claude tự suy luận
   ↓
Area = Employee
Type = Bug
```

Claude có thể được yêu cầu tự trả:

```text
Area: Employee
Type: Bug
Confidence: 92%
```

nhưng confidence này là **self-reported confidence của LLM**, không phải classifier probability đã được calibration.

Do đó POC có thể so:

```text
Baseline:
Claude reasoning

vs

Laya:
fixed-label classifier
```

Quan tâm tới:

- đúng label hay không
- thời gian
- chi phí/quota
- confidence có hữu ích để quyết định "auto / review" hay không

---

# 10. Vai trò của Claude Code sau khi Laya classify

Laya không thay Claude Code.

Laya chỉ enrich task:

```text
ADO
 ↓
Laya
 ↓
Area = Employee
Type = Bug
Confidence = 0.94
 ↓
Claude Code
```

Claude Code có thể dùng metadata đó để bắt đầu coding:

```text
Task:
Fix employee image upload

Area:
Employee

Type:
Bug
```

Sau đó Claude mới làm phần khó:

```text
find relevant code
↓
inspect controller/service
↓
trace API
↓
understand bug
↓
implement fix
↓
run tests
```

Đây là boundary phù hợp với Laya:

```text
Laya:
"Task này thuộc nhóm nào?"

Claude:
"Vậy tôi phải sửa code thế nào?"
```

---

# 11. POC scope

## Phase 1 — Scan project

Build một script:

```text
scan_project.py
```

Input:

```text
repo path
```

Output:

```text
project-options.json
```

Yêu cầu tối thiểu:

- detect project/folder/module candidates
- loại bỏ folder không liên quan
- normalize tên
- tạo `id`
- tạo description ngắn cho mỗi candidate nếu có thể suy ra từ naming convention

Không cần đảm bảo 100% module mapping ngay từ đầu.

---

## Phase 2 — Fetch 1 ADO task

Build:

```text
fetch_ado_task.py
```

Input:

```text
ADO work item ID
```

Output:

```json
{
  "id": 1234,
  "title": "...",
  "description": "..."
}
```

---

## Phase 3 — Laya classification

Build:

```text
classify_task.py
```

Input:

```text
ADO task
+
project-options.json
```

Output:

```json
{
  "area": {
    "label": "Employee",
    "confidence": 0.94
  },
  "type": {
    "label": "Bug",
    "confidence": 0.98
  }
}
```

---

## Phase 4 — Claude Code integration

Prototype một command/skill:

```text
/ado-classify <work-item-id>
```

Workflow:

```text
/ado-classify 1234
      ↓
fetch ADO
      ↓
load project-options.json
      ↓
Laya
      ↓
print classification
```

Ví dụ output:

```text
ADO #1234

Area: Employee       (0.94)
Type: Bug             (0.98)

→ Classification confidence: HIGH
```

Sau đó Claude Code có thể tiếp tục task với metadata này.

---

# 12. Chưa làm trong scope này

Chưa làm:

- 50 hoặc 200 ADO items
- dataset 500–2000 items
- TF-IDF benchmark
- Claude Haiku benchmark lớn
- fine-tune Laya
- shadow pilot
- tự động ghi Area/Type ngược vào ADO
- tự động thay đổi workflow coding dựa trên confidence
- tự động generate module description hoàn hảo
- cố giải quyết module mapping cho mọi repository type

Những phần này chỉ quay lại sau khi POC một-task chứng minh workflow có ý nghĩa.

---

# 13. Tiêu chí đánh giá POC

Không cần dùng metric phức tạp ngay lập tức.

Với một task thực tế, kiểm tra:

### 1. Option quality

Source scanner có tạo ra danh sách module hợp lý không?

```text
YES / NO
```

### 2. Classification quality

Laya có chọn module/type mà developer thực tế mong đợi không?

```text
Area: PASS / FAIL
Type: PASS / FAIL
```

### 3. Confidence usefulness

Ví dụ:

```text
0.95 → có đúng không?
0.51 → có phải ambiguous không?
```

Mục tiêu là xem confidence có thể dùng làm:

```text
HIGH confidence
    → auto suggestion

LOW confidence
    → Claude / human review
```

### 4. Latency

Đo:

```text
fetch ADO
+
preprocess
+
Laya
```

### 5. Coding usefulness

Quan trọng nhất:

> Classification có giúp Claude Code bắt đầu task với context tốt hơn không?

Nếu Area/Type chỉ là metadata vô nghĩa và không thay đổi workflow coding, Laya không mang lại nhiều giá trị.

---

# 14. Success criteria sau POC

POC được xem là đáng mở rộng nếu:

```text
1. Source scanner tạo được candidate list đủ tốt
2. Laya classify đúng task mẫu
3. Confidence có khả năng dùng để gate
4. Latency đủ nhỏ để gọi mỗi task
5. Classification thực sự hữu ích cho Claude Code workflow
```

Sau đó mới cân nhắc mở rộng:

```text
1 task
   ↓
10 tasks
   ↓
50 tasks
   ↓
real dataset
   ↓
benchmark / fine-tune
```

Đây là cách giảm rủi ro so với việc ngay từ đầu xây cả pipeline dataset lớn.

---

# 15. Kết luận

Scope mới giữ nguyên ý tưởng cốt lõi của research:

> **Dùng Laya cho những decision nhỏ, có option cố định, mà hiện tại một LLM lớn hoặc developer đang phải tự suy luận.**

Nhưng thay vì bắt đầu bằng:

```text
500–2000 ADO items
        ↓
benchmark
        ↓
fine-tune
```

POC bắt đầu bằng:

```text
Source code
    ↓
generate candidate modules
    ↓
1 ADO task
    ↓
Laya
    ↓
Area + Type + Confidence
    ↓
Claude Code
```

Điểm cần chứng minh trước tiên không phải là **“Laya có classification accuracy bao nhiêu % trên toàn bộ công ty?”**

Mà là:

> **“Một workflow như vậy có thực sự hữu ích trong lúc tôi đang code hay không?”**

Nếu câu trả lời là không, có thể dừng rất sớm mà không cần xây dataset lớn.

Nếu câu trả lời là có, mới mở rộng sang benchmark nhiều task và fine-tune.
