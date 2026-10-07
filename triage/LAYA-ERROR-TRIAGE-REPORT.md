# Laya Error Triage – Báo cáo tính năng và kết quả đánh giá

> Branch: `feat/laya-error-triage` · Ngày: 2026-10-07 · Trạng thái: **ĐÃ DỪNG** – bước 2 cho thấy Laya không đạt ngưỡng; không viết hook thật.
> Nguồn ý tưởng: `idea/03-laya-error-triager-mcp.md` (đã điều chỉnh: hook thay cho MCP, bộ category mở rộng được).

---

## 1. Tóm tắt nhanh

| | |
|---|---|
| **Tool là gì** | Một hook của Claude Code. Khi một lệnh Bash bị lỗi, hook dùng Laya (model phân loại nhỏ, chạy local) để (1) gắn **nhóm lỗi** và (2) chỉ ra **đoạn log chứa nguyên nhân gốc**, rồi chèn một dòng ghi chú ngắn cạnh kết quả lỗi để Claude đọc. |
| **Mục tiêu** | Một việc nhỏ: giúp Claude tập trung đúng chỗ khi log lỗi dài và nhiều nhiễu. Không nhằm tiết kiệm quota. |
| **Tích hợp** | Hook `PostToolUseFailure` (matcher `Bash`) trong `.claude/settings.json`. Không cần MCP, không cần Claude tự gọi tool. |
| **Đã xác minh** | Lệnh lỗi bắn `PostToolUseFailure`. Hook trả `additionalContext` thì Claude đọc được (thử thật bằng `claude -p`). |
| **Kết quả đo hiện tại** | Laya **kém hơn** regex đơn giản: phân loại 36% so với 87%, chọn đoạn log 38% so với 93%, mất khoảng 1.9 s mỗi lần. Thí nghiệm phụ với 4 cách hỏi khác nhau: tốt nhất chỉ đạt 49%. Thí nghiệm phụ 2 (chia nhỏ category theo tên lỗi cụ thể): tốt nhất 73%, vẫn dưới ngưỡng 75% (mục 8). |

---

## 2. Bối cảnh: Laya làm được gì và không làm được gì

- Laya là **encoder kiểu BERT** (ModernBERT-large, 421M tham số). Nó **không sinh văn bản**: mỗi lần gọi chỉ chạy một forward pass và trả về xác suất cho các đáp án cho sẵn.
- Ba loại câu hỏi:
  - `choice`: chọn 1 trong N đáp án, mỗi đáp án là một câu mô tả (bị cắt ở 48 token).
  - `noul`: có/không.
  - `score`: chấm điểm theo thang mức.
- Context: tối đa khoảng 1024 token cho mỗi lần gọi. Văn bản dài hơn bị **cắt âm thầm, giữ phần đầu**, nên phải tự cắt lấy phần cuối log trước khi gửi.
- Chạy local trên CPU, offline, miễn phí. Trên máy LENOVO2 mất khoảng 0.3–0.5 s với input ngắn, 2–3 s khi input gần 1024 token.
- **Hệ quả:** Laya chỉ hợp với các việc nhỏ, dạng trắc nghiệm, nơi chọn sai không gây hại. Nó không đọc hiểu được log dài và không tự viết lời khuyên.

---

## 3. Flow hiện tại: trước khi có tool

```
Claude quyết định chạy lệnh            ví dụ: npm test
        │
        ▼
Tool Bash chạy lệnh → exit code 1, output 180 dòng
        │
        ▼
Claude Code đưa nguyên output vào context
        │   (dạng: "Exit code 1\n<stdout+stderr>")
        ▼
Claude tự đọc 180 dòng:
  - log tiến trình, warning deprecated, test pass, stack frame thư viện...
  - tự tìm dòng lỗi thật
        │
        ▼
Claude quyết định bước tiếp theo
```

