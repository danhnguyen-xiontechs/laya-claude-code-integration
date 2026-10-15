# Báo cáo tổng hợp: Laya & Jev trong Claude Code

**Giai đoạn:** 2026-09-30 → 2026-10-15 · **Repo:** `danhnguyen-xiontechs/laya-claude-code-integration` · **Người thực hiện:** Danh Nguyen · **Ngày lập:** 2026-10-15

> **Cách đọc mức test**
> ✅ **Thực tế**: chạy thật end-to-end (môi trường ESS thật, PR thật, Claude Code thật) ·
> 📊 **Offline**: đánh giá trên bộ dữ liệu, không chạy trong skill thật ·
> 🧪 **Unit test**: chỉ có test tự động của script ·
> 💡 **Ý tưởng**: mới có tài liệu thiết kế
>
> **Kết luận dùng nhãn:** `ADOPT` dùng được ngay · `PILOT` thử tiếp có điều kiện · `SHADOW` chạy song song chỉ ghi log · `SHELVED` gác lại · `DROP` bỏ · `IDEA` chưa làm

---

## 1. Tóm tắt cho lãnh đạo

**Mục tiêu:** đánh giá hai "decision engine" (model nhỏ, chọn 1 đáp án trong danh sách cố định, trả kèm xác suất) để thay các lần gọi LLM lặp lại kiểu phân loại / routing / xác nhận. Kết quả cuối cần: adopt / pilot / drop, có số liệu.

**Đã làm:** 14 skill biến thể (2 cho `review-pr`, 10 cho `web-test`, 2 cho BMad), 5 skill mới build từ đầu với Jev (repo `JEV`), 8 công cụ mới (proxy chọn model, workflow theo bước, ado-classify, error-triage hook, cache-expiry hook, laya-launcher, fast-compact, gói cài Laya) và khoảng 10 thí nghiệm đánh giá.

**Kết luận chính:**

1. **Laya (self-host) gần như không thắng baseline đơn giản ở bài nào.** Routing model đắt hơn dùng cố định Sonnet (1.43x). Phân loại lỗi đạt 57.5%, trong khi Sonnet đạt 97.5%. Trong các web-test skill, Laya hiếm khi đủ tự tin để tự quyết (median p ≈ 0.5). **Ngoại lệ duy nhất:** `ado-classify` (BM25 lọc trước, Laya chọn sau) đúng module **18/20** task thật → `PILOT`.
2. **Jev (hosted, TypeSafe qua OpenRouter) chính xác hơn Laya rõ rệt khi đánh giá offline.** Write-gate đúng 96%, page-wait đúng 96%. Jev nhanh hơn Laya khoảng 5 lần ở page-wait (~0.6 s) và gần như miễn phí ($0.0185 cho 837 lần gọi). Tuy vậy:
   - Jev **tự tin cả khi sai** (median p 0.99), nên tăng ngưỡng không lọc được lỗi.
   - Khi chạy agent thật trên ticket 11840, **không biến thể nào (Laya hay Jev) giảm được token hoặc số lượt** so với skill gốc.
   - Dữ liệu (text trang ESS, đoạn code) **rời khỏi mạng công ty**. Chế độ auto của Claude Code chặn các lần gọi này vì coi là "Data Exfiltration". Chưa có ý kiến của bộ phận Security.
3. **Giá trị thực tế chủ yếu đến từ phần rule/script cố định đi kèm, không phải từ model:**
   - `find.mjs` tìm element bằng rule
   - rule nhận biết trang đã tải xong trong `wait.mjs`
   - network audit trong write-gate
   - cache-expiry hook
   - fast-compact (rút gọn context 254k → 57k token trong 57 ms, không gọi model)
4. **review-pr + Jev: tốt trên PR test, nhưng trượt khi test thật.** Ngày 15/10 đã chạy lại PR 5240 theo kiểu A/B có kiểm soát: Claude review 1 lần ra 18 lỗi, rồi cả hai engine chấm trên cùng 18 lỗi đó.
   - **Jev:** đồng ý 12/18. Mọi chỗ lệch đều là **nâng** mức (hướng an toàn). Giữ đúng 5/5 lỗi Critical. Tốn $0.0006 và 5.6 s mỗi PR.
   - **Laya:** chỉ đồng ý 7/18. Hạ 4 trong 5 lỗi Critical, và đẩy 3 lỗi chặn merge xuống Suggestion.
   - **Test thật trên 8 PR ess-be đã merge:** chỉ 2/8 cờ nâng mức của Jev là lỗi thật (25%, thấp hơn mức chọn ngẫu nhiên 50%).
   - → `review-pr-jev-classify` chuyển về `SHADOW`. Laya: `DROP`.
5. **5 skill mới build từ đầu quanh Jev (repo `JEV`)** đều chạy được trong Claude Code thật: 7 session, Claude tự chọn đúng skill, 84/84 unit test pass → `PILOT`. Mức Jev đóng góp không đều: cao ở `acceptance-criteria-coverage` và `dead-code-finder`, khoảng 50/50 ở `subagent-validator`, thấp ở `git-risk-scanner` và `context-curator`.
6. **2 skill BMad + Jev** (`bmad-help-jev`, `bmad-code-review-jev`) đã build xong, thiết kế tốt (không sửa BMad core), nhưng **mới có unit test** (17/17), chưa chạy với Jev thật → cần pilot rồi mới kết luận.
7. **`skills-router`** (skill gợi ý skill diện rộng, build mới): trên 199 scenario tự soạn, sau vòng 2 Jev đúng 91% so với BM25 75% và Laya 54–62%; nhưng trên 368 prompt thật Jev chỉ hòa BM25 (50%) và nhãn quá ít. → `PILOT`: mặc định BM25, Jev là bước thứ hai tùy chọn.
8. **`subagent-model-router`** (chọn model cho từng subagent, build mới): trên 18 task có kiểm tra tự động, rule + leo model khi trượt pass 18/18 với **14% chi phí** so với luôn dùng Opus (luôn Sonnet 61%, Jev 48%). **Pilot trên 6 story ess-be thật:** pass 6/6 như bản Sonnet với **36% quota subagent**. → `PILOT` có bằng chứng thật tốt nhất, tiềm năng tiết kiệm quota lớn nhất cho kịch bản chạy song song nhiều story.

**Khuyến nghị:**
- Không đưa Laya vào làm router hoặc bộ phân loại tự động.
- `PILOT` ado-classify như công cụ gợi ý.
- Jev chỉ `PILOT` cho severity check của review-pr (vai trò lưới an toàn, Claude vẫn quyết định cuối) và cho write-gate / page-wait / oracle (oracle không tự ghi FAIL), **sau khi Security cho phép gửi dữ liệu ra ngoài**.
- `PILOT` 5 skill Jev mới trên repo thật của team, kèm bản để Claude tự làm (không dùng skill) để so sánh.
- `ADOPT` ngay các phần rule-based, gồm skill `web-test-laya-ground` (biến thể tốt nhất khi chạy thật nhờ rule `find.mjs`) và plugin `fast-compact` (rút gọn context 77% trong 57 ms, không gọi model).

---

## 2. Laya và Jev là gì

| | **Laya** | **Jev** |
|---|---|---|
| Nguồn | Mã nguồn mở (Apache-2.0), github.com/NandhaKishorM/laya | Dịch vụ hosted của TypeSafe, gọi qua OpenRouter Decisions API |
| Model | Encoder kiểu BERT 322–421M tham số (checkpoint `english`, `multilingual`, `typed-decisions`); không sinh văn bản | `typesafe/jev-1.13-20260917` |
| Chạy ở đâu | Máy local (CPU), `laya-serve` cổng 8000 | Cloud; **dữ liệu rời mạng** |
| Tốc độ đo được | p50 ~0.3–0.9 s/câu ngắn (CPU); 2.8 s với page text; input 4k token → 15 s | p50 ~0.54–0.59 s |
| Chi phí | $0, nhưng model 2.2 GB, RAM ~2 GB, khởi động 30–40 s | ~$0.00002/lần gọi |
| Kiểu câu hỏi | `choice`, `score`, `noul` (có/không) | Giống (cùng API "System One") |
| Điểm yếu đã đo | Xác suất dồn ở 0.4–0.6 (thiếu tự tin); trường `confidence` không phải xác suất top; mỗi mô tả lựa chọn chỉ được 48 token; từ 11 lựa chọn trở lên thì xác suất không còn calibrate; tiếng Việt kém | Quá tự tin (p≈0.99 cả khi sai); cần `OPENROUTER_API_KEY`; auto mode của Claude Code chặn |

---

## 3. Toàn cảnh: tất cả hạng mục và mức test

