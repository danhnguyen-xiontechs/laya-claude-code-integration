// Arm B (round 2): the same listing, plus the one-line hint of the tool's route.mjs (BM25 shortlist, then Jev; agreement low, as the README ships it).
// The hint comes FIRST so the Bash output never cuts it (round 1: every B output was over the 30,000-char cap).
// route.mjs runs once with --json (the object for the log), and the line is built by formatLine (the CLI default), so there is no second Jev call.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listing, TOOL_DIR } from './common.mjs';

export async function run({ request, root }) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(TOOL_DIR, 'scripts', 'route.mjs'), '--project-root', root, '--query', request, '--provider', 'jev', '--agreement', 'low', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* keep null */ }
  const { formatLine } = await import(pathToFileURL(path.join(TOOL_DIR, 'scripts', 'route.mjs')).href);
  const line = out ? formatLine(out) : 'suggest: none | error: unparseable output';
  const log = out
    ? { tool: 'route.mjs', provider: out.provider ?? null, mode: out.mode, suggestion: out.suggestion?.id ?? null, alternatives: (out.alternatives || []).map((a) => a.id), abstain: out.abstain, abstainReasons: out.abstainReasons, confidenceLabel: out.confidenceLabel, agreement: out.agreement ?? null, shortlist: (out.shortlist || []).map((s) => s.id), error: out.error ?? null, latencyMs: out.latencyMs ?? null, wallMs: Date.now() - t0, cost: out.cost ?? null, model: out.model ?? null, line, lineChars: line.length }
    : { tool: 'route.mjs', error: 'unparseable output', status: r.status, stderr: String(r.stderr).slice(0, 300), wallMs: Date.now() - t0, line, lineChars: line.length };
  const list = listing(root);
  const text = 'skills-router hint: ' + line + '\n\n' + list;
  log.textChars = text.length;
  return { text, log };
}