**Điểm yếu (nhỏ nhưng có thật):**
- Với log dài và nhiễu, Claude đôi khi sửa nhầm theo warning, hoặc chạy lại lệnh với `--verbose` hay `| grep` để tìm lỗi, tốn thêm một lượt.
- Với log ngắn và rõ ràng thì gần như không có vấn đề gì. Tool không có ích trong trường hợp này.

---

## 4. Flow sau khi có tool

```
Claude chạy: npm test
        │
        ▼
Lệnh lỗi (exit 1), output 180 dòng
        │
        ▼
Claude Code bắn sự kiện PostToolUseFailure
        │   stdin của hook nhận JSON:
        │   { "hook_event_name": "PostToolUseFailure",
        │     "tool_name": "Bash",
        │     "tool_input": { "command": "npm test", ... },
        │     "error": "Exit code 1\n...toàn bộ output...",
        │     "is_interrupt": false }
        ▼
laya_triage.py
  ├─ Lọc: bị interrupt, hoặc log < 30 dòng → thoát, không làm gì
  ├─ chunker.clean(): bỏ mã màu ANSI, dòng "Exit code", dòng lặp
  ├─ chunker.chunk(): lấy 60 dòng cuối, cắt thành ≤ 5 đoạn
  │     (cắt ở "Traceback", "Error", "FAIL", dòng trống...)
  ├─ categories.load(): bộ base + .claude/laya-triage.json của project
  ├─ Laya: nhóm lỗi + đoạn chứa nguyên nhân gốc
  ├─ Độ tin cậy thấp → thoát im lặng (không gợi ý còn hơn gợi ý sai)
  └─ Lỗi bất kỳ (Laya tắt, timeout 3 s...) → thoát im lặng (fail-open)
        │
        ▼
stdout của hook:
  { "hookSpecificOutput": { "hookEventName": "PostToolUseFailure",
      "additionalContext": "[Laya triage] nhóm: test_assertion (0.81)\n
                            Đoạn khả nghi: dòng 142–151\n
                            FAIL src/cart.test.ts › applies discount ..." } }
        │
        ▼
Claude thấy: toàn bộ log + dòng ghi chú → đi thẳng vào chỗ lỗi
```

**Điểm quan trọng:**
- Claude **vẫn thấy toàn bộ log**. Ghi chú chỉ là gợi ý thêm, không thay thế log.
- Hook chỉ chạy khi có lệnh lỗi, nên không làm chậm các lệnh chạy thành công.
- Không tốn thêm lượt gọi model. MCP thì ngược lại: Claude phải tự gọi tool rồi đọc kết quả, mất thêm một vòng.

### Trước và sau, cùng một ví dụ

| | Trước | Sau |
|---|---|---|
| Claude nhận | 180 dòng log | 180 dòng log + khoảng 3 dòng ghi chú |
| Claude phải làm | Tự lọc nhiễu, tìm dòng lỗi | Đọc gợi ý trước, kiểm tra lại trong log |
| Khi gợi ý sai | — | Claude bỏ qua ghi chú, làm như "trước" |
| Chi phí thêm | 0 | khoảng 0.5–2 s (chỉ khi lệnh lỗi) + 30–50 token context |

---

## 5. Áp dụng vào Claude Code CLI / Desktop

### Cấu hình (`.claude/settings.json` của project, hoặc `~/.claude/settings.json` để dùng mọi nơi)

```json
{
  "hooks": {
    "PostToolUseFailure": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "python D:/Laya/triage/laya_triage.py", "timeout": 5 } ] }
    ]
  }
}
```

**Điều kiện:** `laya-serve` đang chạy ở `http://127.0.0.1:8000`. Có thể đổi bằng biến `LAYA_URL`. Nếu server không chạy, hook im lặng và Claude Code vẫn chạy như chưa cài hook.

Áp dụng giống nhau cho CLI (`claude`, `claude -p`) và Code tab trong Claude Desktop, vì cả hai đọc cùng file settings.

