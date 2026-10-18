# 20261017-sbp-agent-02 — story-batch-planner after the rework

Re-measure after fixing the Critical (incomplete prerequisite inverted), the Majors (mixed-kind cycles, batch
policy enabling Jev, out-of-batch depends_on) and the agent-cost items (PLAN_JSON line, no serialization on
shared words). Previous run 20261017-sbp-agent-01 was REWORK/LOW on 4 small fixtures.

- **Cases**: 3 new batches in `cases/` (12, 11, 10 stories): API producer/consumer, DTO conflict, two
  migrations, schema reader, shared file/fixture, explicit link, text ref, out-of-batch dep (FIN-12, HR-404),
  mixed-kind mutual dependency (cycle) + dependent, incomplete stories incl. an incomplete prerequisite (R-1).
- **Arms**: same prompt; A adds "No planner tool is available …", B adds "run `node plan.mjs --summary`".
  Neutral wrapper `plan.mjs` in each work folder (A prints "planner disabled"; B runs the real planner with
  `--jev`). Haiku 5.5, effort xhigh, 2 reps (rep 2 B first). `make_tasks.mjs` builds folders and prompts.
- **Pass**: answer `{waves, needs_decision}`; every id placed, none twice; all invariants in `grade.mjs`
  (orderings, not-same-wave pairs, held stories, independent scheduled). A deferred later story passes an
  ordering. Correctness only; wave count reported in the observed outcome.
- **Tokens**: subagent transcripts via `subagent_usage.mjs` (A with `--forbid`). `grade.mjs` collects,
  saves answers/texts and writes results.
