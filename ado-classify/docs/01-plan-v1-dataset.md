# Laya phân loại work item ADO: plan chi tiết

Ngày: 2026-10-07. Trạng thái: **đã thay thế** (2026-10-08) bởi scope v2 ([02-scope-v2.md](02-scope-v2.md)) và cách C ([../README.md](../README.md)). Giữ lại làm lịch sử: phần so sánh với TF-IDF / Haiku và điều kiện quyết định vẫn dùng được khi mở rộng sang nhiều task.

> **Việc phải làm trước:** thư mục `ado/` (gồm `items*.json` chứa title và mô tả thật của khoảng 250 work item) đã được commit lên `origin/main`, mà repo GitHub đang để **public**. Cần chuyển repo sang private hoặc xóa các file này khỏi lịch sử git trước khi pull thêm dữ liệu. Mọi dữ liệu của plan này lưu **ngoài repo**.

---

## 1. Tóm tắt một đoạn

Hiện nay, mỗi khi có work item mới trên Azure DevOps (ADO), sẽ có người (hoặc một LLM nếu tự động hóa) đọc title và mô tả để quyết định item thuộc loại nào, module nào, độ ưu tiên bao nhiêu. Plan này kiểm tra xem **Laya**, một model phân loại nhỏ chạy hoàn toàn trên máy local, có làm được việc đó **đủ chính xác, nhanh hơn và không tốn tiền gọi LLM** hay không. Thước đo là các nhãn **người thật đã điền** trong ADO. Đối thủ phải thắng gồm một model thống kê rẻ (TF-IDF) và Claude Haiku. Nếu Laya thắng, nó trở thành bước gợi ý nhãn tự động. Nếu thua, ta dừng và có số liệu để kết luận.

---

## 2. Vì sao chọn hướng này (sau ba plan trước)

| Hướng đã xem | Vấn đề |
|---|---|
| Chọn model (Haiku/Sonnet/Opus) cho Claude Code theo request (proxy) | Chạy được, nhưng đắt hơn dùng cố định Sonnet (1.43x) vì đổi model làm mất cache |
| Chọn model theo từng bước (subagent + hook) | Opus một luồng vẫn rẻ và nhanh nhất (657 so với 1203–1283 đơn vị); Laya luôn phân vân (xác suất 0.42–0.62) |
| Chặn subagent thừa | Rất ít dữ liệu (43 lần gọi Agent trên máy này), phần lớn gọi có chủ đích |
| Chọn mức review / phạm vi test | Input là số và boolean; rule làm tốt bằng hoặc hơn, Laya không có thêm thông tin gì |
| Notes Router (gợi ý tài liệu) | Hợp lý, nhưng chỉ giúp Claude bớt vài lượt tìm kiếm, không thay được LLM call nào |
| **Phân loại work item ADO** | **Đúng loại việc Laya được thiết kế để làm, có ground truth sẵn, thay thẳng một LLM call** |

Điểm mấu chốt rút ra từ các thử nghiệm trước: **Laya không làm được việc của model lớn** (viết code, lập luận, debug). Nó chỉ làm tốt một việc: **đọc một đoạn văn bản ngắn và chọn một nhãn trong danh sách cố định**. Vì vậy phải đặt nó vào chỗ mà công việc đúng là như thế.

---

## 3. Laya làm việc như thế nào

### 3.1 Model là gì
- Encoder kiểu BERT (ModernBERT-large, 421M tham số, checkpoint `english`). **Không sinh chữ**, chỉ đọc input một lần (một forward pass) rồi ra xác suất cho từng nhãn.
- Chạy trên CPU của máy dev: khoảng 0.4–0.6 s mỗi item (đã đo trên 122 item ADO: trung vị 573 ms với title + mô tả). Không cần GPU, không cần internet, không cần API key.
- Giới hạn input: mặc định 1024 token. Phần vượt quá bị cắt mà không báo, nên mô tả dài chỉ được đọc phần đầu. Mỗi mô tả nhãn tối đa 48 token. Từ 11 nhãn trở lên thì xác suất chưa được calibrate.

### 3.2 Một lần gọi trông như thế nào
Gửi vào (HTTP `POST /v1/systemone` tới `laya-serve` ở local, hoặc gọi thẳng qua Python SDK):

```json
{
  "state": {"title": "Leave history API returns records in wrong order",
            "description": "When calling GET /leave-history ... (cắt 2000 ký tự)"},
  "questions": {"area": {
     "type": "choice",
     "instructions": "Which module does this work item belong to?",
     "criteria": {
        "leave":   "Leave requests, leave balance, leave approval and history",
        "payroll": "Salary, payslips, allowances, tax calculation",
        "auth":    "Login, roles, permissions, tokens"
     }}},
  "model": "english", "max_len": 1024
}
```

