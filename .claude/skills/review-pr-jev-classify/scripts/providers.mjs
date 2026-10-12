// providers.mjs — pull-request provider support for review-pr (Azure DevOps, GitHub, GitLab).
// Zero dependencies, Node >= 18. Used by pr-fetch.mjs and post-comments.mjs.
//
// Everything that talks to a provider goes through a command runner
// `run(cmd, args, { cwd }) -> { status, stdout, stderr, error }` so tests can inject canned
// CLI output. The real runner calls the provider CLIs: `az` (with the azure-devops
// extension), `gh`, `glab`. Nothing here writes to a provider; posting lives in
// post-comments.mjs.
import { spawnSync } from 'node:child_process';

export const PROVIDERS = ['azure-devops', 'github', 'gitlab'];

// ---------------------------------------------------------------------------
// URL / remote parsing
// ---------------------------------------------------------------------------

function dec(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Splits a URL or scp-like git address into { host, parts[] } (credentials, port, query removed). */
export function splitAddress(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?/i.exec(s);
  if (!m) {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)([^?#]*)$/.exec(s);
    if (!scp || scp[1].length < 2) return null; // 1 char = Windows drive letter
    m = [null, scp[1], `/${scp[2]}`];
  }
  const parts = (m[2] ?? '').split('/').filter(Boolean).map(dec);
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/i, '');
  return { host: m[1].toLowerCase(), parts };
}

/** Provider for a host name, or null when it cannot be told from the host alone. */
export function providerForHost(host) {
  if (!host) return null;
  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || /\.visualstudio\.com$/.test(host)) return 'azure-devops';
  if (host === 'github.com' || /(^|\.)github\./.test(host)) return 'github';
  if (host === 'gitlab.com' || /(^|\.)gitlab\./.test(host)) return 'gitlab';
  return null;
}

/** Azure DevOps { org, project, repo, rest[] } from host + path parts (https, ssh and legacy forms). */
function adoCoords(host, parts) {
  let p = [...parts];
  let org;
  if (host === 'ssh.dev.azure.com' || /(^|\.)vs-ssh\.visualstudio\.com$/.test(host)) {
    if (p[0] === 'v3') p = p.slice(1);
    // ssh: v3/org/project/repo
    if (p.length < 3) return null;
    return { org: p[0], project: p[1], repo: p[2], rest: p.slice(3) };
  }
  const legacy = /^([^.]+)\.visualstudio\.com$/.exec(host);
  if (legacy) {
    org = legacy[1];
    if (p[0] && p[0].toLowerCase() === 'defaultcollection') p = p.slice(1);
  } else {
    org = p.shift();
  }
  const gi = p.indexOf('_git');
  if (!org || gi === -1 || !p[gi + 1]) return null;
  const project = gi === 0 ? p[gi + 1] : p.slice(0, gi).join('/');
  return { org, project, repo: p[gi + 1], rest: p.slice(gi + 2) };
}

/**
 * Parses a pull-request / merge-request web URL. Returns
 *   { provider, host, org?, project?, repo, path, id }  or null.
 * `path` is the repository path the CLI wants: GitHub `owner/repo`, GitLab `group/sub/repo`,
 * Azure DevOps `org/project/repo`. `provider` may be forced for self-hosted hosts.
 */
