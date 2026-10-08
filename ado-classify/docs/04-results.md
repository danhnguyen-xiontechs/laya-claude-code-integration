# Kết quả test (2026-10-08)

Repo: `ess-be`. Task: 21 work item ESS lấy thật từ ADO của khách hàng (chỉ đọc), tìm được qua mã work item trong commit message của `ess-be`. Laya checkpoint `english`, CPU (máy ADMIN). Mỗi cấu hình chạy một lần.

File này chỉ ghi ID và tên module. Title, mô tả và kết quả chi tiết nằm ở `data_dir` (`E:\laya-data\ado-classify\ess-be\`), không commit vì repo đang public.

## Đáp án lấy ở đâu

Không ai gắn nhãn tay. Mỗi feature doc trong `ess-be/docs/features/*.md` có mục "Where the code is" liệt kê file code. Task sửa file `.cs` nào thì đáp án là feature có doc nhắc tới nhiều file đó nhất. Bỏ qua các file dùng chung (`CacheKeys`, `D365EntityNames`, `D365DateConverter`, `BatchQueryService`) và file test. Code: `eval_history.py`, hàm `truth_of`.

Một task (19082, Professional Experience) không có feature doc nào nên không chấm. Còn 20 task.

## Test 1: lựa chọn lấy từ các mục `##` của `docs/DOMAIN.md` (24 lựa chọn, Laya 2048 / 768)

| Cách | Đúng top 1 | Đáp án trong top 3 | Thời gian |
|---|---|---|---|
| Laya, câu hỏi có chữ "work item" | 6/17 | 11/17 | trung vị 2.7 s |
| Laya, câu hỏi trung tính | 9/17 | 11/17 | trung vị 2.7 s |
| BM25 | 12/17 | 14/17 | dưới 1 ms |

- `DOMAIN.md` là danh mục **bảng D365**, không phải danh sách feature: không có mục Performance Review, Calibration, Talent. 4/21 task không có lựa chọn đúng, chỉ chấm 17 task. Đáp án của test này do Claude ghép file sang mục DOMAIN (không tự động như test 2).
- Câu hỏi có chữ "work item" làm Laya chọn "Tasks & Work Items" ở 11/21 task, nhiều lần với xác suất 0.96–1.00. Laya nhạy với chữ trùng giữa câu hỏi và tên lựa chọn.
- Kết luận: bỏ `DOMAIN.md`, dùng `docs/features`.

## Test 2: lựa chọn lấy từ `docs/features` (27 module)

| Cách | Đúng top 1 | Đáp án trong top 3 | Thời gian (chỉ phần phân loại) |
|---|---|---|---|
| A. Laya đọc đủ 27 lựa chọn (2048 / 768) | 6/20 | 14/20 | trung vị 2.7 s |
| B. Chỉ BM25 | 9/20 | 16/20, **top 8: 20/20** | dưới 1 ms |
| **C. BM25 lọc top 8 → Laya chọn (1024 / 192)** | **18/20** | 18/20 | trung vị 1.1 s |

Chạy lại bằng `eval_history.py` sau khi đóng gói: khớp từng số.

| ID | Loại | Đáp án | A | B | C (xác suất) |
|---|---|---|---|---|---|
| 10442 | Task | hr-request | hr-request ✓ | hr-request ✓ | hr-request (0.83) ✓ |
| 10550 | Bug | identification | employment ✗ | calibration ✗ | identification (0.60) ✓ |
| 11375 | Bug | identification | employment ✗ | tasks ✗ | tasks (0.30) ✗ |
| 11546 | Bug | approval-delegation | employment ✗ | profile ✗ | approval-delegation (0.79) ✓ |
| 11588 | Bug | hr-request | employment ✗ | talent-view ✗ | hr-request (0.64) ✓ |
| 11839 | Bug | attendance | employment ✗ | attendance ✓ | attendance (0.47) ✓ |
| 11861 | Task | attendance | leave-time-off ✗ | attendance ✓ | attendance (0.43) ✓ |
| 11996 | Bug | leave-time-off | leave-time-off ✓ | leave-time-off ✓ | leave-time-off (0.86) ✓ |
| 18443 | Task | hr-request | employment ✗ | identification ✗ | hr-request (0.77) ✓ |
| 18711 | Task | talent-view | questionnaires ✗ | hr-request ✗ | talent-view (0.32) ✓ |
| 18872 | Bug | leave-time-off | employment ✗ | leave-time-off ✓ | leave-time-off (0.48) ✓ |
| 19080 | Task | certificate | employment ✗ | hr-request ✗ | certificate (0.42) ✓ |
| 19082 | Task | (không có doc) | employment | certificate | leave-time-off (0.19) |
| 19152 | Task | attendance | attendance ✓ | attendance ✓ | attendance (0.64) ✓ |
| 19239 | Bug | profile | skills-performance ✗ | talent-view ✗ | talent-view (0.49) ✗ |
| 19242 | Task | performance | performance ✓ | performance ✓ | performance (0.44) ✓ |
| 19279 | Bug | attendance | attendance ✓ | attendance ✓ | attendance (0.54) ✓ |
| 19358 | Bug | attendance | leave-time-off ✗ | leave-time-off ✗ | attendance (0.54) ✓ |
| 19424 | Task | performance | performance ✓ | performance ✓ | performance (0.75) ✓ |
| 19427 | Task | performance | skills-performance ✗ | identification ✗ | performance (0.44) ✓ |
| 20934 | Bug | attendance, leave-time-off | employment ✗ | manager-view ✗ | leave-time-off (0.50) ✓ |

## Điều rút ra

1. **Laya không nên đọc cả danh mục dài.** Ở cách A, mỗi lựa chọn chỉ còn khoảng 25 token, và xác suất rơi vào nhóm "11+" chưa calibrate. Laya bị hút về một lựa chọn: `employment` 11/21 lần. Mô tả của `employment` lại là "There is no BE-owned Employment surface", tức gần như trống. Đây là giả thuyết cho việc nó "hút", chưa kiểm chứng.
2. **BM25 tìm đủ nhưng xếp sai.** Đáp án luôn nằm trong top 8 (20/20) nhưng chỉ 9/20 ở top 1.
3. **Ghép hai bước thì mỗi bên làm đúng việc mình giỏi**: 18/20, khoảng 1 s mỗi task. Đây là cách Laya tự khuyến nghị (`laya/shortlist.py`).
4. **Độ tự tin của cách C chưa dùng làm ngưỡng được.** Hai câu sai có xác suất 0.30 và 0.49, nhưng có câu đúng chỉ 0.42–0.44. Cần nhiều task hơn.
5. **Hai câu sai đều đáng xem lại:**
   - 11375 (ô "Issuing agency" không có tìm kiếm): Laya chọn `tasks`.
   - 19239 (Performance Matrix trên trang hồ sơ): đáp án là `profile` vì commit sửa `EmployeeProfileService`, còn `talent-view` cũng có lý.

## Giới hạn

- 20 task, một repo, chạy một lần. Chênh 1–2 task không có ý nghĩa thống kê.
- Đáp án phụ thuộc việc feature doc liệt kê đúng file code.
- Chưa so với Claude Haiku (đối thủ thật nếu mục tiêu là thay LLM).
- Task đều viết bằng tiếng Anh; chưa thử task tiếng Việt.
- Mô tả module tự trích từ câu đầu của mục 1, có câu bị cắt dở (ví dụ cắt ở "e.g."). Chưa tối ưu.