Nhận về:

```json
{"answers": {"area": {"probabilities": {"leave": 0.81, "payroll": 0.07, "auth": 0.12}}}}
```

Ta lấy nhãn có xác suất cao nhất. **Xác suất cao nhất** (ở đây 0.81) là độ tự tin dùng để quyết định có tự gán hay chuyển cho người.

### 3.3 Hai cách dùng Laya
| Cách | Laya biết gì | Ưu | Nhược |
|---|---|---|---|
| **Zero-shot** | Chỉ đọc mô tả nhãn (`criteria`) do ta viết | Không cần dữ liệu train, đổi nhãn chỉ cần sửa văn bản | Kết quả trước đây yếu: 56% trên tầng model, xác suất thường dưới 0.6 |
| **Fine-tune head** | Học từ vài trăm đến vài nghìn item đã có nhãn thật | Đây là cách các nhóm khác đẩy độ chính xác lên cao hẳn | Cần dữ liệu có nhãn; đổi bộ nhãn thì phải train lại |

Fine-tune head ở đây nghĩa là: giữ nguyên encoder của Laya, chỉ train thêm một lớp nhỏ phía trên (giống logistic regression trên vector mà encoder sinh ra). Train trên CPU mất vài phút. Cách cài cụ thể (dùng công cụ train của Laya hay tự viết vài chục dòng PyTorch) sẽ chốt ở Phase 3.

---

## 4. Laya thay thế cái gì: trước và sau

**Laya không thay Claude Code.** Claude Code vẫn là công cụ để code. Laya thay **một bước phân loại** mà nếu không có nó thì người hoặc LLM phải làm. Có hai chỗ như vậy.

### 4.1 Triage work item trong ADO (chỗ chính)

**Trước (hiện tại):**
```
Item mới trên ADO
  -> PM / lead đọc từng item
  -> tự điền Type, Area, Priority, Tags
  -> (nếu tự động hóa bằng LLM: mỗi item một lần gọi Haiku/Sonnet,
      dữ liệu gửi ra ngoài, tốn tiền, 1–3 s mỗi item)
```

**Sau (nếu Laya đạt):**
```
Item mới trên ADO
  -> script local (chạy định kỳ hoặc khi được gọi) đọc item qua ADO API
  -> Laya phân loại trên máy local (khoảng 0.5 s, không gửi dữ liệu ra ngoài)
  -> xác suất >= ngưỡng: gợi ý nhãn (giai đoạn đầu chỉ ghi log, sau đó mới ghi comment hoặc tag lên ADO)
  -> xác suất < ngưỡng: đánh dấu "cần người xem"
  -> người xác nhận hoặc sửa; mỗi lần sửa trở thành dữ liệu train thêm
```

### 4.2 Trong Claude Code: khi bạn nhờ Claude phân loại hàng loạt

**Trước:**
```
Bạn: "phân loại 50 item ADO này theo module"
  -> Claude (Opus/Sonnet) tự gọi ADO, đọc từng title + mô tả vào context
  -> lập luận từng item -> hàng chục nghìn token, nhiều lượt, tốn quota gói Max
```

**Sau:**
```
Bạn: "phân loại 50 item ADO này theo module"
  -> Claude gọi một lệnh/skill (ví dụ `ado-classify --query ...`)
  -> script lấy item và cho Laya phân loại ở local
  -> Claude chỉ nhận bảng kết quả gọn (ID, nhãn, xác suất), chỉ xem kỹ các item xác suất thấp
  -> ít token hơn nhiều, nhanh hơn, không cần Claude đọc nội dung từng item
```

Mục 4.2 là cách "dùng model nhỏ cho việc nhỏ thay vì dùng model lớn" khi đang ở trong Claude Code. Nó chỉ đáng làm sau khi Phase 2–3 chứng minh Laya đủ chính xác.

### 4.3 So sánh nhanh
| | Người làm tay | LLM (Haiku) | Laya (nếu đạt) |
|---|---|---|---|
| Thời gian mỗi item | Phút | 1–3 s | khoảng 0.5 s (CPU) |
| Chi phí mỗi item | Công người | Tiền token hoặc quota | Gần như 0 (điện máy local) |
| Dữ liệu rời khỏi máy | Không | **Có** (gửi lên API) | **Không** |
| Đổi bộ nhãn | Dễ | Dễ (sửa prompt) | Zero-shot: dễ; fine-tune: train lại vài phút |
| Giải thích vì sao | Có | Có (viết lý do) | Không, chỉ có xác suất |
| Tự tin / không tự tin | Có | Không đáng tin | Có xác suất, dùng làm ngưỡng |

