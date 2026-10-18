# harness (round 2)

Copy of the round-1 harness (`../../20261018-dcf-agent-01/harness`) with only the paths changed: `common.mjs` points SCRATCH, WORK_ROOT and the subagent usage script at this session's folders, and the scrub now replaces the Windows home folder with `<home>`. `retro.mjs` (make|collect|grade|list) and `tools/dcf.mjs` (cases, prompts, wrapper B, grader) are unchanged.

The path defaults in `common.mjs` are placeholders (`<home>` replaces the Windows home folder in this committed copy): set `RETRO_SCRATCH`, `WORK_ROOT` and `USAGE_SCRIPT` to real paths before running `make`, and `EXP_DIR` is this folder by default.

What differs from round 1 is the code the wrapper imports: `SCRATCH/jev-run/jev_skills` is the patched copy (see `../tool-change.patch`), not the JEV worktree.

Order used: `node retro.mjs make dcf`; the case agents run; `node retro.mjs collect dcf <subagentsDir>`; `node retro.mjs grade dcf`; then `build_tool_report.mjs` for this folder.
