# So sánh 4 skill web-test: Laya (cũ) vs Jev (mới)

Ngày 2026-10-14 · nhánh `claude/laya-jev-skill-comparison-fe1001` · Jev model `typesafe/jev-1.13-20260917`

## Tóm tắt

Bạn có 4 skill Laya cho kết quả tệ (`web-test-laya-wait`, `-gate`, `-verdict`, `-oracle`). Tôi đã tạo 4 skill Jev tương ứng (`web-test-jev-wait`, `-gate`, `-verdict`, `-oracle`) bằng cách copy từ skill Laya và thay engine quyết định, giữ nguyên câu hỏi, ngưỡng và cơ chế fallback về rule. Skill cũ không bị sửa. Sau đó chạy cùng một bộ input qua Laya (local, CPU) và Jev (hosted, OpenRouter).

| Skill | Laya (cũ) | Jev (mới) | Nhận định |
|---|---|---|---|
| `web-test-jev-gate` | Laya: bỏ sót 1/12 ghi, báo nhầm 9/12 đọc | Jev: bỏ sót 0/12, báo nhầm 1/12 | Jev tốt hơn rõ rệt |
| `web-test-jev-wait` | Laya: 0/24 trang xong được xác nhận; báo nhầm "login" 13/18 trang có nav | Jev: 72/72 xác nhận xong; báo nhầm login 0/132 | Jev tốt hơn rõ rệt (live 8/8 đúng) |
| `web-test-jev-oracle` | Laya: tự quyết 3% bước; 85% trả về agent | Jev: tự quyết 69%; trả về agent 19%; false-pass 0 | Jev tốt hơn, nhưng có false-fail trên bước thật |
| `web-test-jev-verdict` | Laya: tự quyết 37%, chính xác 82% | Jev: tự quyết 96%, chính xác 88% | Tốt trên bước tự đủ nghĩa; kém trên bước thật có tham chiếu chéo |

**Kết luận ngắn.** Nguyên nhân Laya "tệ" là nó hiếm khi đủ tự tin (median p chỉ 0,56 trên verdict) nên gần như mọi bước phải quay về agent, và khi tự tin thì đôi khi sai (báo login nhầm, bỏ sót false-pass). Jev gần như luôn tự tin (median p 0,99) và đúng trên các câu hỏi tự đủ nghĩa: gate, wait, oracle/verdict trên bước viết rõ ràng. Giá phải trả: Jev **tự tin cả khi sai**. Trên các bước thật của 6 run cũ (loại "Total hours bằng giá trị ở TC01"), Jev ghi "fail" sai cho 7,3/30 bước pass mỗi lượt trong bộ tổng, và 8/16 bước pass thật khi chạy script end-to-end (Laya: 2, vì Laya phần lớn trả bước về agent). Hai điểm này cần quyết định trước khi chuyển hẳn (xem mục Khuyến nghị).

> **Chưa đo được:** số lượt model (turn) và token của cả phiên agent khi chạy trọn một ticket với từng skill. Các con số 38 vs 19 turn trong báo cáo cũ là từ phiên agent thật; ở đây tôi đo chất lượng và tải quyết định của từng engine trên cùng input (nhanh, lặp lại được), không chạy lại 8 phiên agent. Lần chạy trên ESS dev thật bằng profile đăng nhập của bạn bị hệ thống chặn nên chưa có; phần live dùng trang giả lập và dữ liệu bước thật đã lưu. Xem mục "Chưa làm / hạn chế".

## 1. Bối cảnh: 4 skill Laya nào tệ, và vì sao

