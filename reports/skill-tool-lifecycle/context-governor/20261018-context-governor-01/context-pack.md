# Context-governor context pack

Facts only, from `D:\XionTechs\Laya`. Not read: `smart-context-trimming\hooks\trim-core.ts` (skipped by rule), and the other files in this output folder. `fast-compact\types\claude-code.d.ts` was read by Grep and by Read windows of at most 60 lines.

## 1. Plugin layout

### fast-compact (`D:\XionTechs\Laya\fast-compact`)
- `.claude-plugin\plugin.json`: name `fast-compact`, version `0.1.1`, author `Danh Nguyen`. `userConfig`: `preserveRecentMessages` (number, default 6); `minReductionRatio` (number, default 0.25).
- `.claude-plugin\marketplace.json`: one plugin entry, `"source": "./"`, version `0.1.1`.
- `hooks\hooks.json`: `{ "modules": ["./fast-compact.ts"] }`.
- `hooks\fast-compact.ts`:
  - line 254: `export const register: Register = (on: On, options: PluginOptions) => {`
  - line 260: `on('session.compact', async ($, event, next) => {` (the only `on(` registration found)
  - lines 261-262: home from `$.env.get('USERPROFILE')` ?? `$.env.get('HOME')`; dir `${home}/.claude/fast-compact`
  - lines 269-276: `log.jsonl` in that dir; line 6 comment: `arm.json` in that dir
  - lines 306-307: `$.ui.log(...)`, `$.ui.toast(\`fast-compact: ${text}\`, { timeoutMs: 15_000 })`
- `package.json`: `"type": "module"`; `engines.node` `>=22.18`; scripts `test` = `node --test "tests/*.test.ts"`, `typecheck` = `tsc -p tsconfig.json`, `preview` = `node scripts/preview.ts`.
- `tsconfig.json`: `module` and `moduleResolution` `nodenext`; `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit` true; `paths`: `{ "claude-code": ["./types/claude-code.d.ts"] }`; `include`: `hooks`, `scripts`, `tests`, `types`.
- Tests: `tests\fast-compact.test.ts`; framework `node:test` with `node:assert/strict`; imports `type { SessionMessage } from 'claude-code'`.

### smart-context-trimming (`D:\XionTechs\Laya\smart-context-trimming`)
- `.claude-plugin\plugin.json`: name `smart-context-trimming`, version `0.1.0`, author `Danh Nguyen`. `userConfig`: `mode` (string, options `observe|enforce|off`, default `observe`); `minLines` 250; `minBytes` 20000; `useJev` (boolean, true); `maxJevLatencyMs` 8000; `minJevConfidence` 0.6; `rawOutputTtlHours` 24.
- `hooks\hooks.json`: `{ "modules": ["./register.ts"] }`.
- `hooks\register.ts` (116 lines):
  - line 33: `export const register: Register = (on, options) => {`
  - line 34: `const opt: Options = { ...DEFAULTS, ...(options as Partial<Options>) }`; `DEFAULTS` and `Options` are imported from `./trim-core.ts` (lines 19-20).
  - lines 26-31, `baseDir($)`: `$.env.get('USERPROFILE')` ?? `$.env.get('HOME')`; dir `${home}/.claude/smart-context-trimming`.
  - line 39: `on('session.start', ...)`: registers command (line 40), reads env `SMART_TRIM_MODE` (line 41), sweeps raw logs older than `rawOutputTtlHours` (lines 43-50).
  - line 54: `on('command.run', { command: 'smart-trim' }, ...)`.
  - line 64: `on('tool.call', { tool: 'Bash' }, ...)`; line 115: `.catch(($, e, next) => next(e))`.
  - writes `${d}/raw/${stamp}-${e.tool_use_id}.log` (line 86) and `${d}/metrics-${stamp}.jsonl` (line 107).
- `package.json`: `"private": true`, `"type": "module"`, `engines.node` `>=22.18`. Scripts: `test` = `node --test "tests/*.spec.ts"` (this glob matches only `tests\core.spec.ts`); `test:engine` = `claude plugin test .`; `bench` = `node scripts/bench.ts`.
- No `tsconfig.json` in this directory. Tests: `tests\core.spec.ts` (node:test); `tests\engine.test.ts` (imports `expect, mock, test` from `claude-code/testing`, and `type { On }` from `claude-code`); `tests\fixtures.ts`.
- Version notes: `smart-context-trimming\README.md` line 3 says "function hooks, Claude Code ≥ 2.1.295". `fast-compact\reports\fast-compact-overview.md` line 47 says "Claude Code ≥ 2.1.274".

