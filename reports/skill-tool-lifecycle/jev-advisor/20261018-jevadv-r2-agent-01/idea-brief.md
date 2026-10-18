# Retro round 2: jev_advisor (20261018-jevadv-r2-agent-01)

**Question.** When the cause is not in the source (a value that exists only in the log), does a single [jev] hint, one that repeats no local anchor, help an agent find the cause in fewer steps?

**Baseline.** [20261018-jevadv-agent-01](../20261018-jevadv-agent-01/): 8/8 both arms, tokens 3.38M -> 3.63M (+7%). The last improvements.md said the cases were too easy (the source named the cause) and that the hints pointed at noise in 4 of 8 runs.

**What changed this round.** At most one [jev] hint; a hint whose focus line only repeats the local failure anchor is dropped; the hint line shows 200 characters. Four log-only cases were built (the cause is a value in a 330-400 KB log, not in the source).

**Nothing has been measured.** The user stopped the run before the case agents, to review the fixtures and the cost. The build found that the gold chunk is not sent to Jev on any of the four cases (the request sends 80 of 420-490 chunks), so a run would measure chunk selection more than Jev.
