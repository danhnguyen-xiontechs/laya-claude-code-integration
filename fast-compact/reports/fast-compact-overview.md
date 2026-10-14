# fast-compact — tổng quan

Plugin Claude Code (skill + hook) nén context theo kiểu **giữ nguyên văn**, thay cho bản tóm tắt
của `/compact` mặc định. Quy tắc cứng, không gọi model, chỉ bật khi người dùng chủ động gọi.

## 1. fast-compact làm gì

**Cách dùng**

```
/fast-compact   → xem trước sẽ cắt gì, bật cờ dùng một lần (hết hạn sau 15 phút)
/compact        → hook thấy cờ: nén nguyên văn thay vì tóm tắt; cờ tự tắt
```

- Không gọi `/fast-compact` → `/compact` tóm tắt như mặc định.
- Auto-compact (khi context đầy) → luôn dùng tóm tắt mặc định, fast-compact không can thiệp.
- `/fast-compact preview` chỉ xem trước; `/fast-compact off` tắt cờ.
- Giảm dưới 25% hoặc hook lỗi/quá thời gian → tự quay về bản tóm tắt mặc định.

**Nó giữ lại gì**

Mọi message, mọi tool call và toàn bộ text user/assistant đều giữ nguyên, đúng thứ tự.
Message đầu tiên và 6 message mới nhất không bị đụng tới.

**Nó cắt gì (chỉ áp dụng cho các call cũ hơn)**

| Tool | Input | Output |
|---|---|---|
| Edit, MultiEdit, Write, NotebookEdit | chuỗi dài cắt còn 300 ký tự; Write đã bị một Write sau ghi đè cùng file thì bỏ `content` | giữ (vốn ngắn) |
| Read | cắt còn 400 | thành ghi chú nếu file đó được đọc/sửa lại sau; ngược lại giữ 300 ký tự đầu |
| Grep, Glob, LS, ToolSearch, WebSearch | cắt còn 400 | 150 ký tự đầu |
| Agent, Task, WebFetch | cắt còn 400 | 600 ký tự đầu |
| Bash, PowerShell, MCP, tool khác | cắt còn 400 | giữ nếu là lỗi hoặc ≤ 1200 ký tự; ngược lại giữ 200 đầu + 200 cuối |

- Mỗi chỗ bị cắt để lại ghi chú `[fast-compact: N chars cut; …]`, nói cách lấy lại (đọc lại file, chạy lại lệnh).
- Phần đã cắt thì không cắt lần nữa.

**Thành phần**

| File | Vai trò |
|---|---|
| `hooks/fast-compact.ts` | Quy tắc + function hook `session.compact`; ghi `~/.claude/fast-compact/log.jsonl` (từ bản 0.1.1) |
| `scripts/preview.ts` | Xem trước trên transcript thật, bật/tắt cờ (`arm.json`); chạy đúng bộ quy tắc của hook |
| `skills/fast-compact/SKILL.md` | Lệnh `/fast-compact` |
| `tests/fast-compact.test.ts` | 13 test |

**Yêu cầu:** Claude Code ≥ 2.1.274, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (early access), Node 22.18+.

## 2. Jev đóng góp gì

fast-compact **không gọi Jev** khi chạy. Phần Jev đóng góp nằm ở **ý tưởng** và **kết quả đo**.

**Ý tưởng lấy từ `tamaratran/fast-jev-compaction`.** Plugin đó cũng nén nguyên văn, chỉ
xoá/cắt tool call cũ. Nhưng mỗi lần compact, nó gửi state hội thoại cho Jev và hỏi từng call có
nên giữ không.

**Đo trên 4 session thật** (project `D--Laya`, cắt ở mốc 60%). Haiku 5.5 chấm 158 call theo kiểu
nhìn trước tương lai: call/output nào thực sự được dùng lại về sau.

| | Jev (bản gốc) | Jev + 300 ký tự đầu output | Quy tắc cứng (fast-compact) |
|---|---|---|---|
| Giảm số ký tự | 43–76% | 44–88% | 47–58% |
| Call còn cần được giữ | 0/38 | 0/38 | **38/38** |
| Output còn cần, giữ nguyên | 0/6 | 0/6 | 2/6 (4 cái còn đầu + cuối) |
| AUC "call còn cần" | 0.70 | 0.74 | Quy tắc "giữ Write/Edit": 0.77 |
| AUC "output còn cần" | 0.38 | 0.53 | — |
| Chi phí mỗi lần compact | ~2 s, ≤ $0.008, tối đa 7 request | như trái | 0, ~60 ms |

