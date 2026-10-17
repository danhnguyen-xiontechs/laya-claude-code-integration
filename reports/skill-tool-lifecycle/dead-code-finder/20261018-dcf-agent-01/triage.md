# Triage: dead-code-finder

Retro measurement of a PILOT tool of the Laya/Jev report (run 2026-10-18). Source: the JEV repo, branch `claude/review-5-plans-idea-folder-ce4d36`, commit e551872 **plus the uncommitted working tree** (the three skills, their examples and tests are untracked there; the working tree was copied read-only and measured as it was).

1. **What it decides.** Which Python symbols (functions, classes, methods, constants, imports, orphan modules) and junk (commented-out code, debug prints, dead branches) can be deleted. Static rules (AST, string search, decorators, entry points, `__all__`, overrides, reflection) decide what is KEPT; the remainder is ranked into Tier A (safe in small batches), B (needs a look) and C (kept).
2. **What Jev adds.** Jev (Choice questions per candidate) is the only thing that can promote a candidate to Tier A (likely_dead / dead_code_comment / debug_leftover with p >= 0.9) and labels junk (debug leftover vs intentional output vs explanatory example). Without Jev there is never a Tier A; Jev cannot delete anything.
3. **What a fair agent task with a checkable gold answer looks like.** A small project with known seeded dead items and look-alike live code (registered by decorator, getattr prefix, config string, entry point, override, `__all__`, test-only). The agent lists what it would delete; a script scores it against the key. Pass = no wrong item (a decoy or anything not in the key) and at least 75% of the dead items. Weak point: the projects are small enough for plain Claude to grep every name.

Verdict of the triage: measurable with agents. Cases are small and seeded, so this measures whether the tool helps or costs on easy, fully known material; it cannot say how it behaves on a large real codebase.
