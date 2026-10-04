# Workflow theo bước: Laya chọn model cho từng subagent

Thay vì chọn một model cho cả task (dễ thành "Opus từ đầu đến cuối"), task chạy thành 5 bước, mỗi bước là một subagent của Claude Code. Hook đứng trước mỗi lần gọi subagent, hỏi Laya trên **brief của bước đó**, rồi đặt `model` cho subagent. Luồng chính giữ một model cố định nên không mất prompt cache.

```
/wf <task>  (luồng chính, model cố định)
  wf-explore -> wf-plan -> wf-implement -> wf-verify -> wf-review
       mỗi lần gọi: PreToolUse hook -> compact brief -> Laya -> updatedInput.model
```

Khác với `proxy/`: proxy đổi model của từng request trong luồng chính (mất cache, phải vá request cho từng model). Hướng này không dùng proxy.

## Cài vào một repo

```bash
powershell -ExecutionPolicy Bypass -File D:\Laya\workflow\setup_workflow.ps1 -Target D:\duong\dan\repo
```

Cài `.claude/agents/wf-*.md`, `.claude/commands/wf.md` và một hook trong `.claude/settings.local.json` (giữ nguyên phần còn lại của file). Chạy lại không nhân đôi hook. Gỡ bằng `-Remove`.

## Chạy

Chế độ chọn model đặt bằng biến môi trường **trước khi mở Claude Code**:

| `LAYA_STEP_MODE` | Hành vi |
|---|---|
| `laya` (mặc định) | Laya chọn haiku / sonnet / opus theo brief. Cần `laya-serve` chạy ở cổng 8000 |
| `static` | Bảng cố định theo loại bước: explore=haiku, plan=opus, implement=sonnet, verify=haiku, review=sonnet (đổi bằng `LAYA_STEP_STATIC="plan=sonnet,..."`) |
| `off` | Hook không can thiệp; subagent kế thừa model của luồng chính |

Các biến khác: `LAYA_STEP_FLOOR` / `LAYA_STEP_CEIL` (sàn, trần theo bước, chế độ laya), `LAYA_URL`, `LAYA_TIMEOUT` (giây, mặc định 3), `LAYA_STEP_LOG`.

```bash
# cửa sổ 1: Laya
$env:LAYA_MODELS="english"; laya-serve
# cửa sổ 2: trong repo đã cài
$env:LAYA_STEP_MODE="laya"; claude --model sonnet
> /wf <mô tả task>
```

Hook **không bao giờ làm hỏng luồng**: Laya tắt, quá giờ hay lỗi thì không in gì và subagent dùng model mặc định. Hook chỉ chạm vào subagent tên `wf-*`. Khi can thiệp, hook trả `permissionDecision: allow` cho riêng lần gọi subagent đó.

## Đọc kết quả

```bash
python D:\Laya\workflow\step_report.py <session_id> --out runs\<ten>\report.md --review runs\<ten>\review.md
```

`session_id` lấy từ `claude -p ... --output-format json` hoặc tên file trong `~/.claude/projects/<repo>/`. Báo cáo ghép: hook chọn gì (kèm xác suất), model thật của subagent, số lượt, token (input mới / cache đọc / cache tạo / output), thời gian, và tổng của luồng chính. `review.md` là mẫu để người review điền từng bước: model đủ / thừa / thiếu. **Nhãn "đúng" là ý kiến người review, không phải của Claude.**

Log của hook: `hooks/step_decisions.jsonl` (có `compact_ms`, `laya_ms`, `total_ms`).

## Kết quả đã đo (2026-10-02, task đổi tên hàm trong repo này)

- Cơ chế: hook chạy được ở `-p`; tool tên `Agent`; `tool_input` có `description`, `prompt`, `subagent_type`, `run_in_background`; đặt `model` trong `updatedInput` đổi được model của subagent (đối chứng: không hook thì subagent kế thừa Sonnet của luồng chính, có hook ép haiku thì chạy Haiku 4.5).
- Thời gian: compact 0.03 ms; Laya 450–630 ms với brief 150–260 ký tự, **750–1230 ms với brief 500–970 ký tự** (brief do luồng chính viết); mỗi lần gọi subagent cộng thêm khoảng 0.5–1.2 giây. Không gọi lại Laya ở các turn trong một subagent.
- Task nhỏ này: Laya chọn Sonnet cho cả 5 bước (xác suất 0.50–0.62), nên trùng cấu hình "tất cả Sonnet". Tổng 334 đơn vị chi phí quy đổi (giả định giá 1:3:5) so với khoảng 115 khi một luồng Sonnet làm cùng task (bài `e1` ngày 2026-10-01): với task tầm thường, chia bước tốn gấp khoảng 3 lần. Đây là một lần chạy, chưa phải thống kê.

## Lưu ý

- Chế độ `-p`: subagent chạy nền (`requestShape: background`) và **không thể hỏi quyền**. Lệnh Bash ghép kiểu `cd ... && git diff` không khớp quy tắc hẹp như `Bash(git *)` nên bị từ chối. Prompt của agent đã dặn không `cd`; khi chạy tự động trong bản sao dùng một lần, cho phép `Bash` rộng hơn. Ở chế độ tương tác bạn tự duyệt.
- Git Bash trên Windows đổi `/wf` thành `C:/Program Files/Git/wf` khi gọi `claude -p "/wf ..."`; đặt `MSYS_NO_PATHCONV=1` hoặc chạy từ PowerShell.
- Luồng chính có thể bỏ bước (ví dụ bỏ `wf-plan` khi task đã rõ). Điều này là chủ ý trong `commands/wf.md`, trừ `wf-verify` và `wf-review` sau khi có sửa code.
- `hooks/probe.py` chỉ để chẩn đoán: ghi nguyên JSON mà hook nhận (`PROBE_SET_MODEL=haiku` để thử ép model).
