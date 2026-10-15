# Plan: áp Jev (TypeSafe) vào BMAD: `bmad-help` và `bmad-code-review`

Ngày 2026-10-13. Branch `plan/jev-applicability`.

**Trạng thái (2026-10-14):** B1 và B2(a) đã implement thành 2 skill mới: `.claude/skills/bmad-help-jev` và `.claude/skills/bmad-code-review-jev`. Skill BMAD gốc không bị sửa. B2(b) chưa làm. Hai skill **chưa chạy với Jev thật** (mới có unit test với provider giả và dry-run parse trên ess-be / ess-fe / pxp-workspace).

Nguồn: `D:\JEV\JEV_STUDY.md`, `D:\Source\BMAD-METHOD\src`, cấu hình `_bmad` thật của `ess-be`, `ess-fe`, `pxp-workspace`, và docs TypeSafe (cookbook skill_suggestion, use-case map, các patterns).

## 1. Ràng buộc: mỗi project có một BMAD riêng

Hiện trạng ba project:

- `ess-be` cài bmm + tea + cis + bmb + bmad-loop, khoảng 80 skill. Project có `_bmad/custom/bmad-build.toml`, file này ép route và quy tắc tạo branch.
- `ess-fe` chỉ cài bmm + bmb, có `project-context.md`.
- `pxp-workspace` đặt `context_placement = "both"`.

Cách thiết kế để chạy được trên mọi project:

- **Không sửa BMAD core và không fine-tune theo project.** Jev không cần huấn luyện. Quy tắc của từng project được đưa vào `state`/`criteria` lúc chạy, nên project khác nhau chỉ khác dữ liệu, còn code là một.
- **Dùng một script chung, không chứa gì riêng của project** (ví dụ `jev-bmad.mjs` trong `xt-skills/shared` hoặc `_bmad/scripts`). Script chỉ đọc những gì project đã có sẵn: `module-help.csv` của các module đã cài, `project-context.md`, `persistent_facts`.
- **Cắm vào từng project bằng cơ chế custom có sẵn của BMAD**: file `_bmad/custom/<skill>.toml`, với các khóa `activation_steps_prepend/append` và `[[workflow.review_layers]]` (trong `instruction` được chạy bash). Project muốn dùng thì thêm vài dòng toml, muốn gỡ thì xoá file.
- **Kết quả của Jev chỉ là gợi ý hoặc dữ liệu đầu vào.** Bước quyết định cuối của skill vẫn do Claude làm như cũ.
- **Gọi model qua provider chung `laya | jev | kev`.** Lý do: dữ liệu (diff code, câu hỏi của user) có thể không được phép gửi ra ngoài. Khi đó dùng Kev (`D:\KEV`, chạy local, cùng API System One).

## 2. B1: `bmad-help` gợi ý skill tiếp theo

**Pattern:** cookbook *Skill suggestion* của TypeSafe. Trên catalog 182 skill, cookbook báo tỉ lệ nạp sai skill giảm từ 16.8% xuống 7.3%, và nạp skill không cần thiết giảm từ 9.8% xuống 4.0%.

**Thiết kế:**

- **State:** câu hỏi của user, cộng với trạng thái artifact do code tự kiểm tra (đã có PRD, architecture, epics, sprint-status hay chưa).
- **Request 1 (xếp hạng rộng):**
  - Một Choice trên toàn bộ catalog, đọc từ `module-help.csv` của **chính project đó** (ess-be khoảng 80 skill, ess-fe ít hơn). Mô tả của từng skill dùng làm criteria.
  - Kèm các Noul gate: "câu này có cần một quy trình/skill không" và "trả lời bằng lời là đủ" (Noul này được đảo chiều khi tính).
- **Request 2 (xếp hạng lại):** chạy trên top 3. Criteria là mô tả cộng 700 ký tự đầu của SKILL.md. Mỗi ứng viên có thêm một Noul "skill này làm đúng việc được hỏi không".
- **Ngưỡng:** nếu trung bình gate < 0.3 hoặc fit tốt nhất < 0.3 thì không gợi ý gì. Mỗi lần gợi ý tối đa một skill. Các ngưỡng này phải đo lại trên dữ liệu của mình.
- **Cách cắm:** thêm `activation_steps_prepend` trong `_bmad/custom/bmad-help.toml` để chạy script. Kết quả được đưa vào như một gợi ý; `bmad-help` vẫn tự trả lời theo quy trình của nó.

