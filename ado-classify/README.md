# ado-classify: Laya gợi ý module code cho một task ADO

Khi nhận một task ADO, công cụ này đọc title và description rồi cho biết task thuộc **module nào của repo**, kèm **đường dẫn code** để Claude Code (hoặc dev) bắt đầu đúng chỗ. Chạy hoàn toàn local: không gọi LLM, dữ liệu task không rời khỏi máy (ngoài việc đọc từ ADO).

Trạng thái (2026-10-08): **POC chạy được trên `ess-be`**, 18/20 task lịch sử chọn đúng module ở top 1. Chưa tích hợp vào Claude Code. Xem [docs/04-results.md](docs/04-results.md).

## Cách hoạt động (cách C)

```
ess-be/docs/features/*.md ──build_catalog.py──> modules.json (27 module: mô tả, đường dẫn code, file .cs)
                                                     │
Task ADO ──fetch (chỉ đọc, chỉ ESS)──> title + description + repro steps + acceptance criteria
                                                     │
                     BM25: chấm điểm mức trùng từ khóa giữa task và toàn văn từng feature doc
                                                     │  lấy 8 module điểm cao nhất (khác nhau theo từng task)
                                                     ▼
                     Laya: questions file sinh tự động, criteria = 8 module đó → chọn 1, kèm xác suất
                                                     │
                     Kết quả: top 3 module + xác suất + đường dẫn code
```

- **Danh mục đủ module vẫn giữ nguyên** (27 với `ess-be`). BM25 chỉ chọn ra 8 ứng viên cho **từng task**. Trên 20 task lịch sử, đáp án luôn nằm trong 8 ứng viên đó.
- **Không cần viết tay questions file.** `instructions` là một dòng trong config; `criteria` được ghép tự động từ `modules.json` cho mỗi task.
- **BM25 không phải một phần của Laya.** Đây là thuật toán tìm kiếm theo từ khóa cổ điển, khoảng 20 dòng trong `common.py`, chạy dưới 1 ms.
- Vì sao không cho Laya đọc cả 27 module: mọi lựa chọn dùng chung ngân sách `head_max_len`, nên mỗi lựa chọn chỉ còn khoảng 25 token, và từ 11 lựa chọn trở lên xác suất chưa được calibrate. Đo được 6/20 so với 18/20 (xem kết quả).
- Laya lỗi (chưa cài, hết RAM...) thì `classify()` trả kết quả của BM25 và ghi rõ `engine: bm25`.

## Cài đặt

Yêu cầu:
- Laya đã cài theo `install-laya.ps1` ở gốc repo, `HF_HOME` trỏ tới cache model.
- `az` CLI đăng nhập được vào **tenant của org ADO chứa task**: `az login --tenant <tenant-id> --allow-no-subscriptions`.
- Repo đích (`ess-be`) có thư mục `docs/features/`.

Cấu hình:
```bash
cp ado-classify/config.example.json ado-classify/config.local.json
```

Rồi điền vào `config.local.json`:

| Khóa | Ý nghĩa |
|---|---|
| `repo`, `features_dir` | Repo đích và thư mục feature doc |
| `data_dir` | Nơi lưu modules.json, tasks.json, kết quả. **Để ngoài repo này** (repo public) |
| `ado.org`, `ado.tenant`, `ado.project` | Org, tenant Entra và project ADO chứa task |
| `ado.scope_keyword` | Chỉ nhận item có chữ này trong Area hoặc Iteration (ESS) |
| `laya.shortlist_k` | Số ứng viên BM25 đưa cho Laya (8; giữ trong khoảng 6–10 để xác suất có calibrate) |
| `laya.max_len`, `laya.head_max_len` | 1024 / 192 |
| `laya.instructions` | Câu hỏi gửi Laya. Tránh chữ trùng với tên một module (xem kết quả test 1) |
| `catalog_overrides` | `{ "slug": "mô tả viết tay" }` khi mô tả tự trích chưa tốt |

`config.local.json` đã nằm trong `.gitignore`.

## Chạy

Dùng Python của tool Laya (máy ADMIN: `C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe`), đặt `PYTHONIOENCODING=utf-8`.