### Bộ nhóm lỗi: base + mở rộng theo project

**Base** (trong `triage/categories.py`):

| Nhóm | Ý nghĩa |
|---|---|
| `dependency_missing` | Thư viện / tool bên thứ ba chưa cài |
| `import_or_path` | Module, file, export, đường dẫn của chính project bị sai |
| `syntax_or_type` | Bug trong code: cú pháp, kiểu dữ liệu, biến chưa định nghĩa |
| `test_assertion` | Test chạy nhưng kết quả khác mong đợi |
| `env_or_config` | Biến môi trường, file config, script/project file, phiên bản runtime |
| `permission_or_network` | Quyền truy cập, kết nối, DNS, port |
| `timeout_or_resource` | Timeout, hết bộ nhớ, đệ quy quá sâu |
| `other` | Không thuộc nhóm nào ở trên |

**Mở rộng theo project:** file `.claude/laya-triage.json` trong repo:
```json
{
  "add":      { "db_migration": "Database migration failed: schema mismatch, missing column, migration order." },
  "disable":  ["permission_or_network"],
  "override": { "env_or_config": "Missing or wrong .env value, appsettings.json, or Azure config." }
}
```
Laya là zero-shot, nên thêm nhóm chỉ là thêm một câu mô tả, không cần train lại. Nên giữ khoảng 8–12 nhóm đang bật, và mô tả của các nhóm phải khác nhau rõ ràng.

---

## 6. Cấu trúc code

```
triage/
  LAYA-ERROR-TRIAGE-REPORT.md   # file này
  categories.py                 # bộ nhóm base + đọc .claude/laya-triage.json
  chunker.py                    # làm sạch log, cắt đoạn (regex thuần, < 1 ms)
  eval.py                       # đo Laya so với baseline → eval_results.json
  eval_results.json             # kết quả eval lần 1
  ablate.py / ablate_results.json    # thí nghiệm phụ 1: độ dài input, có/không `other`
  ablate2.py / ablate2_results.json  # thí nghiệm phụ 2: cách viết mô tả category
  dataset/
    build_dataset.py            # sinh log lỗi THẬT bằng cách chạy thật các lệnh lỗi
    cases.jsonl                 # 45 case: lệnh, output, nhóm đúng, chuỗi đánh dấu nguyên nhân
  probe/
    event_probe.py              # bước 1: ghi JSON của sự kiện hook
    ctx_probe.py                # bước 1: kiểm tra additionalContext tới được Claude
    settings*.json              # cấu hình hook dùng cho probe
  (chưa có) laya_triage.py      # hook thật – chỉ viết nếu bước 2 đạt
```

---

## 7. Bước 1 – Kiểm tra cơ chế hook (ĐÃ XONG)

Chạy `claude -p` (Claude Code 2.1.286) với hook ghi log cho cả hai sự kiện:

| Lệnh | Sự kiện bắn | Dữ liệu |
|---|---|---|
| `echo ok` (thành công) | `PostToolUse` | `tool_response.stdout`, `stderr` |
| `python -c "import nonexistent_mod_xyz"` (lỗi) | **`PostToolUseFailure`** | `error` = `"Exit code 1\n" + traceback`, `is_interrupt` |

Hook `PostToolUseFailure` trả về `additionalContext` chứa một chuỗi đánh dấu, và Claude nhắc lại đúng chuỗi đó. **Cơ chế chèn ngữ cảnh hoạt động.**

---

## 8. Bước 2 – Dataset và đánh giá (ĐÃ XONG)

### Dataset
- 45 case, chia đều 8 nhóm, **log thật**: mỗi case tạo file trong thư mục tạm rồi chạy lệnh thật (Python 3.14, Node 24, pytest qua `uv`, dotnet 10, tsc qua `npx`, git).
- Khoảng một nửa số case có "nhiễu" thật: log INFO, DeprecationWarning, nhiều test pass, trước khi tới dòng lỗi.
- Nhãn: nhóm lỗi đúng, và một **chuỗi đánh dấu** nằm trong dòng nguyên nhân gốc. Đoạn log nào chứa chuỗi đó là đoạn đúng.

