---
name: skills-router
description: 'Suggests which installed skill, slash command, subagent or BMad workflow fits a request (project, user, plugin and bundled skills, .claude/commands, .claude/agents, _bmad/_config/bmad-help.csv), or says that none is needed. A BM25 shortlist, then optionally one local Laya / Kev or hosted Jev decision. A hint only: Claude makes the final call. Use on "/skills-router <request>" or when the user asks "which skill should I use for …", "is there a skill/command for …".'
---

# Skills router

`<skill-dir>` is the folder holding this SKILL.md. Run scripts as `node <skill-dir>/scripts/<name>.mjs`
from the project root; never `cd`.

## Data leaving the machine

- `--provider none` (the default in `jev.json`) and `laya` / `kev` (local servers): nothing leaves the
  machine.
- `--provider jev`: the request text, the name and description (plus the first ~700 characters of
  the body) of up to 8 shortlisted skills, and the repo context below are sent to OpenRouter
  (TypeSafe Jev). The context is computed by code: the git branch name, whether the working tree is
  dirty, the top 3 changed file extensions, the number of files under `_bmad-output/`, and whether
  the request contains a PR URL. No file contents, no code, no diffs.

Use `jev` only when the user picked it (flag, `DECISION_PROVIDER=jev`, or `jev.local.json`).

## Steps

1. **Request.** Take it from the arguments. If there is none, ask in one short question what the
   user wants to do.

2. **Route.** Run:

   ```
   node <skill-dir>/scripts/route.mjs --project-root <project-root> --query "<request>" [--provider none|laya|kev|jev]
     [--consistency 3] [--stability-min 0.67] [--agreement off|low|abstain]
   ```

   With a provider, `--consistency k` makes k decision calls with the shortlist shuffled (the same
   shuffle for the same request) and uses how often the top answer won as its confidence;
   `--agreement` compares the engine's top-1 with BM25's (`low`: keep both, confidence low;
   `abstain`: no suggestion when they differ). Defaults come from `jev.json`.

   It prints one JSON object:
   - `suggestion`: `{ id, invocation, why, confidence, fit, source, kind }` or `null`;
   - `alternatives`: up to 2 more, same shape;
   - `abstain`, `abstainReasons` (`gate`, `fit`, `none-first`, `bm25`, `disagree`, `unstable`, `empty`), `closest`;
   - `overlaps`: `[{ id, invocation, differs }]` when the top candidates do the same job;
   - `gate`, `mode` (`provider` or `bm25-only`), `confidenceLabel`, `shortlist`, `error`;
   - with a provider, `agreement` (`{ bm25Top, agree, mode }`), and with `--consistency` > 1,
     `consistency` (`{ rounds, stability, votes }`) and `suggestion.stability`.

   It never fails: on any error, `suggestion` is `null` and `error` says why. If the error is the
   provider (server down, no key, timeout), you may run it once more with `--provider none`.

3. **Answer.** Check the hint against the request and what you know of the project, then:
   - **Suggestion that fits:** recommend it with its exact `invocation`, in one line, with its `why`.
     Name an alternative only when it is a real option. When `overlaps` is non-empty, add one line per
     overlapping skill with its `differs` text, so the user can tell them apart. An entry marked
     `[explicit only]` is for when the user asks for that variant by name.
   - **Abstain, or a suggestion that does not fit:** answer the request directly, or do the work,
     without a skill. Do not push a skill the router abstained on.
   - `bm25-only` hints are keyword matches: trust them less than `provider` hints.
   - `confidenceLabel: "low"` with `agreement.agree: false`: BM25 and the engine picked different
     skills; both are listed (the engine's first). Choose between them from the request, or ask.

   Then, unless the user only asked which skill to use, carry on: invoke the chosen skill, or do the
   task.

4. **Footer.** End with one line:
   `skills-router: <id or "none"> · <why, or the abstain reason> · <provider> · <agreed | overridden>`
   where `overridden` means you chose something other than the suggestion.

## Logging and evaluation

Every run appends one line to `~/.skills-router/log.jsonl` (request, provider, suggestion,
alternatives, gate, fit, abstain, latency, cost). Evaluation on mined history is described in
`README.md`; mined prompts stay in `~/.skills-router/eval/`, outside every repo.
