// outcome-labels.mjs — outcome labels for a reviewed PR: was each finding's code changed afterwards?
//
//   node outcome-labels.mjs --pr <url|id> --run <run folder> [--repo-dir <checkout>] [--out <file.jsonl>]
//                           [--context 5] [--provider laya|jev] [--no-fetch]
//
// Read-only: one `az repos pr show` / `gh pr view` / `glab mr view` call for the PR's current state
// and head commit, then git in a local checkout (`git cat-file`, `git fetch` only when a commit is
// missing, `git diff`). Nothing is written to the provider or to the checkout's working tree.
//
// For a PR that was reviewed and later updated or completed, the review's head commit (sourceCommit
// in the run's pr-<id>.json) is diffed against the PR's final head (rename detection on, -U0). Each
// finding is labelled from the cited region (line ± context, through endLine when given):
//   fixed         a hunk of the later diff touches the region (lines changed, removed or inserted inside)
//   unchanged     no hunk touches the region (code above may have moved it; the new location is logged)
//   file-removed  the cited file was deleted afterwards (ambiguous: left without a "human" label)
// A finding without a line uses the whole file. Rows are written for laya-eval.mjs with
// human = fixed|unchanged and source = "outcome" (default <run>/pr-<id>.outcome.jsonl).
// Outcome is a weak label: "fixed" means the code changed near the finding, not that the finding
// was right; "unchanged" on a merged PR suggests the point was not acted on.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, defaultRunner, runJson, runText } from './providers.mjs';
import { resolveTarget } from './pr-fetch.mjs';
import { normLabel } from './laya-severity.mjs';

export const CONTEXT = 5;

const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();

// ---------------------------------------------------------------------------
// Diff parsing and labelling (pure)
// ---------------------------------------------------------------------------

/**
 * Parses `git diff -M -U0` output into files:
 *   [{ oldPath, path, changeType: 'modified'|'added'|'deleted'|'renamed', hunks: [{ oldStart, oldCount, newStart, newCount }] }]
 */
export function parseHunks(text) {
  const files = [];
  let f = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      f = { oldPath: m ? m[1] : null, path: m ? m[2] : null, changeType: 'modified', hunks: [] };
      files.push(f);
      continue;
    }
    if (!f) continue;
    if (line.startsWith('new file mode')) { f.changeType = 'added'; f.oldPath = null; }
    else if (line.startsWith('deleted file mode')) f.changeType = 'deleted';
    else if (line.startsWith('rename from ')) { f.oldPath = line.slice(12); f.changeType = 'renamed'; }
    else if (line.startsWith('rename to ')) f.path = line.slice(10);
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) f.hunks.push({ oldStart: Number(h[1]), oldCount: h[2] == null ? 1 : Number(h[2]), newStart: Number(h[3]), newCount: h[4] == null ? 1 : Number(h[4]) });
  }
  return files;
}

/** Does a hunk touch old-side lines [lo, hi]? A pure insertion counts when it lands inside or right next to the region. */
export function hunkTouches(h, lo, hi) {
  if (h.oldCount === 0) return h.oldStart >= lo - 1 && h.oldStart <= hi; // inserted after old line oldStart
  return h.oldStart <= hi && h.oldStart + h.oldCount - 1 >= lo;
}

/** New-side position of old line n when no hunk touches it (shift by the hunks before it). */
export function mapLine(hunks, n) {
  let shift = 0;
  for (const h of hunks) {
    const end = h.oldCount === 0 ? h.oldStart : h.oldStart + h.oldCount - 1;
    if (end < n) shift += h.newCount - h.oldCount;
  }
  return n + shift;
}

/**
 * One finding's outcome. files = parseHunks(diff of review head → final head).
 * Returns { label, region, file, newFile, newRegion, hunks }.
 */
export function labelFinding(f, files, { context = CONTEXT } = {}) {
  const file = normPath(f.file);
  if (!file) return { label: null, reason: 'finding cites no file' };
  const d = files.find((x) => x.changeType !== 'added' && normPath(x.oldPath ?? x.path) === file);
  const line = Number(f.line);
  const hasLine = Number.isInteger(line) && line > 0;
  const end = hasLine && Number.isInteger(Number(f.endLine)) && Number(f.endLine) >= line ? Number(f.endLine) : line;
  const region = hasLine ? [Math.max(1, line - context), end + context] : 'whole-file';
  if (!d) return { label: 'unchanged', file, region, newFile: file, newRegion: region, hunks: 0 };
  if (d.changeType === 'deleted') return { label: 'file-removed', file, region, newFile: null, newRegion: null, hunks: d.hunks.length };
  const newFile = normPath(d.path);
  if (!hasLine) {
    return { label: d.hunks.length ? 'fixed' : 'unchanged', file, region, newFile, newRegion: region, hunks: d.hunks.length };
  }
  const touching = d.hunks.filter((h) => hunkTouches(h, region[0], region[1]));
  return {
    label: touching.length ? 'fixed' : 'unchanged',
    file, region, newFile,
    newRegion: touching.length ? null : [mapLine(d.hunks, region[0]), mapLine(d.hunks, region[1])],
    hunks: touching.length,
  };
}

