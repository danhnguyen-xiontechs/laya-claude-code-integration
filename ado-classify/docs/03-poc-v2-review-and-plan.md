# ADO classification POC v2: review và plan implement

Ngày: 2026-10-07. Dựa trên [02-scope-v2.md](02-scope-v2.md). Repo thử: `D:\XionTechs\ess-be`.

> **Cập nhật 2026-10-08:** đã implement dạng rút gọn trong thư mục `ado-classify/` (xem [../README.md](../README.md)). Khác với plan dưới đây:
> - Danh mục module lấy từ `docs/features/*.md` (27 module), không quét code.
> - Task không nằm ở ADO `XionTechs` mà ở org ADO của khách hàng (tenant riêng); chỉ lấy item ESS.
> - Đã thử cho Laya đọc đủ danh mục (2048 / 768): 6/20, kém hẳn cách lọc BM25 top 8 (18/20). Kết quả ở [04-results.md](04-results.md).
> - Chưa làm: lệnh `/ado-classify` cho Claude Code (bước 5), A/B khi code (bước 6).

> Repo Laya này đang **public** trên GitHub. Code của POC có thể nằm trong repo, nhưng mọi dữ liệu (task fetch về, `project-options.json`, kết quả) để ở `E:\laya-data\ado-poc\`, không commit.

---

## Phần 1: Review scope v2

### Điểm tốt
- Đúng cách bạn làm việc: nhận một task, đưa cho Claude Code. Không cần dựng dataset lớn trước.
- Ranh giới hợp lý: Laya trả lời "task thuộc nhóm nào", Claude trả lời "sửa thế nào".
- Bỏ bước tóm tắt bằng LLM, giữ preprocessing đơn giản. Đúng, vì nếu phải gọi LLM để tóm tắt thì mất lý do dùng Laya.
- Có tiêu chí "coding usefulness" và cho phép dừng sớm.

### Cần sửa

**1. Bỏ phân loại Type.** Trường `System.WorkItemType` (Bug / Task / User Story) đã có sẵn khi fetch task, do người tạo task chọn. Bắt Laya đoán lại một thông tin đã có thì không giúp được gì. Chỉ giữ Type như một phép kiểm tra phụ: so Laya với giá trị trong ADO, nhãn có sẵn, không tốn gì.

**2. Output phải là đường dẫn code, không chỉ là nhãn.** "Area = Employee" không giúp Claude, vì Claude đọc title cũng tự biết. Thứ giúp được là:
```
Area: LeaveRequests (0.81)
  src/Ess-App.API/Controllers/LeaveRequests/
  src/Ess-App.Application/Services/LeaveRequests/
