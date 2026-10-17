// Helper library for the case agents (copied to <base>/lib/f1.mjs). Do not edit after the run starts.
// Arm A (v2): the SAME retrieval as the tool (codemap find per query, cleanup, same pool), in codemap's own order:
// no rules score, no importer evidence, no Jev. It shows the same number of rows as arm B (top 10), so the only
// difference between the arms is the ranking (rules + Jev batches) and the extra columns the tool prints.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ARM = 'A';
const TOP = 10;

export async function run({ root, task, queries, mode, caseId, logDir, firstDir }) {
  const explore = path.join(root, '.claude', 'skills', 'codebase-task-explorer', 'scripts', 'explore.mjs');
  const args = [explore, '--task', task, '--mode', mode, '--queries', queries.join('|'), '--root', root, '--provider', 'none', '--json'];
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000, env: process.env });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { j = null; }
  let out;
  if (j) {
    const rows = (j.codemapOnlyTop ?? []).slice(0, TOP);
    out = [
      `## Candidate starting points (unranked) — ${mode}`, '',
      `Engine: ${j.engine} · pool ${j.poolSize}. Matches for the task words, in the search engine's own order (no ranking).`, '',
      '| # | path |', '|---|---|',
      ...rows.map((p, i) => `| ${i + 1} | \`${p}\` |`), '',
    ].join('\n');
  } else {
    out = `The candidate list could not run (exit ${r.status}). Use your own search.\n`;
  }
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, `${caseId}.${ARM}.jsonl`), JSON.stringify({
    t: new Date().toISOString(), caseId, arm: ARM, mode, exit: r.status, stderr: String(r.stderr || '').slice(0, 800),
    engine: j?.engine ?? null, coverage: j?.coverage?.status ?? null, poolSize: j?.poolSize ?? null,
    top: j?.codemapOnlyTop?.slice(0, TOP) ?? null,
  }) + '\n');
  fs.mkdirSync(firstDir, { recursive: true });
  const first = path.join(firstDir, `${caseId}.${ARM}.txt`);
  if (!fs.existsSync(first)) fs.writeFileSync(first, out);
  return out;
}
