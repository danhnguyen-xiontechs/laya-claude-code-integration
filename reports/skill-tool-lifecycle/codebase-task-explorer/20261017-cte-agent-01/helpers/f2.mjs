// Helper library for the case agents (copied to <base>/lib/f2.mjs). Do not edit after the run starts.
// Runs the real scripts/explore.mjs of the copied repo with --provider jev (Jev batches, rules fallback),
// logs its jev block and prints the tool's own markdown rendering (toMarkdown).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ARM = 'B';

export async function run({ root, task, queries, mode, caseId, logDir, firstDir }) {
  const explore = path.join(root, '.claude', 'skills', 'codebase-task-explorer', 'scripts', 'explore.mjs');
  const args = [explore, '--task', task, '--mode', mode, '--queries', queries.join('|'), '--root', root, '--provider', 'jev', '--json'];
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000, env: process.env });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { j = null; }
  let out;
  if (j) {
    const { toMarkdown } = await import(pathToFileURL(explore).href);
    out = toMarkdown(j) + '\n';
  } else {
    out = `The candidate ranking could not run (exit ${r.status}). Use your own search.\n`;
  }
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, `${caseId}.${ARM}.jsonl`), JSON.stringify({
    t: new Date().toISOString(), caseId, arm: ARM, mode, exit: r.status, stderr: String(r.stderr || '').slice(0, 800),
    engine: j?.engine ?? null, coverage: j?.coverage?.status ?? null, poolSize: j?.poolSize ?? null, elapsedMs: j?.elapsedMs ?? null,
    top: j?.top?.map((c) => c.path) ?? null, jev: j?.jev ?? null,
  }) + '\n');
  fs.mkdirSync(firstDir, { recursive: true });
  const first = path.join(firstDir, `${caseId}.${ARM}.txt`);
  if (!fs.existsSync(first)) fs.writeFileSync(first, out);
  return out;
}