| # | Hạng mục | Loại | Engine | Mức test | Kết luận |
|---|---|---|---|---|---|
| A1 | `review-pr-laya-classify` | Áp dụng vào skill có sẵn (`review-pr`) | Laya | ✅ PR 5240 ×2 · 🧪 42/42 | `DROP` (Laya không đạt; bản A2 đã có đủ tính năng) |
| A2 | `review-pr-jev-classify` | Áp dụng vào skill có sẵn (A/B) | Laya / Jev | ✅ PR 5240 ×2 + 8 PR ess-be đã merge · 🧪 87/87 | `SHADOW` (test thật trượt tiêu chí) |
| A3 | `web-test-laya-wait` | Áp dụng vào `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` model, `ADOPT` rule |
| A4 | `web-test-laya-verdict` | Áp dụng vào `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` |
| A5 | `web-test-laya-gate` | Áp dụng vào `web-test` | Laya | ✅ staging (không có bước ghi) · 📊 | `DROP` model, `ADOPT` audit |
| A6 | `web-test-laya-oracle` | Áp dụng vào `web-test` | Laya | ✅ dev + staging · 📊 | `DROP` |
| A7 | `web-test-laya-ground` | Áp dụng vào `web-test` | Laya | ✅ dev ×3 | `ADOPT` skill (nhờ rule `find.mjs`; Laya gần như không tham gia) |
| A8 | `web-test-jev-wait` | Áp dụng vào `web-test` | Jev | ✅ staging · 📊 · 🧪 7/8 | `PILOT`* |
| A9 | `web-test-jev-verdict` | Áp dụng vào `web-test` | Jev | ✅ dev + staging · 📊 · 🧪 10/11 | `DROP` (không dùng mặc định) |
| A10 | `web-test-jev-gate` | Áp dụng vào `web-test` | Jev | ✅ staging · 📊 · 🧪 11/12 | `PILOT`* |
| A11 | `web-test-jev-oracle` | Áp dụng vào `web-test` | Jev | ✅ staging · 📊 · 🧪 11/12 | `PILOT`* (không tự ghi FAIL) |
| A12 | `web-test-jev-ground` | Áp dụng vào `web-test` (A/B) | Laya / Jev | ✅ chỉ với Laya · 🧪 6/6 (nhánh Jev chưa chạy thật) | Chưa đủ dữ liệu |
| A13 | `bmad-help-jev` | Áp dụng vào skill có sẵn (`bmad-help` của BMad) | Jev / Laya / Kev | 🧪 9/9 (chưa chạy Jev thật) | Chưa đủ dữ liệu |
| A14 | `bmad-code-review-jev` | Áp dụng vào skill có sẵn (`bmad-code-review` của BMad) | Jev / Laya / Kev | 🧪 8/8 (chưa chạy Jev thật) | Chưa đủ dữ liệu |
| B1 | Router proxy (chọn Haiku/Sonnet/Opus) | Công cụ mới | Laya | ✅ Claude Code thật + benchmark 15 task | `SHELVED` |
| B2 | Workflow chọn model theo bước | Công cụ mới | Laya | ✅ 2 task thật | `DROP` |
| B3 | Error-triage hook | Công cụ mới | Laya | 📊 89 lỗi thật + 40 held-out | `DROP` |
| B4 | `ado-classify` (gợi ý module code) | Công cụ mới | BM25 + Laya | 📊 20 task ESS thật | `PILOT` |
| B5 | Cache-expiry gate hook | Công cụ mới | Không dùng model (rule) | ✅ đang dùng · 🧪 29 test | `ADOPT` |
| B6 | `laya-launcher` (cắt bớt tools/context theo intent) | Công cụ mới | Laya | ✅ thử tay + A/B 5 run | `PILOT` (dùng flag tĩnh) |
| B7 | `fast-compact` plugin | Công cụ mới | Đã thử Jev, bỏ; chạy bằng rule | ✅ 1 session · 📊 · 🧪 13 test | `ADOPT` (đã merge vào `main`, PR #3) |
| B8 | Gói cài Laya cho Windows | Công cụ mới | Laya | ✅ cài thật 2 máy | `DONE` |
| D1 | `acceptance-criteria-coverage` | Skill mới (repo `JEV`) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` |
| D2 | `dead-code-finder` | Skill mới (repo `JEV`) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` |
| D3 | `git-risk-scanner` (+ hook) | Skill mới (repo `JEV`) | Jev | ✅ 2 session · 📊 · 🧪 | `PILOT` |
| D4 | `subagent-validator` (hook) | Skill mới (repo `JEV`) | Jev | ✅ 3 lần chạy · 📊 · 🧪 | `PILOT` |
| D5 | `context-curator` | Skill mới (repo `JEV`) | Jev | ✅ 1 session · 📊 · 🧪 | `PILOT` (shadow) |
| D0 | `jev_advisor` (wrapper test, nền của D5) | Công cụ mới (repo `JEV`) | Jev | ✅ A/B/C 30 run · 🧪 | `PILOT` |
| E1 | `skills-router` (gợi ý skill diện rộng, cảm hứng từ `bmad-help`) | Skill mới | BM25 + Jev / Laya (tùy chọn) | ✅ 368 prompt thật · 📊 199 scenario · 🧪 65/65 | `PILOT` (mặc định BM25, Jev tùy chọn) |
| F1 | `subagent-model-router` (chọn model cho từng subagent) | Skill mới + hook | Rule + Jev (tùy chọn) | ✅ 6 story ess-be thật (36% quota) · 📊 benchmark 18 task · 🧪 20/20 | `PILOT` (bằng chứng thật tốt nhất) |
| C1–C9 | Các thí nghiệm đánh giá (mục 8) | Nghiên cứu | Laya / Jev | 📊 / ✅ | Xem mục 8 |

\* Với điều kiện Security cho phép gửi dữ liệu ra ngoài. Riêng các skill `web-test`: bug "đọc nhầm tab" đã sửa trên nhánh `claude/web-test-fixes-4fdcd7`, cần chạy lại trên ESS.

---

## 4. Nhóm A1–A2: `review-pr` + Laya / Jev

### 4.1 Bản gốc `review-pr` (repo `xt-skills`, plugin `xt-dev-tools`)
- Review 1 PR (Azure DevOps / GitHub / GitLab) theo bộ rule của dự án. Claude đọc toàn bộ diff và gắn mức Critical / Major / Minor / Suggestion cho từng lỗi.
- Tính điểm 100 trừ dần (Critical −30, Major −12, Minor −4, Suggestion −1). Verdict dựa trên điểm: cứ dưới 100 là "Request Changes".
- Mặc định chỉ đọc; `--post` mới đăng comment, và phải được xác nhận trước. Không có bước model phụ, không có execution log. Unit test: **65/65 pass**.

### 4.2 So sánh 3 phiên bản

| | `review-pr` (gốc) | `review-pr-laya-classify` | `review-pr-jev-classify` |
|---|---|---|---|
| Ai quyết định severity | Claude | Claude. Laya kiểm tra độc lập (chỉ để tham khảo) | Claude. Laya **hoặc** Jev kiểm tra (`--provider laya\|jev`) |
| Câu hỏi giao cho engine | — | (1) `severity` cho từng lỗi: chọn 1 trong 4 mức; đã xóa các từ chỉ mức nghiêm trọng để engine không bị "mớm". (2) `merge_gate` cho cả PR: Blocked khi P ≥ 0.29 | Giống hệt (cùng input, cùng ngưỡng) |
| Chế độ | — | `off` / `shadow` (mặc định, chỉ log) / `recheck` (Claude xem lại tối đa 3 lỗi bị engine phản đối) | Giống |
| Verdict / merge | Theo điểm | **3 trạng thái theo severity:** 🔴 Blocked / 🟡 Eligible with suggestions / 🟢 Eligible; điểm chỉ để tham khảo | Giống |
| Output thêm | `report.md` | `findings.json`, `laya.json`, `run-notes.json`, `execution-log.html` (token thật), mỗi lần review một thư mục riêng | Thêm `.jev.json` (token + chi phí từng lần gọi) |
| Dữ liệu rời máy | Không (ngoài Claude) | Không | **Có** khi dùng Jev |
| Unit test | 65/65 | **42/42 pass** | **51/51 pass** |

### 4.3 Lần chạy đầu: PR 5240 (`ess-be`, PR test có cài sẵn lỗi), 2026-10-13, chế độ shadow

| | Laya | Jev |
|---|---|---|
| Model review của Claude | Opus 5.5 | Sonnet 5.5 |
| Số lỗi Claude tìm thấy | 15 | 17 |
| Engine đồng ý với Claude | 10/15 (67%) | 11/17 (65%) |
| Hướng lệch | **Hạ mức (nguy hiểm):** lỗi AUTHZ lộ dữ liệu bị hạ từ Critical xuống Minor | **Nâng mức (an toàn hơn):** cả 4 lỗi Minor bị nâng lên Major với p 0.68–0.97 |
| Độ tự tin | Thấp, đều đều (0.28–0.56) | Sát 0 hoặc 1, không giúp phân biệt đúng/sai |
| Câu merge | Blocked (P 0.549), khớp rule | Blocked (P 1.0), khớp rule |
| Thời gian bước engine / PR | 15.9 s | 6.5 s |
| Chi phí bước engine | $0 | $0.0005 |
| Claude: lượt / input token | 18 / 2.25M | 9 / 1.06M |

**Lưu ý:** đây **không phải A/B có kiểm soát**. Hai lần chạy dùng model review khác nhau nên danh sách lỗi khác nhau. Lần chạy lại ở mục 4.4 đã khắc phục điều này.

### 4.4 Chạy lại có kiểm soát: PR 5240, 2026-10-15

**Cách chạy:** Claude (Opus 5.5) review 1 lần, rồi cả Laya và Jev chấm **cùng** một file findings. Chế độ shadow, không post gì lên PR.

**Kết quả review của Claude:**
- 18 lỗi: 5 Critical, 8 Major, 4 Minor, 1 Suggestion → 🔴 Blocked, coverage 8/8.
- 22 lượt, 3.14M input token (98% đọc từ cache), 24.9k output token, khoảng 5 phút.

| | Laya | Jev |
|---|---|---|
| Đồng ý với Claude | 7/18 (39%) | **12/18 (67%)** |
| Lỗi Critical giữ đúng mức | 1/5 (hạ 4) | **5/5** |
| Hướng lệch | 6 hạ, 5 nâng | **6 nâng, 0 hạ** |
| Lệch vượt ranh giới merge (Critical/Major ↔ Minor/Suggestion) | 8, trong đó 3 lỗi chặn merge bị hạ xuống Suggestion (TH-04 gọi D365 trong vòng lặp, TH-03, C-03) | 4, đều là Minor → Major (TEST-02, RATE, Bug, DOC-API) |
| Độ tự tin | 0.28–0.44 (toàn bộ thấp) | 0.47–1.00 |
| Câu merge | Blocked, P 0.60 (đúng) | Blocked, P 1.00 (đúng) |
| Thời gian (18 lỗi + câu merge, chạy song song) | 18.2 s (median 1.66 s/lần) | **5.6 s** (median 0.54 s/lần) |
| Chi phí | $0 | $0.0006 (14.2k input / 0.9k output token) |

**So với lần 13/10:**
- Jev giữ nguyên mẫu hình: chỉ nâng mức, đồng ý khoảng 2/3.
- Laya tệ hơn: từ 10/15 xuống 7/18, và lệch cả hai chiều.
- Cả hai engine vẫn nâng các lỗi Minor lên Major.

Log nằm ở `~/.xt-skills/review-pr-jev-classify/reviews/…/pr-5240/20261015-093824-ab/`.

### 4.5 Kết luận cho nhóm review-pr

**`review-pr-jev-classify` với `--provider jev`: `PILOT`.**
- Jev chỉ nâng mức và không bỏ sót lỗi Critical nào, nên hợp vai trò **lưới an toàn**: khi Jev cho mức cao hơn, Claude xem lại lỗi đó một lần (chế độ `recheck`, tối đa 3 lỗi/PR), và Claude vẫn quyết định cuối.
- Chi phí gần như bằng 0, thêm khoảng 6 s mỗi PR.

**Còn thiếu trước khi bật `recheck`:**
1. Chạy trên vài PR thật (không phải PR cài sẵn lỗi).
2. Có người gắn nhãn, để biết 4 lần nâng Minor → Major của Jev là đúng hay báo động giả.
3. Cách chọn lỗi để xem lại. Jev luôn rất tự tin (0.89–0.97 ở cả 4 lần nâng), nên ngưỡng xác suất gần như không lọc được gì; phải dựa vào giới hạn 3 lỗi/PR, và chỗ này cần đo thêm.
4. Security đồng ý cho gửi đoạn code ra OpenRouter.

**`review-pr-laya-classify` (Laya): `DROP`.**
- Mức đồng ý thấp, và hạ cả lỗi chặn merge xuống Suggestion.
- Các cải tiến khác của skill vẫn có sẵn trong bản Jev: verdict 3 trạng thái, file findings, execution log, mỗi lần review một thư mục.

**Câu `merge_gate`:** cả hai engine đều đúng ở cả 2 lần chạy, nhưng hiện chỉ ghi log. Biên của Laya rất mỏng: khi thử nghiệm, ngưỡng là 0.29 trong khi giá trị đúng thấp nhất là 0.299.

### 4.6 Nâng cấp ngày 2026-10-15 (nhánh `claude/review-pr-jev-upgrade-2bbb34`, commit `1b56660`)
- **Chọn lỗi để Claude xem lại mà không cần ngưỡng** (chính sách `stable-disagreement`):
  - Hỏi Jev thêm 3 lần, mỗi lần đảo thứ tự lựa chọn.
  - Chỉ gắn cờ khi Jev trả lời giống nhau cả 3 lần, khác mức của Claude, và vượt ranh giới merge. Tối đa 3 lỗi mỗi PR.
  - Trên PR 5240: 17/18 lỗi ổn định 3/3. Chỉ gắn cờ F14–F17 (Minor → Major), lọc bớt 2 trong 6 chỗ Jev lệch với Claude (F9 và F18 không vượt ranh giới merge). Tốn $0.003 cho 109 lần gọi.
- **2 câu hỏi có/không mới** (chỉ ghi log, không đổi kết quả review):
  - `introduced_by_pr` ("lỗi do PR này gây ra?"): trả lời có 18/18. Câu trả lời đúng, vì mọi dòng được trích đều là dòng mới thêm, nhưng PR test này không đủ để phân biệt câu hỏi với việc luôn trả lời có.
  - `already_raised` ("đã có ai nêu trong thread?"): trả lời có 17/18, khớp với các thread review AI trước đó (đã kiểm tra tay 5 lỗi).
- **Lấy nhãn từ kết quả thật** (`outcome-labels.mjs`): so commit lúc review với commit cuối của PR; lỗi nào có vùng code bị sửa sau đó thì nhãn là `fixed`. Mới test bằng dữ liệu giả, chưa chạy trên PR thật.
- **Sửa 2 bug log:** trường `rules` giờ dùng đúng rule id và override của dự án; header execution log hiện đủ cả hai provider.
- 🧪 **87/87 test pass.** Chưa merge, chưa bật `recheck` trên PR thật: cần nhãn từ nhiều PR để biết các cờ có đúng không.

### 4.7 Test thật trên 8 PR ess-be đã merge (2026-10-15, commit `515b077`)
- **Cách làm:**
  - 8 PR ess-be đã merge: 5231, 5328, 4820, 5264, 5199, 4635, 4431, 4500.
  - Các PR này hầu như không có thread review trên ADO, nên Claude review lại từng PR ở commit **trước** khi tác giả sửa, mà không biết trước kết quả. Tổng cộng 14 lỗi.
  - Jev chạy ở chế độ shadow (`stable-disagreement`, k=3, kèm 2 câu hỏi có/không).
  - Nhãn lấy bằng `outcome-labels.mjs`: lỗi được tác giả sửa về sau là lỗi thật.
- **Tiêu chí A (≥ 50% cờ nâng mức của Jev là lỗi thật): trượt.** Chỉ 2/8 cờ là lỗi đã được sửa (25%), trong khi tỉ lệ chung của mọi lỗi là 50%. Tức là cờ của Jev **kém hơn chọn ngẫu nhiên**. Jev gán Major cho 10/14 lỗi và rất ổn định: sai một cách nhất quán, không phải sai ngẫu nhiên.
- **Tiêu chí B (không hạ mức lỗi chặn merge): đạt,** nhưng không chứng minh được gì, vì Jev không hạ mức lỗi nào.
- **Nhãn có thể đang đếm thiếu:** 3/7 lỗi "không sửa" thực ra đã được sửa ở file doc hoặc test chứ không phải ở dòng được trích. Nếu tính cả những case này, A lên khoảng 50–62%. Cách tính đó không được chốt trước khi chạy nên không dùng để kết luận.
- **2 câu hỏi có/không không cho thông tin gì:** `already_raised` luôn trả lời không, vì PR không có thread; `introduced_by_pr` trả lời sai cả 2 lần nói không.
- **Điểm sáng của chính Claude:** review của Claude khớp với phần dev tự sửa sau này ở nhiều PR (5264, 5199).
- **Chi phí:** Jev $0.002. Claude khoảng 673k token subagent (trừ vào quota Max).
- **Hạn chế:** chỉ 14 lỗi trên các PR nhỏ, là bằng chứng yếu.

**Kết luận mới:** `review-pr-jev-classify` chuyển từ `PILOT` sang `SHADOW` (chạy song song, chỉ ghi log).
- Giả thuyết "Jev chỉ nâng mức nên làm lưới an toàn được" **không đứng vững trên PR thật**: trên PR 5240 các lần nâng mức trông hợp lý vì PR có lỗi cài sẵn, còn trên PR thật Jev chủ yếu nâng mọi thứ lên Major.
- Nếu muốn thử tiếp: chỉ gắn cờ khi mức mặc định trong rule của dự án đồng ý với Jev, và tính cả các lần sửa ở file doc hoặc test mà rule chỉ đến.

---

## 5. Nhóm A3–A12: `web-test` + Laya / Jev

### 5.1 Bản gốc `web-test`
- Lấy ticket ADO (`gemseducation/GEMS-HR-SCM`), sinh test case theo AC (thêm case negative / edge / regression).
- Mở trình duyệt riêng cho từng role (chrome-devtools MCP, dự phòng bằng playwright-cli), chụp screenshot từng bước.
- **Claude tự quyết** mỗi bước pass / fail / blocked. Trước các bước ghi dữ liệu, hỏi người dùng 1 lần (vì D365 dùng chung).
- Xuất `report.html` và `execution-log.html` (có token thật). Không có unit test.

### 5.2 Năm "plan": quyết định nào được giao cho engine

| Plan | Bản gốc làm thế nào | Biến thể giao cho engine | Ngưỡng / dự phòng |
|---|---|---|---|
| **wait** | Claude lặp `wait_for` + snapshot | `wait.mjs`, 1 lần gọi hỏi 3 câu: trang đã tải xong chưa (ready/loading/error), đang ở màn nào (1 trong 12 màn ESS), có phải trang login không | p ≥ 0.6. Rule quyết trước; engine chỉ được hỏi khi rule bí |
| **verdict** | Claude ghi status | `verdict.mjs`: engine chọn pass/fail/blocked dựa trên `expected` và `actual` | ≥ 0.85 tự ghi; 0.60–0.85 ghi kèm cờ review; < 0.60 để Claude quyết |
| **gate** | 1 câu hỏi người dùng | `gate.mjs`: engine xác định bước ghi (write) hay chỉ đọc (read). Khi engine hoặc keyword phản đối Claude thì Claude phải xem lại. `netlog.mjs` ghi lại mọi request ghi (non-GET) để audit | p(write) ≥ 0.5 → bị nghi; Claude không bao giờ được hạ một bước đã đánh dấu write |
| **oracle** | Claude ghi status | `oracle.mjs`: rule kiểm trước → engine → Claude | Pass cần p ≥ 0.95, fail cần p ≥ 0.85, còn lại → review |
| **ground** | Claude đọc snapshot để lấy uid | `find.mjs`: rule khớp tên → engine xếp hạng 2–15 ứng viên → danh sách ngắn | p ≥ 0.8 và hơn ứng viên thứ hai ≥ 0.25 |

- **Bản Laya:** gọi `localhost:8000`, chạy trên CPU local. Engine luôn là tùy chọn; khi tắt hoặc lỗi thì quay về rule hoặc Claude.
- **Bản Jev:** bản sao cơ học của bản Laya, đổi engine sang OpenRouter. Vẫn giữ cùng câu hỏi, nhãn và ngưỡng. Thêm bước xin đồng ý 1 lần và log chi phí riêng.
- **Ngoại lệ:** `jev-ground` là bản A/B có switch `--provider`, mặc định vẫn dùng Laya.

### 5.3 So sánh Laya và Jev: đánh giá offline (2026-10-14, `eval/REPORT.md`)

| Plan | Chỉ số | Laya | Jev |
|---|---|---|---|
| **gate** (24 case held-out) | Bỏ sót bước ghi / báo nhầm bước đọc là ghi / độ chính xác | 1/12 · 9/12 · 58% | **0/12 · 1/12 · 96%** |
| **wait** (51 trang) | Xác nhận đúng trang đã tải xong | 0/24 | **72/72** |
| | Báo nhầm là trang login | 14/44 | **0/132** |
| | Độ chính xác trạng thái trang | 70.6% | **96.1%** |
| | Test live trên Edge (8 kịch bản) | 5/8 | **8/8** |
| **verdict** (73 bước) | Tự quyết / chính xác khi tự quyết | 37% / 82% | 96% / 88% |
| | Riêng 20 bước thật: chính xác khi tự quyết | 67% | **52%** (kém) |
| **oracle** (81) | Tự quyết / báo pass sai | 2.5% / 0 | 69% / 0 (nhưng 3/30 bước pass bị báo fail) |
| **Tốc độ p50** | gate / verdict / oracle / wait | 579 / 648 / 863 / 2820 ms | 538 / 537 / 568 / 586 ms |
| **Chi phí** | | $0 (2.2 GB model) | $0.0185 cho 837 lần gọi |

### 5.4 Chạy agent thật: ticket 11840, 2026-10-15 (mỗi biến thể một session mới, chỉ đọc)

Phần lớn chạy trên staging, vì dev bị D365 giới hạn (429).

| Biến thể | Token | Thời gian | Engine tự quyết / chuyển cho Claude | Kết quả |
|---|---|---|---|---|
| web-test (gốc) | 87k | 281 s | – | PASS |
| laya-verdict | 96k | 559 s | 0 / 4 | PASS |
| jev-verdict | 97k | 572 s | 2 / 0 | PASS |
| laya-wait | 100k | 222 s | 4 bằng rule / 1 timeout | PASS⚠️ |
| jev-wait | 92k | 219 s | 4 / 0 | PASS⚠️ |
| laya-oracle | 97k | 195 s | 0 bằng Laya / 1 | PASS⚠️ |
| jev-oracle | 94k | 217 s | 1 "fail" sai, Claude sửa lại | PASS⚠️ |
| laya-gate | 101k | 233 s | 1 lần phản đối, bị bác | PASS |
| jev-gate | 96k | 168 s | 2 read đúng | PASS |

⚠️ Do bug, `wait.mjs` và `oracle --observe` đọc nhầm tab ẩn, nên engine không thấy đúng trang đang test.

**Kết luận chạy thật:** không biến thể nào giảm được token hay số lượt so với bản gốc. Chi phí Jev mỗi run chỉ $0.00002–0.0013.

### 5.5 Các lần chạy thật trên ESS dev, 2026-10-09 → 10-12 (`ess-test-runs/`)

| Ticket | Skill | Lượt / thời gian | Kết quả |
|---|---|---|---|
| 19358 | laya-wait | 20 / 2 phút | BLOCKED (dữ liệu test thuộc nhân viên khác) |
| 19358 | web-test (gốc) | 27 / 2 phút | PASS |
| 11840 | web-test (gốc) | 19 / 3 phút | BLOCKED 1 case |
| 11840 | laya-verdict | **38** / 3 phút | PASS, nhưng Laya không đủ tự tin ở bước nào |
| 11840 | laya-oracle | 35 / 3 phút | BLOCKED 1 case; 0 bước do Laya quyết |
| 11840 | laya-ground | **16** / 2 phút | PASS; mọi bước giải bằng rule |
| 11840 | jev-ground (dùng Laya) | 24 / 3 phút | BLOCKED 1 case; nhánh Jev chưa chạy |
| 11840 | laya-ground | 22 / 2 phút | PASS; mọi bước giải bằng rule |

Trên ticket 11840, tài khoản test không có giờ thực tế, nên case lỗi chính "0 vs 55" chưa tái hiện được lần nào.

### 5.6 Khuyến nghị cho `web-test`

| Skill | Khuyến nghị |
|---|---|
| jev-gate | `PILOT`: dùng Jev một mình, bỏ phép OR với keyword rule, giữ network audit (recall 100%, 1/12 báo nhầm) |
| jev-wait | `PILOT`: lọc text trang trước khi gửi, giữ regex, ưu tiên `error` hơn `login` |
| jev-oracle | `PILOT`: giữ ngưỡng PASS 0.95, **không bao giờ tự ghi FAIL** |
| jev-verdict | `DROP` mặc định: kém với các bước tham chiếu chéo nhau; cân nhắc gộp vào oracle |
| **laya-ground** | `ADOPT`: **biến thể đáng dùng nhất.** Chạy thật trên 11840: PASS cả 2 lần; so với bản gốc ít lượt hơn (16 so với 19), ít input token hơn (1.4M so với 1.7M), nhanh hơn (2 so với 3 phút), và không phải đọc snapshot trang. **Lợi ích đến từ rule `find.mjs`, không phải từ Laya:** trong 77 lần tìm element có log, rule tự giải 58 lần (75%), 16 lần trả danh sách ngắn cho Claude chọn, Laya chỉ quyết 3 lần (lúc thử nghiệm ngày 10-08) và **sai cả 3 với p = 1.0**, kể cả một lần chọn nhầm cho nút "Submit". → Dùng skill này với Laya **tắt** (hoặc gộp `find.mjs` vào `web-test` gốc). Lưu ý: run gốc so sánh có 3 case, run ground có 2 case. |
| Bản Laya còn lại (wait, verdict, gate, oracle) | `DROP` model. Đưa rule của `wait.mjs` và network audit của gate về bản `web-test` gốc (`ADOPT`) |

### 5.7 Sửa bug ngày 2026-10-15 (nhánh `claude/web-test-fixes-4fdcd7`, commit `0adb7a7`)
- **Đọc nhầm tab:** `page-select.mjs` mới chọn tab theo thứ tự rõ ràng (bỏ tab ẩn, ưu tiên tab đang focus, rồi đến tab mới tải), có thêm `--url <route>` để chỉ định trang. Khi không chắc thì dừng và liệt kê các tab, không đoán. Áp dụng cho `wait.mjs`, `oracle --observe` và `find.mjs` ở mọi bản.
- **Các lỗi khác đã sửa:** BOM trong `results.json`, thứ tự tham số của `launch-role.ps1`, comment sai trong `jev-gate/gate.mjs`.
- **Gate trước mỗi cú click** (`gate.mjs --check-action`), có ở cả bản Jev và bản Laya: nếu cú click trông như ghi dữ liệu mà bước đó đánh dấu chỉ đọc thì dừng lại hỏi.
- 🧪 **206/206 test pass** trên cả 11 bản. Eval `live-wait` chạy lại cho kết quả giống hệt.
- **Chưa chạy lại trên ESS** (cần bạn chọn môi trường), nên kết quả chạy thật của wait/oracle ở mục 5.4 vẫn là bản trước khi sửa.

---

## 6. Nhóm A13–A14: BMad (`bmad-help`, `bmad-code-review`) + Jev

**Bối cảnh:**
- BMad là bộ skill quy trình được cài riêng trong từng project: `ess-be` có khoảng 80 skill, `ess-fe` ít hơn.
- Hai skill mới là **wrapper mỏng**: không copy, không sửa BMad core. Lúc chạy, chúng đọc chính bộ BMad của project đó.
- Jev chỉ thêm một gợi ý (bmad-help) hoặc một layer review (bmad-code-review); skill gốc vẫn quyết định.
- Provider đổi được: `jev` (mặc định), `laya`, hoặc `kev` (Jev chạy local).
- **Plan:** `idea/jev-applicability-plan.md`.
- **Code:** nhánh `feat/bmad-jev-skills` (commit `9651d01`, 2026-10-15), đã push, chưa merge.

### 6.1 `bmad-help` so với `bmad-help-jev`

| | `bmad-help` (gốc) | `bmad-help-jev` |
|---|---|---|
| Làm gì | Đọc catalog skill của project và các artifact đã có, rồi tư vấn bước tiếp theo | Như bản gốc, nhưng trước đó Jev chọn ra tối đa 1 skill để gợi ý |
| Jev làm gì | — | **Lần gọi 1:** chọn 1 skill trên toàn catalog, kèm câu hỏi có/không "câu hỏi này có cần đến một skill không". **Lần gọi 2:** xếp hạng lại top 3 (đọc thêm 700 ký tự đầu của SKILL.md), kèm câu hỏi có/không "skill này có làm đúng việc được hỏi không". Ngưỡng 0.3 lấy theo cookbook TypeSafe, chưa đo lại |
| Ai quyết | Claude | Vẫn là `bmad-help` (Claude). Gợi ý của Jev chỉ là hint; cuối câu trả lời ghi Jev được nghe theo ("agreed") hay bị bác ("overridden") |
| Dữ liệu ra ngoài | Không | Câu hỏi, mô tả catalog, 700 ký tự đầu của tối đa 3 SKILL.md, tên file trong `_bmad-output/`. Không gửi nội dung file hay code |
| Đo lường | — | Ghi log mỗi lần chạy. Chế độ `--eval` tính tỉ lệ gợi ý sai và gợi ý thừa trên bộ câu hỏi có nhãn |

### 6.2 `bmad-code-review` so với `bmad-code-review-jev`

| | `bmad-code-review` (gốc) | `bmad-code-review-jev` |
|---|---|---|
| Làm gì | 4 layer reviewer mặc định chạy song song, sau đó triage: verify từng finding và chấm high / medium / low / false | Như bản gốc, thêm layer thứ 5 "Project Rules (Jev)" |
| Jev làm gì | — | **Một lần cho mỗi project:** phân loại các rule của project (semantic / mechanical / không phải rule), kèm phạm vi file áp dụng. **Mỗi lần review:** với từng cặp (rule semantic, hunk nằm trong phạm vi của rule), hỏi có/không "code thêm vào có vi phạm rule này không?". Cặp nào vượt ngưỡng thì thành finding |
| Ai quyết | Claude (bước triage) | Vẫn là triage của Claude: finding của Jev được verify như mọi finding khác. Jev không viết text, không chấm severity, không quyết chuyện merge |
| Dữ liệu ra ngoài | Không | Các dòng được thêm của từng hunk (kèm tối đa 12 dòng xung quanh), đường dẫn file, nội dung rule. Hỏi đồng ý một lần cho mỗi project |
| Đo lường | — | Ghi verdict triage của từng finding Jev, từ đó tính precision và số báo nhầm mỗi lần review |
| Cắm cố định | — | Có thể thêm layer vào `_bmad/custom/bmad-code-review.toml` (cơ chế custom có sẵn của BMad), không cần wrapper |

### 6.3 Mức test và kết luận

**Mức test:**
- 🧪 **Unit test** với provider giả: `bmad-help-jev` 9/9 pass, `bmad-code-review-jev` 8/8 pass (chạy lại 2026-10-15).
- **Dry-run:** phần đọc và parse đã chạy trên bộ BMad thật của `ess-be`, `ess-fe`, `pxp-workspace` (theo plan).
- ❌ **Chưa chạy với Jev thật lần nào.** Máy này không có log `~/.bmad-jev/`, và `ess-be` chưa có file `jev-rules.generated.json`.

**Kết luận: chưa đủ dữ liệu.** Thiết kế tốt: không đụng BMad core, tự thích nghi theo từng project, Jev chỉ gợi ý. Nhưng mới có unit test. Bước tiếp theo là pilot theo plan §5, với tiêu chí đã chốt trước:
- **`bmad-help-jev`:** khoảng 60 câu hỏi có nhãn trên `ess-be` và `ess-fe`. Giữ lại nếu cả tỉ lệ gợi ý sai lẫn gợi ý thừa đều giảm so với khi không gợi ý.
  - Cookbook của TypeSafe báo, trên catalog 182 skill: gợi ý sai giảm từ 16.8% xuống 7.3%, gợi ý thừa giảm từ 9.8% xuống 4.0%. Đây là số của nhà cung cấp, mình chưa kiểm chứng.
- **`bmad-code-review-jev`:** 10 PR đã merge của `ess-fe`. Giữ lại nếu bắt được vi phạm rule mà 4 layer hiện có bỏ sót, và số báo nhầm sau triage không quá 1 mỗi PR.
- **Trước khi pilot:** cần Security đồng ý cho gửi câu hỏi / diff ra OpenRouter, nếu không thì dùng Kev (chạy local).

---

## 7. Nhóm B: công cụ mới build từ đầu

### B1. Router proxy: Laya chọn Haiku / Sonnet / Opus trước mỗi request · ✅ Thực tế · `SHELVED`
- **Đã build:** `proxy/router_proxy.py`, proxy tương thích Anthropic API (cổng 8787). Proxy chặn mọi request có API key, chỉ cho đi qua đăng nhập OAuth của gói thuê bao, để không phát sinh chi phí ngoài gói.
- **Test:** chạy thật với Claude Code ngày 2026-10-01, 0 lỗi sau 7 quy tắc chuẩn hóa request. Benchmark live 15 task × 4 chiến lược.
- **Kết quả:** chi phí ước tính so với cố định Sonnet: **Sonnet 1.00x**, Laya 1.43x, LLM router 1.71x, cố định Opus 2.13x. Tỉ lệ pass: Sonnet 15/15, Laya 15/15. Mỗi lần đổi model phải dựng lại **47.5k token cache**.
- **Kết luận:** routing theo từng request đắt hơn dùng cố định Sonnet về mặt cấu trúc.

### B2. Workflow chọn model theo bước (5 subagent `wf-*` + hook hỏi Laya) · ✅ Thực tế · `DROP`
- **Test:** 2 task thật trong repo này.
- **Kết quả:** chi phí task 1: chạy Opus một luồng 285, Laya 667, phân bổ tĩnh 788. Task 2: 657, Laya 1283, tĩnh 1203. Xác suất Laya chỉ 0.42–0.55 (gần như hòa giữa các lựa chọn); hook chậm 1.8–4.7 s.
- **Kết luận:** chạy một luồng Opus vẫn rẻ hơn và nhanh hơn. Phần review chất lượng do người làm chưa thực hiện.

### B3. Error-triage hook: Laya gắn loại lỗi khi tool fail · 📊 Offline (dữ liệu thật) · `DROP`
- **Vòng 1** (45 lỗi tự tạo): Laya 36%, regex 87%.
- **Vòng 2** (89 lỗi thật, người dùng đã duyệt nhãn): Laya **28%**, rule 33%, mục tiêu 80%.
- **Held-out** (40 log mới): Laya 57.5% (0.7 s), **Sonnet 97.5%** (4.8 s, ~$0.007/log).

### B4. `ado-classify`: gợi ý module code cho task ADO · 📊 Offline (dữ liệu thật) · `PILOT`
- **Cách làm:** BM25 lọc 8 trong 27 module, sau đó Laya chọn 1 → trả về đường dẫn code.
- **Test:** 20 task ESS thật đã hoàn thành. Đáp án lấy từ chính các file `.cs` mà commit của task đó đã sửa.
- **Kết quả:** **18/20**, ~1.1 s. Laya một mình (27 lựa chọn): 6/20; BM25 một mình: 9/20.
- **Còn thiếu:** chưa tích hợp vào Claude Code (MCP), chưa so với Haiku, chưa A/B khi đang code. Gọi qua CLI mất 8–12 s vì phải nạp lại model mỗi lần.

### B5. Cache-expiry gate hook · ✅ Đang dùng · 🧪 29 test pass · `ADOPT`
- **Chức năng:** chặn 1 lần trước khi gửi prompt nếu cache lớn đã hết hạn và sắp phải dựng lại. Không dùng model; mất 65–90 ms.
- **Thực tế:** 9 lần chặn trong khoảng 10-05 → 10-11; người dùng đều chọn gửi tiếp. Mỗi lần dựng lại cache tốn thêm ước tính $0.26–3.64.

### B6. `laya-launcher` + shim `claude` · ✅ Thử thực tế · `PILOT` (dùng flag tĩnh)
- **Cách làm:** Laya đoán intent, rồi giới hạn `--tools` / MCP / slash commands của session.
- **A/B trên pxp-ai #1697** (Opus, mỗi cấu hình 5 run):
  - Context cố định giảm 23.8k → 11.0k token (−54%); chi phí giảm khoảng 8%.
  - Tỉ lệ pass: L1 5/5, plain 2/5.
- **Điểm cần lưu ý:** cải thiện **đến từ bộ flag, không phải từ Laya** (Laya luôn trả lời "bugfix"). Read-gate L2 chặn mất file cần thiết (0/5) → `DROP`.

### B7. `fast-compact` plugin · ✅ 1 session thật · 🧪 13 test · `ADOPT`
- **Đánh giá Jev cho việc chọn nội dung cần giữ:** Jev giữ đúng 0/38 lần gọi còn cần (không lần nào vượt p 0.5), còn rule giữ đúng 38/38 → bỏ Jev.
- **Bản rule:** rút gọn 254k → 57k token (−77%) trong 57 ms, không gọi model.
- **Kết luận:** dùng được ngay. Plugin là opt-in (người dùng tự gọi), chạy bằng rule nên không tốn token và không gửi dữ liệu ra ngoài. Đã merge vào `main` (PR #3, 2026-10-15). Việc còn lại: theo dõi thêm trên vài session thật (hiện mới chạy 1 session).

### B8. Gói cài Laya cho Windows · ✅ cài thật trên 2 máy · `DONE`
- `install-laya.ps1` (uv + Python 3.12, `laya==0.3.21`), cùng `serve.py` đã vá (thêm form trên Swagger) và `start-laya.bat`.

---

## 8. Nhóm C: thí nghiệm đánh giá (nghiên cứu)

| # | Thí nghiệm | Dữ liệu | Kết quả chính | Kết luận |
|---|---|---|---|---|
| C1 | Smoke test 10 câu Bug/Feature/Task | 10 câu tự viết | 8/10, 2.3 s/câu | Chỉ để kiểm tra |
| C2 | Routing 3 tầng (bước A) | 60 prompt tổng hợp | 47/60 (chỉ prompt), 50/60 (có thêm tín hiệu) | Tín hiệu quá lạc quan |
| C3 | Routing đa tín hiệu | 60 prompt | Không hơn bước A, chậm gấp 4 lần | `DROP` |
| C4 | Benchmark offline (bước D) | 60 prompt | Thêm ngưỡng làm kết quả tệ hơn | Đã thay bằng benchmark live (B1) |
| C5 | Hiệu năng Laya trên CPU | Tải tổng hợp | p50 314 ms, 3.2 lần/s, 1425 request / 0 lỗi; input 4k token mất 15 s | Đủ cho dev, chưa đo GPU |
| C6 | Laya gợi ý tầng model cho work item ADO | 122 item thật | 56%, **bằng "luôn chọn Sonnet"** | Chỉ dùng làm gợi ý cho người |
| C7 | Audit token (Phase 0) | 12 session thật ($295) | Cache-read chiếm 97% token / 49% chi phí; trần tiết kiệm của "dead context" chỉ 2.4% | Dùng rule, gác Laya |
| C8 | Nghiên cứu skill `laya-router` (bên thứ ba) | Review code | Chỉ mang tính tham khảo, chạy sau khi đã trả tiền model | Không giải được bài toán routing |
| C9 | Ý tưởng: security guardrail, triager MCP, observation routing | — | — | `IDEA` |

---

## 9. Nhóm D: skill mới build từ đầu với Jev (repo `JEV`)

**Bối cảnh:**
- Repo riêng `danhnguyen-xiontechs/JEV`. Gồm 5 skill viết theo các plan trong `docs/ideas/`; mỗi skill là một project skill đi kèm một package Python chỉ dùng thư viện chuẩn.
- **Nguyên tắc chung:** Jev chỉ là lớp gợi ý; rule hoặc Claude quyết định cuối cùng. Khi Jev lỗi, skill không bao giờ đưa ra kết luận mạnh hơn.

**Cách test:**
- 🧪 **Unit test:** 84 test, pass hết (chạy lại ngày 2026-10-15).
- 📊 **Offline:** mỗi skill có bộ demo/eval riêng, dữ liệu tổng hợp do Claude dựng, có sẵn đáp án đúng.
- ✅ **Thực tế (2026-10-15):** 7 session Claude Code thật (headless, Sonnet), prompt viết tự nhiên, không nêu tên skill.
  - Claude tự chọn đúng skill cả 4/4 lần.
  - Tìm ra 2 bug thật và 3 điểm dùng chưa tốt mà unit test không bắt được; tất cả đã sửa.
  - Chi phí: Claude khoảng $1.18, Jev dưới $0.003.

### 9.1 Tổng quan 5 skill (và nền `jev_advisor`)

| # | Skill | Làm gì | Jev làm gì | Test thực tế 2026-10-15 | Kết luận |
|---|---|---|---|---|---|
| D1 | `acceptance-criteria-coverage` | Lập ma trận AC ↔ test (Covered / Partial / Missing / Failed) | Phân loại từng cặp (AC, test). Cặp `unrelated` với p ≥ 0.9 thì Claude khỏi đọc test đó | ✅ Ma trận đúng cả 5 AC | `PILOT` |
| D2 | `dead-code-finder` | Tìm code chết và rác (print debug, code bị comment) | Phân loại các ứng viên còn lại sau keep rules. Chỉ khi Jev xác nhận thì mục mới được vào Tier A "xóa được" | ✅ Tìm đúng; lộ bug: 1 class còn sống bị xếp Tier A (đã sửa) | `PILOT` |
| D3 | `git-risk-scanner` | Chấm điểm rủi ro của file từ lịch sử git; hook bật "defensive mode" trước khi sửa file rủi ro | Đọc commit message, chỉnh điểm của công thức trong một biên giới hạn | ✅ Hook chạy đúng; Claude ban đầu tự chọn chạy không Jev (đã sửa hướng dẫn) | `PILOT` |
| D4 | `subagent-validator` | Hook kiểm tra diff của subagent có lệch khỏi task / scope không | Hỏi từng hunk "có phục vụ task không?". Chỉ chặn khi Jev **và** rule cùng chỉ ra trên một file | ✅ Chặn đúng 1 lần, không lặp, không báo nhầm; lộ bug snapshot khi repo có `.gitignore` (đã sửa) | `PILOT` |
| D5 | `context-curator` | Lược log test dài trước khi Claude đọc (mới có chế độ shadow) | Đánh dấu các chunk log an toàn để bỏ | ⚠️ Chỉ lược được 2.2% log khó, Claude phải tự trích | `PILOT` (shadow) |
| D0 | `jev_advisor` (nền của D5) | Wrapper chạy test, thêm gợi ý "xem chỗ này trước" cho log lỗi dài | Gợi ý chunk đáng xem | A/B/C 30 run: cả 3 nhánh đều đúng 30/30 | `PILOT` (chưa chứng minh lợi ích) |

### 9.2 Jev đóng góp bao nhiêu? (đo trên bộ demo)

| Skill | Không có Jev | Có Jev | Mức Jev đóng góp |
|---|---|---|---|
| D1 ac-coverage | Claude phải tự đọc cả 30 cặp | Jev gắn đúng nhãn 30/30 cặp. Claude bỏ qua được 16/30 cặp (52% code test), không sót cặp liên quan nào. Chi phí $0.0007 | **Cao:** Jev là bộ lọc chính. Chưa đo bản để Claude tự làm |
| D2 dead-code | Keep rules: 0 decoy ở Tier A, nhưng Tier A cũng rỗng (0/14 code chết); nhãn rác đúng 79% | 10/14 code chết lên Tier A, vẫn 0 decoy; nhãn rác đúng 100% | **Cao ở phần "dám xóa".** Phần an toàn đến từ keep rules (28 decoy → 0). Lần chạy thật, Jev báo nhầm 1 class còn sống là chết (p 0.91) |
| D3 git-risk | Công thức đã flag đúng 2/2 file rủi ro (P = R = 1.0) | Vẫn 2/2. Tương quan với nhãn "fix hoặc incident" tăng từ 0.28 lên 0.58, nhưng tương quan với số lần fix không đổi (0.44 → 0.43) | **Thấp:** công thức làm phần chính; Jev chủ yếu thêm lý do vào cảnh báo |
| D4 subagent-validator | Rule scope không biết một hunk có phục vụ task hay không | Xác suất tách bạch: hunk lệch p 0.03–0.05, hunk đúng p 0.92–0.97. Bắt 5/5 ca lệch, chặn 4/5, không chặn nhầm ca nào (0/4). Hunk sửa README thì mơ hồ (0.54–0.6) | **Khoảng 50/50:** muốn chặn phải có cả Jev và rule |
| D5 curator | — | Log dễ: lược được 69–92%. Log khó (h01–h08): chỉ 11–39%, vì Jev chỉ xem tối đa 80 chunk. Không mất bằng chứng ở ngưỡng 0.2 | **Thấp trên log khó**, đúng chỗ cần nhất |
| D0 advisor | Không wrapper: đúng 30/30 | Chỉ rule: 30/30. Có Jev: 30/30. Có 1 gợi ý Jev trỏ nhầm (Claude tự bỏ qua). Lần chạy thật trên h05, gợi ý p 0.73 trỏ vào red herring | **Chưa đo được:** bộ dễ đã chạm trần; bộ khó h01–h08 đã dựng nhưng chưa chạy |

**Dữ liệu gửi ra OpenRouter:**
- D1: text AC và code test.
- D2: đoạn code.
- D3: commit message.
- D4: diff hunk.
- D5 / D0: các chunk log test.

### 9.3 Kết luận cho nhóm D

**Cả 5 skill đều chạy được và không tệ → `PILOT`.** Nhưng mức Jev đóng góp không đều, không phải 50/50 ở mọi skill:
- **Cao:** D1, D2. Jev là phần phân loại chính và chính xác trên demo.
- **Khoảng 50/50:** D4. Muốn chặn phải có cả Jev và rule.
- **Thấp hoặc chưa đo được:** D3, D5, D0. Rule / công thức làm phần chính; Jev thêm được ít, hoặc lợi ích chưa đo ra.

**Điều kiện để lên `ADOPT`:**
1. Commit code. 5 skill hiện đang nằm **chưa commit** trong worktree `claude/review-5-plans-idea-folder-ce4d36`.
2. Chạy trên repo thật của team (ví dụ `ess-be`), không chỉ demo.
3. Đo bản để Claude tự làm, không dùng skill, để biết skill tiết kiệm được gì.
4. Mỗi kịch bản chạy nhiều lần, vì hành vi LLM thay đổi giữa các lần.
5. Security đồng ý cho gửi dữ liệu ra OpenRouter.
6. Quyết định có đăng ký 2 hook (D3, D4) vào `.claude/settings.json` hay không. Hiện chưa bật mặc định.

---

## 10. Nhóm E: `skills-router`: gợi ý skill diện rộng (build mới, có Jev tùy chọn)

**Ý tưởng:**
- Lấy cảm hứng từ `bmad-help` nhưng rộng hơn. `bmad-help` chỉ gợi ý trong skill của BMad; `skills-router` gợi ý trên **toàn bộ** skill, slash command và subagent đang cài.
- Router chỉ là lớp gợi ý, Claude vẫn quyết định cuối. Router cũng dám nói "không cần skill nào".

**Cách hoạt động:**
- **Catalog gộp nhiều nguồn:** skill của project, của user, skill đồng bộ từ claude.ai, plugin đã cài, slash command, subagent, catalog BMad và các skill có sẵn trong Claude Code. Catalog loại trùng theo thứ tự ưu tiên và nhận ra skill chỉ được gọi bằng lệnh tường minh. Trên `ess-be` có 172 mục sau khi loại trùng.
- **Chọn qua 2 tầng:** BM25 lọc top 8, rồi (tùy chọn) một lần hỏi engine `laya`, `kev` hoặc `jev`: chọn skill, cổng "có cần skill không" và độ khớp của top 3.
- **Mặc định `none` (chỉ BM25):** không có dữ liệu nào rời máy.
- **Có thêm:** công cụ lấy dữ liệu từ lịch sử transcript, bộ eval, và hook shadow `UserPromptSubmit` (chưa đăng ký vào `settings.json`) để gom nhãn thật dần.
- **Code:** nhánh `claude/skills-router-62fc74`, 3 commit (`1f097b4`, `3aa3ffa`, `b604a57`), chưa push.

**Mức test:**
- 🧪 **Unit test:** 46/46 pass (chạy lại 2026-10-15).
- 📊 **Offline trên 199 scenario tự soạn** (kịch bản viết mới theo phong cách lịch sử, chốt tách dev/test trước khi chạy).
- ✅ **Dữ liệu thật:** 368 prompt lấy từ lịch sử Claude Code của chính bạn (15 prompt bị lọc vì có thể chứa bí mật). Chỉ 16 prompt có nhãn là một skill cụ thể.

### 10.1 Kết quả trên 199 scenario tự soạn

Số liệu trên toàn bộ 199 scenario, ngưỡng chọn trên tập dev:

| Router | Chọn đúng ngay lần đầu | Gợi ý sai | Gợi ý thừa | Độ chính xác chung | Độ trễ (p50) | Chi phí |
|---|---|---|---|---|---|---|
| BM25 | 64% | 7% | 2% | 73% | 5 ms | $0 |
| Laya (english) | 54% | 13% | 11% | 62% | 6.2 s | $0 |
| Laya (multilingual) | 31% | 12% | 10% | 54% | 2.9 s | $0 |
| **Jev** | **78%** | 10% | 5% | **86%** | 0.54 s | $0.0100 cho 199 lần gọi |

- **Jev vượt rõ ở nhóm khó:** prompt ý định ngầm (không nêu tên skill) đúng 68% (BM25 32%, Laya 13% và 0%); prompt ngắn, mơ hồ hoặc gõ sai đúng 84% (BM25 26%).
- **Với ngưỡng mặc định** (gate / fit 0.3): Jev vẫn giữ độ chính xác 85%, còn BM25 tụt xuống 53% (gợi ý thừa 59%) và Laya english xuống 52% (gợi ý thừa 39%).
- **Lỗi của Jev ở nhóm skill trùng việc:** sai 8/31 (BM25 sai 11/31). Mọi lỗi cùng một dạng: người dùng yêu cầu bản biến thể (ví dụ "chạy Laya severity check") nhưng router gợi ý skill gốc `review-pr`. Nguyên nhân là bộ lọc "chỉ gọi khi nêu rõ tên".
- **Laya không thắng BM25** ở bài này và chậm hơn 3–6 s mỗi lần.

### 10.2 Kết quả trên prompt thật (368 prompt từ lịch sử)

| Router | Chọn đúng ngay lần đầu | Gợi ý sai | Gợi ý thừa | Độ trễ (p50) |
|---|---|---|---|---|
| BM25 | 50% | 0% | 8% | 5 ms |
| Laya (english) | 31% | 0% | 2% | 7 s |
| Laya (multilingual) | 31% | 19% | 17% | 3 s |
| **Jev** | **50%** | 13% | 10% | 0.55 s |

- **Jev chỉ hòa BM25**, không vượt. Chi phí thật: **$0.0215** cho 325 lần gọi (khoảng $0.00007 mỗi lần), không lỗi.
- **Nhãn quá ít:** chỉ 16 case có nhãn skill, trong đó 5 thuộc tập test. Lệch 1–2 case là nhiễu. Phần lớn prompt thật là chat thường (không cần skill) và bằng tiếng Việt.
- **Ngưỡng mặc định:** Jev gợi ý sai 19% và thừa 22%, so với BM25 là 50% và 77%.
- **Xác suất của Jev không "luôn 1.0":** chỉ 25% lần gọi có xác suất từ 0.95 trở lên. Quá tự tin ở đây không gây ra skill sai, mà gây gợi ý thừa trên prompt không cần skill (84/309 prompt "không cần skill" vẫn bị Jev đặt một skill lên đầu).
- **Phát lại 383 prompt qua hook shadow** (cục bộ, ngưỡng mặc định): BM25 gợi ý thừa 78%, Laya english 53%, cùng chiều với kết quả trên scenario.

### 10.3 Vì sao hai bảng cho kết luận lệch nhau

- **Scenario là tình huống do Claude dựng:** sạch hơn, cân bằng hơn, nhãn do Claude tự đặt (kể cả 12 case chấp nhận nhiều đáp án và quy tắc "yêu cầu bản biến thể"). Nó cho thấy router **xử lý tốt các loại câu hỏi khác nhau đến đâu**, và ở đó Jev vượt rõ. Độ chính xác thật nhiều khả năng thấp hơn.
- **Prompt thật** phản ánh hành vi thực, nhưng nhãn quá ít để kết luận, và đa số là chat thường.
- Hai nguồn cùng chỉ ra một điều: **Jev nhanh, rẻ, không tệ hơn BM25, và tốt hơn ở prompt ngầm / mơ hồ**, nhưng không có bằng chứng thật là nó vượt hẳn BM25.

### 10.4 Kết luận cho `skills-router`: `PILOT`

- **Mặc định giữ BM25:** ngang Jev trên prompt thật, tức thì, miễn phí, không gửi gì ra ngoài.
- **Jev là bước thứ hai tùy chọn**, dùng khi người dùng chủ động hỏi "nên dùng skill nào". Ở đó Jev tốt hơn rõ rệt trên scenario, 0.5 s và vài phần nghìn cent mỗi lần.
- **Không dùng để định tuyến mọi prompt một cách thụ động:** gợi ý thừa còn cao, và ngưỡng chọn từ 16 nhãn chưa đủ tin cậy.
- **Laya không có chỗ đứng ở bài này:** không hơn BM25 về chọn skill và chậm hơn nhiều.

**Việc còn lại:**
1. Bật hook shadow một thời gian để có nhãn thật (hiện là nhãn "Claude đã gọi skill nào", chưa chắc là skill đúng).
2. Sửa lỗi nhóm skill trùng việc: khi người dùng yêu cầu bản biến thể thì không gợi ý skill gốc.
3. Chọn ngưỡng BM25 riêng cho từng catalog: ngưỡng mặc định 3 quá thấp, và tốt nhất khoảng 10 trên scenario và 19 trên prompt thật.
4. Làm tiếp các ý đã gác lại: kiểm tra chất lượng mô tả skill từ ma trận nhầm lẫn, và gợi ý chuỗi skill.

**Dữ liệu gửi cho Jev khi chạy lại trên prompt thật:** prompt (600 ký tự đầu), tên và mô tả của tối đa 8 skill ứng viên (kèm 500 ký tự đầu của SKILL.md), cùng một cờ có/không cho biết prompt có URL PR. Không gửi đường dẫn file, tên project hay nội dung file. Mô tả skill của các dự án tương ứng cũng được gửi.

### 10.5 Vòng 2 (2026-10-15, commit `5e23728`)
- **Sửa lỗi bản biến thể:** router đưa bản biến thể vào danh sách ứng viên khi prompt có từ phân biệt nó với skill gốc (laya, jev, "severity check", …). Jev đúng **31/31** scenario nhóm trùng việc (trước đó 23/31). Độ chính xác tổng lên **91%** (trước đó 86%); BM25 75%.
- **Đồng thuận (ý 4):**
  - Trên scenario, đồng thuận làm độ chính xác giảm còn 82%, vì mỗi lần BM25 và Jev chọn khác nhau thì Jev đều đúng (19/19).
  - Trên 368 prompt thật (tính offline, không gọi Jev lại), bỏ qua các trường hợp không đồng thuận làm gợi ý sai giảm từ 13% xuống 6% và gợi ý thừa từ 10% xuống 6%, đổi lại mất 2 trong 8 gợi ý đúng.
- **Self-consistency k=3 (ý 5) không giúp gì:** chỉ 4/169 prompt đổi câu trả lời khi đảo thứ tự, mà chi phí gấp 3.
- **Cấu hình đề xuất:** khi người dùng chủ động hỏi thì dùng Jev k=1 và đánh dấu "độ tin cậy thấp" khi không đồng thuận; với hook shadow thì bỏ qua khi không đồng thuận.
- Vòng này tốn $0.03. 🧪 **65/65 test pass.**

---

## 11. Nhóm F: `subagent-model-router`: chọn model cho từng subagent (build mới)

**Vì sao làm:**
- Nếu sau này công ty chạy song song khoảng 20 subagent (mỗi subagent một story), quota sẽ tiêu chủ yếu theo model của subagent.
- Chọn model theo từng request đã thua vì đổi model làm mất prompt cache. Subagent thì có context riêng, nên chọn model cho nó **không làm mất cache** của luồng chính.

**Cách hoạt động:**
- **Hook `PreToolUse` gắn vào tool Agent:** đặt `model` cho subagent khi người gọi chưa đặt. Đã thử thật bằng `claude -p`: subagent chạy Haiku trong khi luồng chính là Sonnet. Có thêm CLI `route.mjs` cho orchestrator.
- **Chọn tầng model:** bằng rule (loại subagent, động từ của task, số file/AC, có test hay không), tùy chọn thêm Jev kèm đồng thuận và self-consistency.
- **Leo model khi trượt:** chạy ở tầng được chọn; nếu kiểm tra tự động fail thì chạy lại một lần ở tầng cao hơn.
- **Mặc định:** chế độ shadow (chỉ ghi log), chỉ dùng rule. Hook chưa đăng ký vào `settings.json`.
- **Code:** nhánh `claude/subagent-model-router-f7f0e3` (`c83ddf5`, `2b90d97`, `a487901`), chưa push.

**Lịch sử thật trên máy này (132 subagent):**
- Subagent chiếm 28% chi phí ($136 trên $479, tính theo giá list).
- 98% subagent không đặt model nên dùng chung model của luồng chính: Sonnet 75%, Opus 24%, Haiku gần như 0%.
- Theo bảng giá dùng trong benchmark, Haiku rẻ hơn Sonnet khoảng 20 lần mỗi token, nên khoản tiết kiệm chủ yếu đến từ việc chuyển việc nhẹ sang Haiku.

**Benchmark 18 task có kiểm tra tự động** (explore, sửa lỗi nhỏ, refactor, viết test, thiết kế/debug):

| Cách chọn model | Pass | Chi phí so với luôn dùng Opus |
|---|---|---|
| Luôn Opus | 18/18 | 100% |
| Luôn Sonnet | 18/18 | 61% |
| **Chỉ dùng rule + leo model khi trượt** | **18/18** | **14%** |
| Jev | 18/18 | 48% |
| Jev + đồng thuận + self-consistency | 18/18 | 51% |

- **Haiku làm được 17/18 task.** Task còn lại (d5-deps) Haiku trượt vì hiểu đề quá sát chữ; leo lên Sonnet thì pass. Một lần Haiku trượt chỉ tốn khoảng $0.01, rẻ hơn việc cố đoán trước.
- **Jev hơi thận trọng:** chưa lần nào chọn model quá thấp, nhưng chọn Sonnet cho 12 task mà Haiku làm được, nên tốn khoảng gấp 3.5 lần so với rule + leo model. Jev ổn định trên 16/18 task khi hỏi 3 lần.
- **Chi phí benchmark:** khoảng $4 (pilot 6 task × 3 model $2.72; vòng 2 gán nhãn 12 task còn lại theo kiểu thử Haiku trước $1.32).

**Kết luận: `PILOT`, tiềm năng tiết kiệm quota lớn nhất trong cả dự án.**
- **Story có test hoặc AC:** dùng rule + leo model khi trượt, không cần Jev.
- **Story không có kiểm tra tự động:** dùng Jev + đồng thuận, vì không có gì bắt được khi chọn sai model.
- **Thu kết quả subagent theo lô** để giảm số lần đánh thức luồng chính (vòng 2 tốn chi phí luồng chính chỉ bằng 1/3 pilot nhờ cách này).

**Hạn chế:**
- Task nhỏ, tự soạn, mỗi task chạy 1 lần cho mỗi model.
- 23/54 ô kết quả là suy ra, theo giả định "model thấp pass thì model cao cũng pass".
- Chưa thử task không có kiểm tra tự động, chưa thử trên story thật.

**Việc tiếp theo:** chạy thử trên vài story thật có AC (`ess-be` / `ess-fe`), và bật hook ở chế độ shadow để so với model đang thực sự được dùng.

### 11.1 Pilot trên ess-be với story thật (2026-10-15, commit `5efd93a`)
- **Cách làm:**
  - Claude tự viết 6 user story thực tế cho ess-be (validation, filter tìm kiếm, sửa bug có bẫy, endpoint mới, refactor 10 file, một story cần quyết định thiết kế), mỗi story có AC và bộ test ẩn.
  - Mỗi story do 1 subagent làm, so 2 cách trên các worktree nháp:
    - A: luôn dùng Sonnet;
    - B: router chọn model, kèm leo model khi trượt.
- **Kết quả:**

| Story | A: Sonnet | B: Router | Leo model |
|---|---|---|---|
| S1 validation | ✅ $0.326 | Haiku ✅ $0.020 | không |
| S2 filter tìm kiếm | ✅ $0.241 | Haiku ✅ $0.024 | không |
| S3 sửa bug có bẫy | ✅ $0.428 | Haiku ✅ $0.023 | không |
| S4 endpoint mới | ✅ $0.763 | Haiku ✅ $0.029 | không |
| S5 refactor 10 file | ✅ $0.191 | Haiku ✅ $0.014 | không |
| S6 thiết kế (chỉ build và suite) | ✅ $0.229 | **Opus** ✅ $0.666 | không |
| **Tổng** | **$2.18** | **$0.78 (36%)** | 0 |

- **Cả hai tiêu chí đều đạt:** router pass mọi story mà bản Sonnet pass, chất lượng diff không kém hơn (ở S6, Opus còn bám quy ước dependency injection của ess-be tốt hơn); quota subagent chỉ bằng **36%** so với A (ngưỡng đặt ra là ≤ 50%).
- **Ba lưu ý:**
  - **4/5 lần chọn Haiku là do bug** ở rule: câu "do not change them" trong prompt khiến rule hiểu nhầm story code là việc chỉ đọc. Không có bug thì S1, S2, S4, S5 sẽ chạy Sonnet. Dù vậy, Haiku vẫn pass cả 5 story. Bug đã sửa ở commit `24bd4b6`, nhánh `claude/router-readonly-fix` (20/20 test).
  - **Chưa lần nào phải leo model,** nên cơ chế "trượt thì leo lên model cao hơn" vẫn chưa được kiểm chứng.
  - **Subagent không chạy qua hook thật:** chế độ auto chặn việc mở session `claude -p` từ script, nên session tự spawn subagent với model do `route.mjs` chọn (cùng logic chọn model với hook). Ngoài ra ess-be đã có sẵn 17 test fail trên bản sạch, nên "suite xanh" được hiểu là không có fail mới.
- **Kết luận:** vẫn là `PILOT`, và giờ là `PILOT` có bằng chứng thật tốt nhất trong dự án.
  - Story có kiểm tra tự động: dùng rule + leo model khi trượt.
  - Story không có kiểm tra: không bao giờ bắt đầu bằng Haiku.
  - Bước tiếp theo: chạy lại trên 15–20 story ADO thật sau khi sửa bug, để thấy các lần trượt và leo model thật.

---

<!-- BEGIN retry-loop-breaker -->
## Retry Loop Breaker: mod Claude Code (plan 02, Jev tùy chọn)

**Vì sao:** Claude đôi khi chạy lại đúng lệnh test/build vừa lỗi mà không sửa gì, tốn lượt. Không phải lần chạy lại nào cũng thừa (sau khi sửa code, sau lỗi mạng, test chập chờn), nên mod phải phát hiện *không có tiến triển*, không chỉ "lệnh này từng lỗi".

**Cách hoạt động:**
- **Mod Claude Code** (`retry-loop-breaker/`, function hook, `tool.call` trên Bash). Chỉ xét lệnh kiểm tra đơn giản (`npm test`, `dotnet test/build`, `pytest`, `go test`, `cargo test`, `tsc`, … và danh sách cấu hình thêm). Lệnh có pipe, `&&`, chuyển hướng, biến môi trường, deploy/git/dữ liệu thì không bao giờ đụng tới.
- **Sau lần chạy lỗi:** lưu một bản ghi nhỏ theo session (`$.state`): lệnh đã chuẩn hóa, dấu vân tay lỗi (hash FNV các dòng lỗi, đã che thời gian, thời lượng, đường dẫn tạm, hex, UUID), tóm tắt ngắn, mutation epoch; TTL 30 phút, tối đa 50 bản ghi. Không lưu log thô.
- **Trước lần chạy tiếp:** cùng lệnh + cùng dấu vân tay + cùng epoch, đã gặp `maxIdenticalFailuresBeforeBlock` lần (mặc định 2) → chế độ `enforce` trả `{ deny }` kèm lý do và bước nên làm; chế độ `observe` (mặc định) chỉ ghi `would_block`.
- **Thế nào là "có thay đổi":** Edit/Write/NotebookEdit thành công (từ bất kỳ agent nào), lệnh Bash không read-only theo chính engine, hoặc người dùng gõ "rerun / try again / chạy lại". Lỗi tạm thời (ECONNRESET, 429, 503, NuGet feed…) và test chập chờn (đã thấy cả pass lẫn fail) không bao giờ bị chặn. Bị từ chối quyền, bị ngắt, chạy nền thì không tính là lỗi.
- **Jev chỉ khi mơ hồ:** lệnh *gần giống* (Jaccard token ≥ 0.6, cùng runner) một lệnh đã chạm ngưỡng. Enum cố định `allow_retry | block_redundant_retry | uncertain_allow`, kiểm tra chặt, timeout 4 s; chỉ chặn khi `block_redundant_retry` với p ≥ 0.8. Timeout, lỗi, output sai → cho chạy.
- **Mặc định chỉ agent chính**; có `/retry-guard status` và `/retry-guard reset` (API đã cài hỗ trợ slash command).
- **Phase 0 kiểm trên bản đã cài** (Claude Code 2.1.300, types sinh ra 2.1.295): input `tool.call` là tham số của tool cộng `agentId` (không có ở loop chính); exit code khác 0 trả về `isError: true` với `text` "Exit code N…"; trả `{ deny }` mà không gọi `next` thì lệnh bị từ chối và tool không chạy; `$.state` theo session, giữ qua hot reload. `claude plugin validate` đạt; `tsc` sạch.

**Test nhanh (fixture nhỏ, chưa phải pilot):**

| Trường hợp (§12) | Kết quả |
|---|---|
| Lặp đúng test lỗi, không đổi gì | chặn ở lần 3 (ngưỡng 2), lần 2 với ngưỡng 1 |
| Cùng build, cùng lỗi biên dịch (thời gian khác) | chặn |
| Chạy lại sau khi sửa code thành công | cho chạy |
| Cùng lệnh, lỗi khác | cho chạy (đếm lại) |
| Lỗi mạng tạm thời | cho chạy |
| Test chập chờn (fail → pass → fail) | cho chạy |
| Gần giống, khác test/project | Jev `allow_retry` 1.00, hoặc không đủ giống → cho chạy |
| Gần giống, cùng test thêm một cờ | Jev `block_redundant_retry` 0.95–0.99 |
| Bị từ chối quyền | không ghi nhận, cho chạy |
| Lệnh có tác dụng phụ / ghép lệnh | không thuộc diện, không đụng |
| Jev timeout / JSON sai / ngoài enum / độ tin thấp | cho chạy |
| Người dùng yêu cầu chạy lại | epoch mới, cho chạy |
| Session mới / workspace khác / hết TTL | không rò rỉ |

- 8 test engine (`claude plugin test`, engine thật) + 14 unit test: đều đạt. **0 lần chặn sai.** 4 lần gọi Jev thật, mỗi lần khoảng 0.5–0.65 s.
- Chưa đo: precision/recall trên session thật, token hay lượt tiết kiệm. Mod **chưa cài** ở đâu; mặc định `observe`.

**Kết luận: PILOT** (chạy observe trên việc thật trước; chỉ bật enforce khi log would-block cho precision ≥ 80%).

**Giới hạn:** epoch chỉ là xấp xỉ (sửa file ngoài tool của Claude, ví dụ trong IDE, không thấy; sửa file không liên quan cũng mở chặn); lệnh chạy qua script alias không thuộc diện; Jev chỉ thấy hai lệnh và một dòng tóm tắt lỗi.
<!-- END retry-loop-breaker -->

## 12. Kết luận chung

| Câu hỏi | Trả lời |
|---|---|
| Laya có thay được LLM call lặp lại không? | **Hầu như không.** Laya chỉ ổn với text ngắn và ≤ 8–10 lựa chọn, có bộ lọc trước (ado-classify). Laya kém với log dài, nhiều lựa chọn, tiếng Việt; xác suất không đủ tách bạch để đặt ngưỡng. |
| Jev có tốt hơn không? | **Có, chính xác hơn rõ rệt**, lại rẻ và nhanh. Trên review-pr, Jev đồng ý 12/18 và chỉ nâng mức (Laya 7/18). Nhưng Jev quá tự tin, dữ liệu rời mạng, và khi chạy agent `web-test` thật chưa giảm được token. |
| Chọn model theo request hoặc theo bước có tiết kiệm không? | **Theo request hoặc theo bước: không**, vì đổi model làm mất prompt cache. **Theo từng subagent: có**, vì subagent có context riêng; trên benchmark, rule + leo model khi trượt chỉ tốn 14% so với luôn dùng Opus (mục 11). |
| Đồng thuận và self-consistency có thay được ngưỡng không? | **Đồng thuận: có ích trên dữ liệu thật nhiều nhiễu** (skills-router: gợi ý sai 13% → 6%), nhưng có hại trên dữ liệu sạch. **Self-consistency: không**, vì Jev gần như luôn trả cùng một đáp án khi đảo thứ tự (skills-router: chỉ 4/169 prompt đổi; review-pr: 17/18 ổn định). |
| Router skill diện rộng có đáng làm không? | **Có, ở dạng tùy chọn.** `skills-router`: Jev tốt nhất trên scenario tự soạn (91% sau vòng 2), nhưng trên prompt thật chỉ hòa BM25. Laya không có chỗ đứng. Cần thêm nhãn thật qua hook shadow. |
| Skill mới build quanh Jev thì sao? | **Chạy được, không tệ, nhưng Jev đóng góp không đều.** Jev là phần chính ở acceptance-criteria-coverage và dead-code-finder; khoảng 50/50 ở subagent-validator; ít ở git-risk-scanner và context-curator. Tất cả mới đo trên demo tổng hợp. |
| Cái gì mang lại giá trị thật? | Các phần **rule/script cố định**: `find.mjs`, rule của `wait.mjs`, network audit, cache-expiry gate, fast-compact, giới hạn tool bằng flag tĩnh. |

---

## 13. Rủi ro và lưu ý

- **Repo đang public** nhưng có dữ liệu thật:
  - `ado/items*.json`: 190 work item PXP / XT-Smart-Platform.
  - `audit/*.csv`: chứa prompt và đường dẫn của các project khác.
  - `ess-test-runs/`: ticket, screenshot ESS (trên nhánh `claude/laya-jev-skill-comparison-fe1001`).
  - → Cần chuyển repo sang private hoặc xóa các file đó khỏi lịch sử git.
- **Jev gửi dữ liệu ra OpenRouter / TypeSafe:** text trang ESS (có thể có tên nhân viên) và đoạn code PR. Chưa hỏi Security. Auto mode của Claude Code chặn các lần gọi này.
- **Chất lượng bằng chứng:**
  - Phần lớn nhãn do Claude gắn; mẫu nhỏ; mỗi cấu hình thường chỉ chạy 1 lần.
  - Giá dùng tỉ lệ giả định 1:3:5, không phải giá thật của gateway X-Tek.
  - Chưa có test nào trên bước **ghi** dữ liệu thật trong ESS.
- **Bug đã biết** (4 bug dưới đây đã sửa ngày 2026-10-15 trên nhánh riêng, chưa merge):
  - `wait.mjs` / `oracle --observe` đọc nhầm tab.
  - PowerShell ghi `results.json` có BOM, làm `record.mjs` lỗi.
  - Comment trong `jev-gate/scripts/gate.mjs` vẫn còn số liệu của Laya.
  - `review-pr-jev-classify`: trường `rules` trong log bỏ qua rule id và override của dự án (chỉ ảnh hưởng log). Header của execution log chỉ hiện provider được `assess.mjs` chạy sau cùng.

- **`subagent-model-router`:** pilot thật chỉ có 6 story do Claude tự viết; cơ chế leo model chưa từng được kích hoạt; subagent chưa chạy qua hook thật.
- **`review-pr-jev-classify`:** test thật chỉ có 14 lỗi; nhãn lấy từ việc dev sửa ở đúng dòng nên có thể đếm thiếu các lần sửa ở file doc/test.
- **`skills-router`:** nhãn của 199 scenario do Claude tự đặt; trên prompt thật chỉ có 16 nhãn skill; mô tả skill của project cũng được gửi cho Jev khi dùng Jev; hook shadow chưa bật, độ trễ thật của hook chưa đo.
- **2 skill BMad + Jev:** chưa chạy với Jev thật lần nào; ngưỡng 0.3 lấy từ cookbook, chưa đo trên dữ liệu của mình.
- **5 skill Jev mới (repo `JEV`):** code chưa commit; số liệu đo trên demo tổng hợp do Claude dựng; chưa có bản để Claude tự làm để so sánh; mỗi kịch bản thật mới chạy 1 lần.

---

## 14. Việc còn mở / bước tiếp theo đề xuất

1. Xin ý kiến Security về việc gửi dữ liệu ra Jev / OpenRouter (hoặc đo **Kev**, bản Jev chạy local, chưa đo).
2. Bug đọc nhầm tab đã sửa (nhánh `claude/web-test-fixes-4fdcd7`); còn lại là chạy lại agent run 2–3 lần mỗi biến thể (ước tính ~40M token).
3. `review-pr-jev-classify`: chạy shadow với Jev trên 5–10 PR thật, nhờ người gắn nhãn các lỗi bị lệch, rồi mới quyết định bật `recheck`.
4. ado-classify: làm MCP server, so với Haiku, A/B trong lúc dev code.
5. Đưa `find.mjs` và rule của `wait.mjs` vào `web-test` gốc; theo dõi `fast-compact` trên vài session thật (đã merge vào `main`).
6. Dọn dữ liệu nhạy cảm khỏi repo public.
7. 5 skill Jev mới: commit code, chạy trên repo thật của team, đo thêm bản Claude tự làm; chạy bộ log khó h01–h08 cho `jev_advisor`.
8. Pilot 2 skill BMad + Jev theo plan: khoảng 60 câu hỏi có nhãn cho `bmad-help-jev`; 10 PR đã merge của `ess-fe` cho `bmad-code-review-jev`.
9. `skills-router`: (lỗi nhóm skill trùng việc đã sửa ở vòng 2) bật hook shadow để gom nhãn thật, chọn ngưỡng BM25 theo từng catalog; chỉ sau đó mới chốt Jev có nên là bước thứ hai mặc định hay không.
10. `subagent-model-router`: merge bản sửa bug (`claude/router-readonly-fix`), rồi chạy lại trên 15–20 story ADO thật để thấy các lần trượt và leo model; bật hook ở chế độ shadow.
11. Review và merge các nhánh mới: `claude/skills-router-62fc74`, `claude/subagent-model-router-f7f0e3`, `claude/review-pr-jev-upgrade-2bbb34`, `claude/web-test-fixes-4fdcd7`.

---

## Phụ lục

### A. Tổng hợp unit test (chạy lại ngày 2026-10-15)

| Skill / công cụ | Số test | Kết quả |
|---|---|---|
| `review-pr` (gốc) | 65 | 65 pass |
| `review-pr-laya-classify` | 42 | 42 pass |
| `review-pr-jev-classify` | 51 | 51 pass |
| `web-test-jev-wait / gate / verdict / oracle` | 8 / 12 / 11 / 12 | Tất cả pass; mỗi bộ có 1 test skip vì máy đã bật sẵn đồng ý dùng Jev |
| `web-test-jev-ground` | 6 | 6 pass |
| `web-test` gốc và 5 skill `web-test-laya-*` | 0 | Không có unit test (chỉ có probe ở `idea/web-test/gate/`) |
| `hooks/cache_expiry_gate` | 29 (41 check) | Pass (theo `hooks/tests/report.md`) |
| `fast-compact` | 13 | Theo report của nhánh, chưa chạy lại |
| 5 skill Jev mới + `jev_advisor` (repo `JEV`) | 84 | 84 pass (chạy lại 2026-10-15) |
| `bmad-help-jev` / `bmad-code-review-jev` | 9 / 8 | Tất cả pass, dùng provider giả (chạy lại 2026-10-15) |
| `skills-router` | 65 | 65 pass, dùng provider giả (vòng 2, 2026-10-15) |
| `subagent-model-router` | 19 | 19 pass, dùng provider giả |
| `review-pr-jev-classify` (bản nâng cấp) | 87 | 87 pass |
| 11 bản `web-test` (bản sửa bug) | 206 | 206 pass |

### B. Dòng thời gian

| Ngày | Việc |
|---|---|
| 09-30 | Cài Laya, benchmark hiệu năng CPU |
| 10-01 | Gói cài, routing bước A, router proxy chạy thật với Claude Code, benchmark live 15 task |
| 10-02 | Tổng hợp benchmark (Laya 1.43x), ADO 122 item |
| 10-04 → 10-05 | Workflow theo bước (2 task thật), audit Phase 0, cache-expiry hook, nghiên cứu `laya-router` |
| 10-06 | A/B giới hạn context trên #1697, `laya-launcher` |
| 10-07 → 10-08 | Error triage (dừng), ado-classify 18/20, skill `web-test-laya` |
| 10-09 | Tách 5 skill `web-test-laya-*`, chạy thật trên dev (11840, 19358) |
| 10-11 | `review-pr-laya-classify` |
| 10-13 | Chạy thật PR 5240; `review-pr-jev-classify`, `web-test-jev-ground`; plan áp Jev vào BMad |
| 10-14 | 4 skill `web-test-jev-*`, đánh giá offline Laya và Jev; repo `JEV`: smoke test, `jev_advisor`, A/B/C 30 run |
| 10-15 | Agent run trên ticket 11840 (dev + staging), `fast-compact`, chạy lại A/B có kiểm soát trên PR 5240; 5 skill Jev mới + test thực tế 7 session; 2 skill BMad + Jev; `skills-router` (đánh giá trên 199 scenario và 368 prompt thật, rồi vòng 2); `subagent-model-router` (benchmark 18 task); nâng cấp `review-pr-jev-classify`; sửa bug `web-test` |

### C. Code nằm ở đâu

| Nhánh | Nội dung |
|---|---|
| `main` | Gói cài, routing, proxy, benchmark, workflow, ado, ado-classify, audit, hooks |
| `claude/laya-jev-skill-comparison-fe1001` (mới nhất, **chưa merge vào main**) | Toàn bộ 12 skill, `eval/`, `triage/`, `ess-test-runs/` |
| `research/laya-router-skill` (chưa merge) | Routing đa tín hiệu, A/B #1697, `laya-launcher` |
| `main` (merge từ `claude/fast-jev-compaction-worktree-f61594`, PR #3) | `fast-compact` |
| `feat/bmad-jev-skills` (đã push, chưa merge) | `bmad-help-jev`, `bmad-code-review-jev`, `idea/jev-applicability-plan.md` |
| `claude/skills-router-62fc74` (chưa push) | `skills-router`, hook shadow, 199 scenario, vòng 2 |
| `claude/subagent-model-router-f7f0e3` (chưa push) | `subagent-model-router`, benchmark 18 task |
| `claude/subagent-router-pilot-*` (chưa push) | Báo cáo pilot ess-be (`research/subagent-router-ess-be-pilot.md`) |
| `claude/router-readonly-fix` (chưa push) | Sửa bug "chỉ đọc" của router |
| Nhánh của session test review-pr thật (chưa push) | `research/review-pr-jev-real-eval.md` |
| `claude/review-pr-jev-upgrade-2bbb34` (chưa push) | Nâng cấp `review-pr-jev-classify` |
| `claude/web-test-fixes-4fdcd7` (chưa push) | Sửa bug 11 bản `web-test`, gate theo từng cú click |
| Repo `xt-skills` | Bản gốc `review-pr` |
| Repo `danhnguyen-xiontechs/JEV`, nhánh `jev` | Smoke test Jev, `jev_advisor`, A/B/C |
| Repo `JEV`, worktree `claude/review-5-plans-idea-folder-ce4d36` (**chưa commit**) | 5 skill Jev mới, demo/eval, `docs/runs/realtest/` |
| Chưa commit | `eval/AGENT-RUNS-REPORT.*`, kết quả agent run 10-15, `.xt-skills/` (log review PR 5240) |

### D. Nguồn số liệu chính
`HANDOFF.md`, `PROGRESS-2026-10-01.md`, `benchmark/report*.md`, `eval/REPORT.md`, `eval/AGENT-RUNS-REPORT.md`, `idea/web-test/report-*.md`, `idea/review-pr/plan-1-laya-severity-classification.md`, `triage/LAYA-ERROR-TRIAGE-REPORT.md`, `ado-classify/docs/REPORT.md`, `audit/summary.md`, `hooks/tests/report.md`, `.xt-skills/review-pr-*/reviews/`, `ess-test-runs/`. Repo `JEV`: `README.md`, `docs/runs/realtest/report.md`, `examples/*/run/`, `docs/runs/curator/shadow-eval.txt`, `docs/runs/abc/`.