```
Scanner đã biết module nằm ở thư mục nào, nên trả luôn đường dẫn. Lợi ích đo được là Claude bớt các lượt grep để tìm chỗ cần sửa.

**3. Một task không chứng minh được gì, nhưng có sẵn 20 task với đáp án.** Commit message của `ess-be` có mã ADO và scope, ví dụ `feat(attendance): ... (ADO 20934)`, `fix(performance): ... (TASK-19427)`. Đã đếm: **22 work item** được nhắc trong commit, cả 22 đều sửa file trong `Controllers/<Module>/` hoặc `Services/<Module>/`, 4 item đụng nhiều module. Như vậy:
- Ground truth = các module mà commit của task đó thực sự sửa. Tự động, không ai phải gắn nhãn.
- Chấm PASS/FAIL tự động: module Laya chọn có nằm trong số module bị sửa không.
- Vẫn nhỏ (22 task, chạy vài phút), nhưng có ý nghĩa hơn hẳn 1 task.

**4. Cần một baseline rẻ: so khớp từ khóa (BM25).** Title "Fix employee image upload" chứa sẵn chữ "employee". Một thuật toán so từ khóa giữa title và tên module, tên class sẽ đoán đúng ngay. Laya chỉ có giá trị khi cách diễn đạt khác tên module, ví dụ title viết "nghỉ phép" mà module tên `LeaveRequests`. Nếu BM25 làm ngang Laya thì dùng BM25.

**5. Số module vượt giới hạn của Laya.** `ess-be` có khoảng 35 module (thư mục trong `Controllers/` và `Services/`). Từ 11 lựa chọn trở lên Laya chưa calibrate, mỗi mô tả lại bị cắt ở 48 token. Cách xử lý: BM25 lọc ra top 8, Laya chọn trong 8 module đó. Plan v2 chưa tính tới điều này.

**6. Repo .NET này không chia module theo thư mục gốc.** Đây là clean architecture: `Ess-App.API/Controllers/LeaveRequests`, `Ess-App.Application/Services/LeaveRequests`... Một module nằm rải ở nhiều layer. Scanner phải gom theo **tên feature xuyên layer**, không theo thư mục gốc như ví dụ trong v2.

**7. Mô tả module lấy từ tên thì quá yếu.** "Leave: leave request..." chỉ là nhắc lại tên. Lấy thêm tín hiệu từ code, rẻ và tất định: tên class, tên method public, route của controller. Ví dụ mô tả `LeaveRequests` = "endpoints: submit, approve, cancel, balance, history; services: LeaveBalanceService...". Cắt cho vừa 48 token.

**8. Bug trên ADO hay để trống Description.** Với work item loại Bug, nội dung thường nằm ở trường `Microsoft.VSTS.TCM.ReproSteps`, không ở `System.Description`. Có thể đây là lý do 47/122 item ở lần test trước "không có mô tả". Fetcher phải lấy cả ReproSteps và AcceptanceCriteria.

**9. Đo "coding usefulness" bằng số liệu.** Không tính bằng cảm giác:
- Offline (miễn phí): đường dẫn gợi ý có chứa file thực sự bị sửa không (đã có ở điểm 3).
- Online (tốn quota, làm sau): chạy cùng một task hai lần, có gợi ý và không có gợi ý, đếm số lượt và token trước khi Claude mở đúng file.

**10. Các điểm nhỏ.**
- Task tiếng Việt: checkpoint `english` đọc tiếng Việt kém. Cần đánh dấu task tiếng Việt và báo cáo riêng.
- Xác suất cao nhất trước đây dồn quanh 0.4–0.6; có 8 lựa chọn thì còn thấp hơn. Ngưỡng HIGH/LOW phải lấy từ 22 task, không đặt sẵn 0.9.

---

## Phần 2: Plan implement

### Cấu trúc
```
ado-poc/                         (code, trong repo Laya)
  scan_project.py                quét repo -> project-options.json
  fetch_ado_task.py              lấy 1 work item -> task.json
  classify_task.py               task + options -> shortlist BM25 -> Laya -> kết quả
  build_history.py               git log -> danh sách (work item, module bị sửa)
  eval_history.py                chạy BM25 / Laya trên các task lịch sử, ra report
  README.md
E:\laya-data\ado-poc\             (dữ liệu, ngoài repo)
  ess-be/project-options.json
  ess-be/history.json
  ess-be/tasks/<id>.json
  ess-be/results/*.jsonl, report.md
```
Chạy bằng Python của tool Laya (có sẵn torch, httpx). BM25 tự viết khoảng 30 dòng, không cần cài thêm `scikit-learn`.

### Bước 1: `scan_project.py` (khoảng 0.5 ngày)
- Input: đường dẫn repo. Output: `project-options.json`.
- **Nguồn chính: `docs/features/*.md`** (29 feature, mỗi file có mục "1. What it does" do người viết, và `ess-fe` dùng cùng slug). Mô tả lựa chọn lấy từ câu đầu của mục 1, cắt dưới 48 token; toàn bộ file dùng làm keyword cho BM25. Phần quét code bên dưới dùng để gắn đường dẫn và bắt module chưa có doc.
- Tìm module: các thư mục con trực tiếp của `*/Controllers/` và `*/Services/`, cộng thêm các file `*Controller.cs` đứng riêng (ví dụ `CertificateController.cs` gom thành module `Certificate`).
- Chuẩn hóa tên: số nhiều/số ít (`Task`/`Tasks`), sửa lỗi chính tả có sẵn (`PersonalInfomation`), gộp khi trùng.
- Loại bỏ: `Common`, `Helpers`, `Cache`, `DependencyInjection`, `bin`, `obj`.
- Với mỗi module ghi lại:
  - `paths`: các thư mục chứa module đó ở mọi layer;
  - `keywords`: tên class, method public, route (đọc `.cs` bằng regex, không cần build);
  - `description`: ghép tự động từ keywords, cắt dưới 48 token.
- Có `options.override.json` (không bắt buộc) để người sửa tay mô tả hay gộp module.
- Kiểm tra: in danh sách module để bạn xem có hợp lý không (tiêu chí "option quality" của v2).

### Bước 2: `fetch_ado_task.py` (khoảng 0.25 ngày)
- Input: work item ID. Lấy token qua `az account get-access-token` như `ado/pull_more.py`.
- Lấy các trường: `System.Title`, `System.Description`, `Microsoft.VSTS.TCM.ReproSteps`, `Microsoft.VSTS.Common.AcceptanceCriteria`, `System.WorkItemType`, `System.AreaPath`.
- Bỏ HTML, chuẩn hóa khoảng trắng. Ghi `tasks/<id>.json` ở thư mục dữ liệu.
- Chỉ đọc, không ghi gì lên ADO.

### Bước 3: `classify_task.py` (khoảng 0.5 ngày)
- Preprocess:
  - Strategy A: title + 2000 ký tự đầu của (description, repro steps, acceptance criteria).
  - Strategy B: giữ ưu tiên các đoạn có tiêu đề Expected / Actual / Steps / Acceptance.
- BM25 trên (title + text) so với `keywords` của từng module, lấy top 8.
- Gọi `laya-serve` (`POST /v1/systemone`, checkpoint `english`, `max_len` 1024) với câu hỏi `choice` gồm 8 module đó. Gọi kèm câu hỏi Type trong cùng request để kiểm tra phụ.
- Output:
  - top 3 module, mỗi module kèm xác suất và `paths`;
  - Type của Laya so với Type trong ADO;
  - thời gian từng bước: fetch, preprocess, BM25, Laya.
- Fail-open: Laya không chạy thì vẫn trả kết quả của BM25 và ghi rõ là đang dùng BM25.

### Bước 4: `build_history.py` và `eval_history.py` (khoảng 0.5 ngày)
- Đọc `git log --all --name-only` của `ess-be`, lấy mã work item bằng regex (`ADO 20934`, `TASK-19427`, `BUG-19358`, `#19424`, `bug 19279`). Gom các file bị sửa theo từng work item, rồi ánh xạ file sang module bằng `paths` của scanner.
- Fetch 22 task qua `fetch_ado_task.py`.
- So các cách trên 22 task:

