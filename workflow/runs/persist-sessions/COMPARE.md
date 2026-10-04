# Task thật thứ hai: lưu session của proxy ra file (2026-10-05)

Task (`task.txt`): trong `proxy/router_proxy.py`, dict `sessions` chỉ nằm trong RAM. Làm cho nó bền: lưu JSON cạnh proxy (đường dẫn đổi được bằng `ROUTER_SESSIONS_FILE`), nạp lúc khởi động, lưu khi thêm hoặc nâng tầng; ghi an toàn khi crash, không chặn event loop; file thiếu hoặc hỏng không được làm proxy chết; bỏ session quá 24 giờ khi nạp; không đổi hành vi routing; viết test pytest và chạy cho qua. Luồng chính Sonnet (trừ baseline), mỗi cấu hình chạy **một lần** trong bản sao riêng.

| Cấu hình | Model từng bước | Luồng chính | Chi phí* | Thời gian | Test | Code mới |
|---|---|---|---|---|---|---|
| `static` | explore=haiku, plan=opus, implement=sonnet, verify=haiku, review=sonnet, **rồi implement + verify lần hai** | Sonnet, 15 lượt | 1,203 | 352 s | 18 qua | store 111 + test 159 dòng |
| `laya` | explore=sonnet (p 0.42), plan=opus (0.48), implement=opus (0.53), verify=sonnet (0.43), review=sonnet (0.44) | Sonnet, 11 lượt | 1,283 | 271 s | 17 qua | store 114 + test 161 |
| `baseline` | một luồng Opus, không workflow | Opus, 11 lượt | **657** | **118 s** | 15 qua | store 61 + test 119 |

\*Giả định giá haiku:sonnet:opus = 1:3:5, output 5x, cache đọc 0.1x, cache ghi 1.25x; chỉ để so tương đối. Test do chính mỗi cấu hình viết, mình chạy lại trong từng bản sao: đều qua, `router_proxy.py` biên dịch được.

## Điều đã thấy

- **Baseline Opus một luồng vẫn rẻ nhất (657) và nhanh nhất (118 s)**, rẻ hơn khoảng 1.8–2 lần và nhanh hơn 2.3–3 lần so với hai cấu hình chia bước. Cùng kết luận với task nhỏ lần trước.
- **Cả ba đều đáp ứng yêu cầu "không chặn event loop"** (ghi trong thread bằng `asyncio.to_thread`, ghi tạm rồi `os.replace`). Hai cấu hình chia bước làm kỹ hơn (gộp nhiều lần lưu thành ít lần ghi, ở `laya` còn thử lại khi Windows báo `PermissionError`) nên code dài gần gấp đôi. Chưa biết phần thêm đó đáng giá hay là làm quá.
- **`static` phải sửa một vòng:** `verify` (Haiku) và `review` tìm ra vấn đề, nên `implement` + `verify` chạy lại, tốn thêm khoảng 300 đơn vị. `laya` làm một lượt.
- **Haiku làm bước explore cần nhiều lượt hơn hẳn:** 18 lượt so với 3 lượt của Sonnet cho cùng việc, nhưng vẫn rẻ hơn về đơn vị chi phí (81 so với 98). Bước verify của Haiku ở lần chạy lại mất 12 lượt.
- **Laya chọn model theo brief với xác suất 0.42–0.53:** đều gần hòa ba lựa chọn, nên đây vẫn là quyết định yếu. Khác bảng tĩnh ở hai bước: explore (sonnet thay vì haiku) và implement (opus thay vì sonnet); các bước khác trùng.
- **Hook của Laya mất trung bình 3.0 giây mỗi lần gọi, tối đa 4.2 giây** (cộng khoảng 15 giây trên 271 giây chạy), cao hơn đo riêng vì brief dài và máy bận.

## Lưu ý về độ tin cậy

- Một lần chạy mỗi cấu hình. Ở đây chưa nói được gì về chất lượng ngoài việc test của mỗi cấu hình qua; phần chất lượng là việc của bạn.
- Lần chạy đầu của task này hỏng toàn bộ do lỗi của `run_task.py` (đề bài nhiều dòng bị cmd.exe cắt, đã sửa bằng cách gọi `claude` không qua shell). Không dùng kết quả đó; chỉ tốn rất ít hạn mức.
- Cùng một task có thể có nhiều cách làm đúng; baseline viết ngắn hơn nhưng vẫn qua cả 15 test của chính nó.

## Việc của bạn

Đọc trong mỗi thư mục `static/`, `laya/`, `baseline/`: `final.diff` (sửa `router_proxy.py` và `.gitignore`), `session_store.py` và `test_sessions.py` (hai file mới, đã chép ra đây), rồi điền `review.md`: model từng bước đủ / thừa / thiếu, diff dùng được không.