---

## 5. Phân loại cái gì

Chọn ở Phase 0 dựa trên dữ liệu thật. Ứng viên:

| Bài | Nhãn lấy từ trường ADO | Vì sao có ích | Rủi ro |
|---|---|---|---|
| **Module / Area** | `System.AreaPath` (cấp 1–2) | Gán đúng team, đúng người review | Có thể quá nhiều Area, cần gộp |
| Loại item | `System.WorkItemType` (Bug / Task / User Story) | Người tạo hay chọn sai loại | Đã test nhanh 8/10; có thể quá dễ, ít giá trị |
| Độ ưu tiên | `Microsoft.VSTS.Common.Priority` hoặc `Severity` | Triage bug nhanh hơn | Nhãn hay bị điền theo thói quen (mặc định 2), có thể nhiễu |
| Tags | `System.Tags` | Gom nhóm, báo cáo | Thường thưa, mỗi item nhiều tag |

Điều kiện chọn: dưới 11 nhãn (gộp nếu cần), trường được điền ở ít nhất 70% item, và **có người đang tốn công làm việc này**. Câu hỏi cho bạn: team hiện đang phân loại thủ công trường nào?

---

## 6. Các phase

### Phase 0: kiểm tra trường dữ liệu (khoảng 0.5 ngày)
- Dùng `az` CLI có sẵn (quyền đọc) để đếm, trên toàn bộ item của PXP và XT-Smart-Platform: độ phủ từng trường, số nhãn khác nhau, phân bố, thay đổi theo thời gian.
- **Chỉ đếm, không lưu title hay mô tả.**
- Kết quả: một bảng ngắn và đề xuất 1–2 bài phân loại để bạn chọn.

