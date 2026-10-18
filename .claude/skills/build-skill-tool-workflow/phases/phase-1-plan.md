# Phase 1: Plan (Opus, Track N only)

Who: a `haiku-100k:haiku-case` agent gathers context; **one Opus call** with a closed pack writes the brief and the design. Track E skips this phase (see SKILL.md).

## Gather the context pack (Haiku)

One `haiku-100k:haiku-case` agent reads the existing implementation and its neighbours and writes `<expDir>/context-pack.md` (under ~2k words): what exists, file paths, contracts, prior experiments and their headlines, fixtures that can be reused. Opus gets this file's text pasted into its prompt, never the repo.

## 0. Intake

Classify: `skill | hook | plugin | mcp | helper | provider`. Read the existing implementation and its neighbours first (in this repo: `.claude/skills/*`, `hooks/`, `routing/`, `eval/`, `report/`, HANDOFF/REPORT files, the `web-test-laya-*` / `web-test-jev-*` pattern). Reuse the existing provider wrapper and fixtures. Create the experiment id and folder.

## 1. Brainstorm → idea brief (no code)

Fill `templates/idea-brief.md`: problem, what plain Claude does today, hypothesis, smallest useful intervention, **what Jev/Laya decides** and what happens when it is wrong, slow, down or malformed, alternatives (rules only, plain Claude, Jev, Laya), risks, non-goals, and **success criteria fixed before any data** (usually: tokens or turns saved, and no case gets worse). Offer 2–3 options with a recommendation; if a model call does not plausibly beat rules, say so.

**Gate A** — show the brief and ask the user (AskUserQuestion): approve / revise / hold / reject. Record the decision and date; set `status: APPROVED_FOR_IMPLEMENTATION`.

## 2. Design

Short `design.md` (`templates/experiment-plan.md` as checklist): contracts (hook I/O, CLI/JSON, MCP schema), what Claude decides vs what the tool decides, the flag that turns it off, timeout/malformed/unavailable fallback, redaction, the case set with what "pass" means per case, and how tokens will be measured. Freeze it (`evaluation.criteriaFrozenAt`) before running step 6.

The brief and the design are written by the single Opus call from the context pack; the control session shows the brief to the user for Gate A.

## Gate and metric definitions (in design.md, frozen before any data)

Every offline gate and success metric in `design.md` states, before it runs:
- **Units:** numerator and denominator in the same unit (e.g. both cache_read tokens). A bound must be ≤ the total by construction; add an assertion to the script.
- **Window:** which data it reads (whole session histories, not a date cut; UTC vs local time), which sessions, and a held-out session from another day.
- **Edge cases:** sessions that start already past a threshold, sessions with no event of interest.
- **Reporting extras:** what is reported but not gating (e.g. the user's realized delay).

A change after the first result is a deviation: the user must approve it, the new definition is frozen in `design.md` (with a dated line) before the re-run, and both results stay in the evidence. (context-governor 2026-10-18: a bound mixing units reached an impossible 121%, then the formula changed twice.)
