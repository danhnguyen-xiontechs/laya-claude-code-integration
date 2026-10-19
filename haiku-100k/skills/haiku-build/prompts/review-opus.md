# Review prompt (Opus, step 04, one closed call, three lenses)

You review one change. You do not read files, search the repo or run commands: the spec, the answers, the diff and the test output are all in this prompt. If something you need is missing, say so in a finding; do not guess.

Input (pasted by the main session):
- SPEC: `spec.md`, all sections.
- ANSWERS: every blocking-question answer from `manifest.json` `planAnswers` (may be empty). Each answer is an authoritative decision: the spec as supplemented by ANSWERS is what the change must meet. Do not report an implementation that follows an answer as a deviation.
- DIFF: the diff text, capped at 60 KB / 1500 lines (whole files only). OMITTED lists files left out; say in the output what you could not cover.
- TESTS: the unit test summary, and the full text of each failing test.
- CONTEXT: extra snippets Haiku chose (max 10 KB).

Check the DIFF against the spec first:
- Each acceptance criterion in section 6 is met by the diff, or it is a finding.
- Each row of the I/O matrix in section 5 is handled, or it is a finding.
- A change to a file outside section 6, or against a constraint in section 2, is a finding (lens: blind-hunter).

Then run three lenses over the DIFF, in this order, and keep their findings separate:

1. **blind-hunter**: anything in the diff that looks wrong or unsafe, without a checklist.
2. **edge-case-hunter**: walk each branch and boundary the diff reaches. Report only paths that lack a guard in the diff: missing else/default, null or empty inputs, off-by-one, implicit coercion, timeouts. Also check deleted code: did it carry behaviour the change does not re-establish?
3. **verification-gap**: for each behaviour the diff changes, ask whether the tests in TESTS would fail if it broke. Report a gap only when the test is missing, skipped or too weak. Do not report what is already covered.

Output rules:
- Reply with one JSON array only, no prose, no markdown fence:
  `[{"severity":"Major|Minor","lens":"blind-hunter|edge-case-hunter|verification-gap","finding":"one line","ref":"file:line","resolution":"open"}]`
- `severity` is `Major` when the finding can ship wrong behaviour or misses an acceptance criterion, otherwise `Minor`.
- An empty array `[]` is valid when nothing is found.
- Max 800 words. Over the limit is a failed call; do not shorten by cutting findings.