```bash
python build_catalog.py                       # quét docs/features -> modules.json (chạy lại khi doc đổi)
python classify.py --id 19279                 # lấy task từ ADO và phân loại
python classify.py --title "..." --text "..." # phân loại văn bản bất kỳ, không gọi ADO
python classify.py --id 19279 --json          # in JSON
python fetch_tasks.py --from-git              # lấy mọi task được nhắc trong commit của repo (kèm file đã sửa)
python eval_history.py                        # chấm A / B / C trên các task đó -> eval_report.md
python eval_history.py --skip-full            # bỏ cách A (chậm)
```

Ví dụ output:
```
ADO #19279 (Bug): <title của task>
  -> attendance             0.54  src/Ess-App.API/Controllers/Attendance/AttendanceController.cs, ...
     leave-time-off         0.16  Controllers/LeaveRequests/LeaveRequestsController.cs, ...
     approval-delegation    0.09  ...
  engine=bm25+laya | ung vien BM25: attendance, approval-delegation, calibration, ...
  thoi gian (ms): {'bm25': 0.49, 'laya': 8659, 'fetch': 3801}
```

**Thời gian khi gọi bằng dòng lệnh:** mỗi lần chạy phải nạp lại model (khoảng 7–10 s) và gọi `az` lấy token (khoảng 3–4 s). Bản thân phân loại chỉ mất khoảng 1 s. Muốn nhanh khi dùng thật thì cần một tiến trình giữ model trong RAM (MCP server, xem phần tiếp theo).

## An toàn dữ liệu

- Chỉ **đọc** ADO, không ghi gì lên ADO.
- Lọc 2 bước: đọc metadata trước, chỉ đọc nội dung của item đúng project và có `scope_keyword` trong Area/Iteration. Item ngoài scope bị in ra là "loai" và không lấy nội dung.
- Title, mô tả, kết quả chi tiết chỉ nằm trong `data_dir`. Thư mục này không chứa dữ liệu task.
- Org và tenant của khách hàng chỉ nằm trong `config.local.json` (gitignored).

## File

| File | Việc |
|---|---|
| `common.py` | Config, ADO (chỉ đọc + lọc scope), quét danh mục, BM25, gọi Laya, hàm `classify` (cách C, fail-open về BM25) |
| `build_catalog.py` | `docs/features` → `modules.json` |
| `fetch_tasks.py` | Lấy task theo ID hoặc theo commit (`--from-git`, kèm file đã sửa để chấm) |
| `classify.py` | Phân loại một task / một đoạn văn bản |
| `eval_history.py` | So A / B / C trên task lịch sử, đáp án tự động từ file đã sửa |
| `config.example.json` | Mẫu config |
| `docs/01-plan-v1-dataset.md` | Plan ban đầu (dataset lớn, so TF-IDF / Haiku). Lịch sử |
| `docs/02-scope-v2.md` | Scope v2 của người dùng: thu nhỏ về một task |
| `docs/03-poc-v2-review-and-plan.md` | Review scope v2 và plan implement. Lịch sử, một phần đã thay bằng cách C |
| `docs/04-results.md` | Kết quả các test và điều rút ra |
| `docs/REPORT.md` | Báo cáo tiếng Anh cho quản lý: cách hoạt động, flow, MCP đề xuất, kết quả, bước tiếp theo |

## Việc tiếp theo

Flow làm việc sau khi apply (dev gõ `/ado-task <id>` → MCP phân loại → Claude đọc feature doc và mở đúng file → code như cũ → log gợi ý để so với commit) và plan chi tiết: [docs/03-poc-v2-review-and-plan.md](docs/03-poc-v2-review-and-plan.md), phần 3. Bản tiếng Anh cho quản lý: [docs/REPORT.md](docs/REPORT.md), mục "Developer workflow after rollout".

1. **MCP server** bọc `classify()`: giữ model và token trong RAM, tool `classify_ado_task(id)`, `classify_text(title, text)`, `list_modules()`, kèm lệnh `/ado-task` và log gợi ý. Dùng được trong Claude Code và Claude Desktop. Thư viện MCP đã có trong bản cài `laya[mcp]`.
2. **So với Claude Haiku** trên cùng 20 task: mốc bắt buộc nếu muốn nói Laya thay được LLM.
3. **Đo lợi ích khi code:** chạy cùng 2 task với và không có gợi ý, đếm số lượt trước khi Claude mở đúng file.
4. Cải thiện mô tả module (cắt câu tốt hơn, `catalog_overrides`), thêm task tiếng Việt, thêm repo `ess-fe` (cùng slug feature).
