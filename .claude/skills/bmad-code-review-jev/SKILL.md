---
name: bmad-code-review-jev
description: 'Jev variant of bmad-code-review: runs the project''s own bmad-code-review with one extra review layer, "Project Rules (Jev)", where TypeSafe Jev (or Laya / Kev) checks every added hunk of the diff against the project''s own semantic rules (project-context.md or the AGENTS.md bmad:context block). Its findings go through the normal triage. Trigger only on "/bmad-code-review-jev [same args as bmad-code-review] [--provider jev|laya|kev]" or an explicit request to try the Jev rules layer; plain code reviews go to bmad-code-review.'
---

# BMad Code Review + Jev project-rules layer

A thin wrapper. It does **not** copy `bmad-code-review`: each project keeps its own BMad install,
layers and customizations. This skill adds one layer to that project's review for this run, and
records how its findings fared in triage.

What Jev does here, and only this: for each pair (semantic rule, hunk whose file is in the rule's
scope) built by the script, it answers one yes/no question with a probability: "does the added code
break this rule?". The script turns pairs above the threshold into findings. Jev writes no text,
gives no severity and decides nothing about merge; triage verifies every finding as usual.

`<skill-dir>` means the folder containing this SKILL.md. Run scripts as
`node <skill-dir>/scripts/<name>.mjs` with absolute paths. Never `cd`.

## Data leaving the machine

With provider `jev` (the default), the **added lines of each hunk** (plus up to 12 unchanged lines
around them), the file path and the rule texts are sent to OpenRouter (TypeSafe Jev). The rule-set
build sends the rule texts and the repo's folder names. `--provider laya` or `--provider kev` keep
everything local.

## Steps

0. **Provider and consent.** Provider: `--provider` argument, else env `DECISION_PROVIDER`, else
   `jev.json` (`jev`). If it is `jev`, run `node <skill-dir>/scripts/consent.mjs --project-root <root>`:
   - `approved` → continue.
   - `denied` → run the review without the Jev layer (step 2 without the extra layer) and say so.
   - `unknown` → ask the user once (AskUserQuestion): "Send added diff lines and rule texts of this
     project to OpenRouter (TypeSafe Jev) for the rules layer?" with options *Yes, for this project* /
     *No, skip the Jev layer* / *Use local Laya instead*. Record Yes/No with
     `consent.mjs --project-root <root> --approve` or `--deny`; for Laya switch the provider to `laya`.

1. **Rule set.** Run `node <skill-dir>/scripts/rules-build.mjs --project-root <root> --provider <p>`.
   - `unchanged: true` → continue.
   - Built now (`classifiedNow` > 0) → tell the user in two lines: the file
     `_bmad/custom/jev-rules.generated.json` was written, with N semantic / N mechanical / N not-a-rule
     rules, and that corrections go to `_bmad/custom/jev-rules.json` (see `references/rules-file.md`).
     Do not stop to wait for a review of the file.
   - `error` "no rule source found" → say the project has no agent rules yet (suggest
     `bmad-project-context setup`) and run the review without the Jev layer.
   - `unclassified` > 0 (provider failed on some rules) → those rules are skipped by the layer; say so.

2. **Run the project's bmad-code-review.** Invoke the `bmad-code-review` skill with the user's
   arguments (minus `--provider`) and follow it completely, with one addition carried through it:

   > In Step 2, the review layers are `{workflow.review_layers}` **plus** this layer, unless a layer
   > with id `project-rules-jev` is already among them (the project wired it permanently):
   > - id `project-rules-jev`, name `Project Rules (Jev)`
   > - instruction: run with Bash, no subagent:
   >   `node <skill-dir>/scripts/rules-layer.mjs --diff <absolute {diff_file}> --project-root <root> --provider <p>`
   >   Its stdout is the layer's findings. Output starting with `LAYER FAILED:` means the layer failed
   >   (add it to `failed_layers`). "No rule violations above the threshold." is a valid empty result,
   >   not a failure. Remember the `(run log: …)` path it prints.
   >
   > In Step 3, Jev findings (`J1`, `J2`, …) are ordinary findings: verify each claim at the cited
   > line and render a verdict like any other. `P(violation)` is not a severity. A rule finding is
   > `false` when the added code follows the rule or the rule does not apply to it.

3. **Record verdicts.** After triage, for every `J<n>` finding write its verdict
   (`high|medium|low|false|maybe-false`, before grouping) with
   `node <skill-dir>/scripts/verdicts.mjs --run <run log path> --set "J1=medium,J2=false"`.

4. **Footer.** End the review with one line:
   `Jev rules layer: <n> findings → <real> kept, <false> rejected · <pairs> pairs · <provider> · $<cost or n/a>`
   or `Jev rules layer: skipped (<reason>)`.

## Measuring it

`node <skill-dir>/scripts/verdicts.mjs --summary` gives, per provider: runs, findings, precision
(real / judged) and false findings per run. Keep the layer when it finds rule violations the other
layers missed and false findings stay at about one per review or fewer; tune `thresholds.flagMin`
in `jev.json` from these numbers.

To wire the layer permanently into a project instead of through this wrapper, see
`references/wiring.md`.