### Kết quả lần 1

| Việc | Laya | Không dùng model |
|---|---|---|
| Phân loại nhóm (45 case) | **36%** | Regex từ khoá: **87%** |
| Chọn đoạn nguyên nhân (42 case có ≥ 2 đoạn) | Hỏi chọn đoạn A–E: 14% · Hỏi có/không từng đoạn: 38% | Đoạn cuối: 57% · Đoạn nhiều từ khoá lỗi nhất: **93%** |
| Độ trễ p50 / p90 | Phân loại: 1.9 s / 3.3 s · Có/không mỗi đoạn: 0.46 s / 1.3 s | dưới 1 ms |

**Khi lọc theo độ tin cậy của Laya:**

| Xác suất cao nhất ≥ | Tỷ lệ case được gợi ý | Độ chính xác |
|---|---|---|
| 0.0 | 100% | 36% |
| 0.5 | 49% | 64% |
| 0.6 | 33% | 80% |
| 0.7 | 29% | 85% |

**Lỗi chính:** Laya dồn phần lớn câu trả lời vào `other`. Có 22 trên 29 câu sai nằm ở `other`.

### Thí nghiệm phụ (ĐÃ XONG – `triage/ablate.py`, `ablate_results.json`)
Mục đích: kiểm tra xem kết quả kém là do cách hỏi hay do bản thân model. Phân loại nhóm lỗi trên 45 case:

| Biến thể | Laya đúng | Độ trễ p50 |
|---|---|---|
| Lần 1: 30 dòng cuối, có `other` | 36% | 1.9 s |
| 8 dòng cuối, có `other` | 44% | 0.99 s |
| Chỉ đoạn nhiều từ khoá lỗi nhất, có `other` | 47% | 0.82 s |
| 30 dòng cuối, bỏ `other` | **49%** | 2.0 s |
| Chỉ đoạn nhiều từ khoá lỗi nhất, bỏ `other` | 47% | 0.79 s |
| *Regex từ khoá (để so sánh)* | ***87%*** | *< 1 ms* |

- Rút ngắn input và bỏ `other` giúp Laya tăng khoảng 10–13 điểm, nhưng mức cao nhất vẫn **dưới 50%**.
- Khi bỏ `other`, Laya chuyển sang đoán bừa một nhóm khác, thường là `dependency_missing` hoặc `timeout_or_resource`. Lỗi gốc là Laya không hiểu log, chứ không phải do có sẵn lựa chọn `other`.
- Kết luận tạm thời lúc đó: lỗi nằm ở model, không phải ở độ dài input hay lựa chọn `other`. Thí nghiệm phụ 2 cho thấy **cách viết category** vẫn còn ảnh hưởng lớn.

### Thí nghiệm phụ 2 (ĐÃ XONG – `triage/ablate2.py`, `ablate2_results.json`)
Mục đích: kiểm tra xem bộ category (mô tả quá trừu tượng) có phải nguyên nhân không. Hai cách viết lại, chạy trên 2 kiểu input, cùng 45 case:
- **A:** giữ 8 nhóm, mô tả liệt kê tên lỗi cụ thể (`ModuleNotFoundError`, `ECONNREFUSED`...).
- **B:** tách thành 23 nhóm con hẹp (vd. "Node: Cannot find module 'pkg'", "DNS failure"), Laya chọn nhóm con rồi gộp về 8 nhóm.
- Mọi mô tả ≤ 41 token, không bị Laya cắt ở 48 token.

