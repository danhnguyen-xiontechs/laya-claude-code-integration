# Plan 1 — Vòng lặp chờ trang (bảng điểm quyết định #3, #4, #5)

## Nó làm gì

Một script nhỏ `wait.mjs` nối vào browser đang chạy trên port 9222 (cùng browser mà chrome-devtools MCP đang dùng). Mỗi 500 ms nó lấy text hiển thị của trang (vài trăm ký tự đầu, không phải DOM), hỏi Laya ba câu có nhãn cố định, và chỉ trả về Claude **một dòng** khi trang đã ổn định hoặc hết thời gian.

Ba câu hỏi, gộp trong một lần gọi `laya_decide`:

| Câu | Nhãn | Dùng để |
|---|---|---|
| Trang đã tải xong chưa | `ready` / `loading` / `error` | thoát vòng chờ |
| Đây là màn hình nào | `leave-list`, `leave-form`, `approvals`, `profile`, `login`, `error`, `unknown` (danh sách lấy từ sitemap ESS, giữ ≤ 15) | xác nhận đã điều hướng đúng |
| Có phải trang đăng nhập Microsoft / MFA | `true` / `false` | dừng đúng lúc để hỏi user ký vào |

Kết quả trả về Claude:

```
ready screen=leave-form login=false waited=1.8s expect="Leave request submitted"=found
```

## Trước khi apply

Step 4 của skill, mục 2: Claude gọi `wait_for` với text mong đợi. Nếu text chưa có thì tool trả về timeout hoặc trang vẫn skeleton. Claude đọc kết quả, quyết định gọi lại hoặc chụp snapshot để xem. Mỗi vòng như vậy là **một lượt model**, đọc lại toàn bộ context (cache read, nhưng vẫn tính) và sinh một tool call mới. Với trang ESS fan-out nhiều call D365, một bước điều hướng dễ mất 2–4 lượt chỉ để chờ.

Ngoài ra `wait_for` chỉ biết một text. Nó không biết trang đã rẽ sang màn login, hay đã lên màn lỗi "Something went wrong". Những trường hợp đó Claude chỉ phát hiện khi chụp snapshot, tức thêm 2–7K token vào context.

## Sau khi apply

```
Claude ──(1 tool call)──► wait.mjs ──┬─ 500ms: lấy text trang
                                     ├─ laya_decide: ready? screen? login?
                                     ├─ chưa ready → lặp (tối đa N giây)
                                     └─ ready / login / error / timeout → trả 1 dòng
```

- Một bước chờ = **một lượt** Claude, bất kể trang mất 1 giây hay 15 giây.
- Rẽ sang login hoặc màn lỗi được phát hiện **ngay trong vòng chờ**, không cần snapshot.
- Laya chạy local, ~0.5 s/lần trên CPU, không tốn quota. 20 vòng poll vẫn là 0 token.
- Laya sai cũng ít hại: nói `loading` khi đã ready thì chờ thêm 500 ms; nói `ready` sớm thì bước kế tiếp dùng `expect` text (rule, không phải Laya) làm chốt chặn cuối.

## Cách đo trước/sau

1. Từ execution log của các run đã có (22063…), đếm số lượt và token của chuỗi `wait_for` → `take_snapshot` → `wait_for` cho mỗi bước điều hướng.
2. Thu text trang tại ~100 thời điểm (đang tải, đã tải, login, lỗi) từ run thật, gán nhãn tay, chạy Laya offline. Cần đạt: `login` và `error` không bị bỏ sót (recall cao), `ready` có thể sai một chút.
3. Chạy lại cùng ticket với `wait.mjs`. So: số lượt model, token input, thời gian thực của mỗi bước điều hướng.

## Việc cần làm

- [ ] `scripts/wait.mjs`: `connectOverCDP('http://127.0.0.1:9222')`, lấy `document.body.innerText` cắt 1500 ký tự, đếm phần tử có class/aria `loading|skeleton|spinner` làm tín hiệu phụ.
- [ ] Gọi Laya qua HTTP `POST localhost:8000/v1/systemone` (không qua MCP, vì script chạy ngoài Claude).
- [ ] Danh sách màn hình ESS cho câu 2, lấy từ route của `ess-fe`.
- [ ] Sửa Step 4 mục 2 của SKILL.md: thay `wait_for` bằng `wait.mjs --expect "<text>" --timeout 20`.
- [ ] Khi Laya không chạy (server down): script tự rơi về rule thuần (expect text + không còn spinner), ghi `laya=off` vào output.

## Rủi ro

- Laya có giới hạn độ dài input; 1500 ký tự ≈ 400 token là an toàn (đo: 512 token ≈ 1.1 s trên CPU LENOVO2).
- Danh sách màn hình phải cập nhật khi ESS thêm màn. Nếu `unknown` xuất hiện nhiều thì đó là tín hiệu cần thêm nhãn.