Nguồn: `idea/web-test/report-laya-skills.md` (9/10/2026, cùng ticket #11840, dev, mỗi skill một lần chạy). Cột cuối là skill Jev tôi tạo để thay thế.

| Skill Laya | Laya làm gì | Kết quả cũ | Skill Jev mới |
|---|---|---|---|
| web-test-laya-wait | Quyết định trang đã tải xong chưa, nhận ra trang login/lỗi | ❌ Không có lợi. Laya báo "đang tải" 20/20 lần trên trang đã xong | web-test-jev-wait |
| web-test-laya-gate | Ý kiến thứ hai: bước nào ghi dữ liệu | ⚠️ Chỉ có ích về an toàn. Bỏ sót 1/12 nhưng báo nhầm 9/12 bước đọc | web-test-jev-gate |
| web-test-laya-verdict | Phán pass/fail/blocked từng bước | ❌ Tệ hơn. Chỉ tự tin ở 2/17 bước; 38 lượt model so với 19 | web-test-jev-verdict |
| web-test-laya-oracle | Như verdict nhưng rule trước, PASS cần ngưỡng cao | ❌ Tệ hơn. Rule chạy tốt, Laya không quyết bước nào; 35 lượt so với 19 | web-test-jev-oracle |
| web-test-laya-ground | Tìm nút/ô cần bấm | ✅ Tốt nhất, nhưng 17/17 lần là do rule, Laya chưa được dùng (đã có bản Jev riêng `web-test-jev-ground`, ngoài phạm vi lần này) | (đã có) |

Mẫu số chung của các thất bại: skill đặt một model nhỏ vào vị trí "quyết định", nhưng model trả xác suất thấp và xê dịch, thấp hơn ngưỡng, nên bước nào cũng quay về agent. Agent vẫn tốn lượt đọc kết quả của script *cộng* việc tự làm lại. Đây chính là chỗ Jev có thể khác (xác suất sắc nét), nên phép thử trung tâm của báo cáo này là: **cùng input, engine nào đủ tự tin đủ thường xuyên, và khi tự tin thì có đúng không.**

## 2. Đã tạo gì

- **Worktree/branch:** `claude/laya-jev-skill-comparison-fe1001` (worktree `D:\Laya\.claude\worktrees\laya-jev-skill-comparison-fe1001`). Đã merge `plan/jev-applicability` vào để có các skill Laya và dữ liệu cũ; nhánh gốc không đổi.
- **4 skill mới** trong `.claude/skills/`: `web-test-jev-wait`, `web-test-jev-gate`, `web-test-jev-verdict`, `web-test-jev-oracle`. Mỗi skill là bản sao của skill Laya tương ứng. **Skill Laya không bị sửa.**
- **Điểm thay đổi duy nhất trong logic:** `laya-lib.mjs` → `jev-lib.mjs` (cùng hợp đồng `ask()`), `laya-check.mjs` → `jev-check.mjs`, bỏ `scripts/laya/` (installer, serve.py). Jev gọi qua `decision-provider.mjs` có sẵn của `web-test-jev-ground` (OpenRouter Decisions API, `typesafe/jev-1.13`).
- **Giữ nguyên:** câu hỏi (wording, nhãn), ngưỡng (verdict 0.85/0.60, oracle 0.95/0.85, gate 0.5, wait 0.6), thứ tự rule → engine → agent, fallback về rule khi engine tắt/lỗi. Nhờ vậy so sánh là "thay engine", không phải "thiết kế lại".
- **Khác biệt có chủ đích vì Jev là dịch vụ hosted:** (1) chỉ dùng sau khi người dùng đồng ý một lần (`jev-check.mjs --set true|false`, lưu ở `jev.local.json`, gitignored); thiếu `OPENROUTER_API_KEY` thì rule-only; (2) log riêng `*-jev-log.jsonl`, `jev-usage.jsonl` (độ trễ, token, chi phí; không ghi nội dung hay key); (3) không có bước cài/khởi động server.
- **Test:** 4 bộ unit/CLI test với Jev giả trên loopback (43 test, tất cả pass): ngưỡng, override cần lý do, tắt Jev thì rule-only, HTTP lỗi thì fallback, khóa API không lọt vào log. `node --test .claude/skills/web-test-jev-*/tests/*.test.mjs`

## 3. Cách đo

Cùng một request (state + câu hỏi) được gửi cho cả hai engine đúng như skill gửi (file `eval/questions.mjs` sao chép nguyên văn từ script). Laya chạy local (laya-serve, CPU, checkpoint `english`, `max_len` theo từng skill). Jev gọi thật qua OpenRouter, **lặp 3 lần mỗi câu** để đo độ ổn định (Laya xác định nên chạy 1 lần). Chấm điểm bằng đúng quy tắc quyết định của từng skill (ngưỡng, rule trước).

| Bộ dữ liệu | Kích thước | Nhãn từ đâu |
|---|---|---|
| gate: `idea/web-test/gate` dev + held-out | 30 + 24 câu | Có sẵn từ lần đo cũ (held-out viết sau khi khóa rule). Replay của tôi tái hiện đúng số cũ: Laya 1/12 bỏ sót, 9/12 báo nhầm; rule 8/12 và 5/12. |
| verdict/oracle: bước THẬT | 20 bước từ 6 run `ess-test-runs` | Trạng thái agent đã ghi (16 pass, 4 blocked). **Không phải ground truth độc lập**: đó là phán đoán của agent. |
| verdict/oracle: sửa tay từ bước thật | 8 fail + 8 blocked | Tôi sửa `actual` (đổi số 160→40, 0→55, thay bằng lỗi môi trường) nên nhãn đúng theo cách dựng. |
| verdict/oracle: viết tay ESS | 37 bước (14 pass, 15 fail, 8 blocked) + 8 quan sát chưa sẵn sàng | Tôi viết trước khi gọi model; nhãn đúng theo cách dựng. Tự đủ nghĩa, nên dễ hơn bước thật. |
| wait: ảnh chụp trang | 33 trang viết tay + 18 bản có nav ESS thật ở đầu | Viết tay với nhãn đúng theo cách dựng (xong/đang tải/lỗi/login, màn hình). Gồm các câu chữ login/lỗi mà regex của skill bỏ sót. 2 ca login "tranh cãi" được tính riêng. |

> Bộ dữ liệu nhỏ, phần lớn do tôi viết, và ground truth của bước thật là phán đoán của agent. Cách đọc đúng: **so sánh tương đối Laya và Jev trên cùng input**, không phải độ chính xác tuyệt đối. Tôi cũng không dùng ảnh chụp trang ESS thật trong `wait-log.jsonl` vì chúng chứa tên và mã nhân viên thật; không gửi chúng cho Jev.

## 4. gate: bước nào ghi dữ liệu

| Held-out (24 câu: 12 ghi, 12 đọc) | Bỏ sót bước ghi | Báo nhầm bước đọc | Chính xác |
|---|---|---|---|
| Rule từ khóa | 8/12 | 5/12 | 46% |
| Laya (skill cũ) | 1/12 | 9/12 | 58% |
| **Jev (skill mới)** | **0/12** | **1/12** | **96%** |
| Rule HOẶC Laya (như skill cũ) | 1/12 | 10/12 | 54% |
| Rule HOẶC Jev (như skill mới) | 0/12 | 6/12 | 75% |

**Tỉ lệ báo nhầm bước đọc (càng thấp càng tốt), held-out**

- Rule: 42%
- Laya: 75%
- Jev: 8%

- **Xác suất tách được hai nhóm?** Laya: bước ghi 0,44–0,85, bước đọc 0,30–0,73 (chồng lên nhau, không có ngưỡng nào tách). Jev: bước ghi 0,99–1,00, bước đọc 0,00–0,91; chỉ một câu đọc bị báo ghi: "Log out and log back in as the manager" (p ≈ 0,9, mơ hồ thật).
- **Trên toàn bộ 54 câu:** Jev bỏ sót 0/27, báo nhầm 1/27; Laya bỏ sót 1/27, báo nhầm 15/27. Laya bỏ sót duy nhất: "Turn off email notifications in settings". Jev ổn định: 0 câu đổi nhãn giữa 3 lần chạy.
- **Trên 20 bước THẬT của 6 run cũ** (đều là bước chỉ đọc, ticket read-only): Laya sinh **9** "disputed" (báo nhầm), Jev sinh **4**. Cả 4 cái của Jev đều do *rule từ khóa* ("cancelled", "approved" là danh từ trong câu), Jev không thêm cái nào; 5 cái dư của Laya là do Laya.

> Hệ quả thiết kế: vì mỗi lần báo nhầm = một "disputed" buộc agent xem lại (tốn lượt model), kết hợp "Rule HOẶC Jev" làm số báo nhầm tăng từ 1/12 lên 6/12 chỉ vì rule từ khóa. Dùng **Jev đơn thuần** (không OR với rule) cho recall 100% và 1/12 báo nhầm. Skill Jev hiện giữ nguyên OR để so sánh công bằng; nên đổi sau khi bạn đồng ý (xem Khuyến nghị).

## 5. wait: trang đã xong chưa, trang login/lỗi, màn hình nào

Trong `wait.mjs`, model chỉ được hỏi khi rule không kết luận, trang không còn spinner và văn bản đứng yên ≥ 3 s. Mỗi lần hỏi là một request gồm 3 câu (state, screen, login) với tối đa 1500 ký tự văn bản trang.

| Offline, 51 ảnh chụp trang (Jev ×3) | Laya | Jev |
|---|---|---|
| Trang đã xong, được xác nhận "ready" (p ≥ 0,6) | 0/24 | 72/72 |
| Trang đang tải, được xác nhận "loading" | 0/12 | 30/36 |
| Median p của câu "state" | 0,48 | 0,99 |
| Trang login có câu chữ regex bỏ sót, phát hiện được | 3/3 (2 ca tranh cãi: 2/2) | 6/9 (2 ca tranh cãi: 0/6) |
| **Trang ứng dụng bị báo nhầm là login** | **14/44** (trang có nav: 13/18) | **0/132** |
| Trang lỗi có câu chữ regex bỏ sót, phát hiện được | 4/6 | 18/18 |
| Nhận đúng màn hình ESS (p ≥ 0,6, đúng/sai chắc chắn) | 29/34 (sai chắc: 2) | 102/102 (sai chắc: 0) |
| Độ trễ p50 mỗi request | 2,8 s | 586 ms |

**Chạy thật trong trình duyệt** (Edge headless, cổng riêng 9334, profile tạm; cùng trang cho cả hai skill, `--timeout 12`). Cột "kỳ vọng" là việc một lần chờ tốt nên làm.

| Tình huống | Kỳ vọng | Laya | Jev |
|---|---|---|---|
| slow-with-expect | ready sau ~3 s (chỉ rule) | ✅ ready / màn time-off / 4,3 s | ✅ ready / màn time-off / 4,9 s |
| wrong-page | không ready: text mong đợi không xuất hiện (timeout) | ✅ timeout / màn error / 13,1 s | ✅ timeout / màn unknown / 12,3 s |
| login-code | status=login (câu chữ MFA mà regex bỏ sót) | ✅ login / màn login / 5,6 s | ✅ login / màn login / 4,1 s |
| login-authenticator | status=login | ✅ login / màn login / 5,4 s | ✅ login / màn login / 4,2 s |
| error-load | status=error (câu chữ lạ) | ❌ login / màn error / 5,8 s | ✅ error / màn error / 4,1 s |
| error-503 | status=error | ❌ login / màn error / 5,4 s | ✅ error / màn error / 4,3 s |
| app-nav-wrong | KHÔNG phải login (trang ứng dụng bình thường có nav, thiếu text mong đợi) | ❌ login / màn home / 6,7 s | ✅ timeout / màn attendance / 12,3 s |
| app-nav-found | ready (rule) | ✅ ready / màn unknown / 1,7 s | ✅ ready / màn attendance / 1,2 s |

- Laya đúng 5/8, Jev đúng 8/8. Hai lỗi nặng của Laya: gọi **trang lỗi là login** (`status=login` thay vì `error`, vì script kiểm tra login trước) và gọi **trang ứng dụng bình thường là login** khi trang có văn bản nav ESS. Cả hai khiến agent đi sai hướng (đăng nhập lại thay vì xử lý lỗi/chờ).
- Cả hai đều không giúp được ca "đã xong nhưng không phải trang mong đợi" (`wrong-page`): với `--expect` cho trước, rule quyết định sự sẵn sàng và model chỉ bổ sung login/lỗi/màn hình. Thiết kế này vẫn còn chờ hết timeout.
- Khả năng còn yếu của Jev: câu "Microsoft sign-in?" chưa chắc ở vài trang MFA/đăng nhập nội bộ (p quanh 0,5 đến 0,8) và đưa trang "chỉ có header" vào "ready" (1/6 trang tải dở). Rule regex vẫn nên giữ.

## 6. verdict: pass / fail / blocked từng bước

Quy tắc skill: p ≥ 0,85 → ghi luôn; 0,60 ≤ p < 0,85 → ghi nhưng gắn "review"; p < 0,60 → agent tự phán.

| Toàn bộ 73 bước | Tự quyết | Đúng khi tự quyết | Tự quyết không cần review | Bước không-pass bị ghi pass | Bước pass bị ghi fail |
|---|---|---|---|---|---|
| Laya | 37% | 82% | 6% | 2/43 | 2/30 |
| **Jev** | 96% | 88% | 85% | 0/129 | 7,3/30 |

| Theo bộ dữ liệu | n | Laya: nhãn đầu đúng | Jev: nhãn đầu đúng | Laya: tự quyết | Jev: tự quyết | Laya: đúng khi quyết | Jev: đúng khi quyết |
|---|---|---|---|---|---|---|---|
| Bước THẬT (nhãn của agent) | 20 | 55% | 48% | 30% | 87% | 67% | 52% |
| Sửa tay → fail | 8 | 50% | 100% | 25% | 100% | 0% | 100% |
| Sửa tay → blocked | 8 | 100% | 100% | 75% | 100% | 100% | 100% |
| Viết tay ESS | 37 | 65% | 100% | 35% | 100% | 92% | 100% |

**Độ chính xác nhãn đầu, theo bộ dữ liệu — Laya**

- real: 55%
- mut-fail: 50%
- mut-blocked: 100%
- hw: 65%

**— Jev**

- real: 48%
- mut-fail: 100%
- mut-blocked: 100%
- hw: 100%

- **Trên bước tự đủ nghĩa** (viết tay, sửa tay): Jev đúng 100% và 100% (Laya 65% và 50%). Laya còn ghi *pass* cho 2/8 ca số liệu đã bị sửa sai (ví dụ `Total hours: 55` khi expected là 0) — đó là false-pass, lỗi đắt nhất. Jev: 0 false-pass trên 129 lượt không-pass.
- **Độ tự tin:** Laya median p 0,56, 63% lượt dưới 0,60 (agent phải làm lại), chỉ 6% ≥ 0,85. Jev median p 0,99, 4% dưới 0,60, 85% ≥ 0,85. Jev ổn định giữa 3 lần chạy (1 bước đổi nhãn).
- **Trên bước THẬT thì ngược lại.** Laya chỉ tự quyết 30% (còn lại về agent), Jev quyết 87% nhưng chỉ đúng 52%. Lỗi tập trung ở các bước có expected tham chiếu bước/case khác ("Total hours bằng giá trị ở TC01", "giống bước 1") và actual chỉ nói "Total hours: 0": Jev phán **fail** với p 0,85–0,99. Tôi thử đưa các bước trước của cùng run vào state (arm "context"): đúng khi quyết chỉ từ 52% lên 56%, số bước pass bị ghi fail mỗi lượt (trên 16 bước pass thật) từ 7,3 xuống 7 — **không đủ để đưa vào skill**. Nhãn thật ở đây là phán đoán của agent (ticket chính là lỗi "Total hours 0 vs 55", agent kết luận pass với bằng chứng yếu), nên chưa thể nói chắc ai đúng — nhưng một verdict "fail" tự ghi với p 0,99 là rủi ro dù đúng hay sai.
- **Chạy script end-to-end trên 19 bước thật:** Laya quyết 6 bước (đúng 4, sai 2), trả 13 về agent, gắn review 17. Jev quyết 17 (đúng 9, sai 8), trả 2 về agent, gắn review 7. Số verdict **sai mà không được gắn review** (agent không có tín hiệu để soát): Laya 0, Jev 6.

| Ngưỡng p | ≥ 0.5 | ≥ 0.6 | ≥ 0.7 | ≥ 0.85 | ≥ 0.95 | ≥ 0.99 |
|---|---|---|---|---|---|---|
| Laya: tự quyết / đúng | 69% / 72% | 37% / 82% | 23% / 82% | 6% / 75% | 3% / 100% | 0% / – |
| Jev: tự quyết / đúng | 100% / 86% | 96% / 88% | 94% / 88% | 85% / 90% | 73% / 93% | 62% / 93% |

Quét ngưỡng: ngưỡng của skill được đặt cho phân bố xác suất mềm của Laya. Với Jev, nâng ngưỡng chỉ cắt dần số lượt tự quyết mà độ chính xác hầu như không đổi (88% → 93%), vì xác suất của Jev gần như nhị phân. Ngưỡng không phải đòn bẩy để chặn lỗi của Jev.

## 7. oracle: rule trước, model sau, PASS cần p ≥ 0,95 và FAIL cần p ≥ 0,85

| Toàn hệ thống (81 quan sát) | PASS thật được ghi pass | FAIL thật được ghi fail | Không-pass bị ghi pass | Pass bị ghi fail (mỗi lượt) | Trả về agent |
|---|---|---|---|---|---|
| Laya | 7% | 4% | 0/51 | 0/30 | 85% |
| **Jev** | 52% | 88% | 0/51 | 3/30 | 19% |

- Laya gần như không quyết được gì (ngưỡng 0,95 quá cao cho phân bố của nó: chỉ 3% lượt do model quyết), khớp với báo cáo cũ: "rule chạy tốt, Laya không quyết bước nào". Hệ quả là 85% bước về agent — nguồn của 35 lượt model so với 19.
- Jev quyết 69% bước và về agent 19%. **Không có false-pass nào** (ngưỡng 0,95 cho PASS giữ vai trò an toàn). Ca "chưa sẵn sàng" (trang còn tải): 100% không bị ghi pass, nhãn "not_ready" được nhận đúng 8/8 (Laya 4/8).
- Trên **bước thật** (20): model của Laya quyết 0% (về agent 90%); model của Jev quyết 43% nhưng có 3/16 bước pass bị ghi **fail** mỗi lượt (cùng nhóm bước tham chiếu chéo như ở verdict).
- Chạy script end-to-end trên 19 bước thật: Laya quyết 2 (toàn bằng rule, đúng 2), Jev quyết 10 (rule 2 + Jev 8; đúng 5, sai 5), trả 9 về agent (Laya 17).

> Giả định của phép replay oracle: `observed` được lấy bằng đúng `actual` của bước (script thật lấy toast và các dòng chứa chuỗi trong ngoặc của expected từ DOM). Đây là xấp xỉ.

## 8. Độ trễ, chi phí, riêng tư

| Skill | Laya p50 (CPU) | Jev p50 (hosted) | Jev $/lượt gọi | Jev token vào / lượt |
|---|---|---|---|---|
| gate | 579 ms | 538 ms | $0.00002 | 395 |
| verdict | 648 ms | 537 ms | $0.00002 | 439 |
| oracle | 863 ms | 568 ms | $0.00002 | 478 |
| wait (3 câu/lượt, ≤1500 ký tự) | 2,8 s | 586 ms | $0.00004 | 845 |

- Toàn bộ phần offline tốn **$0.0185** cho 837 lượt gọi Jev (gồm cả arm context; chưa tính phần live, vài trăm lượt nữa ở mức $0,00002). Chi phí Jev trên một ticket là không đáng kể (vài chục lượt × ~$0,00002); Laya miễn phí nhưng cần ~2,2 GB model, ~2 GB RAM và khởi động ~30–40 s, độ trễ của wait trên CPU là 2,8 s.
- **Riêng tư:** Jev là dịch vụ ngoài. Gate gửi câu mô tả bước; verdict gửi expected+actual; oracle gửi expected+dòng quan sát; **wait gửi tới 1500 ký tự văn bản trang** — có thể chứa tên/mã nhân viên. Vì thế skill chỉ dùng Jev sau khi hỏi người dùng một lần, và wait nên cân nhắc lọc/rút gọn văn bản trước khi gửi hoặc chỉ dùng khi trang không chứa dữ liệu người. Nếu dữ liệu không được phép ra ngoài thì dùng Kev (local, cùng API) như kế hoạch `jev-applicability-plan.md`.

## 9. Phát hiện đáng chú ý

- **Jev tự tin cả khi sai.** Xác suất gần 0/1 nên "p cao" không còn là tín hiệu để chặn lỗi (xem quét ngưỡng). Độ chính xác khi p ≥ 0,99 vẫn chỉ 93% trên verdict. Cần chốt chặn khác: không bao giờ tự ghi `fail`/`blocked` mà không có agent xác nhận, hoặc luôn gắn review cho verdict do model đưa ra.
- **Điểm mạnh của Jev là câu hỏi hẹp, tự đủ nghĩa** (gate, nhận trang login/lỗi, màn hình, so khớp expected/actual rõ ràng). **Điểm yếu là bước cần ngữ cảnh ngoài state** (so với giá trị của case khác). Thêm các bước trước vào state không sửa được.
- **Laya sai theo kiểu khác:** không tự tin (nên tốn lượt) và đôi khi sai chắc chắn (login nhầm, false-pass ở ca đã sửa số).
- **Rule từ khóa của gate** là nguồn báo nhầm chính của skill Jev (4/4 disputed trên bước thật). Jev đơn thuần tốt hơn "rule HOẶC Jev".
- Hai kết quả cũ của Laya được tái hiện trong replay (gate 1/12 và 9/12; wait/oracle hiếm khi đủ tự tin), nên harness đáng tin cho phần so sánh.

## 10. Chưa làm / hạn chế

- **Không chạy lại phiên agent trọn ticket** để đo số lượt model và token (so với 19/38/35 turn trong báo cáo cũ). Đó là phép đo cuối cùng cho "skill có rẻ hơn không"; tôi chỉ có thể suy ra từ tỉ lệ bước phải về agent. Mỗi phiên tốn cỡ 1,5M token vào; 9 biến thể (baseline + 4 Laya + 4 Jev) × 3 lần ≈ 40M token.
- **Không chạy trên ESS dev thật:** thử mở trình duyệt bằng profile `xiontechs` đã đăng nhập (cổng 9333) bị hệ thống chặn là truy cập môi trường thật; tôi không vòng qua. Phần live dùng trang giả lập và 6 run đã lưu.
- **Cỡ mẫu nhỏ, nhãn do người viết:** 20 bước thật, 53 bước viết/sửa tay, 51 trang. Chênh vài điểm phần trăm không có ý nghĩa; chênh lớn (gate báo nhầm, wait login nhầm, oracle quyết được) thì rõ ràng.
- `wait.mjs` live chỉ thử 8 tình huống, 1 lần mỗi skill. Jev không tất định tuyệt đối (3 lần lặp: 1 bước đổi nhãn trên verdict).
- Chưa đo Kev (local, cùng API) và `web-test-jev-ground` (đã có từ trước, ngoài phạm vi).

## 11. Khuyến nghị

| Skill | Đề xuất | Lý do |
|---|---|---|
| web-test-jev-gate | **Dùng Jev**, và đổi thành Jev đơn thuần (bỏ OR với rule từ khóa); giữ netlog + audit làm chốt chặn thật. | Recall 100%, báo nhầm 1/12 (Laya 9/12); giảm disputed từ 9 xuống 0 trên 20 bước thật. Chi phí gần 0. |
| web-test-jev-wait | **Dùng Jev**, nhưng lọc văn bản trang trước khi gửi (hoặc chỉ gửi phần `<main>`), giữ regex login/lỗi, cân nhắc để `error` thắng `login` khi cả hai cùng bật (Laya từng gọi trang lỗi là login). | Nhận trang lỗi/login lạ, không báo login nhầm, nhanh gấp ~5 lần Laya. Vẫn không giải quyết "đúng trang nhưng thiếu text mong đợi". |
| web-test-jev-oracle | **Dùng Jev**, giữ ngưỡng PASS 0,95; **không auto-ghi FAIL**: mọi fail do model đề xuất phải về agent xác nhận. | 0 false-pass, giảm 85% → 19% bước về agent; nhưng 3/16 pass thật bị ghi fail trên bước thật. |
| web-test-jev-verdict | **Chưa nên bật mặc định.** Chỉ dùng khi expected tự đủ nghĩa (agent được hướng dẫn viết expected không tham chiếu case khác), và mọi verdict của model gắn `review`. | Tốt trên bước tự đủ nghĩa (100%/100%), kém trên bước thật (đúng 52% khi quyết, sai không có cờ). Oracle làm cùng việc nhưng rule-first và có ngưỡng PASS cao hơn. |

- **Bước tiếp theo đáng làm nhất:** chạy 3 phiên agent trọn ticket #11840 cho mỗi skill (baseline `web-test`, Laya, Jev) ở dev, để lấy số lượt model/token/thời gian. Cần bạn duyệt chạy với profile ESS đã đăng nhập (hoặc cung cấp phiên khác) và mở cổng riêng (không dùng 9222).
- Nếu muốn gom: cân nhắc gộp verdict+oracle thành một skill (oracle dựa rule trước), vì verdict là bản yếu hơn của oracle.
- Tái lập: `node eval/run-ab.mjs && node eval/analyze.mjs && node eval/make-report.mjs` (cần laya-serve và `OPENROUTER_API_KEY`); live: `node eval/live-wait.mjs`, `node eval/live-scripts.mjs`.

## Phụ lục: file

- `.claude/skills/web-test-jev-{wait,gate,verdict,oracle}/`: 4 skill mới (mỗi skill có `SKILL.md`, `scripts/`, `tests/`, `jev.json`).
- `eval/questions.mjs`: câu hỏi, ngưỡng, rule copy nguyên văn từ script. `eval/data/`: bộ dữ liệu (`handwritten.mjs` là phần viết tay) và script dựng.
- `eval/run-ab.mjs`, `eval/analyze.mjs`, `eval/run-context-arm.mjs`, `eval/live-wait.mjs`, `eval/live-scripts.mjs`, `eval/make-report.mjs`. Kết quả thô và tóm tắt: `eval/results/`.
