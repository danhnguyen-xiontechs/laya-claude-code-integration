---
name: bmad-help-jev
description: 'Jev variant of bmad-help: before the project''s own bmad-help runs, TypeSafe Jev (or Laya / Kev) picks at most one next BMad skill from that project''s installed catalog (_bmad/_config/bmad-help.csv), and bmad-help answers with that pick as a hint. Trigger only on "/bmad-help-jev [question]" or an explicit request to try the Jev skill suggestion for BMad; plain BMad help goes to bmad-help.'
---

# BMad Help + Jev skill suggestion

A thin wrapper. It does **not** replace or copy `bmad-help`: every project keeps its own BMad install,
modules and customizations, and this skill reads them at run time. Jev only adds one typed hint
("which skill, if any, and how sure"); `bmad-help` still decides what to tell the user.

`<skill-dir>` means the folder containing this SKILL.md. Run scripts as
`node <skill-dir>/scripts/<name>.mjs` from the project root. Never `cd`.

## Data leaving the machine

With provider `jev` (the default), the user's question, the catalog descriptions, the first 700
characters of up to 3 candidate SKILL.md files and the **file names** under `_bmad-output/` are sent
to OpenRouter (TypeSafe Jev). No file contents, no code. If that is not acceptable for this project,
use `--provider laya` or `--provider kev` (both local).

## Steps

1. **Question.** Take the user's question from the arguments. If there is none, ask what they want
   to do (one short question), or use "What should I do next?" if they only want orientation.

2. **Jev suggestion.** Run:

   ```
   node <skill-dir>/scripts/suggest.mjs --project-root <project-root> --query "<question>" [--provider jev|laya|kev]
   ```

   It prints one JSON object: `suggestion` (`{ skill, action, name, menuCode, rerankP, fit }` or
   `null`), `gate`, `fit`, `candidates`, `catalogSize`, `error`. It never fails the run: on any
   error `suggestion` is `null` and `error` says why (missing key, no `_bmad/`, timeout).

3. **Run the project's bmad-help.** Invoke the `bmad-help` skill with the user's question and follow
   it completely, with this one extra input carried into its reasoning:

   - `suggestion` not null → "Jev suggests `<skill>` (fit <fit>, gate <gate>). Treat this as a hint
     only: confirm it against the catalog sequencing, required gates and the artifacts you find;
     recommend something else when the evidence says so."
   - `suggestion` null and no `error` → "Jev found no skill that clearly fits (gate <gate>). Consider
     answering directly before recommending a workflow."
   - `error` → no hint; run `bmad-help` as normal.

   If the project has no `bmad-help` skill installed, answer from `_bmad/_config/bmad-help.csv`
   yourself using the same hint rules.

4. **Footer.** End the answer with one line:
   `Jev: <skill or "none"> · gate <gate> · fit <fit> · <provider> · <agreed | overridden | no hint>`
   where `agreed` means bmad-help's first recommendation is the same skill, `overridden` means it
   recommended a different one.

## Measuring it

Every run appends one line to `~/.bmad-jev/help-log.jsonl` (question, provider, suggestion,
candidates, latency, cost). To score it on labelled cases:

```
node <skill-dir>/scripts/suggest.mjs --project-root <project-root> --eval cases.jsonl --provider jev
```

`cases.jsonl` holds one `{ "query": "...", "expected": "<skill>" | null }` per line. The summary gives
the wrong-suggestion rate, the needless-suggestion rate (suggested a skill when none was expected)
and accuracy on covered cases. Thresholds in `jev.json` are the cookbook's starting values (0.3);
pick them from an eval on the project's own data.