### Phase 1: dataset (khoảng 0.5 ngày)
- Pull 500–2000 item, gồm title, mô tả, acceptance criteria và nhãn của bài đã chọn. Lưu ở `E:\laya-data\ado\` (ngoài repo).
- Chia theo thời gian: item cũ để train, khoảng 200 item mới nhất để test. Như vậy giống cách dùng thật: train trên quá khứ, dự đoán item mới.
- Đánh dấu nhóm: có hoặc không có mô tả, tiếng Việt hoặc tiếng Anh, theo project.

### Phase 2: so các cách trên cùng tập test (khoảng 1 ngày)
| Cách | Vai trò |
|---|---|
| Luôn chọn nhãn phổ biến nhất | Mốc sàn |
| Rule keyword | Mốc rẻ nhất |
| **TF-IDF + logistic regression** | **Đối thủ thật**: chạy local, train vài giây. Laya không thắng cách này thì không cần Laya |
| **Claude Haiku zero-shot** | Thứ Laya định thay. Chạy `claude -p --model haiku` trên 200 item test bằng gói Max (ít quota). Lưu ý: thời gian đo qua CLI gồm cả overhead khởi động |
| Laya zero-shot | Checkpoint `english`, viết mô tả nhãn dưới 48 token |

### Phase 3: fine-tune head cho Laya (1–2 ngày)
- Train head trên tập train, đánh giá trên cùng tập test.
- Nếu đủ thời gian: thử thêm một encoder nhỏ khác cùng cách (để biết thắng là nhờ Laya hay nhờ fine-tune).

### Phase 4: shadow pilot (chỉ khi Phase 3 đạt, khoảng 1–2 tuần chạy nền)
- Script chạy định kỳ trên item mới, **chỉ ghi log**, không ghi gì lên ADO.
- So gợi ý của Laya với nhãn người điền sau đó.
- Ghi comment hoặc tag lên ADO là thay đổi nhìn thấy được với team, cần bạn (và có thể lead) duyệt riêng.

### Phase 5 (tùy chọn): skill cho Claude Code
- Lệnh `ado-classify` cùng một skill ngắn để Claude Code dùng Laya khi bạn nhờ phân loại hàng loạt (mục 4.2).

Tổng Phase 0–3: khoảng 3–4 ngày làm việc. Chỉ Phase 2 tốn một ít quota (Haiku, 200 lần gọi).

---

## 7. Đo bằng gì

| Chỉ số | Ý nghĩa |
|---|---|
| Accuracy, **macro-F1** | Đúng bao nhiêu, có công bằng giữa các nhãn ít gặp không |
| Recall từng nhãn, confusion matrix | Nhãn nào hay bị nhầm với nhãn nào |
| **Coverage ở precision 95%** | Nếu chỉ tự gán khi xác suất ≥ x, thì tự gán được bao nhiêu % item mà đúng ≥ 95%. **Đây là số quan trọng nhất cho việc dùng thật** |
| Latency p50 / p95 | Trên CPU máy dev |
| Theo nhóm | Có / không mô tả, tiếng Việt, từng project |

## 8. Điều kiện quyết định (bạn chỉnh được)

| Kết quả | Quyết định |
|---|---|
| Laya (fine-tune) kém Haiku không quá 3 điểm macro-F1, **và** thắng TF-IDF, **và** tự gán được ≥ 50% item ở precision ≥ 95% | **Pilot** (Phase 4) |
| TF-IDF ngang hoặc hơn Laya | **Dùng TF-IDF, bỏ Laya** cho bài này (rẻ hơn, nhẹ hơn, dễ giải thích) |
| Cả hai đều kém Haiku nhiều | Giữ LLM, hoặc dừng nếu chi phí LLM không đáng |
| Không bài nào có nhãn đủ sạch ở Phase 0 | Dừng, báo cáo lý do |

Kết luận nào cũng là kết quả hợp lệ cho task đánh giá decision engine của X-Tek: mục tiêu là có số liệu để chọn adopt / pilot further / drop.

---

## 9. Rủi ro và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| Lộ dữ liệu công ty | Repo phải private trước; dữ liệu để ngoài repo; Laya chạy local; Haiku baseline gửi 200 item qua gói Max của công ty (cần chắc điều này được phép) |
| Nhãn trong ADO bị nhiễu (điền mặc định, điền sai) | Phase 0 kiểm tra phân bố; nếu nhãn quá lệch thì đổi bài |
| Item không có mô tả (lần trước gây 17/20 lỗi) | Đo riêng nhóm này; khi dùng thật thì báo "cần thêm mô tả" thay vì đoán |
| Tiếng Việt (checkpoint multilingual từng xếp gần như mọi câu tiếng Việt sai) | Ép checkpoint `english`, đo riêng nhóm tiếng Việt; fine-tune có thể giúp |
| Mô tả dài bị cắt | Ghép title + đầu mô tả + acceptance criteria, cắt ở 2000 ký tự |
| Bộ nhãn đổi theo thời gian (Area mới) | Chia train/test theo thời gian để thấy rõ; khi dùng thật thì train lại định kỳ |
| So sánh không công bằng với Haiku (gọi qua CLI có overhead) | Báo riêng thời gian model và thời gian end-to-end |

## 10. Không làm trong plan này
- Không để Laya tự ghi lên ADO trước khi qua shadow pilot và được duyệt.
- Không dùng nhãn do Claude gán làm ground truth.
- Không đánh giá chất lượng code, không chọn model cho Claude Code (đã thử, không có lợi).
- Không dùng GPU (RTX 3070 có thể làm sau nếu cần nhanh hơn, hiện CPU đủ).

## 11. Sản phẩm bàn giao
- `ado/PLAN-ado-classification.md` (file này).
- Script: `field_audit.py` (Phase 0), `pull_dataset.py` (Phase 1), `baselines.py`, `run_laya.py`, `finetune_head.py`, `evaluate.py`.
- Báo cáo tiếng Anh dạng gạch đầu dòng cho team: bảng so sánh các cách, coverage ở precision 95%, latency, khuyến nghị adopt / pilot / drop.
- Dữ liệu thô và log ở `E:\laya-data\ado\`, không commit.

## 12. Cần bạn quyết định trước Phase 0
1. Xử lý repo public (private hoặc xóa lịch sử): ai làm, khi nào.
2. Team đang phân loại thủ công trường nào (Area, Priority, Type, Tags, gán người)?
3. Có thêm project ADO nào khác không?
4. Lưu dữ liệu ở `E:\laya-data\ado\` được không?
5. Gửi 200 item test qua Claude Haiku (gói Max công ty) để làm baseline có được phép không?
6. Có được cài `scikit-learn` (cho TF-IDF) vào môi trường của tool Laya hoặc một venv riêng không?

## 13. Thuật ngữ
- **Zero-shot**: model dự đoán chỉ dựa vào mô tả nhãn, chưa học từ ví dụ nào.
- **Fine-tune head**: giữ encoder, chỉ train một lớp nhỏ phía trên bằng dữ liệu có nhãn của mình.
- **TF-IDF + logistic regression**: cách phân loại văn bản cổ điển dựa trên tần suất từ; rất nhanh, thường là đối thủ khó đánh bại với dữ liệu nội bộ.
- **Macro-F1**: điểm trung bình giữa các nhãn, không để nhãn phổ biến che mất nhãn hiếm.
- **Coverage ở precision 95%**: tỉ lệ item mà hệ thống dám tự gán và đúng ít nhất 95% trong số đó.
- **Shadow mode**: chạy thật nhưng chỉ ghi log, không ảnh hưởng gì tới người dùng.
