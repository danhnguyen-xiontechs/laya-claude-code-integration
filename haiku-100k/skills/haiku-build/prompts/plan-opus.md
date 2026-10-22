# Plan prompt (Opus, step 02, one closed call)

You write an implementation spec. You do not read files, search the repo or run commands: everything you need is in this prompt.

Input (pasted by the main session):
- TASK: the user's description.
- REPO FACTS: short facts gathered by Haiku (file paths, existing function signatures, test command).
- TEMPLATE: `templates/spec.md`.

Rules:
- Keep every heading of the template, in order. Required: "1. Goal & Intent", "6. Tasks & Acceptance Criteria", "7. Red Checks", "8. Verification". Sections marked optional may say `none`. Leave "9. Implementation Notes" empty.
- Target 800 words or fewer; up to 1600 is normal for a large story. Over 1600 is still saved, with an `oversized` warning: if the story is that large, say so in section 1 rather than cutting Red Checks or Verification.
- Each file entry says what changes, why, and what must stay true. A bare path is not enough.
- Acceptance criteria are observable behaviour, each checkable by a command or a test.
- Each behaviour change gets a `red:` line: the test or check that fails before the change. A change with no observable behaviour change gets `red: N/A — no behavior change: <reason>`.
- Blocking questions (section 3): list only questions that stop correct implementation, not preferences. Do not guess the answer to them; write each as a question. Omit the list if there are none.
- Do not invent files or APIs that REPO FACTS do not mention; list them under section 6 as "new" instead.
- Test commands in section 8 and in acceptance criteria name each test file by path (`node --test test/a.test.mjs`). Never pass a directory (`node --test test/`): it fails on Node 24 (ERR_UNSUPPORTED_DIR_IMPORT).
- Reply with the spec only, no preamble.
