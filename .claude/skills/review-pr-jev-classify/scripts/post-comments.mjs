// post-comments.mjs — post review comments to a pull request. DRY-RUN BY DEFAULT.
//
//   node post-comments.mjs --pr <pr.json> --comments <comments.json> [--json]
//       dry run: prints exactly what would be posted and where; changes nothing.
//   node post-comments.mjs --pr <pr.json> --comments <comments.json> --post --confirm <pr-id>
//       posts. --confirm must repeat the PR id, so a stray --post cannot hit the wrong PR.
//
// <pr.json> is the file written by pr-fetch.mjs. <comments.json>:
//   { "summary": "<markdown review summary>",
//     "comments": [ { "file": "src/app.ts", "line": 42, "body": "<markdown>" } ] }
// Inline comments must target a new-side line that is in the diff; others are moved into
// the summary under "Comments outside the diff" (providers reject them inline).
//
//   Azure DevOps  one thread for the summary + one thread per inline comment (file/line context)
//   GitHub        one review (event COMMENT) with the summary as body and inline comments
//   GitLab        one note for the summary + one discussion per inline comment (position)
// Never approves, rejects or votes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError, defaultRunner, parseUnifiedDiff, runJson } from './providers.mjs';

export const MAX_BODY = 60000;

function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw new Error(`Cannot read ${label} ${file}: ${err.message}`);
  }
}

/** Validates the comments input; returns { summary, comments } or throws. */
export function validateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('comments file must be a JSON object');
  const summary = typeof input.summary === 'string' ? input.summary : '';
  const comments = Array.isArray(input.comments) ? input.comments : [];
  comments.forEach((c, i) => {
    if (!c || typeof c.file !== 'string' || !c.file) throw new Error(`comments[${i}].file is required`);
    if (!Number.isInteger(c.line) || c.line < 1) throw new Error(`comments[${i}].line must be a positive integer`);
    if (typeof c.body !== 'string' || !c.body.trim()) throw new Error(`comments[${i}].body is required`);
  });
  if (!summary.trim() && !comments.length) throw new Error('nothing to post: summary and comments are both empty');
  for (const b of [summary, ...comments.map((c) => c.body)]) {
    if (b.length > MAX_BODY) throw new Error(`a comment body is ${b.length} characters (max ${MAX_BODY}); shorten it`);
  }
  return { summary, comments: comments.map((c) => ({ file: c.file.replace(/^\/+/, ''), line: c.line, body: c.body })) };
}

/** Map of file path -> Set of new-side line numbers present in the diff. */
export function commentableLines(diffText) {
  const map = new Map();
  for (const f of parseUnifiedDiff(diffText ?? '')) if (f.path) map.set(f.path, new Set(f.rightLines));
  return map;
}

function outsideSection(list) {
  if (!list.length) return '';
  const rows = list.map((c) => `- \`${c.file}:${c.line}\` — ${c.body.replace(/\s*\r?\n\s*/g, ' ')}`);
  return `\n\n### Comments outside the diff\n\n${rows.join('\n')}`;
}

/**
 * Builds the posting plan without running anything.
 * Returns { provider, pr: {id, url}, actions: [{ kind, file?, line?, body, cmd, args, payload }], moved: [...] }.
 * `args` contains the literal token "<payload-file>" where the payload file path goes.
 */
export function buildPlan(pr, input, diffText) {
  const { summary, comments } = validateInput(input);
  const lines = commentableLines(diffText);
  const haveDiff = lines.size > 0;
  const inline = [];
  const moved = [];
  for (const c of comments) {
    if (haveDiff && lines.get(c.file)?.has(c.line)) inline.push(c);
    else moved.push({ ...c, reason: haveDiff ? 'line not in the diff' : 'no diff available to anchor the comment' });
  }
  const pd = pr.providerData ?? {};
  const actions = [];
  const fullSummary = (summary + outsideSection(moved)).trim();

  if (pr.provider === 'azure-devops') {
    const route = ['--route-parameters', `project=${pd.projectId ?? pd.projectName ?? pr.project}`, `repositoryId=${pd.repositoryId ?? pd.repositoryName ?? pr.repo}`, `pullRequestId=${pr.id}`];
    const base = ['devops', 'invoke', '--area', 'git', '--resource', 'pullRequestThreads', ...route,
      '--org', pd.orgUrl ?? `https://dev.azure.com/${encodeURIComponent(pr.org)}`, '--api-version', '7.0',
      '--http-method', 'POST', '--in-file', '<payload-file>', '-o', 'json'];
    if (fullSummary) {
      actions.push({ kind: 'summary', body: fullSummary, cmd: 'az', args: base,
        payload: { comments: [{ parentCommentId: 0, content: fullSummary, commentType: 1 }], status: 1 } });
    }
    for (const c of inline) {
      actions.push({ kind: 'inline', file: c.file, line: c.line, body: c.body, cmd: 'az', args: base,
        payload: {
          comments: [{ parentCommentId: 0, content: c.body, commentType: 1 }],
          status: 1,
          threadContext: { filePath: `/${c.file}`, rightFileStart: { line: c.line, offset: 1 }, rightFileEnd: { line: c.line, offset: 1 } },
        } });
    }
  } else if (pr.provider === 'github') {
    const host = pd.hostname && pd.hostname !== 'github.com' ? ['--hostname', pd.hostname] : [];
    const payload = { body: fullSummary, event: 'COMMENT', comments: inline.map((c) => ({ path: c.file, line: c.line, side: 'RIGHT', body: c.body })) };
    if (pr.sourceCommit) payload.commit_id = pr.sourceCommit;
    actions.push({ kind: 'review', body: fullSummary, inline: inline.length, cmd: 'gh',
      args: ['api', ...host, `repos/${pr.repoPath}/pulls/${pr.id}/reviews`, '--method', 'POST', '--input', '<payload-file>'], payload });
  } else if (pr.provider === 'gitlab') {
    const host = pd.hostname && pd.hostname !== 'gitlab.com' ? ['--hostname', pd.hostname] : [];
    const enc = encodeURIComponent(pd.projectPath ?? pr.repoPath);
    const refs = pd.diffRefs;
    const anchored = refs?.base_sha && refs?.head_sha && refs?.start_sha ? inline : [];
    const unanchored = anchored === inline ? [] : inline.map((c) => ({ ...c, reason: 'merge request has no diff refs' }));
    moved.push(...unanchored);
    const body = (summary + outsideSection(moved)).trim();
    const api = (endpoint) => ['api', ...host, `projects/${enc}/merge_requests/${pr.id}/${endpoint}`, '--method', 'POST',
      '--header', 'Content-Type: application/json', '--input', '<payload-file>'];
    if (body) actions.push({ kind: 'summary', body, cmd: 'glab', args: api('notes'), payload: { body } });
    for (const c of anchored) {
      const file = (pr.files ?? []).find((f) => f.path === c.file);
      actions.push({ kind: 'inline', file: c.file, line: c.line, body: c.body, cmd: 'glab', args: api('discussions'),
        payload: { body: c.body, position: { position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha,
          new_path: c.file, old_path: file?.oldPath ?? c.file, new_line: c.line } } });
    }
  } else {
    throw new Error(`Unsupported provider: ${pr.provider}`);
  }
  return { provider: pr.provider, pr: { id: pr.id, url: pr.url, repo: pr.repoPath }, actions, moved };
}

