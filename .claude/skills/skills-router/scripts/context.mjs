// context.mjs — the little repo state the router sends with a request. Computed by code, never
// file contents: branch name, dirty flag, top changed file extensions, whether _bmad-output/ has
// artifacts, and whether the query itself carries a PR URL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PR_URL = /https?:\/\/\S*(?:\/pull\/\d+|\/pullrequest\/\d+|\/merge_requests\/\d+)/i;

export const hasPrUrl = (query) => PR_URL.test(String(query || ''));

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch { return null; }
};

/** Top file extensions in `git status --porcelain` output: [{ ext, n }], at most 3. */
export function topExtensions(porcelain, max = 3) {
  const n = {};
  for (const line of String(porcelain || '').split('\n')) {
    const f = line.slice(3).trim().split(' -> ').at(-1).replace(/^"|"$/g, '');
    if (!f) continue;
    const ext = path.extname(f).toLowerCase() || (f.endsWith('/') ? '(dir)' : '(none)');
    n[ext] = (n[ext] || 0) + 1;
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([ext, c]) => ({ ext, n: c }));
}

/** Number of files under _bmad-output/ (depth ≤ 3, capped at 200), without reading any. */
export function bmadArtifactCount(root, cap = 200) {
  let n = 0;
  const walk = (dir, depth) => {
    if (depth > 3 || n >= cap) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (n >= cap || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
      else n++;
    }
  };
  walk(path.join(root, '_bmad-output'), 1);
  return n;
}

/** { git_branch, working_tree_dirty, changed_extensions, bmad_output_artifacts, pr_url_in_query }. */
export function repoContext(root, query) {
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = branch === null ? null : git(root, ['status', '--porcelain']);
  return {
    git_branch: branch === null ? null : branch.trim(),
    working_tree_dirty: status === null ? null : status.trim().length > 0,
    changed_extensions: status ? topExtensions(status).map((x) => x.ext) : [],
    bmad_output_artifacts: bmadArtifactCount(root),
    pr_url_in_query: hasPrUrl(query),
  };
}
