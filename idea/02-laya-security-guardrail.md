# File: 02-laya-security-guardrail.md
# Approach 2: Laya Security Guardrail Skill (Lớp Khiên Bảo Vệ Hệ Thống)

## 1. Vấn đề cốt lõi (The Problem)
Claude Code CLI được cấp quyền thực thi mã thông qua tool `Bash` hoặc `Terminal`. Trong quá trình tự hành (Agentic loop), AI có thể mắc lỗi ảo giác (hallucination) và sinh ra các lệnh nguy hiểm như `rm -rf /`, `drop table users`, hoặc vô tình đọc các file chứa khóa bí mật (`cat .env`, `cat ~/.ssh/id_rsa`) rồi in ra transcript.

## 2. Giải pháp từ Laya (The Solution)
Sử dụng mô hình Laya (1024 context) như một lớp gác cổng siêu tốc. Trước khi lệnh được chạy ở Terminal, nó phải đi qua trạm kiểm duyệt của Laya. Vì Laya chạy offline dưới máy, nó không gửi lệnh đi đâu cả, đảm bảo tuyệt đối về Data Privacy.

## 3. Luồng hoạt động (Workflow)
1. **Khởi tạo Skill:** Tạo thư mục `.claude/skills/laya-guardrail/` chứa file `SKILL.md` yêu cầu Claude Code: *"Mày phải đưa mọi lệnh shell qua lệnh `laya-scan <command>` trước khi chạy"*.
2. **Claude Code sinh lệnh:** `cat .env | grep API_KEY`
3. **Quét bảo mật (Laya):** Lệnh `laya-scan` đẩy chuỗi trên vào mô hình Laya.
4. **Đánh giá:** Laya dán nhãn `sensitive_data_exposure` với xác suất 0.98.
5. **Chặn (Block):** Script shell trả về `STDERR: DENIED by Laya Guardrail. Sensitive file access.`. Claude Code nhận lỗi, xin lỗi user và dừng hành động hoặc hỏi ý kiến.

## 4. Hướng triển khai (Implementation Notes)
- Tạo một script bash/python nhỏ CLI command `laya-scan`.
- Fine-tune hoặc cung cấp few-shot prompt/profiles cho Laya chuyên nhận diện 3 nhãn: `safe`, `destructive` (phá hủy dữ liệu), và `sensitive_exposure` (lộ lọt dữ liệu).