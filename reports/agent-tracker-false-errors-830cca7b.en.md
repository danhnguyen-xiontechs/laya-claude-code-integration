# agent-tracker error overcount: analysis of Turns 8–10

- **Session:** `830cca7b-a997-4277-9b23-a0b98b1fd6ec` (D:\Laya, Haiku 5.5, 2026-10-20)
- **Metric source:** agent-tracker (xt-companion-local 0.18.0), `skills/agent-tracker/scripts/agent-tracker.mjs`
- **Analysed:** 2026-10-20
- Bản tiếng Việt: [agent-tracker-false-errors-830cca7b.md](agent-tracker-false-errors-830cca7b.md)

## 1. Root cause

agent-tracker counts a tool result as an error when:

```js
// agent-tracker.mjs:1809 (same logic at :1937)
const isErr = tr.is_error || /Exit code [1-9]|fatal:|error|failed|denied/i.test(trContent);
```

The regex runs over the **whole output**. As a result:
- Any Read, Grep, `sed` or `cat` of source code or docs that contains `error`, `failed` or `denied` (identifiers, `console.error`, comments, JSON field names) is counted as an error.
- The `Exit code [1-9]` branch also matches string literals in code, for example the test fixture `const FAIL = 'Exit code 1\n...'`.
- Successful commands whose output contains those words (test names, statistics) are counted too.

This session was editing agent-reliability's own error-handling code (`redact.ts`, `advisor.ts`, `core.ts`, `report.mjs`), so almost every code read was counted as an error.

## 2. Summary

| Category | Turn 8 | Turn 9 | Turn 10 | Total |
|---|---|---|---|---|
| A. Source code / docs containing a matching word | 13 | 15 | 10 | **38** |
| B. Successful command, output contains a matching word | 2 | 1 | 0 | **3** |
| C. Real failure, exit 0 because of a pipe | 0 | 0 | 3 | **3** |
| D. Real error (is_error) | 0 | 1 | 2 | **3** |
| **agent-tracker count (reproduced)** | 15 | 17 | 15 | **47** |
| Dashboard shows | 16 | 17 | 15 | 48 |

**Conclusion:** 41 of 47 errors are miscounted (A + B). Only 6 are real failures (C + D), and 3 of those were flagged `is_error` by Claude Code.
Turn 8 is off by one from the dashboard (15 vs 16), probably because agent-tracker draws turn boundaries slightly differently from the prompt-to-prompt split used here.

**Categories**
- **A** – The output is source code or documentation; nothing failed.
- **B** – The command succeeded (tests passed, patch applied, statistics JSON), but the output contains a matching word.
- **C** – The command really failed (red test, SyntaxError), but a pipe (`| tail`, `| cut`) turned the exit code into 0, so `is_error` is false.
- **D** – Claude Code returned `is_error: true`.

## Turn 8 (dashboard: 16 errors, reproduced: 15)

A=13 · B=2 · C=0 · D=0

| # | Cat. | Tool | Command / file | Matched | Matching output excerpt |
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

## Turn 9 (dashboard: 17 errors, reproduced: 17)

A=15 · B=1 · C=0 · D=1

| # | Cat. | Tool | Command / file | Matched | Matching output excerpt |
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

## Turn 10 (dashboard: 15 errors, reproduced: 15)

A=10 · B=0 · C=3 · D=2

| # | Cat. | Tool | Command / file | Matched | Matching output excerpt |
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
| 15 | D | Bash | cd "$SP/scratchpad" && cat > probe-redact.mts <<'EOF' import { redact } from './ar-capture | `Error` |  ^^^^ } SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expected ',', got 'string liter *(output withheld by a plugin)* |

## 3. Note: `is_error` is not fully clean either

haiku-100k's oversized-output hook replaces the output with `"Bash ran, and a plugin withheld its result: …"` and sets `is_error: true`, even when the command succeeded. In Turn 7, for example, an ordinary `sed -n 26,4…p report.mjs` was counted as an error. Counting by `is_error` should exclude these results or report them separately.

## 4. Suggested agent-tracker fix

1. Use `tool_result.is_error` as the primary error signal.
2. If text matching is kept, only match `^Exit code [1-9]` at the **start** of the output. Drop the whole-content `error|failed|denied` scan, especially for Read, Grep and Glob (they have no exit code).
3. Do not count results containing `plugin withheld its result` unless they also carry a non-zero `Exit code`.
4. To catch category C, track it as a separate metric (for example "suspected failure hidden by a pipe") instead of adding it to the error count.

## 5. For the real errors: did the agent-reliability hook or Jev help?

**No.** Each real error happened once, then Claude changed approach on its own, so the hook never had a reason to step in. The table below compares the hook's telemetry (`haiku-100k/telemetry/830cca7b-….jsonl`, dataset `~/.claude/agent-reliability/dataset/attempts-2026-10.jsonl`) with the transcript.

**What the hook recorded** (mode `observe`, `jevAdvisor: shadow`):

| Time (UTC) | Error | Hook action | What Claude did next |
|---|---|---|---|
| 09:43 | `node -e "import('./hooks/redact.ts')"` returned Exit 1 ("Expected unicode escape") | Opened `inc-1`, attempt 1, `allow` (log only) | 10 s later it moved on to editing `report.mjs` and never reran that command. `inc-1` was left OPEN |
| 09:54 | `cat > tests/capture.test.ts … && bun test` returned Exit 2 (test failure) | Opened `inc-2`, attempt 1, `allow` | Fixed the test and reran it. 38 s later `inc-2` → CLOSED, success |
| 09:59 | `npm test` | PASS (`piped_summary_pass`), no action | — |

**Why it had no effect:**
- **The Jev advisor was never called.** In `shadow` mode it only runs from the 2nd consecutive failure of the same incident. Both incidents stopped at attempt 1.
- **Rule B and Rule C never triggered.** Rule B needs the same command to fail identically twice with nothing changed in between. Rule C needs a refused call to be resent. Neither happened in this session.
- The mode is `observe`, so even if a rule had triggered, the hook would only have logged it, not blocked anything.

**Errors the hook did not see:**
- The `probe-redact` run that failed with a SyntaxError at 09:55 is not in the telemetry. Its output had been withheld by haiku-100k's oversized-output hook. Claude rewrote the probe file and the rerun succeeded about a minute later.
- The three category C failures (red tests whose exit code a pipe turned into 0) look like non-failures to the hook.
- The two `is_error` results in Turn 7 (09:38 and 09:42) were output withheld for length, not failures.

**Conclusion:** there was no retry loop in this session, so agent-reliability only observed. The hook and Jev only help in sessions where Claude reruns the same failing test or build command several times. To see which loops the hook caught across all history, run `/haiku-100k:reliability-report` rather than reading the dashboard's error count.

---
*Reproduction: the transcript `~/.claude/projects/D--Laya/830cca7b-….jsonl` was re-scanned with agent-tracker's exact regex. A turn runs from one user prompt to the next. Scratchpad paths are shortened to `$SP`.*
