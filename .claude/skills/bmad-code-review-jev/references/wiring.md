# Wiring the layer permanently into a project (optional)

The wrapper skill adds the layer for one run. A project that wants it in every plain
`bmad-code-review` run can add it through BMad's own customization surface instead. Nothing in BMad
core changes, and deleting the file removes it.

`{project-root}/_bmad/custom/bmad-code-review.toml` (team, committed) or
`bmad-code-review.user.toml` (personal, gitignored):

```toml
[[workflow.review_layers]]
id = "project-rules-jev"
name = "Project Rules (Jev)"
instruction = """
Run with Bash, no subagent:
node "<absolute path to bmad-code-review-jev>/scripts/rules-layer.mjs" --diff "{diff_file}" --project-root "{project-root}"
Its stdout is this layer's findings. Output starting with `LAYER FAILED:` means the layer failed.
"No rule violations above the threshold." is a valid empty result.
"""
```

Arrays of tables keyed by `id` merge by id, so this appends a fifth layer next to the four defaults.
The rule set must exist first: run `rules-build.mjs --project-root <root>` once (and again when the
agent rules change; it is a no-op when nothing changed).

Caveats:
- The script path is machine-specific; a team file needs every developer to have the skill at the
  same path (for example installed through xt-skills), or use the personal `.user.toml`.
- Data consent: a permanent wiring with provider `jev` sends diffs on every review. Decide that per
  project before committing the team file, or set `"provider": "laya"` / `"kev"` in `jev.local.json`.
- Verdict recording (step 3 of the wrapper) does not happen in a plain run.