| Cách | Mô tả |
|---|---|
| BM25 top-1 / top-3 | Baseline so từ khóa |
| Laya top-1 / top-3 | Laya chọn trong top 8 của BM25 |
| Laya, chỉ title | Để thấy description giúp được bao nhiêu |
| Laya, đủ 29 lựa chọn | Không lọc BM25; thử `head_max_len` mặc định (mỗi lựa chọn bị cắt còn khoảng 6 token) và nâng lên khoảng 768 (`max_len` 2048). Trả lời bằng số liệu câu hỏi "đưa hết option vào thì sao" |

- Chỉ số: **hit@1, hit@3** (module dự đoán có nằm trong số module bị sửa không); bảng xác suất cao nhất so với đúng/sai; latency; tách riêng nhóm Bug, nhóm task tiếng Việt, nhóm không có mô tả.
- Kiểm tra phụ: độ khớp Type của Laya với `WorkItemType` trong ADO.

### Bước 5: lệnh cho Claude Code (khoảng 0.25 ngày)
- `/ado-classify <id>` đặt trong `ess-be/.claude/commands/` ở bản cài local, không commit vào `ess-be`. Lệnh chạy `classify_task.py` rồi in ra:
```
ADO #20934  (Task, ADO: Task)
Area: Attendance   0.62   src/Ess-App.API/Controllers/Attendance/, src/Ess-App.Application/Services/Attendance/
      LeaveRequests 0.21
Confidence: MEDIUM   (ngưỡng lấy từ bước 4)
```
- Claude Code đọc output này rồi bắt đầu task.

### Bước 6 (tùy chọn, tốn quota): A/B trên 2 task
- Chọn 2 task trong 22 task lịch sử. Checkout commit trước khi sửa, chạy `claude -p` hai lần, có và không có gợi ý.
- Đo: số lượt và token trước khi Claude mở file thực sự bị sửa, tổng lượt, tổng thời gian.
- Chỉ làm khi bước 4 cho thấy Laya hoặc BM25 đạt hit@3 cao.

### Tiêu chí quyết định sau bước 4
| Kết quả | Quyết định |
|---|---|
| Laya hit@3 ≥ 80% **và** cao hơn BM25 rõ ràng (ít nhất 3 task) | Làm bước 5–6, sau đó mở rộng sang nhiều task hơn và repo `ess-fe` |
| BM25 ngang Laya | Giữ bước gợi ý đường dẫn nhưng **dùng BM25**, bỏ Laya cho bài này |
| Cả hai hit@3 dưới khoảng 60% | Gợi ý module không đủ tin cậy, dừng |

### Thời gian và chi phí
- Bước 1–5: khoảng 2 ngày. Không tốn quota Claude; chỉ cần `laya-serve` chạy local (tắt sau khi chạy xong) và `az login`.
- Bước 6: một ít quota (4 lần chạy `claude -p`).

