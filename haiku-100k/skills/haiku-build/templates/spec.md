# Spec: <short title>

Target 500–700 words, max 800. Written by Opus in step 02; saved as `spec.md`. Keep every heading, in this order. Sections marked *optional* may say `none` and be short; a small task gets a short spec.

## Metadata
- Title, type (feature / fix / refactor), date, status: draft
- Context paths only when Build needs them

## 1. Goal & Intent (required)
What is wrong or missing, what changes for the user, and the direction taken. Two to four sentences.

## 2. Boundaries & Constraints (optional)
Invariants that must hold, contracts callers rely on, and what is out of scope.
- Example: "Keep the `parseConfig(text)` return shape; callers in `src/cli.js` depend on it."

## 3. Assumptions / Blocking Questions (optional)
- Assumptions Build may take without asking.
- **Blocking questions**: only questions that stop correct implementation. If there are any, step 02 asks the user once, before Build. Each answer is recorded in `manifest.json` `planAnswers` and is authoritative (see step 03).

## 4. Code Map (optional)
Only the files this change touches or reads for context: path, role, what to check there.

## 5. Behavior & Edge Cases (optional)
An I/O matrix for inputs, outputs and errors that one criterion cannot express.

| Input | Expected output | Error / note |
|---|---|---|
| `""` (empty) | `[]` | none |
| `"a,,b"` | `["a","b"]` | skip empty items |

## 6. Tasks & Acceptance Criteria (required)
Ordered tasks. Each file gives what changes, why, and what must stay true.
- `src/example.js` — validate input before processing; keep the existing caller contract; reject invalid input with a `TypeError`.

Acceptance criteria are observable behaviour, each checkable by a command or a test. "Tests pass" is not a criterion. Every AC names its implementation `target:` (file or function) and its `verify:` (the command or test that checks it), in this exact form; an AC without either is `unmapped` (warning `ac-unmapped`) and never counts as passing.
- AC1: `parseList("a,,b")` returns `["a","b"]` — target: `src/list.mjs`; verify: `node --test test/list.test.mjs`
- AC2: ... — target: `<file or function>`; verify: `<command or test>`

## 7. Red Checks (required)
One `red:` line per behaviour change: a test or check that fails before the change and passes after it.
- `red:` `test/list.test.mjs` "skips empty items" — fails now because `parseList` returns `["a","","b"]`.
- `red: N/A — no behavior change: <reason>` when nothing observable changes. Do not invent a test.

## 8. Verification (required)
- Unit test command (offline, no installs): `<exact command>` — name each test file by path (`node --test test/a.test.mjs`). A directory argument (`node --test test/`) fails on Node 24 (ERR_UNSUPPORTED_DIR_IMPORT).
- Pass condition: <what the output must show>
- Manual checks, only if they cannot be automated: <steps>

## 9. Implementation Notes (filled by Haiku during build)
Empty at plan time. Build records deviations from the spec, blockers, and the decision taken for each blocking-question answer that changed a detail.
