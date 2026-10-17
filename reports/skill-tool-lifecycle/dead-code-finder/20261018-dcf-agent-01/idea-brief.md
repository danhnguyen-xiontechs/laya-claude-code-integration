# Idea brief (retro): dead-code-finder

This tool already exists (JEV repo, commit e551872 + working tree) and is listed PILOT in the Laya/Jev report after 1-3 real sessions and 84/84 unit tests (all five new JEV skills together; dead-code-finder's own tests pass here). Steps 1-3 of the build workflow are skipped by the user's decision. This folder answers one question:

> On a controlled set of 4 cases with a known answer, does Claude + dead-code-finder with Jev live pass more cases, or spend fewer tokens, than plain Claude, and does any case get worse?

- What plain Claude does today: greps for each name and reads the files.
- What Jev decides in this tool: see triage.md (line 2).
- Success criteria fixed before any data: B passes at least as many cases as A in every pair, no case that passes in A fails in B, and B does not cost more tokens than A (paired, beyond the noise between the two repetitions).
- Wrong, slow or down: the tool falls back to rules (dead-code: no Tier A; git-risk: formula only; ac-coverage: labels null, continue Claude-only). The wrapper logs every Jev call and failure.
- Non-goals: fixing the tool, a verdict on large real repositories, the skill's optional hook or prune steps.