### Rủi ro
| Rủi ro | Xử lý |
|---|---|
| Chỉ 22 task, chênh 1–2 task không có ý nghĩa | Báo cáo kèm số tuyệt đối; nếu đáng làm tiếp thì lấy thêm task qua link PR ↔ work item trên ADO |
| Commit gắn nhầm mã work item, hoặc commit sửa lan sang module khác | Ground truth là "module bị sửa", tính hit nếu dự đoán khớp bất kỳ module nào trong số đó; xem tay 4 task đụng nhiều module |
| Tên module rải rác, scanner gom sai | Có file override; xem danh sách ở bước 1 trước khi chạy tiếp |
| Task tiếng Việt | Báo cáo riêng; không sửa trong POC |
| Lộ dữ liệu | Dữ liệu ở `E:\laya-data`, repo Laya cần chuyển private |

### Bắt đầu
~~Nếu bạn đồng ý, tôi làm bước 1 trước...~~ Bước 1–4 đã làm (dạng rút gọn, dùng `docs/features` thay cho quét code). Xem phần 3.

---

## Phần 3: sau POC, đưa vào workflow hằng ngày (cập nhật 2026-10-08)

### 3.1 Trạng thái
| Hạng mục | Trạng thái |
|---|---|
| Danh mục module từ `docs/features` (`build_catalog.py`) | Xong |
| Fetch ADO chỉ đọc, chỉ ESS (`fetch_tasks.py`) | Xong |
| Phân loại cách C: BM25 top 8 → Laya (`classify.py`) | Xong, 18/20 trên task lịch sử |
| Chấm tự động trên task lịch sử (`eval_history.py`) | Xong |
| MCP server + lệnh `/ado-task` | **Chưa làm**, phần 3.3 |
| Log gợi ý và so với commit thật | **Chưa làm**, phần 3.3 |
| So với Haiku, A/B khi code | **Chưa làm**, phần 3.4 |

### 3.2 Flow sau khi apply (trạng thái đích)
```
Dev gõ trong Claude Code:  /ado-task 19279
        │
        ▼
Claude Code đọc .claude/commands/ado-task.md
        │   lệnh dặn Claude: "gọi tool classify_ado_task trước, rồi mới bắt đầu task"
        ▼
Claude gọi tool MCP
        │   request gửi tới MCP server (JSON-RPC qua stdio):
        │   { "method": "tools/call",
        │     "params": { "name": "classify_ado_task",
        │                 "arguments": { "id": "19279" } } }
        ▼
mcp_server.py  (chạy nền suốt phiên; Laya, BM25, token ADO đã nạp sẵn trong RAM)
  ├─ ADO: đọc metadata (project, Area, Iteration) ── chỉ đọc
  ├─ Lọc scope: sai project, hoặc không có "ESS" trong Area/Iteration
  │     → từ chối, báo lý do, KHÔNG đọc nội dung task
  ├─ ADO: đọc nội dung (title, description, repro steps, acceptance criteria)
  ├─ catalog: modules.json (27 module từ docs/features; tự build lại nếu doc mới hơn)
  ├─ BM25: chấm điểm 27 module → giữ 8 ứng viên              (< 1 ms)
  ├─ Laya: criteria = 8 ứng viên → chọn 1, kèm xác suất      (~1 s, CPU)
  ├─ Ghi log: suggestions.jsonl (ID, top 3, xác suất; không ghi title)
  ├─ Laya lỗi / quá giờ → trả kết quả BM25, "engine": "bm25"  (fail-open)
  └─ ADO lỗi (hết phiên az) → trả lỗi rõ: "chạy az login --tenant <tenant>"
        │
        ▼
Kết quả tool trả về cho Claude:
  { "id": "19279", "type": "Bug",
    "task": { "title": "...", "description": "...", "repro": "...", "ac": "..." },
    "top": [ { "module": "attendance", "p": 0.54,
               "doc": "docs/features/attendance.md",
               "paths": ["src/Ess-App.API/Controllers/Attendance/AttendanceController.cs",
                         "src/Ess-App.Application/Services/Attendance/AttendanceService.cs"] },
             { "module": "leave-time-off", "p": 0.16, ... },
             { "module": "approval-delegation", "p": 0.09, ... } ],
    "engine": "bm25+laya" }
        │
        ▼
Claude thấy: nội dung task + gợi ý module → bắt đầu đúng chỗ
  ├─ xác suất cao: đọc docs/features/attendance.md
  │     (§1–5; sửa bug thì thêm §7–9 và §12, theo quy ước của docs/features/README.md)
  │     → mở thẳng các file trong "paths", không phải grep cả repo
  └─ xác suất thấp: coi top 3 là gợi ý, tự tìm như bình thường
        │   (ngưỡng "cao / thấp" tạm thời, chốt sau khi có khoảng 50 gợi ý, xem 3.4)
        ▼
Code → chạy test → dev review diff      (như hiện nay, công cụ không can thiệp)
        │
        ▼
Dev commit: "fix(attendance): ... (BUG-19279)"   (quy ước team đang dùng)
        │
        ▼
feedback.py (chạy định kỳ): so log gợi ý với file mà commit thật sự sửa
  ├─ khớp → không làm gì
  └─ lệch → liệt kê module hay sai → sửa mô tả (catalog_overrides) hoặc bổ sung feature doc
```

