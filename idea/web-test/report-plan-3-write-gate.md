# Report — Plan 3: cổng chặn bước ghi dữ liệu (`gate.mjs` + `netlog.mjs`)

Ngày 2026-10-08. Skill: `.claude/skills/web-test-laya`. Dữ liệu: bộ câu action có nhãn (`idea/web-test/gate/`) và run Opus 22063 lúc 17:58.

## Một câu

Laya **có ích thật** ở plan 3: nó hiểu nghĩa câu nên bắt được các bước ghi dữ liệu viết bằng cách nói lạ, mà rule từ khóa bỏ sót. Cái giá là nó nghi ngờ nhầm nhiều bước chỉ đọc, nên mỗi nghi ngờ được trả về cho Claude xem lại thay vì hỏi thẳng user.

## Trước khi apply

- SKILL.md chỉ có một câu dặn: "liệt kê các bước submit/approve/… và hỏi user một lần". Claude làm việc này **trong cùng lượt** lên plan, lẫn với đọc ticket và viết 8–12 case.
- Không có bước kiểm tra riêng, không có ai kiểm tra chéo.
- Sau run cũng không đối chiếu được "đã hỏi những bước nào" với "thực tế đã ghi những gì". D365 dùng chung, nên ghi nhầm là người khác nhìn thấy.

## Sau khi apply

```
plan: Claude đánh writes: true|false cho từng bước
  └─ gate.mjs:  rule từ khóa + Laya kiểm tra lại từng bước
        ├─ Claude nói ghi                       → write (không bao giờ hạ xuống)
        ├─ Claude nói đọc, rule/Laya nói ghi    → disputed → Claude xem lại:
        │      đổi sang ghi, hoặc giữ đọc + ghi lý do (writesReason)
        └─ cả ba nói đọc                        → read
  └─ hỏi user 1 lần: các bước ghi + 1 dòng các bước Claude đã bác bỏ nghi ngờ
run: netlog.mjs ghi mọi request non-GET tới /api/ (method, path, status; không header/body)
cuối run: gate.mjs --audit → request ghi rơi vào bước bị coi là đọc → ghi vào observations
```

## Số liệu

**Đo offline, bộ held-out 24 câu** (12 ghi / 12 đọc, viết sau khi đã khóa rule và câu hỏi):

| | Bỏ sót bước ghi | Báo nhầm bước đọc |
|---|---|---|
| Rule từ khóa | **8/12** | 5/12 |
| Laya | **1/12** | 9/12 |
| Rule OR Laya | 1/12 | 10/12 |

Rule sót các câu như "OK the overtime claim", "Hit Done", "Revoke the delegation", "Post a comment", "Mark as attended". Laya bắt được gần hết. Nhưng xác suất Laya đưa ra cho bước ghi thật và bước đọc chồng lên nhau (0.44–0.85 so với 0.51–0.73), nên không ngưỡng nào tách được hai nhóm. Đây là lý do Laya chỉ được nghi ngờ, không được quyết định.

**Run thật 22063 (Opus, 17:58)**, 6 bước, tất cả đều chỉ đọc:

| | Kết quả |
|---|---|
| Lần chạy gate đầu | `disputed=2`: hai bước "Navigate … to Dec 2026" (Laya 0.52 và 0.55) |
| Claude xem lại | Giữ là đọc, lý do: "Month navigation only changes the viewed date range (GET request)" |
| Lần chạy gate thứ hai | `disputed=0 overruled=2`, exit 0 |
| Chi phí | ~1 lượt model thêm, 6 câu hỏi Laya (~2 s) |
| Ghi nhầm / sót | 0 (ticket không có bước ghi, nên chưa đo được recall trên ESS thật) |

**Test với server giả** (cổng riêng): audit bắt được bước "Sort" mà Claude đã bác bỏ nghi ngờ nhưng thực tế gửi POST. Recorder bỏ qua GET, bỏ query string, không ghi header.

## Laya giúp được gì ở plan 3

| | Đánh giá |
|---|---|
| Bắt bước ghi viết bằng cách nói lạ | **Có**: 1/12 sót so với 8/12 của rule (held-out) |
| Bớt token/quota | Không đáng kể; gate chạy một lần mỗi run |
| Quyết định thay Claude | **Không nên**: báo nhầm 9/12 bước đọc |
| Đổi lại được gì | Mỗi bước Claude coi là "đọc" mà trái ý rule hoặc Laya đều phải có lý do bằng chữ, nằm trong report |

Phần kiểm chứng thật sự là `netlog.mjs` + audit, không phụ thuộc Laya: dù cả Claude lẫn Laya đều sai, request ghi vẫn hiện ra trong report.

## Lỗi tìm ra từ run thật, đã sửa

- Khi run không có request ghi nào, `netlog.mjs` không tạo file log, nên audit báo "recorder không chạy". Nay file được tạo ngay lúc start.

## Đề xuất

- Giữ thiết kế: Claude quyết định, Laya nghi ngờ, network kiểm chứng.
- Cần một ticket có bước submit/approve để đo trên ESS thật: Laya có bắt được bước Claude đánh sai không, và audit có khớp request với bước không. Ticket 22063 chỉ có bước đọc.
- Theo dõi tỷ lệ dispute bị bác bỏ. Nếu gần 100% qua nhiều run (như run 17:58: 2/2), có thể nâng ngưỡng Laya để bớt lượt xem lại, nhưng phải đo lại recall trên held-out trước.
