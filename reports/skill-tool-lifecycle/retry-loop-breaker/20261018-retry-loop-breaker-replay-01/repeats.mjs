// How much repeated test/build output do agents read when they run the same command again?
// For every subagent transcript: test/build runs (r3 classify on the unwrapped command), grouped by command;
// each re-run is compared with the previous output of the same command (line-set overlap).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const core = await import(pathToFileURL(path.join(import.meta.dirname, 'r3', 'core.ts')).href);
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const unwrap = (c) => c.replace(/node\s+(?:"[^"]*run\.mjs"|\S*run\.mjs)\s+/g, '');
const norm = (l) => l.replace(/\d+(\.\d+)?\s*(ms|s)\b/g, '#').replace(/\b\d{2}:\d{2}:\d{2}\b/g, '#').trim();
let agents = 0, runs = 0, reruns = 0, rerunBytes = 0, allBytes = 0, nearSame = 0, nearSameBytes = 0, agentsWithRerun = 0;
for (const d of fs.readdirSync(PROJ).filter((d) => d.startsWith('D--XionTechs-Laya'))) for (const s of fs.readdirSync(path.join(PROJ, d))) {
  const sub = path.join(PROJ, d, s, 'subagents');
  if (!fs.existsSync(sub)) continue;
  for (const f of fs.readdirSync(sub).filter((f) => f.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(sub, f), 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const res = new Map();
    for (const e of lines) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const b of e.message.content) if (b?.type === 'tool_result')
      res.set(b.tool_use_id, typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join(''));
    const last = {};
    let had = false;
    agents++;
    for (const e of lines) if (e.type === 'assistant') for (const c of e.message?.content ?? []) {
      if (c.type !== 'tool_use' || c.name !== 'Bash') continue;
      const cmd = unwrap(c.input?.command ?? '');
      if (!core.classify(cmd, '')) continue;
      const out = res.get(c.id) ?? '';
      const key = core.normalizeCommand(core.stripWrappers(cmd));
      runs++; allBytes += out.length;
      if (last[key] !== undefined) {
        reruns++; rerunBytes += out.length; had = true;
        const a = new Set(last[key].split('\n').map(norm).filter(Boolean)), b = out.split('\n').map(norm).filter(Boolean);
        const same = b.length ? b.filter((l) => a.has(l)).length / b.length : 1;
        if (same >= 0.9) { nearSame++; nearSameBytes += out.length; }
      }
      last[key] = out;
    }
    if (had) agentsWithRerun++;
  }
}
console.log(JSON.stringify({ agents, testBuildRuns: runs, reruns, agentsWithRerun, rerunShareOfRunBytes: +(rerunBytes / allBytes).toFixed(3), rerunsWith90pctSameLines: nearSame, bytesOfThoseReruns: nearSameBytes, allTestBuildOutputBytes: allBytes }, null, 2));