### CLAUDE_CODE_ENABLE_FUNCTION_HOOKS
- `fast-compact\README.md:21`: `{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }`
- `fast-compact\skills\fast-compact\SKILL.md:39`: set under `env` in `~/.claude/settings.json`.
- `fast-compact\scripts\preview.ts:103`: checks `process.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS === '1'`.
- `fast-compact\reports\fast-compact-overview.md:47`: lists it as a requirement.
- Other repo hits are only under `reports\skill-tool-lifecycle\`. None in `smart-context-trimming\` and none in `types\claude-code.d.ts`.

## 2. `fast-compact\types\claude-code.d.ts` (11267 lines)

### Hook registration
- line 4713: `export type On = {`; first overload: `<P extends Pattern>(pattern: P, hook: NoInfer<HookFor<P>>): Registration<HookFor<P>>;`
- line 3655: hook shape ends `e: Frozen<Args<E>>, next: Next<E>) => EventResult<E> | Promise<EventResult<E>>`.
- line 6193: `export type Register = (on: On, options: PluginOptions) => unknown;`
- line 5369: `export type PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>;`; doc at lines 5358-5359: the values of the fields the manifest's `userConfig` declares, "defaults filled in".
- line 1962: `export interface CoreEngineInterface {`; line 3397: `export interface EngineInterface extends CoreEngineInterface {`.

### Turn-end event: `turn.complete`
- line 3374 (input map): `'turn.complete': TurnCompleteInput;`; line 3550 (result map): `'turn.complete': TurnCompleteResult;`.
- lines 8718-8753, `TurnCompleteFields`: `answer: string;` (8723), `durationMs: number;` (8727), `isAborted: boolean;` (8731), `turnId: string;` (8736), `agentId?: string;` (8745), `usage?: TurnUsage;` (8753).
- line 8762: `export type TurnCompleteInput = TurnCompleteFields & (TurnCompleteRefused | TurnCompleteUnrefused);`
- line 8768: `export type TurnCompleteReason = 'answer' | 'aborted' | 'refusal' | 'error';`
- lines 8741-8744: a subagent's turns are also seen by every hook.
- lines 8786-8789: `export type TurnCompleteResult = { text: string; usage?: TurnUsage; }`.
- lines 8779-8781 (doc): "What a turn.complete hook returns and what next(e) resolves to: `{ text }`; a text other than a main-loop answer's is shown beneath it."
- line 9044: `export type TurnUsage = ModelForkUsage & { ... model: string; }` (line 9048).
- lines 4442-4447, `ModelForkUsage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (all number).

### Classic Stop: `classic.Stop`
- lines 909-912: `ClassicEventName = \`classic.${ClassicHookEvent}\``; doc names `classic.Stop` as "a classic hook event as a function-hooks event".
- lines 922-924: `ClassicEventOf` maps each classic hook event to `classic.${E}`.
- line 929: `export type ClassicHookEvent = HookInput['hook_event_name'];`. Line 3831 (one long union line) lists `StopHookInput`.
- lines 554-557, `BaseHookInput`: `session_id: string;`, `transcript_path: string;`, `cwd: string;`.
- lines 7912-7927, `StopHookInput`: `hook_event_name: 'Stop';` (7913), `stop_hook_active: boolean;` (7914), `last_assistant_message?: string;` (7918), `background_tasks?: BackgroundTaskSummary[];` (7922), `session_crons?: SessionCronSummary[];` (7926). No usage field.

### What handlers receive
- `turn.complete` `e`: no session id and no transcript path in its type. Usage: optional `e.usage` (TurnUsage) for that turn.
- Messages: line 2278, `messages: () => Promise<SessionMessage[]>;`. Doc (2271-2273): each entry is `{ role, text, toolUses }`; "A long transcript answers its newest 4096."
- Session id: line 2295, `id: () => Promise<string>;`. Doc (2293-2294): "Returns the session's id (the transcript file's name)."
- Transcript path: no accessor found. The only `transcript_path` field is `BaseHookInput` (line 556), used by classic hooks.
- Session usage: line 2342, `usage: (args?: SessionUsageArgs) => Promise<SessionUsage>;`. `SessionUsage` (lines 7706-7720): `context: SessionContextUsage;`, `rateLimits: SessionRateLimit[];`, `cost?: SessionCost;`.
- `SessionContextUsage`: `tokens?: number;` (line 7381; doc 7377-7379: input of the last response, "uncached, cache-written and cache-read together"); `window: number;` (7386); `percent?: number;` (7391; "a whole percentage, 0 to 100").
- Doc example (lines 2336-2337): `const { context } = await $.session.usage()` then `if ((context.percent ?? 0) >= 85) await $.session.compact()`.
- Line 2344 area: `$.session.compact` compacts the conversation.

### Can a hook add model context, or only show UI?
- `turn.complete`: `TurnCompleteResult` has only `text` and `usage` (lines 8786-8789). No model-context field is typed for this event.
- `classic.Stop`: line 1042, `Stop: 'additionalContext';` in `ClassicResultFields`. Line 965: `additionalContext?: string[];`, doc (962-964): "text handed to the model with the event." Line 1029: `block`, `preventContinuation` and `stopReason` are every event's. Lines 1057-1058 (`ClassicResultOf`) pick these per event.
- `$.ui.log`: line 2051 `log: (text: string) => void;`; doc (2040-2041): "drawn like a system notice (dim; not sent to the model)".
- `$.ui.toast`: line 2079 `toast: (text: string, options?: ToastOptions) => void;`; doc line 2072: "It leaves the transcript and the model untouched."; doc line 2075: `timeoutMs` "how long it stays (default 4000)". Argument type at lines 4860-4863: `text: string; timeoutMs?: number;`.
- `$.ui.status`: line 2090 `status: (text: string | undefined) => void;`; doc (2081-2082): pins a status line under the prompt until the next call.

## 3. `.claude\skills\build-skill-tool-workflow\scripts\transcript_usage.mjs` (57 lines)
- Exports: none. Top-level CLI script; imports `node:fs` and `node:path`; prints JSON to stdout (line 57).
- Usage (line 6): `node transcript_usage.mjs <session.jsonl> [--from ISO] [--to ISO] [--no-subagents]`.
- Subagents (lines 19-22): `<session path minus .jsonl>/subagents/*.jsonl`; skipped with `--no-subagents`.
- Reads each whole file with `fs.readFileSync` (line 29), splits on `\n`, runs `JSON.parse` per line, skips lines that fail to parse (lines 30-35).
- Record types: only `e.type === 'assistant'` is used (line 37). No other `type` value is read.
- Fields read: `e.timestamp` (36); `e.message.id` (38); `e.message.content[]` items with `type === 'tool_use'` (39); `e.message.usage` (42).
- Usage fields summed (lines 43-46): `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`.
- Dedupe by `message.id` (lines 38, 40-41): one API message is split over several lines. `toolCalls` (line 39) increments before the dedupe check, so it counts per line.
- `--from` / `--to`: `Date.parse` compared with `timestamp` (lines 17-18, 37).
- Output keys (lines 25, 47-56): `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `modelTurns`, `toolCalls`, `subagentTurns`, `source`, `elapsedMs`. `elapsedMs` is last minus first main-loop assistant timestamp, or `null`. `source` gets ` + N subagent transcript(s)` (line 55).
- The script does not read `message.model`, `session_id` or `cwd`. It sums per-message usage over the whole run; it does not compute a per-turn input size.
- Name-based correspondence (not stated in the d.ts): `SessionContextUsage.tokens` (uncached + cache-written + cache-read) maps to `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` in this script's usage record.

## 4. Not found or not verified
- No JSONL transcript record schema in `claude-code.d.ts`. Grep for `transcript` finds only `BaseHookInput.transcript_path` and UI text.
- No bare `Stop` function event. The candidates are `turn.complete` (engine event) and `classic.Stop` (classic settings-hook name).
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is not declared in `claude-code.d.ts`.
- Types only: runtime behaviour of `turn.complete` and `classic.Stop` in a plugin hooks module was not checked.
- `trim-core.ts` was not read, so the `DEFAULTS` values were not compared with the `userConfig` defaults.
