# Final decision — smart-context-trimming

- **Decision:** PILOT
- **Decided by:** the user, 2026-10-17T07:33:31Z
- **Based on:** 20261017-sct-agent-02 (commit d5f1113): Haiku 5.5 subagents, 5 tasks × 2 runs, 20/20 pass in both arms, session tokens −18% (4.96M → 4.04M).

## What PILOT means here
- Use the hook in enforce mode on a small scope of real work; it stays behind its flag (default observe, `/smart-trim off` to disable).
- Not adopted globally yet.

## Before adopting
- Measure on real sessions (metrics jsonl from observe/enforce mode), not synthetic tasks.
- Watch js-feature-like tasks (implementing code), which took one or two extra turns with trimming.
- Check the real hook path (deny-shape for failed commands), which the agent run did not reproduce.