export function parsePrUrl(url, { provider: forced } = {}) {
  const a = splitAddress(url);
  if (!a || !/^[a-z][a-z0-9+.-]*:\/\//i.test(String(url).trim())) return null;
  const { host, parts } = a;
  const provider = forced ?? providerForHost(host) ??
    (parts.includes('-') && /^merge_requests$/i.test(parts[parts.indexOf('-') + 1] ?? '') ? 'gitlab' : null) ??
    (/^pull$/.test(parts[2] ?? '') ? 'github' : null);

  if (provider === 'azure-devops') {
    const c = adoCoords(host, parts);
    if (!c) return null;
    const pi = c.rest.findIndex((x) => /^pullrequest$/i.test(x));
    const id = pi === -1 ? null : c.rest[pi + 1];
    if (!id || !/^\d+$/.test(id)) return null;
    return { provider, host: 'dev.azure.com', org: c.org, project: c.project, repo: c.repo, path: `${c.org}/${c.project}/${c.repo}`, id: Number(id) };
  }
  if (provider === 'github') {
    const pi = parts.indexOf('pull');
    if (pi < 2 || !/^\d+$/.test(parts[pi + 1] ?? '')) return null;
    return { provider, host, owner: parts[0], repo: parts[1], path: `${parts[0]}/${parts[1]}`, id: Number(parts[pi + 1]) };
  }
  if (provider === 'gitlab') {
    const di = parts.indexOf('-');
    const repoParts = di === -1 ? null : parts.slice(0, di);
    if (!repoParts || repoParts.length < 2 || !/^merge_requests$/i.test(parts[di + 1] ?? '') || !/^\d+$/.test(parts[di + 2] ?? '')) return null;
    return { provider, host, repo: repoParts[repoParts.length - 1], path: repoParts.join('/'), id: Number(parts[di + 2]) };
  }
  return null;
}

/** Parses a git remote URL into repository coordinates (no PR id), or null. */
export function parseRemote(url, { provider: forced } = {}) {
  const a = splitAddress(url);
  if (!a) return null;
  const { host, parts } = a;
  const provider = forced ?? providerForHost(host);
  if (provider === 'azure-devops') {
    const c = adoCoords(host, parts);
    if (!c) return null;
    return { provider, host: 'dev.azure.com', org: c.org, project: c.project, repo: c.repo, path: `${c.org}/${c.project}/${c.repo}` };
  }
  if (provider === 'github') {
    if (parts.length < 2) return null;
    return { provider, host, owner: parts[0], repo: parts[1], path: `${parts[0]}/${parts[1]}` };
  }
  if (provider === 'gitlab') {
    if (parts.length < 2) return null;
    return { provider, host, repo: parts[parts.length - 1], path: parts.join('/') };
  }
  return null;
}

/** Canonical https URL of the repository (used for the repo-id and in reports). */
export function repoUrl(c) {
  if (c.provider === 'azure-devops') {
    const e = encodeURIComponent;
    return `https://dev.azure.com/${e(c.org)}/${e(c.project)}/_git/${e(c.repo)}`;
  }
  return `https://${c.host}/${c.path}`;
}

/** Web URL of the pull request. */
export function prWebUrl(c) {
  if (c.provider === 'azure-devops') return `${repoUrl(c)}/pullrequest/${c.id}`;
  if (c.provider === 'github') return `${repoUrl(c)}/pull/${c.id}`;
  return `${repoUrl(c)}/-/merge_requests/${c.id}`;
}

// ---------------------------------------------------------------------------
// Command runner and CLI errors
// ---------------------------------------------------------------------------

/** Quotes one argument for cmd.exe (only used for `az`, which is a .cmd script on Windows). */
export function quoteWin(arg) {
  const s = String(arg);
  if (/^[A-Za-z0-9_.,:/=@+\-\\$]+$/.test(s)) return s;
  if (/["%!^&|<>\r\n]/.test(s)) throw new Error(`Argument not safe to pass through cmd.exe: ${JSON.stringify(s)}`);
  return `"${s}"`;
}

/**
 * Default runner. On Windows `az` is `az.cmd`, which Node can only start through a shell,
 * so its command line is built from individually quoted arguments.
 */
export function defaultRunner(cmd, args = [], { cwd, platform = process.platform } = {}) {
  const viaShell = platform === 'win32' && cmd === 'az';
  const opts = { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 512 * 1024 * 1024 };
  const r = viaShell
    ? spawnSync([cmd, ...args].map(quoteWin).join(' '), { ...opts, shell: true })
    : spawnSync(cmd, args, opts);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

const CLI_HELP = {
  az: {
    name: 'Azure CLI',
    install: 'Install the Azure CLI (https://aka.ms/installazurecli), then run: az extension add --name azure-devops && az login',
    login: 'Not signed in to Azure DevOps. Run: az login (then retry). If your organisation uses a PAT, run: az devops login --organization <org-url>',
    auth: /az login|az devops login|AADSTS|TF400813|TF401019|\b401\b|\b403\b|unauthori[sz]ed|not authori[sz]ed|credentials|access token|expired/i,
  },
  gh: {
    name: 'GitHub CLI',
    install: 'Install the GitHub CLI (https://cli.github.com), then run: gh auth login',
    login: 'Not signed in to GitHub. Run: gh auth login (add --hostname <host> for GitHub Enterprise), then retry.',
    auth: /gh auth login|not logged in|authentication|HTTP 401|Bad credentials|requires authentication/i,
  },
  glab: {
    name: 'GitLab CLI',
    install: 'Install the GitLab CLI (https://gitlab.com/gitlab-org/cli), then run: glab auth login',
    login: 'Not signed in to GitLab. Run: glab auth login (add --hostname <host> for self-hosted GitLab), then retry.',
    auth: /glab auth login|not authenticated|unauthori[sz]ed|\b401\b|token/i,
  },
  git: {
    name: 'git',
    install: 'Install git (https://git-scm.com) and make sure it is on PATH.',
    login: 'git could not authenticate to the remote. Check your git credentials for this repository.',
    auth: /Authentication failed|could not read Username|Permission denied \(publickey\)/i,
  },
};

export class CliError extends Error {
  constructor(message, { code = 'CLI_FAILED', tool, hint, status } = {}) {
    super(message);
    this.code = code;
    this.tool = tool;
    this.hint = hint;
    this.status = status;
  }
}

/** Scrubs anything that looks like a bearer token / PAT from CLI text before it is shown. */
export function scrub(text) {
  return String(text ?? '')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{8,}/g, '$1***')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***@');
}

/** Turns a failed run result into a CliError with an actionable hint. */
export function cliError(tool, args, r) {
  const help = CLI_HELP[tool] ?? { name: tool, install: `Install ${tool}.`, login: `Sign in to ${tool}.`, auth: /$^/ };
  const text = `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
  const missing = r.error?.code === 'ENOENT' || /is not recognized as an internal or external command|command not found|No such file or directory/i.test(r.stderr ?? '');
  if (missing) {
    return new CliError(`${help.name} (${tool}) is not installed or not on PATH.`, { code: 'CLI_MISSING', tool, hint: help.install });
  }
  if (tool === 'az' && /'repos' is misspelled|'devops' is misspelled|az extension add/i.test(text)) {
    return new CliError('The Azure DevOps extension for the Azure CLI is not installed.', { code: 'CLI_MISSING', tool, hint: 'Run: az extension add --name azure-devops' });
  }
  if (help.auth.test(text)) {
    return new CliError(`${help.name} is not signed in or has no access to this repository.`, { code: 'CLI_AUTH', tool, hint: help.login, status: r.status });
  }
  const first = scrub(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ').slice(0, 400);
  return new CliError(`${tool} ${args.slice(0, 3).join(' ')} failed (exit ${r.status ?? 'n/a'}): ${first || 'no output'}`, { code: 'CLI_FAILED', tool, status: r.status });
}

/** Runs a command; returns stdout or throws CliError. */
export function runText(run, cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.error || r.status !== 0) throw cliError(cmd, args, r);
  return r.stdout;
}

/** Parses one or more concatenated JSON values (e.g. `gh api --paginate` output: `[..][..]`). */
export function parseJsonStream(text) {
  const out = [];
  const s = String(text ?? '');
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    let depth = 0;
    let inStr = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (ch === '\\') i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { i++; break; }
      } else if (depth === 0 && /\s/.test(ch)) break;
    }
    out.push(JSON.parse(s.slice(start, i)));
  }
  return out;
}

/** Runs a command and parses its JSON output (concatenated arrays from paginated calls are merged). */
export function runJson(run, cmd, args, opts = {}) {
  const text = runText(run, cmd, args, opts);
  const values = parseJsonStream(text);
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return values.every(Array.isArray) ? values.flat() : values;
}

// ---------------------------------------------------------------------------
// Unified diff parsing and secret scan
// ---------------------------------------------------------------------------

function stripDiffPath(p) {
  let s = p.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s === '/dev/null') return null;
  return s.replace(/^[ab]\//, '');
}

/**
 * Parses a unified git diff into files:
 *   [{ path, oldPath, changeType, additions, deletions, binary, rightLines: number[],
 *      added: [{ line, text }] }]
 * rightLines = new-side line numbers present in the diff (added + context) — the lines a
 * provider accepts inline comments on. `added` = the added lines (for the secret scan).
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let f = null;
  let newLine = 0;
  let inHunk = false;
  const lines = String(text ?? '').split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      f = { path: m ? m[2] : null, oldPath: m ? m[1] : null, changeType: 'modified', additions: 0, deletions: 0, binary: false, rightLines: [], added: [] };
      files.push(f);
      inHunk = false;
      continue;
    }
    if (!f) continue;
    if (!inHunk) {
      if (line.startsWith('new file mode')) f.changeType = 'added';
      else if (line.startsWith('deleted file mode')) f.changeType = 'deleted';
      else if (line.startsWith('rename from ')) { f.oldPath = line.slice(12); f.changeType = 'renamed'; }
      else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('copy to ')) { f.path = line.slice(8); f.changeType = 'copied'; }
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) f.binary = true;
      else if (line.startsWith('--- ')) { const p = stripDiffPath(line.slice(4)); if (p) f.oldPath = p; }
      else if (line.startsWith('+++ ')) { const p = stripDiffPath(line.slice(4)); if (p) f.path = p; }
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) { newLine = Number(h[1]); inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      f.additions++;
      f.rightLines.push(newLine);
      f.added.push({ line: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      f.deletions++;
    } else if (line.startsWith(' ')) {
      f.rightLines.push(newLine);
      newLine++;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file"
    } else {
      inHunk = false;
    }
  }
  for (const x of files) if (x.changeType !== 'renamed' && x.changeType !== 'copied') x.oldPath = x.changeType === 'added' ? null : x.oldPath;
  return files;
}

const SECRET_PATTERNS = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'aws-access-key', re: /\b(AKIA[0-9A-Z]{16})\b/ },
  { kind: 'github-token', re: /\b((?:gh[pousr]_[A-Za-z0-9]{30,})|(?:github_pat_[A-Za-z0-9_]{22,}))/ },
  { kind: 'gitlab-token', re: /\b(glpat-[A-Za-z0-9_-]{20,})/ },
  { kind: 'slack-token', re: /\b(xox[abprs]-[A-Za-z0-9-]{10,})/ },
  { kind: 'google-api-key', re: /\b(AIza[0-9A-Za-z_-]{35})\b/ },
  { kind: 'azure-storage-key', re: /AccountKey=([A-Za-z0-9+/=]{20,})/i },
  { kind: 'connection-string-password', re: /(?:Password|Pwd)=([^;'"\s]{6,})/i },
  { kind: 'jwt', re: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/ },
  { kind: 'assigned-secret', re: /(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret)["']?\s*[:=]\s*["']([^"'\s]{8,})["']/i },
];

/** Redacts a secret value: keeps the first 4 characters and the length. */
export function redact(value) {
  const v = String(value ?? '');
  return `${v.slice(0, 4)}****(${v.length} chars)`;
}

/**
 * Scans the added lines of parsed diff files for likely secrets. Never returns the secret:
 * only { file, line, kind, redacted }.
 */
export function scanSecrets(files) {
  const hits = [];
  for (const f of files) {
    for (const a of f.added ?? []) {
      for (const p of SECRET_PATTERNS) {
        const m = p.re.exec(a.text);
        if (!m) continue;
        // Placeholders are not secrets.
        const value = m[1] ?? m[0];
        if (/^(\$\{|<|\{\{|%|xxx|\*\*\*|changeme|placeholder|example)/i.test(value)) continue;
        hits.push({ file: f.path, line: a.line, kind: p.kind, redacted: p.kind === 'private-key' ? '-----BEGIN ... PRIVATE KEY----- (redacted)' : redact(value) });
        break;
      }
    }
  }
  return hits;
}

/** Work item references written in text: `AB#123` (Azure Boards), returned as strings. */
export function referencedWorkItems(...texts) {
  const ids = new Set();
  for (const t of texts) for (const m of String(t ?? '').matchAll(/\bAB#(\d+)\b/g)) ids.add(m[1]);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Provider adapters: fetch + normalize
// ---------------------------------------------------------------------------

function mapChangeType(t) {
  const s = String(t ?? '').toLowerCase();
  if (s.includes('rename')) return 'renamed';
  if (s.includes('add')) return 'added';
  if (s.includes('delete') || s.includes('removed')) return 'deleted';
  if (s.includes('cop')) return 'copied';
  return 'modified';
}

function stripRef(ref) {
  return ref ? String(ref).replace(/^refs\/heads\//, '') : null;
}

function tryStep(warnings, label, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    warnings.push(`${label}: ${err.message}${err.hint ? ` (${err.hint})` : ''}`);
    return fallback;
  }
}

/** Azure DevOps through `az repos` + `az devops invoke`. */
export function fetchAzureDevOps(c, { run }) {
  const warnings = [];
  const orgUrl = `https://dev.azure.com/${encodeURIComponent(c.org)}`;
  const pr = runJson(run, 'az', ['repos', 'pr', 'show', '--id', String(c.id), '--org', orgUrl, '-o', 'json']);
  const project = pr?.repository?.project ?? {};
  const projectRef = project.id ?? c.project;
  const repositoryId = pr?.repository?.id ?? c.repo;
  const invoke = (resource, extra = [], query = []) =>
    runJson(run, 'az', [
      'devops', 'invoke', '--area', 'git', '--resource', resource,
      '--route-parameters', `project=${projectRef}`, `repositoryId=${repositoryId}`, `pullRequestId=${c.id}`, ...extra,
      ...(query.length ? ['--query-parameters', ...query] : []),
      '--org', orgUrl, '--api-version', '7.0', '-o', 'json',
    ]);

  const iterations = tryStep(warnings, 'iterations', () => invoke('pullRequestIterations')?.value ?? [], []);
  const last = iterations.length ? Math.max(...iterations.map((i) => i.id)) : null;
  const changes = last == null ? [] : tryStep(warnings, 'changes',
    () => invoke('pullRequestIterationChanges', [`iterationId=${last}`], ['$top=2000'])?.changeEntries ?? [], []);
  const threads = tryStep(warnings, 'threads', () => invoke('pullRequestThreads')?.value ?? [], []);
  const workItems = tryStep(warnings, 'work items',
    () => runJson(run, 'az', ['repos', 'pr', 'work-item', 'list', '--id', String(c.id), '--org', orgUrl, '-o', 'json']) ?? [], []);

  const coords = { ...c, project: project.name ?? c.project, repo: pr?.repository?.name ?? c.repo };
  coords.path = `${coords.org}/${coords.project}/${coords.repo}`;
  return {
    coords,
    meta: {
      title: pr?.title ?? '',
      description: pr?.description ?? '',
      author: { name: pr?.createdBy?.displayName ?? null, login: pr?.createdBy?.uniqueName ?? null },
      state: pr?.status ?? null,
      isDraft: Boolean(pr?.isDraft),
      sourceBranch: stripRef(pr?.sourceRefName),
      targetBranch: stripRef(pr?.targetRefName),
      sourceCommit: pr?.lastMergeSourceCommit?.commitId ?? null,
      targetCommit: pr?.lastMergeTargetCommit?.commitId ?? null,
    },
    files: changes
      .filter((e) => e.item?.path && !e.item.isFolder)
      .map((e) => ({
        path: e.item.path.replace(/^\//, ''),
        changeType: mapChangeType(e.changeType),
        ...(e.originalPath || e.sourceServerItem ? { oldPath: String(e.originalPath ?? e.sourceServerItem).replace(/^\//, '') } : {}),
      })),
    diffText: null, // Azure DevOps has no diff endpoint in the CLI; computed locally with git.
    threads: threads
      .filter((t) => !t.isDeleted)
      .map((t) => {
        const comments = (t.comments ?? [])
          .filter((cm) => cm.commentType !== 'system' && !cm.isDeleted)
          .map((cm) => ({ author: cm.author?.displayName ?? null, body: cm.content ?? '', createdAt: cm.publishedDate ?? null }));
        const ctx = t.threadContext ?? null;
        return {
          id: String(t.id),
          status: t.status ?? null,
          resolved: t.status ? !['active', 'pending'].includes(t.status) : null,
          file: ctx?.filePath ? ctx.filePath.replace(/^\//, '') : null,
          line: ctx?.rightFileStart?.line ?? ctx?.leftFileStart?.line ?? null,
          comments,
        };
      })
      .filter((t) => t.comments.length),
    workItems: (Array.isArray(workItems) ? workItems : []).map((w) => ({
      id: String(w.id),
      title: w.fields?.['System.Title'] ?? null,
      type: w.fields?.['System.WorkItemType'] ?? null,
      state: w.fields?.['System.State'] ?? null,
      url: w._links?.html?.href ?? null,
    })),
    providerData: {
      orgUrl,
      projectId: project.id ?? null,
      projectName: project.name ?? c.project ?? null,
      repositoryId: pr?.repository?.id ?? null,
      repositoryName: pr?.repository?.name ?? c.repo,
      lastIterationId: last,
    },
    warnings,
  };
}

const GH_FIELDS = ['number', 'title', 'body', 'author', 'state', 'isDraft', 'baseRefName', 'headRefName', 'baseRefOid', 'headRefOid', 'files', 'url', 'comments', 'reviews'];

/** GitHub through `gh pr view`, `gh pr diff`, `gh api`. */
export function fetchGitHub(c, { run }) {
  const warnings = [];
  const repoArg = c.host === 'github.com' ? c.path : `${c.host}/${c.path}`;
  const hostArgs = c.host === 'github.com' ? [] : ['--hostname', c.host];
  let pr;
  try {
    pr = runJson(run, 'gh', ['pr', 'view', String(c.id), '--repo', repoArg, '--json', [...GH_FIELDS, 'closingIssuesReferences'].join(',')]);
  } catch (err) {
    if (!/Unknown JSON field|closingIssuesReferences/i.test(err.message)) throw err;
    pr = runJson(run, 'gh', ['pr', 'view', String(c.id), '--repo', repoArg, '--json', GH_FIELDS.join(',')]);
  }
  const diffText = tryStep(warnings, 'diff', () => runText(run, 'gh', ['pr', 'diff', String(c.id), '--repo', repoArg]), null);
  const inline = tryStep(warnings, 'review comments',
    () => runJson(run, 'gh', ['api', ...hostArgs, `repos/${c.path}/pulls/${c.id}/comments?per_page=100`, '--paginate']) ?? [], []);

  const threads = [];
  for (const cm of pr?.comments ?? []) {
    threads.push({ id: `comment-${threads.length + 1}`, status: null, resolved: null, file: null, line: null,
      comments: [{ author: cm.author?.login ?? null, body: cm.body ?? '', createdAt: cm.createdAt ?? null }] });
  }
  for (const rv of pr?.reviews ?? []) {
    if (!rv.body) continue;
    threads.push({ id: `review-${rv.id ?? threads.length + 1}`, status: rv.state ?? null, resolved: null, file: null, line: null,
      comments: [{ author: rv.author?.login ?? null, body: rv.body, createdAt: rv.submittedAt ?? null }] });
  }
  const roots = new Map();
  for (const cm of Array.isArray(inline) ? inline : []) {
    const rootId = cm.in_reply_to_id ?? cm.id;
    if (!roots.has(rootId)) {
      roots.set(rootId, { id: String(rootId), status: null, resolved: null, file: cm.path ?? null, line: cm.line ?? cm.original_line ?? null, comments: [] });
    }
    roots.get(rootId).comments.push({ author: cm.user?.login ?? null, body: cm.body ?? '', createdAt: cm.created_at ?? null });
  }
  threads.push(...roots.values());

  return {
    coords: c,
    meta: {
      title: pr?.title ?? '',
      description: pr?.body ?? '',
      author: { name: pr?.author?.name || null, login: pr?.author?.login ?? null },
      state: pr?.state ? String(pr.state).toLowerCase() : null,
      isDraft: Boolean(pr?.isDraft),
      sourceBranch: pr?.headRefName ?? null,
      targetBranch: pr?.baseRefName ?? null,
      sourceCommit: pr?.headRefOid ?? null,
      targetCommit: pr?.baseRefOid ?? null,
    },
    files: (pr?.files ?? []).map((f) => ({
      path: f.path,
      changeType: f.changeType ? mapChangeType(f.changeType) : null,
      additions: f.additions ?? null,
      deletions: f.deletions ?? null,
    })),
    diffText,
    threads,
    workItems: (pr?.closingIssuesReferences ?? []).map((i) => ({ id: String(i.number), title: i.title ?? null, type: 'issue', state: i.state ?? null, url: i.url ?? null })),
    providerData: { repoArg, hostname: c.host, headSha: pr?.headRefOid ?? null },
    warnings,
  };
}

/** GitLab through `glab mr view`, `glab mr diff`, `glab api`. */
export function fetchGitLab(c, { run }) {
  const warnings = [];
  const repoArg = c.host === 'gitlab.com' ? c.path : `https://${c.host}/${c.path}`;
  const hostArgs = c.host === 'gitlab.com' ? [] : ['--hostname', c.host];
  const enc = encodeURIComponent(c.path);
  const mr = runJson(run, 'glab', ['mr', 'view', String(c.id), '--repo', repoArg, '--output', 'json']);
  const diffText = tryStep(warnings, 'diff', () => {
    try {
      return runText(run, 'glab', ['mr', 'diff', String(c.id), '--repo', repoArg, '--raw']);
    } catch (err) {
      if (!/unknown flag/i.test(err.message)) throw err;
      return runText(run, 'glab', ['mr', 'diff', String(c.id), '--repo', repoArg]);
    }
  }, null);
  const discussions = tryStep(warnings, 'discussions',
    () => runJson(run, 'glab', ['api', ...hostArgs, `projects/${enc}/merge_requests/${c.id}/discussions?per_page=100`, '--paginate']) ?? [], []);
  const closes = tryStep(warnings, 'linked issues',
    () => runJson(run, 'glab', ['api', ...hostArgs, `projects/${enc}/merge_requests/${c.id}/closes_issues`]) ?? [], []);

  return {
    coords: c,
    meta: {
      title: mr?.title ?? '',
      description: mr?.description ?? '',
      author: { name: mr?.author?.name ?? null, login: mr?.author?.username ?? null },
      state: mr?.state ?? null,
      isDraft: Boolean(mr?.draft ?? mr?.work_in_progress),
      sourceBranch: mr?.source_branch ?? null,
      targetBranch: mr?.target_branch ?? null,
      sourceCommit: mr?.diff_refs?.head_sha ?? mr?.sha ?? null,
      targetCommit: mr?.diff_refs?.base_sha ?? null,
    },
    files: [], // filled from the diff
    diffText,
    threads: (Array.isArray(discussions) ? discussions : [])
      .map((d) => {
        const notes = (d.notes ?? []).filter((n) => !n.system);
        const pos = notes[0]?.position ?? null;
        const resolvable = notes.filter((n) => n.resolvable);
        return {
          id: String(d.id),
          status: null,
          resolved: resolvable.length ? resolvable.every((n) => n.resolved) : null,
          file: pos?.new_path ?? pos?.old_path ?? null,
          line: pos?.new_line ?? pos?.old_line ?? null,
          comments: notes.map((n) => ({ author: n.author?.username ?? null, body: n.body ?? '', createdAt: n.created_at ?? null })),
        };
      })
      .filter((t) => t.comments.length),
    workItems: (Array.isArray(closes) ? closes : []).map((i) => ({ id: String(i.iid ?? i.id), title: i.title ?? null, type: 'issue', state: i.state ?? null, url: i.web_url ?? null })),
    providerData: { repoArg, hostname: c.host, projectPath: c.path, diffRefs: mr?.diff_refs ?? null },
    warnings,
  };
}

export const ADAPTERS = {
  'azure-devops': fetchAzureDevOps,
  github: fetchGitHub,
  gitlab: fetchGitLab,
};
