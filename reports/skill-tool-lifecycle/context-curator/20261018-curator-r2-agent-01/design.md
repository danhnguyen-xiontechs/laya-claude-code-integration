# Design (retro round 2, frozen before the runs)

Same design as round 1 (`../20261018-curator-agent-01/design.md`), with these changes:

- **Tool under test:** round-2 engine = round-1 engine + `tool-change/curator-r2.patch` (pointer view default, `curator.view: curated` keeps the round-1 output, `curator.pointerTop` 12, config keeps the `curator` key). Engine copy in scratch; not committed in the JEV repo.
- **Arm B config:** `.jev-advisor.json` sets `curator: { view: "pointers", pointerTop: 12 }` explicitly.
- **Arm B prompt:** the one tool sentence now describes the pointer list (line ranges, previews, full log under `.tool-output/`). Arm A prompt is unchanged.
- **Cases, repetitions, models, pass rule, token scope, forbid check, answer-key handling:** unchanged from round 1.
