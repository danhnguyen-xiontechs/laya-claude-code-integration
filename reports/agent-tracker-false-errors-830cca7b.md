# agent-tracker đếm nhầm lỗi: phân tích Turn 8–10

- **Session:** `830cca7b-a997-4277-9b23-a0b98b1fd6ec` (D:\Laya, Haiku 5.5, 20/10/2026)
- **Công cụ đo:** agent-tracker (xt-companion-local 0.18.0), `skills/agent-tracker/scripts/agent-tracker.mjs`
- **Ngày phân tích:** 2026-10-20
- English version: [agent-tracker-false-errors-830cca7b.en.md](agent-tracker-false-errors-830cca7b.en.md)

## 1. Nguyên nhân

agent-tracker coi một tool result là lỗi nếu:

```js
// agent-tracker.mjs:1809 (cùng logic ở :1937)
const isErr = tr.is_error || /Exit code [1-9]|fatal:|error|failed|denied/i.test(trContent);
```

Regex này quét **toàn bộ nội dung** output. Vì vậy:
- Read, Grep, `sed` hay `cat` một file source hoặc tài liệu có chữ `error`, `failed`, `denied` (tên biến, `console.error`, comment, field JSON...) đều bị tính là lỗi.
- Nhánh `Exit code [1-9]` cũng khớp với chuỗi literal nằm trong code, ví dụ fixture test `const FAIL = 'Exit code 1\n...'`.
- Lệnh chạy thành công nhưng output có những chữ này (tên test case, số liệu thống kê) cũng bị tính.

Session này đang sửa chính code xử lý lỗi của agent-reliability (`redact.ts`, `advisor.ts`, `core.ts`, `report.mjs`), nên gần như mọi lần đọc code đều bị đếm là err.

## 2. Tổng hợp

| Loại | Turn 8 | Turn 9 | Turn 10 | Tổng |
|---|---|---|---|---|
| A. Source code / tài liệu có chữ khớp regex | 13 | 15 | 10 | **38** |
| B. Lệnh thành công, output có chữ khớp regex | 2 | 1 | 0 | **3** |
| C. Fail thật, exit 0 vì pipe | 0 | 0 | 3 | **3** |
| D. Lỗi thật (is_error) | 0 | 1 | 2 | **3** |
| **agent-tracker đếm (tái tạo)** | 15 | 17 | 15 | **47** |
| Dashboard hiển thị | 16 | 17 | 15 | 48 |

**Kết luận:** 41/47 err là đếm nhầm (A + B). Chỉ 6 là fail thật (C + D), trong đó 3 được Claude Code đánh dấu `is_error`.
Turn 8 lệch 1 so với dashboard (15 so với 16), có lẽ do ranh giới turn của agent-tracker hơi khác cách cắt theo prompt dùng ở đây.

**Định nghĩa các loại**
- **A** – Output là source code hoặc tài liệu, không có lệnh nào thất bại.
- **B** – Lệnh chạy thành công (test pass, apply OK, JSON thống kê), nhưng output chứa chữ khớp regex.
- **C** – Lệnh fail thật (test đỏ, SyntaxError), nhưng exit code bị pipe (`| tail`, `| cut`) che thành 0, nên `is_error` = false.
- **D** – Claude Code trả `is_error: true`.

## Turn 8 (dashboard: 16 err, tái tạo: 15)

A=13 · B=2 · C=0 · D=0

