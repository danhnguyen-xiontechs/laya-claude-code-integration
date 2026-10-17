// Arm B: the same listing, plus the output of the tool's route.mjs (BM25 shortlist, then Jev; agreement low, as the README ships it).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { listing, TOOL_DIR } from './common.mjs';

export async function run({ request, root }) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(TOOL_DIR, 'scripts', 'route.mjs'), '--project-root', root, '--query', request, '--provider', 'jev', '--agreement', 'low'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* keep null */ }
  const log = out
    ? { tool: 'route.mjs', provider: out.provider ?? null, mode: out.mode, suggestion: out.suggestion?.id ?? null, alternatives: (out.alternatives || []).map((a) => a.id), abstain: out.abstain, abstainReasons: out.abstainReasons, confidenceLabel: out.confidenceLabel, agreement: out.agreement ?? null, shortlist: (out.shortlist || []).map((s) => s.id), error: out.error ?? null, latencyMs: out.latencyMs ?? null, wallMs: Date.now() - t0, cost: out.cost ?? null, model: out.model ?? null }
    : { tool: 'route.mjs', error: 'unparseable output', status: r.status, stderr: String(r.stderr).slice(0, 300), wallMs: Date.now() - t0 };
  const text = listing(root) + '\n--- skills-router output (BM25 shortlist, then one Jev decision; a hint, you make the final call) ---\n' + (out ? JSON.stringify(out, null, 1) : r.stdout + r.stderr) + '\n';
  return { text, log };
}
