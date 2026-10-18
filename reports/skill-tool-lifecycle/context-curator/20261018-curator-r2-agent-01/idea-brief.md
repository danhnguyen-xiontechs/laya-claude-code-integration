# Idea brief (retro round 2): ranked pointer list instead of the curated view

**Baseline:** round 1, `../20261018-curator-agent-01/` (REWORK: both arms 8/8, curated view cost +38% tokens; 2.58M A vs 3.56M B). Its `improvements.md` names the top suggestion applied here: do not print the curated view as a replacement; print a short ranked pointer list and keep the full log on disk.

**Question this run answers:** with the pointer list (status line, up to 12 kept chunks with line ranges and previews, a footer with the Read hint), does Haiku 5.5 still find the root cause in the same four failing pytest runs (h02, h04, h06, h07) with fewer tokens than plain Claude, without getting any case wrong? Success criteria are the same as round 1 and fixed before data: B passes every case A passes, and B total tokens < A total tokens (paired by case and repetition). Directional only: 4 cases x 2 repetitions.

**Tool:** context-curator (JEV `jev_advisor/curator.py`), round-2 change in `tool-change/curator-r2.patch`. Jev still decides the per-chunk relevance (p <= omitMaxP keeps the existing keep/omit decisions); the pointer ordering uses failure anchors first, then Jev-scored chunks above the threshold, then other always-keep chunks, then unanswered chunks.

**Non-goals:** no held-out threshold evaluation, no WARNING protection (tried and reverted, see manifest deviations), no other runner than pytest, no adoption decision (Gate B is the user's).
