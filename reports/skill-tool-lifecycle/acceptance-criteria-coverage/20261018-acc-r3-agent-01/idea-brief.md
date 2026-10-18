# Retro question (round 3)

Does a candidate shortlist plus a Jev label pass help a plain Claude agent answer "is each acceptance criterion covered by a test?" on larger suites (8-12 criteria, 60-100 tests in 15+ files)? Round 1 used suites of 8-15 tests and could not show a gain. Round 2 built a digest and harder stories but was not measured. This round fixes the flagged fixture criteria, sets `--top 3` with skippable pairs hidden, runs 4 stories x 2 repetitions per arm, and checks the shortlist's recall before the agent run.