**Vì sao chọn:**

- Có số liệu công bố.
- Tự thích nghi theo project, vì catalog được đọc lúc chạy.
- Dữ liệu gửi đi chỉ gồm câu hỏi và mô tả skill, là loại ít nhạy cảm nhất.

## 3. B2: `bmad-code-review`

### B2(a): thêm layer review "project rules" (ưu tiên chính)

- **Jev làm gì:**
  - Code tách từng quy tắc trong `project-context.md` và `persistent_facts`, rồi tách diff thành các hunk.
  - Code chỉ dựng những cặp (quy tắc, hunk) mà file nằm trong phạm vi của quy tắc, theo đường dẫn, loại file hoặc từ khoá.
  - Với mỗi cặp, Jev trả lời một Noul: "hunk này có vi phạm quy tắc này không".
- **Đầu ra:** danh sách finding gồm quy tắc bị vi phạm, vị trí và xác suất. Danh sách được trả về như output của một reviewer.
- **Cách cắm:** thêm một mục `[[workflow.review_layers]]` vào `_bmad/custom/bmad-code-review.toml`, với `instruction` chạy `node jev-bmad.mjs rules --diff {diff_file}`.
- **An toàn:** finding của layer này vẫn qua bước 3 (triage) của Claude như mọi layer khác: được verify và chấm `high/medium/low/false`. Jev không tự quyết severity hay merge.
- **Vì sao:**
  - Quy tắc riêng của project chính là đầu vào, nên không cần sửa gì theo từng project.
  - Đây là "semantic lint" bắt những thứ Sonar không bắt được: quy ước nghiệp vụ, đặt tên, kiến trúc.
  - Nó cũng là phiên bản BMAD của ý tưởng quality gate X-Tek.

### B2(b): gợi ý gom nhóm ở bước triage (phụ)

- Code dựng các cặp finding cùng file hoặc gần nhau. Jev trả lời Noul "hai finding này do cùng một lỗi gốc".
- Cách cắm: `activation_steps_append`, đưa gợi ý gom nhóm vào trước bước 3. Claude vẫn quyết định cuối.

### Không làm

- **Không thay bước verify claim của bước 3.** Bước này cần đọc caller và guard, rồi suy luận nhiều bước. Đây đúng là điểm yếu của Jev 1.13.

## 4. Gỡ chặn trước khi pilot

1. Xin duyệt: câu hỏi của user (B1) và diff code (B2) có được gửi tới TypeSafe/OpenRouter không. Nếu không, dùng Kev.
2. Thống nhất một `decision-provider` chung, dùng lại từ `review-pr-jev-classify/scripts/decision-provider.mjs`.
3. Đo latency của Jev: p50/p95 khi gửi 1 câu hỏi và khi fan-out 20–50 câu.

## 5. Pilot và cách đo

| | B1 `bmad-help` | B2(a) layer project rules |
|---|---|---|
| Project | ess-be và ess-fe (hai catalog khác nhau, để kiểm tra khả năng tự thích nghi) | ess-fe (có `project-context.md` dày nhất) |
| Bộ dữ liệu | Khoảng 60 câu hỏi thật hoặc tổng hợp lấy từ lịch sử session, mỗi câu có nhãn skill đúng hoặc "không cần skill" | 10 PR đã merge, gán nhãn vi phạm quy tắc thật |
| So sánh | Không gợi ý / Laya / Jev / (Kev) | Không có layer / Laya / Jev / (Kev) |
| Chỉ số | Tỉ lệ gợi ý sai, tỉ lệ gợi ý thừa, latency | Số vi phạm thật bắt được, số báo nhầm sau triage, số lượt Claude tăng thêm, latency |
| Tiêu chí giữ lại (chốt trước khi chạy) | Gợi ý sai và gợi ý thừa đều giảm so với baseline trên cả hai project | Bắt được vi phạm mà các layer hiện có bỏ sót, và báo nhầm sau triage ≤ 1 trên mỗi PR |

Chọn ngưỡng trên tập dev, báo số trên tập held-out.

## 6. Câu hỏi mở

- Câu hỏi của user và diff code có được gửi ra ngoài không? Câu trả lời quyết định dùng Jev hay Kev.
- Script chung đặt trong `xt-skills` (plugin cho cả team) hay trong `_bmad/scripts` của từng project?
