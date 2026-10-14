# Plan 3 — Gate an toàn cho write action (bảng điểm quyết định #7)

## Nó làm gì

Sau khi Claude viết plan vào `results.json`, một script `gate.mjs` duyệt **từng bước của từng case** và hỏi Laya một câu boolean: *"Bước này có ghi dữ liệu (submit, approve, reject, cancel, upload, edit, delete) không?"* Input là `action` của bước (một câu). Kết quả:

| Laya | Hành động |
|---|---|
| `true`, confidence ≥ 0.8 | đánh dấu `writes: true`, đưa vào danh sách phải hỏi user |
| `false`, confidence ≥ 0.8 | `writes: false` |
| còn lại | `writes: "unsure"`, cũng đưa vào danh sách hỏi user |

Danh sách này in ra một bảng gọn (`TC | step | action | Laya | conf`) và skill **dừng chờ OK** trước khi chạy bất kỳ bước nào có `true` hoặc `unsure`. Chạy xong, bước nào thực tế đã gửi POST/PUT/DELETE tới `/api/` mà `writes` là `false` thì ghi vào `observations` là gate bỏ sót.

## Trước khi apply

Step 2 của skill có "Write-action gate": Claude phải tự liệt kê các bước ghi dữ liệu và hỏi một lần. Việc này nằm trong **cùng lượt plan** với việc đọc ticket, suy AC, viết 8–12 case. Dễ sót vì:

- Không có bước kiểm tra riêng, chỉ là một câu dặn trong SKILL.md.
- Từ ngữ trong action không đồng nhất: "Save draft", "Confirm", "Send for approval", "Withdraw" đều là write nhưng không nằm trong danh sách từ khóa của skill.
- Hậu quả không đảo được: D365 F&O dùng chung, ngay cả từ `local`. Một leave request thừa hoặc một approve nhầm là thứ người khác nhìn thấy.

Và không có bằng chứng sau run rằng gate đã đúng: không ai đối chiếu "đã hỏi những bước nào" với "thực tế đã POST những gì".

## Sau khi apply

```
plan xong ──► gate.mjs ──► laya_decide cho từng step (N bước ≈ N × 0.5 s, 0 token)
                 ├─ bảng write/unsure → hỏi user một lần
                 └─ ghi writes vào results.json
run xong ──► đối chiếu network log POST/PUT/DELETE với writes=false → báo sót
```

- Gate thành một bước riêng, chạy máy, không phụ thuộc Claude có nhớ hay không.
- Ngưỡng nghiêng về an toàn: `unsure` cũng hỏi. Hỏi thừa rẻ, ghi nhầm đắt.
- Có vòng phản hồi: mỗi lần gate sót được ghi lại thành dữ liệu để đánh giá Laya hoặc bổ sung rule.

Về token: tiết kiệm không đáng kể (gate chỉ chạy một lần mỗi run). Giá trị là **an toàn có kiểm chứng**, không phải quota.

## Cách đo trước/sau

1. Gom mọi `action` của mọi bước trong các results.json đã có, gán nhãn tay write/read. Thêm các câu khó cố ý ("Open the request and check Cancel is disabled" là read; "Cancel the request" là write).
2. So ba cách: rule từ khóa, Laya, Haiku. Chỉ tiêu quan trọng là **recall của write** (không được sót), precision kém chút chấp nhận được.
3. Vẽ confidence: các ca Laya sai có rơi vào vùng `unsure` không. Nếu có, ngưỡng 0.8 hợp lý; nếu không, hạ ngưỡng hoặc giữ rule làm lớp thứ hai (OR của rule và Laya).
4. Sau khi gắn: đếm số lần "gate sót" ở bước đối chiếu network qua ~10 run.

## Việc cần làm

- [ ] `scripts/gate.mjs`: đọc results.json, gọi Laya HTTP, ghi `writes` + `writesConfidence`, in bảng.
- [ ] Rule từ khóa làm lớp dự phòng khi Laya tắt và làm baseline để so.
- [ ] Sửa Step 2 SKILL.md: thay đoạn "Write-action gate" bằng lệnh chạy `gate.mjs` và quy tắc dừng.
- [ ] Sửa Step 4 mục 5: sau run, lọc network log các method ghi và đối chiếu.
- [ ] `build_report.mjs`: icon ✍ cạnh bước có `writes: true`.

## Rủi ro

- Action viết mơ hồ ("Complete the flow") thì cả Laya lẫn rule đều không biết. Giảm bằng cách yêu cầu trong Step 2: mỗi action chỉ một động từ chính.
- Bước read vẫn có thể gây write ngầm (ví dụ mở form tự tạo draft). Gate dựa trên mô tả không bắt được; chỉ bước đối chiếu network sau run mới phát hiện.

## Kết quả implement (2026-10-08)

Đo trước khi viết logic (`idea/web-test/gate/`: `samples.json` 30 câu dùng để chỉnh, `heldout.json` 24 câu viết sau khi đã khóa rule và câu hỏi):

| Held-out (12 write / 12 read) | Bỏ sót write | Báo nhầm read |
|---|---|---|
| Rule từ khóa (overfit vào bộ chỉnh: 0 sót ở đó) | 8 | 5 |
| Laya, câu hỏi kiểu "động từ chính" (`english`) | 1 | 9 |
| Rule OR Laya | 1 | 10 |

Các cách hỏi khác thua rõ: `noul` (english) bắt 5/15, `noul` (typed-decisions) 0/15, `choice` (typed-decisions) 9/15 trên bộ chỉnh. p(write) của write thật và read chồng lên nhau (0.44–0.85 vs 0.51–0.73), nên không ngưỡng nào tách sạch.

Thiết kế thay đổi so với plan ban đầu: Laya **không** quyết định, nó là người nghi ngờ.
- Agent đánh `writes` cho từng bước lúc lên plan.
- `gate.mjs`: agent nói write → write; rule hoặc Laya nói write mà agent nói read → `disputed`, quay về **agent** xem lại (đổi sang write, hoặc giữ read + `writesReason`). Không bao giờ hạ cờ write của agent.
- User được hỏi một lần: danh sách write + một dòng các bước agent đã bác bỏ nghi ngờ.
- `netlog.mjs` ghi mọi non-GET `/api/` suốt run; `gate.mjs --audit` gán request vào bước theo `step.at` và báo bước bị gọi là read nhưng đã ghi.

Đã test: luồng disputed → agent sửa → exit 0; Laya tắt → chỉ rule; recorder bỏ GET, bỏ query, không ghi header; audit bắt được bước "Sort" (agent bác bỏ) thật ra đã POST.