const answerOf = (r) => (r?.laya ? { label: r.laya.label, confidence: r.laya.confidence } : null);

/**
 * Rows for laya-eval.mjs: one per finding, human = fixed|unchanged (null for file-removed), source "outcome".
 * logs = { laya?: <pr-<id>.laya.json>, jev?: <pr-<id>.jev.json> }; provider picks the `laya` field.
 */
export function buildRows({ prJson, findings, logs = {}, labels, finalState, provider }) {
  const prKey = prJson.repoId && prJson.id != null ? `${prJson.repoId}#${prJson.id}` : `pr-${prJson.id}`;
  const pick = provider && logs[provider] ? provider : Object.keys(logs)[0] ?? null;
  const byId = (log) => new Map((log?.results ?? []).map((r) => [r.id, r]));
  const maps = Object.fromEntries(Object.entries(logs).map(([p, l]) => [p, byId(l)]));
  return findings.map((f, i) => {
    const o = labels[i];
    const res = pick ? maps[pick].get(f.id) : null;
    const answers = Object.fromEntries(Object.keys(logs).map((p) => [p, answerOf(maps[p].get(f.id))]));
    const extra = (key) => Object.fromEntries(Object.keys(logs).map((p) => [p, maps[p].get(f.id)?.[key]?.answer ?? null]));
    return {
      key: `${prKey}/${f.id}`,
      pr: prKey,
      id: f.id,
      rule: f.rule ?? null, issue: f.issue ?? null, evidence: f.evidence ?? null, impact: f.impact ?? null,
      file: f.file ?? null, line: f.line ?? null,
      claude: res?.claude ?? normLabel(f.severity),
      final: res?.final ?? normLabel(f.severity),
      laya: answerOf(res),
      provider: pick,
      answers,
      introducedByPr: extra('introducedByPr'),
      alreadyRaised: extra('alreadyRaised'),
      prMerge: pick && logs[pick].merge?.laya ? { label: logs[pick].merge.laya.label, confidence: logs[pick].merge.laya.confidence } : null,
      human: o.label === 'fixed' || o.label === 'unchanged' ? o.label : null,
      source: 'outcome',
      outcome: { ...o, reviewHead: prJson.sourceCommit ?? null, finalHead: finalState.head, prState: finalState.state },
    };
  });
}

// ---------------------------------------------------------------------------
// Provider and git (read-only)
// ---------------------------------------------------------------------------