| # | Loại | Tool | Lệnh / file | Chữ khớp | Đoạn output khớp |
|---|---|---|---|---|---|
| 1 | A | Read | D:\Laya\agent-reliability\hooks\advisor.ts | `DENIED` | help; a form refusal is about the spelling of the call. 29 const USER_DENIED = /doesn't want to proceed\|tool use was rejected\|has been denie |
| 2 | A | Grep | jevRequest\|normalized_action\|error_summary\|proposed_action\|function normalizeCommand\|funct | `error` | s.records.map((r) => '- ${r.normalized_action} ×${r.repeat_count} ${r.error_fingerprint}${r.transient ? ' (transient)' : ''} epoch ${r.state |
| 3 | A | Read | D:\Laya\agent-reliability\hooks\core.ts | `error` |  action: record.normalized_action, 349 result: record.error_summary, 350 error_fingerprint: record.error_fingerprint |
| 4 | A | Read | D:\Laya\agent-reliability\hooks\advisor.ts | `error` | ttempts ?? []).map((a: Attempt) => ({ tool: a.tool, action: a.action, error: a.error, changes_made_before: a.changes })), 172 state_ch |
| 5 | A | Read | D:\Laya\agent-reliability\scripts\ship-haiku-100k.mjs | `error` | ENT') \|\| !host.includes('registerHooks(on, options)')) { 46 console.error('haiku-100k/hooks/register.ts must register /reliability, /retry |
| 6 | A | Grep | redact\|SECRETISH\|lastPrompt\|includePromptInJev\|dump\(\|postJev\|import  | `error` | eInterface, body: unknown, o: Options): Promise<{ json: unknown } \| { error: string }> { 149: const r = await postJev($, body, o); 202:  |
| 7 | A | Read | D:\Laya\agent-reliability\tests\advisor.unit.ts | `FAILED` |  38\nℹ pass 37\nℹ fail 1'), 'fail'); 38 assert.equal(testSummaryOf('FAILED proxy/test_adapt.py::test_haiku - AssertionError\n===== 2 faile |
| 8 | A | Grep | redact\|decideJev\|brief\(\|function brief\|state = \|inc\.before\|inc\.attempts | `error` | nc.attempts.slice(0, 2).map((a) => ({ tool: a.tool, action: a.action, error: a.error })) }; 286: const r = await decideJev({ state, quest |
| 9 | A | Grep | Attempt\b\|changes | `failed` | 29-/** One failed attempt of an incident, redacted, as the Jev advisor sees it. * |
| 10 | A | Read | D:\Laya\haiku-100k\skills\reliability-report\scripts\report.mjs | `error` | Arg) : Date.now() - 30 * 864e5; 22 if (Number.isNaN(SINCE)) { console.error('bad --since "${sinceArg}" (use YYYY-MM-DD or all)'); process.ex |
| 11 | A | Read | D:\Laya\agent-reliability\hooks\register.ts | `failed` | 316 cls === 'FAIL' ? { kind: 'failed', text } : cls === 'PASS' ? { kind: 'passed' } : { kind: 'ignor |
| 12 | A | Read | D:\Laya\agent-reliability\hooks\register.ts | `Error` | . */ 377 async function dump($: EngineInterface, o: Options, ran: { isError?: true; text?: string; result?: unknown }, cls: Classification): |
| 13 | B | Bash | cd D:/Laya/agent-reliability && node --version && npm test 2>&1 \| tail -60 | `error` | ks the first repeat (0.502ms) ✔ 2. same build with identical compiler errors (elapsed time differs) → blocked (1.2469ms) ✔ 3. rerun after a  |
| 14 | B | Bash | cd D:/Laya && SP="$SP/scratchpad" && mkdir -p "$SP" && git show HEAD:haiku-100k/skills/rel | `failed` | applied 8 failed [] 47 warning: in the working copy of 'C:/Users/LENOVO2/AppData |
| 15 | A | Bash | cd D:/Laya && SP="$SP/scratchpad" && git diff --no-index --unified=0 "$SP/report.HEAD.mjs" | `error` | questions, timeoutMs = 20000 }) { - if (!r.ok) return { ok: false, error: 'http ${r.status} ${String(json?.error?.message ?? '').slice(0, |

## Turn 9 (dashboard: 17 err, tái tạo: 17)

A=15 · B=1 · C=0 · D=1

| # | Loại | Tool | Lệnh / file | Chữ khớp | Đoạn output khớp |
|---|---|---|---|---|---|
| 1 | A | Read | D:\Laya\agent-reliability\skills\reliability-report\scripts\report.mjs | `error` | Arg) : Date.now() - 30 * 864e5; 22 if (Number.isNaN(SINCE)) { console.error('bad --since "${sinceArg}" (use YYYY-MM-DD or all)'); process.ex |
| 2 | A | Read | D:\Laya\agent-reliability\skills\reliability-report\scripts\report.mjs | `error` | = process.env.OPENROUTER_API_KEY; 250 if (!key) return { ok: false, error: 'OPENROUTER_API_KEY not set', latencyMs: 0, cost: 0 }; 251 tr |
| 3 | A | Grep | before[:\s=]\|before\.\|\.before\|attempts\.push\|attempts:\|error: | `error` | tempts: att.map((s) => ({ tool: s.tool, action: s.action, cat: s.cat, error: s.text })), 219:for (const q of files) { try { scanFile(q); } c |
| 4 | D | Bash | cd D:/Laya/agent-reliability && node -e "console.log(require('node:process').version)" &&  | `Exit code 1` | Exit code 1 v24.19.0 [eval]:1 import('./hooks/redact.ts').then(m=>con |
| 5 | A | Grep | before | `error` | 160: tool: a.tool, action: redact(a.action, 220), error: redact(a.error, 400), changes_made_before: (a.changes ?? []).ma |
| 6 | B | Bash | cd D:/Laya && SP="$SP/scratchpad" && mkdir -p "$SP/empty-projects" "$SP/dryrun3" "$SP/empt | `denied` |  "calls_denied_c": 0, "attempts_rows": 0, "telemetry_events": 32, "out": "~ |
| 7 | A | Grep | redact | `error` | wn. Ask the user before using it: it sends redacted tool commands and error text to a hosted model. Labels carry 'label_source: jev' and are |
| 8 | A | Read | D:\Laya\agent-reliability\skills\reliability-report\SKILL.md | `error` | cription: "Report on failure loops in the user's Claude Code history: error categories, failure streaks (main agent and subagents), which st |
| 9 | A | Read | $SP\scratchpad\capture-jev.mjs | `error` | body), 13 }) + '\n'); 14 return new Response(JSON.stringify({ error: { message: 'dry-run capture: not sent' } }), { status: 599 });  |
| 10 | A | Read | $SP\scratchpad\audit-jev.mjs | `Error` | = new Map(); 28 const toolNames = new Map(); 29 let maxAction = 0, maxError = 0, maxBefore = 0, nBefore = [], nAttempts = []; 30 let questio |
| 11 | A | Grep | fetch\(\|openrouter\|JEV_URL\|export (async )?function\|includePromptInJev | `error` | [] \| 'noul'>): { answers: Record<string, ChoiceAnswer \| number> } \| { error: string } { agent-reliability\hooks\core.ts:408:export function  |
| 12 | A | Bash | cd D:/Laya/agent-reliability && grep -n "postJev\\|advisorRequest(\\|jevRequest(\\|\$\.http\\| | `error` | eInterface, body: unknown, o: Options): Promise<{ json: unknown } \| { error: string }> { hooks/register.ts:136: const call = $.http.fetch(J |
| 13 | A | Bash | cd D:/Laya/agent-reliability && ls tests types && grep -ln "http" tests/*.ts; grep -n "htt | `error` | ts attempt: { tool, action: redact(k.raw ?? action, 220), error: redact(text, 400) } }, { maxRecoveryStrategies: o.maxRecoverySt |
| 14 | A | Read | D:\Laya\agent-reliability\tests\engine.test.ts | `Exit code 1` | testing'; 5 import type { On } from 'claude-code'; 6 7 const FAIL = 'Exit code 1\nFAIL tests/a.test.ts\n ✗ adds numbers\n AssertionError: |
| 15 | A | Read | D:\Laya\agent-reliability\tests\engine.test.ts | `Exit code 1` |  } as never; 281 }); 282 return calls; 283 } 284 285 const AZ = 'Exit code 1\nERROR: Before you can run Azure DevOps commands, you need |
| 16 | A | Bash | cd D:/Laya/agent-reliability && grep -n "on('[a-z.]*'" tests/engine.test.ts \| cut -c1-160  | `Error` | all', { tool: 'Bash' }, (_$, e) => { runs.push(e.command); return { isError: true as const, result: AZ, text: AZ }; }); 92: on('tool.call', |
| 17 | A | Bash | cd D:/Laya/agent-reliability && sed -n '88,96p' tests/cases.unit.ts \| cut -c1-260; echo -- | `error` |  redact(record.normalized_action, 220), result: redact(record.error_summary, 400), error_fingerprint: record.error_fingerpri |

## Turn 10 (dashboard: 15 err, tái tạo: 15)

A=10 · B=0 · C=3 · D=2

| # | Loại | Tool | Lệnh / file | Chữ khớp | Đoạn output khớp |
|---|---|---|---|---|---|
| 1 | A | Bash | cd "$SP/scratchpad/ar-capture" && ls docs types; grep -rn "fs\\|write\\|capture\\|appendFile" | `error` | port.md' to '~/.claude/agent-reliability/dataset/'. The report covers error categories, failure streaks, the calls Rules B/C would have refu |
| 2 | C | Bash | cd "$SP/scratchpad/ar-capture" && cat > tests/capture.test.ts <<'EOF' // SCRATCH ONLY (not | `Error` | \capture.test.ts: (fail) capture advisor-prompt-off [146.69ms] HooksError: no implementation for prompt.submit nothing beneath the pl |
| 3 | A | Bash | cd /d/Laya/agent-reliability && grep -n "prompt.submit\\|tool.call\\|\$.prompt\\|on('process. | `Error` | , command, ...(agentId ? { agentId } : {}) } as never) as Promise<{ isError?: boolean; text?: string; deny?: string }>; 61: await $.tool.ca |
| 4 | A | Bash | sed -n 1,40p tests/engine.test.ts | `Exit code 1` | -code/testing'; import type { On } from 'claude-code'; const FAIL = 'Exit code 1\nFAIL tests/a.test.ts\n ✗ adds numbers\n AssertionError: |
| 5 | A | Bash | cd "$SP/scratchpad/ar-capture" && sed -i "s\| mock.clock(on);\n\|\|" tests/capture.test.ts && | `Error` |  false } }) as never); on('tool.call', { tool: 'Bash' }, () => ({ isError: true as const, result: LEAKY, text: LEAKY })); } let n = 0; con |
| 6 | A | Bash | cd "$SP/scratchpad/ar-capture" && ls hooks; grep -n "redact" hooks/register.ts \| head -5;  | `Failed` | rseAdvice, recordRefusal, redact, 202: if (!inc \|\| !raw \|\| !repeatsFailedAttempt(inc, redact(raw, 220), s.epoch)) return null; 380: co |
| 7 | A | Bash | cd "$SP/scratchpad/ar-capture" && sed -i "s\|import { mock, test } from 'claude-code/testin | `Exit code 1` | t { expect, mock, test } from 'claude-code/testing'; 8:const LEAKY = 'Exit code 1\nFAIL tests/a.test.ts\n x adds numbers\n AssertionError: |
| 8 | A | Bash | sed -n 150,160p hooks/register.ts && sed -n 240,275p hooks/register.ts && sed -n 600,620p  | `error` |  return 'error' in r ? r : parseJev(r.json); } /** The advisor mode in effect: |
| 9 | A | Bash | cd "$SP/scratchpad/ar-capture" && grep -n "OUT_DIR =\\|const AZ\\|const LEAKY" tests/capture | `Exit code 1` | a997-4277-9b23-a0b98b1fd6ec/scratchpad/capture-out'; 8:const LEAKY = 'Exit code 1\nFAIL tests/a.test.ts\n x adds numbers\n AssertionError: |
| 10 | D | Bash | cd "$SP/scratchpad/ar-capture" && cat > tests/capture.test.ts <<'EOF' // SCRATCH ONLY (not | `Exit code 2` | Exit code 2 total 42 drwxr-xr-x 1 LENOVO2 197121 0 Oct 20 16:45 .  |
| 11 | C | Bash | cd "$SP/scratchpad/ar-capture" && cat > tests/capture.test.ts <<'EOF' // SCRATCH ONLY (not | `Error` | ture.test.ts: (fail) capture advisor prompt=off [195.28ms] AssertionError: expect(received).toBe() Expected: "COUNTS" Received: "{\ |
| 12 | A | Bash | cd "$SP/scratchpad/ar-capture" && node -e " const fs=require('fs');const p='tests/capture. | `error` | attempts[0] "leaks_in_wire\":[{\"otherUserHome\":[\"state.attempts[0].error\",\"state.attempts[1].error\"],\"userName\":[\"state.attempts[0] |
| 13 | A | Bash | cd "$SP/scratchpad/ar-capture" && grep -n "redact" hooks/core.ts \| head; grep -n "redact"  | `error` | act(record.normalized_action, 220), 351: result: redact(record.error_summary, 400), 356: proposed_action: redact(normalizeComman |
| 14 | C | Bash | cd "$SP/scratchpad" && cat > probe-redact.mts <<'EOF' import { redact } from './ar-capture | `Error` |  ^^^^^^^^^^^^^^^^^^^^^^^^ } SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Unterminated regexp literal  |
| 15 | D | Bash | cd "$SP/scratchpad" && cat > probe-redact.mts <<'EOF' import { redact } from './ar-capture | `Error` |  ^^^^ } SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected ',', got 'string liter *(output bị plugin withheld)* |

## 3. Lưu ý: `is_error` cũng không hoàn toàn sạch

Hook cắt output quá dài của haiku-100k thay output bằng `"Bash ran, and a plugin withheld its result: …"` và đánh dấu `is_error: true`, kể cả khi lệnh chạy thành công. Ví dụ ở Turn 7: một lệnh `sed -n 26,4…p report.mjs` bình thường vẫn bị tính là lỗi. Đếm theo `is_error` thì nên loại các result này ra, hoặc xét riêng.

## 4. Đề xuất sửa agent-tracker

1. Lấy `tool_result.is_error` làm nguồn chính để xác định lỗi.
2. Nếu vẫn dùng text, chỉ khớp `^Exit code [1-9]` ở **đầu** output. Bỏ `error|failed|denied` khỏi phần quét toàn nội dung, nhất là với Read, Grep, Glob (những tool này không có exit code).
3. Không tính lỗi với các result có `plugin withheld its result` mà không có `Exit code` khác 0.
4. Nếu muốn bắt loại C, tách thành một chỉ số riêng, ví dụ "nghi fail bị pipe che", không gộp vào err.

## 5. Với các lỗi thật: agent-reliability hook và Jev có giúp gì không?

**Không.** Mỗi lỗi thật chỉ xảy ra một lần, sau đó Claude tự đổi hướng xử lý, nên hook không có dịp can thiệp. Bảng dưới đối chiếu telemetry của hook (`haiku-100k/telemetry/830cca7b-….jsonl`, dataset `~/.claude/agent-reliability/dataset/attempts-2026-10.jsonl`) với transcript.

**Hook đã ghi nhận những gì** (mode `observe`, `jevAdvisor: shadow`):

| Giờ (UTC) | Lỗi | Hook làm gì | Claude làm tiếp gì |
|---|---|---|---|
| 09:43 | `node -e "import('./hooks/redact.ts')"` báo Exit 1 ("Expected unicode escape") | Mở `inc-1`, attempt 1, `allow` (chỉ ghi log) | 10 giây sau quay sang Edit `report.mjs`, không chạy lại lệnh đó. `inc-1` bị bỏ ở trạng thái OPEN |
| 09:54 | `cat > tests/capture.test.ts … && bun test` báo Exit 2 (test fail) | Mở `inc-2`, attempt 1, `allow` | Sửa test rồi chạy lại. 38 giây sau `inc-2` → CLOSED, success |
| 09:59 | `npm test` | PASS (`piped_summary_pass`), không làm gì | — |

**Vì sao không có tác dụng:**
- **Jev advisor không được gọi lần nào.** Ở mode `shadow`, nó chỉ chạy từ lần fail liên tiếp thứ 2 của cùng một incident. Cả hai incident đều dừng ở attempt 1.
- **Rule B và Rule C không kích hoạt.** Rule B cần cùng một lệnh fail giống hệt nhau 2 lần mà không có gì thay đổi. Rule C cần một lệnh đã bị từ chối được gửi lại. Session này không có trường hợp nào như vậy.
- Mode đang là `observe`, nên kể cả khi rule có kích hoạt thì hook cũng chỉ ghi log, không chặn.

**Mấy lỗi còn lại hook không thấy:**
- Lần chạy `probe-redact` lỗi SyntaxError lúc 09:55 không có trong telemetry. Output của nó đã bị hook cắt output dài của haiku-100k giữ lại. Claude Write lại file probe và chạy lại thành công sau khoảng 1 phút.
- Ba lỗi loại C (test đỏ nhưng output đi qua pipe nên exit 0) hook coi là không lỗi.
- Hai `is_error` ở Turn 7 (lúc 09:38 và 09:42) là output bị giữ lại vì quá dài, không phải lỗi.

**Kết luận:** session này không có vòng lặp retry nào, nên agent-reliability chỉ đứng quan sát. Hook và Jev chỉ có ích ở những session mà Claude chạy lại cùng một lệnh test/build fail nhiều lần. Muốn xem hook đã bắt được vòng lặp nào trên toàn bộ lịch sử thì nên chạy `/haiku-100k:reliability-report` thay vì nhìn số err trên dashboard.

---
*Tái tạo: phân tích transcript `~/.claude/projects/D--Laya/830cca7b-….jsonl` bằng đúng regex của agent-tracker. Mỗi turn tính từ prompt của user đến prompt tiếp theo. Đường dẫn scratchpad được rút gọn thành `$SP`.*
