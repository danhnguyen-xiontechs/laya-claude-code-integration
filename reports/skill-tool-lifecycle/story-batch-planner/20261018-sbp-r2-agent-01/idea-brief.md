# Idea brief (retro round 2) — story-batch-planner

Question: after holding incomplete stories in needs_decision (instead of scheduling them in their own wave) and fixing
endpoint extraction (trailing punctuation), does the planner arm stop costing 2.7x the tokens of plain Haiku on the same
3 batches, without passing fewer cases?

Baseline (left untouched): [20261017-sbp-agent-02](../20261017-sbp-agent-02/) — A 5/6, B 6/6, tokens 656k -> 1,747k;
its `improvements.md` suggestions #1 (incomplete → needs_decision) and #2 (endpoint fix) are applied here.
Success criteria (fixed before data): B tokens <= A tokens (paired, beyond repetition noise) and B passes >= A, no case worse.