/** Current state and head commit of the PR: { state: active|completed|abandoned|..., head, sourceBranch }. */
export function finalState(c, { run }) {
  if (c.provider === 'azure-devops') {
    const pr = runJson(run, 'az', ['repos', 'pr', 'show', '--id', String(c.id), '--org', `https://dev.azure.com/${encodeURIComponent(c.org)}`, '-o', 'json']);
    return { state: pr?.status ?? null, head: pr?.lastMergeSourceCommit?.commitId ?? null, sourceBranch: String(pr?.sourceRefName ?? '').replace(/^refs\/heads\//, '') || null };
  }
  if (c.provider === 'github') {
    const repoArg = c.host === 'github.com' ? c.path : `${c.host}/${c.path}`;
    const pr = runJson(run, 'gh', ['pr', 'view', String(c.id), '--repo', repoArg, '--json', 'state,headRefOid,headRefName']);
    return { state: String(pr?.state ?? '').toLowerCase() || null, head: pr?.headRefOid ?? null, sourceBranch: pr?.headRefName ?? null };
  }
  if (c.provider === 'gitlab') {
    const repoArg = c.host === 'gitlab.com' ? c.path : `https://${c.host}/${c.path}`;
    const mr = runJson(run, 'glab', ['mr', 'view', String(c.id), '--repo', repoArg, '--output', 'json']);
    return { state: mr?.state ?? null, head: mr?.diff_refs?.head_sha ?? mr?.sha ?? null, sourceBranch: mr?.source_branch ?? null };
  }
  throw new CliError(`Unknown provider "${c.provider}"`, { code: 'USAGE' });
}

const hasCommit = (run, dir, sha) => run('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`]).status === 0;

/** Makes sure both commits are in the checkout (fetching the source branch, then the sha, only if missing). */
export function ensureCommits(run, dir, shas, { sourceBranch, noFetch = false } = {}) {
  const missing = () => shas.filter((s) => !hasCommit(run, dir, s));
  if (!missing().length) return;
  if (noFetch) throw new CliError(`commit(s) ${missing().map((s) => s.slice(0, 8)).join(', ')} not in ${dir} (--no-fetch)`, { code: 'CLI_FAILED' });
  if (sourceBranch) run('git', ['-C', dir, 'fetch', '--quiet', 'origin', `refs/heads/${sourceBranch}`]);
  for (const s of missing()) run('git', ['-C', dir, 'fetch', '--quiet', 'origin', s]);
  const still = missing();
  if (still.length) throw new CliError(`commit(s) ${still.map((s) => s.slice(0, 8)).join(', ')} could not be fetched into ${dir}`, { code: 'CLI_FAILED', hint: 'Fetch the PR source branch in the checkout, or pass --repo-dir <checkout of the PR repository>.' });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--pr', '--run', '--repo-dir', '--out', '--context', '--provider'].includes(t)) a[t.slice(2).replace('-d', 'D')] = argv[++i];
    else if (t === '--no-fetch') a.noFetch = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return a;
}

const USAGE = 'Usage: node outcome-labels.mjs --pr <url|id> --run <run folder> [--repo-dir <checkout>] [--out <file.jsonl>] [--context 5] [--provider laya|jev] [--no-fetch]';

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

export async function main(argv = process.argv.slice(2), { log = console.log, error = console.error, run = defaultRunner } = {}) {
  let a;
  try { a = parseArgs(argv); } catch (err) { error(err.message); error(USAGE); return 1; }
  if (a.help) { log(USAGE); return 0; }
  if (!a.pr || !a.run) { error(USAGE); return 1; }
  try {
    const runDir = path.resolve(a.run);
    const prFile = fs.readdirSync(runDir).find((f) => /^pr-\d+\.json$/.test(f));
    if (!prFile) throw new Error(`no pr-<id>.json in ${runDir}`);
    const stem = prFile.replace(/\.json$/, '');
    const prJson = readJson(path.join(runDir, prFile));
    const findingsRaw = readJson(path.join(runDir, `${stem}.findings.json`));
    const findings = Array.isArray(findingsRaw) ? findingsRaw : findingsRaw.findings ?? [];
    const repoDir = path.resolve(a.repoDir ?? prJson.repoDir ?? process.cwd());
    const c = resolveTarget(/^\d+$/.test(String(a.pr).trim()) && prJson.url ? prJson.url : a.pr, { repoDir });
    if (Number(c.id) !== Number(prJson.id)) throw new Error(`--pr is PR ${c.id} but the run folder is for PR ${prJson.id}`);
    const reviewHead = prJson.sourceCommit;
    if (!reviewHead) throw new Error(`${prFile} has no sourceCommit (review head)`);
    const fin = finalState(c, { run });
    if (!fin.head) throw new Error('the provider returned no head commit for the PR');
    const changed = fin.head !== reviewHead;
    const done = /^(completed|merged|closed|abandoned)$/i.test(fin.state ?? '');
    if (!changed && !done) {
      log(`PR ${prJson.id} is ${fin.state ?? 'open'} and not updated since the review (head ${reviewHead.slice(0, 8)}): no outcome yet, nothing written`);
      return 0;
    }
    let files = [];
    if (changed) {
      ensureCommits(run, repoDir, [reviewHead, fin.head], { sourceBranch: fin.sourceBranch, noFetch: a.noFetch });
      files = parseHunks(runText(run, 'git', ['-C', repoDir, 'diff', '--text', '-M', '-U0', '--no-color', reviewHead, fin.head]));
    }
    const context = a.context != null ? Number(a.context) : CONTEXT;
    const labels = findings.map((f) => labelFinding(f, files, { context }));
    const logs = {};
    for (const p of ['laya', 'jev']) {
      const lf = path.join(runDir, `${stem}.${p}.json`);
      if (fs.existsSync(lf)) logs[p] = readJson(lf);
    }
    const rows = buildRows({ prJson, findings, logs, labels, finalState: fin, provider: a.provider });
    const out = path.resolve(a.out ?? path.join(runDir, `${stem}.outcome.jsonl`));
    fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    const n = (l) => labels.filter((x) => x.label === l).length;
    log(`PR ${prJson.id} ${fin.state ?? '?'}: review head ${reviewHead.slice(0, 8)} → final head ${fin.head.slice(0, 8)}${changed ? '' : ' (no later commits)'}; context ±${context}`);
    for (const [i, f] of findings.entries()) {
      const o = labels[i];
      log(`  ${f.id} ${o.label ?? 'skipped'}${o.reason ? ` (${o.reason})` : ''} ${o.file ?? ''}${Array.isArray(o.region) ? `:${o.region[0]}-${o.region[1]}` : ''}${o.newFile && o.newFile !== o.file ? ` → ${o.newFile}` : ''}${Array.isArray(o.newRegion) && o.newRegion[0] !== o.region[0] ? ` (now ${o.newRegion[0]}-${o.newRegion[1]})` : ''}`);
    }
    log(`fixed=${n('fixed')} unchanged=${n('unchanged')} file-removed=${n('file-removed')} skipped=${labels.filter((x) => !x.label).length} → ${out}`);
    return 0;
  } catch (err) {
    error(`outcome-labels: ${err.message}${err.hint ? ` (${err.hint})` : ''}`);
    return err.code === 'CLI_MISSING' || err.code === 'CLI_AUTH' ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
