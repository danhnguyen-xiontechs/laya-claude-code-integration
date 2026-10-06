# laya-launcher (L1)

Chọn **profile tool / MCP / slash command** cho một phiên `claude -p` *trước khi* phiên bắt đầu, để cắt phần context cố định
(tool schema, MCP, 179 slash command…) khỏi mọi request gửi lên API. Không đổi model, không hook, không proxy.

Kết quả A/B trên bug pxp-ai #1697 (5 lần/cấu hình, Opus 5.5): context cố định lượt đầu 23.8k → 11.0k token (−54%),
chi phí trung vị $0.829 → $0.762, hành vi đúng 5/5 so với 2/5. Chi tiết: `research/ab-1697/RESULTS.md` ở repo gốc.

## Có cần Laya không?

**Thường là không.** Laya ở đây chỉ phân loại đề bài thành 1 trong 6 intent rồi tra bảng `profiles.json`.
Nếu bạn biết loại task, `--profile bugfix` cho kết quả **giống hệt** mà không cần `laya-serve`.
Laya chỉ có ích khi task đến tự động (hàng loạt work item, CI) và các profile thực sự khác nhau theo intent.

## Cấu trúc

```
laya-launcher/
  laya_launch.py   # script duy nhất, chỉ dùng thư viện chuẩn Python 3.10+
  profiles.json    # câu hỏi cho Laya + bảng intent -> profile (sửa theo project)
  README.md
```

## Cài

1. Chép thư mục này vào project đích (hoặc bất cứ đâu; script không phụ thuộc vị trí).
2. Cần `claude` trên PATH và đã đăng nhập CLI (`claude /login`).
3. **Chỉ khi dùng Laya:** máy đã có Laya (`install-laya.ps1` ở repo gốc) và `laya-serve` đang chạy ở cổng 8000:
   ```bash
   laya-serve
   ```
   Lần đầu tải ~2.2 GB weights vào `HF_HOME`; sau đó hoàn toàn offline, đề bài không rời máy.

## Dùng

```bash
# Tự chọn profile, không cần Laya
python laya_launch.py --task-file task.txt --profile bugfix --cwd D:\repo

# Để Laya chọn (cần laya-serve)
python laya_launch.py --task-file task.txt --cwd D:\repo

# Chỉ xem quyết định và lệnh, không chạy
python laya_launch.py --task-file task.txt --dry-run

# Tham số thêm cho claude đặt sau "--"
python laya_launch.py --task-file task.txt --profile feature -- --model sonnet --max-turns 30 --output-format json
```

Đề bài có thể đưa qua stdin thay cho `--task-file`. Mỗi lần chạy in một dòng JSON ra stderr (intent, xác suất, profile, lệnh);
đặt `LAYA_LAUNCH_LOG=<file>` để ghi thêm vào JSONL.

## profiles.json

| Khóa | Ý nghĩa |
|---|---|
| `question`, `criteria` | Câu hỏi `choice` gửi Laya. Mỗi mô tả phải **dưới 48 token** (Laya cắt phần dư). |
| `min_prob` | Xác suất tối thiểu để tin Laya; thấp hơn thì dùng `default`. |
| `profiles.<tên>.tools` | Danh sách tool được gửi schema → `--tools`. Bỏ khóa này = giữ tất cả tool. |
| `profiles.<tên>.mcp` | `{}` = không MCP nào; `{"ado": {...}}` = chỉ MCP này → `--strict-mcp-config --mcp-config`. Bỏ khóa = giữ MCP mặc định. |
| `profiles.<tên>.no_skills` | `true` → `--disable-slash-commands`. |
| `profiles.default` | Dùng khi Laya tắt, lỗi, hoặc xác suất thấp (fail-open). Xóa nếu muốn fail-open về Claude Code nguyên bản. |
| `profiles.full` | `{}` = không cắt gì, để so sánh. |

**Sửa theo project:** nếu project cần một MCP (ví dụ ADO, database), ghi cấu hình MCP đó vào `mcp` của profile tương ứng
thay vì `{}`. Nếu cần skill, bỏ `no_skills`. Bảng này mới là thứ mang giá trị; Laya chỉ chọn dòng nào trong bảng.

## Dùng như lệnh `claude` (shim)

`claude-shim.ps1` định nghĩa hàm PowerShell **`claude`** đè lên lệnh thật (bản thật vẫn gọi được bằng `claude-full`).
Cài: thêm vào `$PROFILE` một dòng `. D:\XionTechs\Laya-router-research\laya-launcher\claude-shim.ps1`, mở PowerShell mới. Gỡ: xóa dòng đó.

```
claude                       # menu: session cũ của repo này (resume, vẫn cắt) · [n] đề bài mới · [f] nguyên bản
claude "fix bug X"           # Laya chọn profile (≈0.6 s khi laya-serve đã nóng, ≈17 s lần đầu) → xác nhận → phiên tương tác
claude -y "fix bug X"        # không hỏi xác nhận
claude -P bugfix "..."       # ép profile
claude --full ...            # bỏ qua Laya, claude nguyên bản
claude -c | -r <id>          # resume, cắt theo intent đã ghi (hoặc hỏi Laya trên đề bài đầu của session)
claude -p / mcp / --version  # đi thẳng claude thật
claude "..." -- --model sonnet   # cờ sau "--" chuyển cho claude
```

Màn hình đầu: `Laya intent=bugfix p=0.97 -> profile bugfix: 6 tool · 0 MCP · 0 skill` rồi `[Enter] chạy [f] nguyên bản [p] đổi profile [q] thoát`.
Mỗi phiên mở qua shim có `--session-id` do shim sinh và được ghi vào `~/.laya/sessions.jsonl` (id, intent, profile, 300 ký tự đầu đề bài)
để lần resume không hỏi Laya lại. `laya-serve` được tự bật nền nếu cổng 8000 chưa mở (log `~/.laya/laya-serve.log`); không lên kịp → profile `default`.

Lưu ý:
- Resume là tiến trình mới nên gắn cờ cắt được (đã kiểm chứng `-r <id> --tools ... --strict-mcp-config --disable-slash-commands`); prompt cache dù sao cũng phải dựng lại khi resume.
- Profile `question` là read-only (3 tool). Laya xếp "explain X, no code changes" vào đó với p 0.53, sát `min_prob` 0.5; nếu hay bị cắt nhầm, nâng `min_prob` hoặc bỏ profile `question` để rơi về `default`.
- Claude Desktop (tab Code) không đi qua shim; không áp dụng được.

## Cách nó hoạt động

```
task.txt ─► (Laya: intent, ~1 s) ─► profiles.json ─► claude -p --tools ... --strict-mcp-config --mcp-config {} --disable-slash-commands
```

Từ `claude -p` trở đi, Claude Code chạy y như bình thường, chỉ là mỗi request nhẹ hơn vì model không thấy các tool/MCP/skill bị cắt.
Quyết định cố định cả phiên nên prompt cache không bị phá.

## Giới hạn

- Chỉ áp dụng cho `claude -p` (chạy tự động). Phiên tương tác không có bước "trước khi chạy"; ở đó hãy gỡ MCP/plugin không dùng.
- Tool bị cắt là **không tồn tại** với model trong phiên đó; chọn sai profile (ví dụ `question` cho task cần sửa code) thì phiên không làm được việc.
- Bằng chứng mới có một task, n=5, một model. Chưa chạy riêng cấu hình "profile tĩnh, không Laya" để tách công của Laya khỏi công của bộ cờ.