| Biến thể | Input | Laya đúng | Độ trễ p50 |
|---|---|---|---|
| A: 8 nhóm, mô tả cụ thể | 30 dòng cuối | 47% | 1.9 s |
| A | Đoạn nhiều từ khoá lỗi nhất | 44% | 0.72 s |
| B: 23 nhóm con → 8 | 30 dòng cuối | 62% | 1.8 s |
| B | Đoạn nhiều từ khoá lỗi nhất | **73%** | 0.66 s |
| *Regex từ khoá (để so sánh)* | | ***87%*** | *< 1 ms* |

Lọc theo độ tin cậy (B + đoạn nhiều từ khoá nhất): xác suất ≥ 0.6 → gợi ý cho 91% case, đúng 76%.

- **A gần như không giúp:** nhồi nhiều tên lỗi vào một mô tả dài, Laya vẫn dồn về `dependency_missing`.
- **B giúp rõ (+24 điểm so với mức tốt nhất trước):** mỗi lựa chọn hẹp và cụ thể thì Laya khớp tốt hơn. Phần còn sai chủ yếu ở `permission_or_network` và nhầm `import_or_path` với `dependency_missing`.
- **Lưu ý:** 23 nhóm con được viết sau khi đã xem marker của dataset, nên 73% có thể cao hơn thực tế trên log mới. (Regex cũng được viết theo cách này.)

---

## 9. Kết luận

> **Bước 2 KHÔNG ĐẠT ngưỡng (75%).** Biến thể tốt nhất của Laya đạt 73% về phân loại (category chia nhỏ, thí nghiệm phụ 2); chọn đoạn log đạt 38%. Regex đạt 87% và 93%.
> Đề xuất: **không dùng Laya làm bộ phân loại chính.** Nếu làm hook triage thì theo hướng (a); nếu muốn giữ Laya thì chỉ theo hướng (b) với bộ category B.

1. **Cơ chế tích hợp ổn.** Hook `PostToolUseFailure` + `additionalContext` là cách đúng, rẻ và tự động.
2. **Laya là mắt xích yếu của bài toán này.** Log lỗi chứa rất nhiều tín hiệu từ khoá rõ ràng (`ModuleNotFoundError`, `AssertionError`, `ECONNREFUSED`...). Regex khai thác các tín hiệu đó tốt hơn, nhanh hơn khoảng 2000 lần, và không cần server.
3. **Cách viết category quan trọng với Laya:** nhóm con hẹp, cụ thể (B) tốt hơn hẳn nhóm rộng, trừu tượng. Nhưng kể cả vậy vẫn dưới ngưỡng và dưới regex. Hai hướng còn lại:
   - **(a)** Vẫn làm hook triage, nhưng dùng regex + chọn đoạn theo từ khoá. Tool hữu ích, nhưng không còn liên quan tới Laya. **(Khuyến nghị)**
   - **(b)** Kết hợp: regex trước, chỉ gọi Laya (bộ category B, input là đoạn nhiều từ khoá nhất) khi regex rơi vào `other`, và chỉ dùng kết quả khi xác suất ≥ 0.6. Phần Laya đóng góp sẽ nhỏ.
4. **Bài học cho các ý tưởng Laya tiếp theo:** Laya có lợi thế khi tín hiệu nằm ở **ngữ nghĩa** mà từ khoá không bắt được, ví dụ đánh giá ý định hay độ khó của một yêu cầu bằng ngôn ngữ tự nhiên. Laya không có lợi thế khi input đã có sẵn từ khoá rõ ràng như log lỗi.

---

## 10. Cách tái lập

```bash
# 1. Bật Laya
LAYA_MODELS=english laya-serve

# 2. Sinh lại dataset (chạy thật các lệnh lỗi, khoảng 2–3 phút)
python triage/dataset/build_dataset.py

# 3. Đánh giá (khoảng 5–8 phút trên CPU)
python triage/eval.py

# 4. Thí nghiệm phụ (mỗi cái khoảng 5–8 phút)
python triage/ablate.py
python triage/ablate2.py

# 5. Xong thì tắt laya-serve
```