Những gì **không đổi**: Claude vẫn code và test như cũ, dev vẫn review mọi diff, không ghi gì lên ADO.

### 3.3 Implement (khoảng 1 ngày)
1. **`mcp_server.py`** (dùng thư viện MCP có sẵn trong `laya[mcp]`, chạy bằng Python của tool Laya, giao tiếp stdio):
   - `classify_ado_task(id)`: gọi `fetch_tasks` + `classify` trong `common.py`. Trả nội dung task, top 3, xác suất, đường dẫn code, đường dẫn feature doc, `engine`, thời gian.
   - `classify_text(title, text)`: cho task không nằm trên ADO.
   - `list_modules()`: danh mục hiện tại.
   - Nạp Laya và BM25 một lần khi khởi động; cache token ADO tới khi hết hạn.
   - Tự build lại catalog nếu `docs/features` mới hơn `modules.json`.
   - Lỗi ADO (hết phiên `az`) thì trả thông báo rõ: "chạy `az login --tenant ...`". Laya lỗi thì trả kết quả BM25.
2. **Đăng ký MCP** với Claude Code, scope user (giống MCP `laya` hiện có), env `HF_HOME`, `ADO_CLASSIFY_CONFIG`. Đăng ký bằng Git Bash vì PowerShell nuốt `--`.
3. **Lệnh `/ado-task`**: file `.claude/commands/ado-task.md` cài vào repo đích ở máy dev, không commit vào `ess-be` khi chưa được team đồng ý. Nội dung: gọi `classify_ado_task`, đọc feature doc theo xác suất, rồi bắt đầu task.
4. **Log gợi ý**: `suggestions.jsonl` trong `data_dir` (thời điểm, ID, top 3, xác suất, engine). Không ghi title vào log.
5. **`feedback.py`**: đọc log, tìm commit có mã work item tương ứng, chấm như `eval_history.py`, in danh sách gợi ý sai.
6. **Kiểm tra**: chạy lại 20 task qua đường MCP, phải ra 18/20 như CLI. Đo thời gian lần gọi đầu và các lần sau.

### 3.4 Đo lợi ích trước khi đề xuất cho team
| Bước | Cách làm | Quyết định |
|---|---|---|
| So với Haiku | Cùng 20 task, Haiku đọc đủ 27 module (`claude -p --model haiku`), đo đúng/sai và thời gian | Laya có rẻ hơn hoặc tốt hơn LLM cho việc này không |
| A/B khi code | 2 task lịch sử, checkout commit trước khi sửa, chạy Claude Code có và không có `/ado-task` | Có bớt được lượt, token và thời gian không |
| Ngưỡng xác suất | Sau khoảng 50 gợi ý có log và commit, vẽ đúng/sai theo xác suất | Ngưỡng "cao / thấp" thật cho bước 3.2 |

### 3.5 Rủi ro khi đưa vào dùng
| Rủi ro | Xử lý |
|---|---|
| Gợi ý sai làm Claude đi sai hướng | Luôn trả top 3 và xác suất; lệnh `/ado-task` dặn Claude kiểm chứng bằng code trước khi sửa |
| Feature doc cũ hoặc thiếu module (như Professional Experience) | Vòng phản hồi 3.2 chỉ ra; thêm doc hoặc `catalog_overrides` |
| Mỗi máy dev phải cài Laya (2 GB RAM, khoảng 2.2 GB model) | Đã có `install-laya.ps1`; hoặc sau này chạy một server dùng chung trong mạng nội bộ |
| Phiên `az` của tenant khách hàng hết hạn | Thông báo rõ trong tool; dev chạy `az login` lại |
| Repo Laya public | Code sạch dữ liệu khách hàng; cần xử lý `ado/items*.json` cũ trong lịch sử git trước khi commit |
