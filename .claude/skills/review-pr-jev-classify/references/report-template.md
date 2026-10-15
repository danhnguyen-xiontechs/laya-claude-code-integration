# Report template

The review report is one Markdown file, written to the `report` path printed by
`pr-fetch.mjs` (`~/.xt-skills/review-pr-jev-classify/reviews/<repo-id>/pr-<id>/<run>/pr-<id>.md`) or to the user's
`--out` path. It is the same text that would be posted as the summary comment, so write it
for the PR author: lead with the verdict, put every finding in one table, keep it readable
in about a minute.

## Writing rules

- **One finding = one row.** No per-finding prose blocks.
- **Issue** cell: one sentence, at most 25 words: the defect and its concrete consequence.
  No background, no restating the rule, no hedging.
  - Good: `Passes the account id where the profile id is required, so no lead row is ever returned.`
  - Bad: a paragraph explaining how both services work before reaching the bug.
- **Fix** cell: imperative, at most 15 words; name the function or pattern to use.
- **Rule** cell: the short rule reference from the project rules (`R3`, `§10`, `S2139`,
  `AC2`) or an axis name when no written rule applies (`Bug`, `Security`, `Test gap`,
  `Perf`, `Maintainability`).
- **Location** cell: `` `File.ts:68` `` (see "Citing locations" in review-method.md).
- Cells are single-line: no line breaks or code fences; escape `|` as `\|`; inline code is fine.
- Rows ordered Critical → Major → Minor → Suggestion, then by file; numbered `1..n` so the
  author can reply "fixed #2".
- **Fix sketches** only for Critical/Major rows whose fix is not obvious from the Fix cell:
  at most 8 lines each, keyed by row number, in the language of the file.
- Never include a secret value: write `<redacted>`.
- Do not paste PR description or comment text into the report except as a short quote
  needed to explain a finding.

## Structure

<!-- Kept verbatim from the original review-pr template; do not change without the owner. -->

`{lang}` = the code-fence language of the file being fixed. `{standards}` = the project rules
used, joined on one line with ` · ` (or "generic best practices" when no project rules exist).
The heading and the first two lines (verdict, score, merge, coverage, findings) are printed by
`assess.mjs`; copy them as they are. Rules: "Score, verdict and merge assessment" in
review-method.md. Laya's opinions never appear in the report.

````markdown
## PR Review — {Verdict}

**Score:** {score}/100 · **Merge:** {🔴 Blocked | 🟡 Eligible with suggestions | 🟢 Eligible} · **Coverage:** {n}/{n} files
**Findings:** 🔴 Critical {c} · 🟠 Major {m} · 🟡 Minor {n} · 🔵 Suggestion {s}
**Requirements:** {ticket link(s)} · ✅ {met}/{total} met{, 🔗 {k} in PR {other}}{, ❌ {x} not met}

> {1–2 sentences: what blocks merge, or why it is clean}

| # | Severity | Location | Rule | Issue | Fix |
|---|----------|----------|------|-------|-----|
| 1 | 🟠 Major | `StudentKeyStaffService.cs:68` | Bug | Passes a school account id where a school profile id is required, so no Wellbeing Lead row is ever returned. | Use `GetTeacherSchoolProfileIdAsync`. |
| 2 | 🟡 Minor | `StudentKeyStaffService.cs:26,28` | Perf R1 | Two independent lookups are awaited one after the other. | Start both, `await Task.WhenAll`. |

<details><summary>Fix sketches</summary>

**#1**
```{lang}
// ≤ 8 lines
```

</details>

<details><summary>Requirements gaps — {ticket id}</summary>

| AC | Requirement | Status | Gap |
|----|-------------|--------|-----|
| 2 | {≤ 15 words} | ⚠️ Partial | {≤ 12 words: which path is missing} |

</details>

<sub>Standards: {standards} · BMad review lenses · Out of scope: {non-code files, or "none"}</sub>
````

Requirements gaps table rules: list **only problem criteria** (⚠️ Partial or
❌ Not met). Met, Other PR and Out of scope criteria stay out of the comment;
the `**Requirements:**` line already counts them. When there are no gaps, omit
the `<details>` block entirely. Requirement ≤ 15 words (paraphrase, don't paste
the ticket); Gap ≤ 12 words. Each gap row is also a Major row in the findings
table (`Rule`: `AC<n>`).

**Clean PR** (no findings): keep only the heading, the score/merge/coverage
line, the requirements line, a one-sentence summary, and the standards footer.
No findings table, no requirements gaps block.

## Chat summary (after writing the file)

Print, in this order:

1. PR: provider, repository, `#id`, title, source → target branch.
2. Rules used: the project rules file (repo or user level) or "generic best practices".
3. Verdict, merge assessment, score, counts by severity, coverage `read/ledger`.
4. Laya: the summary line from `classify-findings.mjs` and any re-check results, or
   `Laya off` / `Laya unavailable`.
5. The top findings (Critical and Major rows, at most 5), one line each.
6. Report path. If `--post` was given, continue with references/posting.md; otherwise say
   nothing was posted.
