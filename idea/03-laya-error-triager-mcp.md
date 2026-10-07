# File: 03-laya-error-triager-mcp.md
# Approach 3: Laya Error Triager MCP (Trợ Lý Chẩn Đoán Lỗi Nhanh)

## 1. Vấn đề cốt lõi (The Problem)
Khi chạy lệnh build/test bị fail, terminal có thể nhả ra hàng trăm dòng Error Traceback. Nếu Claude Code tự đọc và tự suy nghĩ (Chain of Thought) để tìm nguyên nhân, nó sẽ tốn rất nhiều token Output (tiền) và thời gian (latency).

## 2. Giải pháp từ Laya (The Solution)
Tận dụng Laya để dán nhãn "Nhóm lỗi" (Error Category) dựa trên 50 dòng log cuối cùng. Laya hoạt động như một bác sĩ cấp cứu phân loại bệnh nhân (Triage), giúp mô hình lớn (Opus/Sonnet) định hình ngay hướng debug thay vì mò mẫm.

## 3. Luồng hoạt động (Workflow)
1. **Claude Code gặp lỗi:** Output của lệnh `npm run build` trả về mã lỗi 1 kèm stack trace dài.
2. **Gọi Tool Chẩn đoán:** Claude gọi tool `categorize_error(log_tail="...50 lines...")` do Laya MCP cung cấp.
3. **Phân loại (Laya):** Trong 50ms, Laya trả về:
   ```json
   {
     "error_category": "dependency_missing",
     "primary_suspect": "node_modules",
     "action_hint": "Check package.json or re-run npm install"
   }