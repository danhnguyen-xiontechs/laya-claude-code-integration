#!/usr/bin/env node
// shadow-replay.mjs — replays mined prompts through the shadow hook and the shadow report, as a
// sanity check against the other evals: same code path, shipped default thresholds, local providers only.
//
//   node shadow-replay.mjs [--cases ~/.skills-router/eval/cases.jsonl] [--provider none|laya]
//                          [--log ~/.skills-router/eval/shadow-replay-<provider>.jsonl] [--limit N]
//
// Each mined case becomes a UserPromptSubmit payload (session and cwd from the case; a typed slash
// command is rebuilt as "/cmd args", the text the hook would have seen). The log is then joined with
// the transcripts by shadow-report, exactly as for live shadow data. Prompts stay on this machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_DIR } from './catalog.mjs';
import { parseArgs } from './decision-provider.mjs';
import { readJsonl } from './mine-history.mjs';
import { runHook } from './shadow-hook.mjs';
import { report } from './shadow-report.mjs';

/** The prompt text the hook would have received for a mined case. */
export const promptOf = (c) => (c.via === 'slash' ? `/${c.expected} ${c.query}` : c.query);

export async function replay({ cases, provider = 'none', logFile, env = process.env, fetchImpl, catalog, projectsDir }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
  const e = { ...env, SKILLS_ROUTER_SHADOW_PROVIDER: provider };
  let done = 0;
  for (const c of cases) {
    const payload = { session_id: c.session, cwd: c.cwd && fs.existsSync(c.cwd) ? c.cwd : process.cwd(), prompt: promptOf(c) };
    await runHook({ stdin: JSON.stringify(payload), env: e, logFile, fetchImpl, catalog });
    if (++done % 50 === 0) process.stderr.write(`  ${provider}: ${done}/${cases.length}\n`);
  }
  const { rows, ...summary } = report({ logFile, projectsDir });
  return { provider, replayed: cases.length, ...summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const provider = typeof a.provider === 'string' ? a.provider : 'none';
  const dir = path.join(STATE_DIR, 'eval');
  let cases = readJsonl(typeof a.cases === 'string' ? a.cases : path.join(dir, 'cases.jsonl'));
  if (a.limit) cases = cases.slice(0, Number(a.limit));
  const logFile = typeof a.log === 'string' ? a.log : path.join(dir, `shadow-replay-${provider}.jsonl`);
  replay({ cases, provider, logFile }).then((r) => console.log(JSON.stringify(r, null, 2)));
}
