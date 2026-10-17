# Idea brief (retro) — integration-verifier, run 20261018-integration-verifier-agent-01

This is a retro measurement: the tool already exists (`.claude/skills/integration-verifier/`, commit f612ca1) and steps 1-3 were skipped on the user's instruction. The user is not asked to approve an idea; Gate B (final decision) stays theirs.

**Question this run answers.** The report rates the tool PILOT with 0 false PASS on its own 10 fixture batches and Jev in shadow. When a Haiku 5.5 agent is asked "Is this batch safe to merge?" on small git batches, does having the verifier (rules + live Jev shadow, one command) give a more correct batch and per-story status than the agent inspecting manifests, logs and branches itself, and what does it cost in tokens?

**Plain Claude today.** Reads the manifests and logs, maybe merges the branches in a temp copy and runs the tests. Risk: trusts "claimed done", skips the combined run, misses a duplicate migration version.

**What Jev decides.** Nothing that changes a status: it labels unclassified combined-failure clusters (shadow). So any difference between arms comes from the deterministic rules; Jev calls are measured but cannot change a result.

**Success criteria (fixed before data).** B passes at least as many cases as A (batch status and all story statuses equal to gold) with no case worse, and does not cost more tokens than A.
