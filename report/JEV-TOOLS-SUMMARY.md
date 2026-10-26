# Jev trong Claude Code: tổng hợp mod / hook / skill

*Cập nhật 2026-10-26. Chi tiết đo đạc xem `report/LAYA-JEV-REPORT.vi.md` và `reports/skill-tool-lifecycle/STATUS-2026-10-18.md`.*

**Jev** là model quyết định của TypeSafe, gọi qua OpenRouter (`OPENROUTER_API_KEY`). Nó chọn một đáp án trong danh sách cố định và trả kèm xác suất. Mỗi lần gọi mất khoảng 0.5–1 s và gần như miễn phí (~$0.00002). Điểm yếu: quá tự tin (p ≈ 0.99 cả khi sai) và dữ liệu gửi ra ngoài mạng công ty.

Bài học chung: **phần lớn giá trị đến từ rule/script đi kèm**. Jev chỉ có ích ở các bước mơ hồ.

---

## 1. Đang dùng hằng ngày (plugin `haiku-100k` 0.13.0)

| Thứ | Loại | Jev làm gì | Trạng thái |
|---|---|---|---|
| **effort-pace** (auto effort) | Hook | Ở "pivot step" (đầu turn, sau lỗi, sau Edit lớn), Jev chọn effort `low/medium/high`. Bước đọc bình thường thì rule hạ về `low`. Opus giữ trong khoảng `low`–`medium`. Kèm guard chặn lệnh Bash treo lâu. | **apply** (mặc định), `/effort-pace` |
| **agent-reliability** (failure/retry) | Hook | Rule B chặn lần chạy thứ 3 của một test/build fail giống hệt. Rule C không gửi lại lệnh đã bị từ chối. Jev Recovery Advisor chọn 1 trong 5 hướng xử lý từ lỗi thứ 2. | **observe** (chỉ ghi log), Jev advisor **off** |
| **haiku-build** v3 | Skill | Opus viết spec, Haiku code + test, Sonnet review, script chốt status. Jev chỉ tư vấn (`HAIKU_BUILD_JEV=apply\|off`). | Dùng; v3 merge 25/10 (PR #22) |
| **haiku-build-auto** | Skill | Giống haiku-build nhưng không hỏi người, mọi quyết định do `auto.mjs`, cuối run tự commit. Factory dùng skill này. | Dùng; merge 22/10 (PR #19) |
| **subagent-model-router** | Hook PreToolUse + skill | Chọn haiku/sonnet/opus cho mỗi subagent (rule + Jev, k=3, cascade khi fail). Đo vòng 3: 16/16, **−82% chi phí**. Pilot 6 story ess-be: 6/6 với 36% quota. | **shadow**, provider `jev` |
| **skills-router** | Hook UserPromptSubmit + skill | Gợi ý skill phù hợp: BM25 trước, Jev là bước 2 tùy chọn. | **shadow** |
| **reliability-report** | Skill | Đọc lịch sử session, gom chuỗi lỗi, Jev gắn nhãn offline (`--jev`). | Dùng khi cần |

## 2. Tình trạng gần đây (log telemetry 21–26/10)

**effort-pace: đang chạy.**
- Ghi được 364 bước trong 19 session, gồm Sonnet 201 bước và Haiku 163 bước.
- Effort được hạ xuống `low` 95 lần và nâng lên `high` 56 lần.
- Jev được gọi 109 lần, p50 1.1 s. Có 42 lần Jev không chắc (p < 0.6) nên fallback lên `high`.

**agent-reliability: còn chạy nhưng chưa có bằng chứng hiệu quả.**
- Có 19 sự kiện: 8 lần harness từ chối, 8 lỗi test/build.
- **Không có chuỗi lỗi nào từ 3 lần trở lên**, nên Rule B chưa chặn lần nào. Ở mode observe thì nó cũng chỉ ghi log, không chặn.
- Trước đó (14/10) bản `retry-loop-breaker` replay 579 transcript: **0 lần chặn trong 3.474 lệnh**, nên bị DROP.
- Đánh giá offline 20/10: Jev gắn nhãn 60 chuỗi lỗi, phần lớn là harness refusal chứ không phải agent lặp. Chưa chứng minh được Jev cải thiện kết quả.
- → Hiện tại giá trị chính của nó là Rule C (không lách khi bị từ chối) và phần log.

**Vì sao 22–25/10 không có log: factory chạy trên máy khác.** Đây không phải lỗi hook.
- Có 26 session factory, cwd là `D:\XionTechs\...\worktrees\factory\...` và `C:\Users\ADMIN\...`. Cả hai thư mục này đều không có trên máy LENOVO2.
- Commit factory mang tác giả "Laya Retro", khác với git user của máy này.
- Transcript chỉ được chép về `~/.claude/projects` khoảng 00:00 ngày 26/10.
- Hook vẫn chạy bên đó: ngày 24/10, guard của effort-pace đã chặn một lệnh `python -` heredoc trong session ess-be 2281.
- Log nằm ở `C:\Users\ADMIN\.claude\plugins\cache\haiku-100k\haiku-100k\<version>\telemetry\` trên máy kia.
- Trong cùng thời gian, máy này chỉ có 1 session, ghi 6 dòng vào ngày 22/10 và không có lượt model nào.
- Lưu ý: factory chủ yếu chạy Opus, mà bản 0.9.0 effort-pace không pace và không ghi log Opus. Chỉ từ 0.11.0 mới có `paceOpus`.

**Vì sao subagent-model-router không ghi log từ 21/10: máy này không spawn subagent nào.** Hook vẫn đăng ký, và lần ghi cuối là 20/10 08:51Z. Kể từ đó, ngoài transcript factory chép về, không có lần gọi `Agent` nào trên máy này. Hook chỉ được cài trên máy này (`~/.claude/settings.json` cùng bản copy ở `~/.claude/skills/`), nên máy factory có thể không có router.

**Guard của effort-pace chặn nhầm (26/10).** Một lệnh `grep` có chuỗi "claude -p" nằm *trong pattern* bị guard coi là đang chạy một session Claude, và bị từ chối.

## 3. Các skill Jev khác (đã build, đã đo)

| Skill / mod | Kết quả | Quyết định |
|---|---|---|
| `smart-context-trimming` (mod) | Duy nhất giảm token thật khi chạy agent: −18% rồi −24%, gộp output lặp −73% byte | **PILOT** (code ở branch, chưa merge) |
| `codebase-task-explorer` | Recall@5 tăng từ 0.47 (chỉ rule) lên 0.93 (rule + Jev), chỗ Jev thắng rõ nhất; nhưng A/B agent tốn thêm 43% token | REWORK |
| `review-pr-jev-classify` | PR test tốt, PR thật chỉ 2/8 cờ đúng | SHADOW |
| `web-test-jev-wait` / `gate` / `oracle` | Offline đúng 96% | PILOT (cần Security cho phép gửi dữ liệu) |
| `web-test-jev-verdict` / `ground` | Không giúp, hoặc chưa đủ dữ liệu | DROP / chưa đủ dữ liệu |
| `bmad-help-jev`, `bmad-code-review-jev` | Mới có unit test | Chưa đủ dữ liệu |
| `story-batch-planner`, `integration-verifier` | Rule tốt, Jev shadow; A/B agent không giảm token | REWORK |
| `acceptance-criteria-coverage`, `dead-code-finder`, `git-risk-scanner`, `context-curator`, `jev_advisor` (repo `JEV`) | Haiku tự làm đã đúng gần hết, helper chỉ thêm lượt | REWORK / chưa đủ dữ liệu |

Không dùng Jev nhưng liên quan: `fast-compact` (thử Jev rồi bỏ, rule-only, **ADOPT**) và cache-expiry hook (**ADOPT**).

## 4. Ngoài 3 cái bạn nhớ, đáng chú ý thêm

1. **subagent-model-router**: có kết quả tiết kiệm tốt nhất (−82% chi phí), hợp với factory chạy nhiều story song song. Nhưng đang không ghi log, cần sửa trước.
2. **smart-context-trimming**: tool duy nhất giảm token thật, nhưng vẫn nằm ở branch.
3. **skills-router**: đang shadow, có thể bỏ nếu không dùng tới.

## 5. Việc nên làm tiếp

- Lấy telemetry trên máy factory (ADMIN). Muốn gom log về một chỗ thì đặt userConfig `telemetryDir` cùng một folder chung. Kiểm tra máy đó đã lên 0.13.0 chưa, và có cài hook subagent-model-router chưa.
- Sửa guard effort-pace: chỉ khớp khi `claude` là command word, không khớp trong tham số của `grep`.
- agent-reliability: chạy `/haiku-100k:reliability-report --since 2026-10-21` sau vài ngày dùng thật. Nếu vẫn 0 lần chặn thì giữ Rule C, bỏ Rule B và Jev advisor.
- Merge `smart-context-trimming` vào plugin nếu muốn dùng.
