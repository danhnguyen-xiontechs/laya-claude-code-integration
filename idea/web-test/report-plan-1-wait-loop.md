# Report — Plan 1: vòng chờ trang (`wait.mjs`)

Ngày 2026-10-08. Skill: `.claude/skills/web-test-laya`. Ticket đo: 22063 trên ESS dev (4 run có số liệu).

## Một câu

`wait.mjs` giúp thật: bỏ được vòng `wait_for`/snapshot và chụp ảnh luôn trong một call. **Nhưng phần giúp là rule trong script, không phải Laya.** Trên ESS thật, Laya chưa lần nào làm thay đổi kết quả.

## Trước khi apply

Claude chờ trang bằng `wait_for(text)` của chrome-devtools MCP:
- Mỗi lần chờ là một lượt model. Trang chưa xong thì phải gọi lại, hoặc `take_snapshot` để xem (thêm 2–7K token vào context, bị đọc lại ở mọi lượt sau).
- `wait_for` chỉ biết một đoạn text. Trang rẽ sang màn login Microsoft hay "Something went wrong" thì phải snapshot mới biết.
- Chụp ảnh là một tool call riêng.

## Sau khi apply

```
node .claude/skills/web-test-laya/scripts/wait.mjs --expect "<text>" --shot shots/TC01-S01.png
→ status=ready screen=attendance login=false expect=found waited=5.3s laya=idle
```

Script nối vào browser trên port 9222, poll text trang mỗi 500 ms, trả **một dòng**: ready / login / error / timeout, kèm chụp ảnh. Thứ tự quyết định:

1. **Rule trước**: còn spinner/skeleton → chờ; text mong đợi có rồi → ready; regex login/lỗi → dừng; URL route → tên màn hình.
2. **Laya sau**: chỉ hỏi khi trang không có spinner, text đứng yên 3 s, mà rule vẫn chưa kết luận. Ba câu hỏi: đã tải xong chưa / màn nào / có phải login.

## Số liệu

| Run | Skill | Model | `wait_for` | `wait.mjs` | Lượt model | Thời gian |
|---|---|---|---|---|---|---|
| 15:24 | web-test | Fable | 4 | – | 40 | 10 phút (có first-run sign-in) |
| 17:26 | web-test-laya | Fable | 0 | 3 | 39 | 4 phút |
| 17:39 | web-test-laya | Opus | 0 | 2 | 26 | 3 phút |
| 17:58 | web-test-laya | Opus | 0 | 8 | 50 | 5 phút |

Lưu ý: các run khác nhau cả số case lẫn model, và run 15:24 phải sign-in lần đầu, nên thời gian không so thẳng được. Chưa có run `web-test` (baseline) bằng Opus để so công bằng.

**Laya làm gì trong các run thật** (`~/.ess-web-test/wait-log.jsonl`, 45 poll trên ESS):

| | Số poll |
|---|---|
| Rule tự kết luận | 38 |
| Có hỏi Laya | 7 (đều trong cùng một lần timeout ở run 17:58) |
| Laya làm đổi kết quả | **0** |

Bảy lần đó Claude mở nhầm sang trang `manager-view`, nơi không có text mong đợi. Laya trả lời đúng là "đã tải xong" và "không phải login", nhưng độ tin cậy thấp (state 0.50, screen 0.58, dưới ngưỡng 0.6), nên script vẫn chờ tới timeout 25.7 s.

**Trên trang giả lập** (test lúc implement): Laya nhận đúng màn login (p 0.95–1.00) và màn lỗi (screen 1.00). Tuy vậy, regex cũng đã bắt được cả hai trang đó.

## Laya giúp được gì ở plan 1

| | Đánh giá |
|---|---|
| Bớt lượt model khi chờ | Có, nhưng **nhờ script gộp wait + screenshot**, không nhờ Laya |
| Nhận ra trang login/lỗi có câu chữ lạ | Có tiềm năng, **chưa gặp trên ESS thật** |
| Gọi tên màn hình | Route URL đã làm được; Laya chỉ cần khi URL không nói lên gì |
| Báo sớm "trang đã xong nhưng không phải trang mong đợi" | Laya có trả lời đúng nhưng chưa đủ tin cậy để dừng sớm. Rule "text đứng yên N giây, không spinner, không có text mong đợi" có lẽ làm được việc này mà không cần Laya |

## Lỗi tìm ra từ run thật, đã sửa

- `wait.mjs` báo ready sau 0.7 s vì nhãn tháng đổi trước khi data tải. SKILL.md nay dặn `--expect` phải là chuỗi chỉ xuất hiện khi data đã có.

## Đề xuất

- Giữ `wait.mjs` (rule), vì đây là phần đem lại lợi ích.
- Laya trong `wait.mjs`: giữ ở chế độ "chỉ khi rule bó tay", tiếp tục ghi `wait-log.jsonl`. Sau khoảng 10 run, nếu số lần Laya đổi kết quả vẫn là 0 thì bỏ Laya khỏi plan 1.
- Thêm rule dừng sớm khi trang ổn định mà thiếu text mong đợi, để không phải chờ hết 25 s như run 17:58.