**Vì sao Jev không dùng được**
- Ở ngưỡng mặc định 0.5, Jev bỏ gần như tất cả: xác suất "giữ output" cao nhất chỉ 0.26.
- Jev chỉ thấy dòng `ok, N chars`, không thấy nội dung output. Thêm phần đầu output vào state cũng chỉ đưa
  AUC lên mức ngang đoán ngẫu nhiên.
- Hạ ngưỡng `keepCall` thì không ngưỡng nào vừa giữ ít vừa bắt được nhiều call cần hơn quy tắc
  "giữ Write/Edit" (recall 0.71, precision 0.56).
- Session lớn bị gửi lại toàn bộ state 25k token ở mỗi request (7 request, khoảng 200k token).

**Jev vẫn đóng góp:**
1. Bộ đo (script đánh giá + nhãn Haiku) dựng lên để chấm Jev, sau đó dùng lại để chọn quy tắc.
2. Kết quả đo chỉ ra quy tắc nào đáng giữ: giữ call Write/Edit, và output Bash là chỗ nguy hiểm
   (cả 6 output còn cần đều là Bash).
3. Ý tưởng nén nguyên văn thay vì tóm tắt, cùng ngưỡng giảm tối thiểu 25% rồi quay về tóm tắt mặc định.

## 3. So sánh `/compact` mặc định và fast-compact

| | `/compact` mặc định | fast-compact |
|---|---|---|
| Cách làm | Model đọc cả hội thoại rồi viết bản tóm tắt | Quy tắc cứng cắt output/input cũ của tool |
| Text hội thoại | Thay bằng bản tóm tắt | Giữ nguyên văn 100% |
| Tool call cũ | Mất, chỉ còn những gì bản tóm tắt nhắc tới | Còn đủ, kèm ghi chú cách lấy lại phần bị cắt |
| Chi tiết nhỏ (số liệu, id, đường dẫn, lỗi) | Dễ mất nếu bản tóm tắt bỏ qua | Còn, nếu nằm trong text hoặc input/output ngắn |
| Mức giảm | Rất cao (ví dụ phiên PXP: 968k → 19k token, −98%) | Vừa (session này: 254k → 57k token, −77%) |
| Thời gian | Lâu: 136 s ở phiên PXP | ~57 ms |
| Chi phí | Một lần gọi model trên toàn bộ context | 0 |
| Khi nào chạy | `/compact` và auto-compact | Chỉ `/compact` sau khi gọi `/fast-compact` |
| Giới hạn | Mất độ chính xác | Phần còn lại chủ yếu là text, khó giảm thêm sau ~50–60% ký tự; session rất dài vẫn cần tóm tắt |

**Kết quả lần chạy thật** (session 69207ce4, 2026-10-14, chi tiết trong `compact-2026-10-14.md`)

- 254,476 → 57,332 token (−77%), 319k → 150k ký tự (−53%), 57 ms.
- 81/81 tool call còn nguyên; 55 call bị cắt input hoặc output; không có bản tóm tắt.
- Text user/assistant: 56.9k → 54.4k ký tự (gần như nguyên vẹn).
- Phần cắt chủ yếu: output Bash 108k/136k ký tự, input Bash 33k, nội dung Write cũ 24k.

**Khi nào dùng cái nào**
- **fast-compact:** đang làm dở việc cần nhớ chính xác (số liệu đo, id, quyết định, đường dẫn), và session chủ yếu phình
  vì output tool.
- **Mặc định:** session rất dài, chủ yếu là text, hoặc chuyển sang việc mới và chỉ cần nhớ ý chính.

## 4. Hạn chế và bước tiếp theo

**Hạn chế**
- Quy tắc mới được kiểm trên 4 session của một project.
- Nhãn đúng/sai do Haiku gắn, không phải người.
- Mới có một lần chạy thật.
- Function hooks là tính năng early access, API có thể đổi giữa các bản Claude Code.
- Plugin đang được cài từ thư mục worktree: nên merge vào `main` rồi trỏ marketplace sang đó trước khi worktree bị xoá.

**Bước tiếp theo:** thêm `/fast-compact report` sinh báo cáo trước/sau như `compact-2026-10-14.md`,
và chạy thử trên vài session của các project khác.