/** Human-readable dry-run text: every body exactly as it would be posted. */
export function formatPlan(plan) {
  const out = [`DRY RUN — nothing posted. Target: ${plan.provider} ${plan.pr.repo} PR ${plan.pr.id} (${plan.pr.url})`, ''];
  plan.actions.forEach((a, i) => {
    const where = a.kind === 'inline' ? ` ${a.file}:${a.line}` : a.kind === 'review' ? ` (+${a.inline} inline comment(s))` : '';
    out.push(`--- [${i + 1}] ${a.kind}${where} ---`);
    out.push(a.body || '(empty body)');
    if (a.kind === 'review') {
      for (const c of a.payload.comments) out.push('', `    > inline ${c.path}:${c.line}`, ...c.body.split(/\r?\n/).map((l) => `    ${l}`));
    }
    out.push('');
  });
  if (plan.moved.length) {
    out.push(`${plan.moved.length} comment(s) moved into the summary (not anchorable inline):`);
    for (const m of plan.moved) out.push(`  - ${m.file}:${m.line} (${m.reason})`);
  }
  out.push('', `${plan.actions.length} request(s) would be sent. To post: add --post --confirm ${plan.pr.id}`);
  return out.join('\n');
}

/** Executes a plan with the runner. Returns [{ index, kind, ok, error?, id? }]. */
export function executePlan(plan, { run = defaultRunner, tmpDir = os.tmpdir() } = {}) {
  const results = [];
  plan.actions.forEach((a, index) => {
    const file = path.join(tmpDir, `review-pr-${process.pid}-${Date.now()}-${index}.json`);
    fs.writeFileSync(file, JSON.stringify(a.payload), 'utf8');
    try {
      const res = runJson(run, a.cmd, a.args.map((x) => (x === '<payload-file>' ? file : x)));
      results.push({ index: index + 1, kind: a.kind, ok: true, id: res?.id ?? null });
    } catch (err) {
      results.push({ index: index + 1, kind: a.kind, ok: false, error: `${err.message}${err.hint ? ` (${err.hint})` : ''}` });
    } finally {
      try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
    }
  });
  return results;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--pr', '--comments', '--confirm'].includes(t)) a[t.slice(2)] = argv[++i];
    else if (t === '--post') a.post = true;
    else if (t === '--json') a.json = true;
    else if (t === '-h' || t === '--help') a.help = true;
    else throw new CliError(`Unknown argument: ${t}`, { code: 'USAGE' });
  }
  return a;
}

const USAGE = 'Usage: node post-comments.mjs --pr <pr.json> --comments <comments.json> [--json] [--post --confirm <pr-id>]';

export function main(argv = process.argv.slice(2), { run = defaultRunner, log = console.log, error = console.error } = {}) {
  try {
    const a = parseArgs(argv);
    if (a.help) { log(USAGE); return 0; }
    if (!a.pr || !a.comments) { error(USAGE); return 1; }
    const pr = readJsonFile(path.resolve(a.pr), 'PR file');
    const input = readJsonFile(path.resolve(a.comments), 'comments file');
    const diffText = pr.diff?.file && fs.existsSync(pr.diff.file) ? fs.readFileSync(pr.diff.file, 'utf8') : pr.diff?.text ?? '';
    const plan = buildPlan(pr, input, diffText);
    if (!a.post) {
      log(a.json ? JSON.stringify({ dryRun: true, ...plan }, null, 2) : formatPlan(plan));
      return 0;
    }
    if (String(a.confirm ?? '') !== String(pr.id)) {
      error(`Refusing to post: --confirm must equal the PR id (${pr.id}).`);
      return 1;
    }
    const results = executePlan(plan, { run });
    log(JSON.stringify({ posted: true, pr: plan.pr, results, moved: plan.moved.length }, null, 2));
    return results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    error(`post-comments: ${err.message}`);
    if (err.code === 'USAGE') error(USAGE);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
