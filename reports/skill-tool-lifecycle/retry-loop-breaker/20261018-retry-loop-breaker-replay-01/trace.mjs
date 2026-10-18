// Trace the r3 guard on the retry-loop agents with >= 3 eligible calls: per Bash call, eligibility, epoch, decision,
// outcome kind and repeat count, plus why the epoch moved. Usage: node trace.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const core = await import(pathToFileURL(path.join(import.meta.dirname, 'r3', 'core.ts')).href);
const res = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'replay-unwrapped.json'), 'utf8'));
const pick = res.rows.filter((r) => r.group !== 'other' && r.r3.eligible >= 3).map((r) => r.file);
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const find = (f) => {
  for (const d of fs.readdirSync(PROJ)) { const b = path.join(PROJ, d); for (const s of fs.readdirSync(b)) { const p = path.join(b, s, 'subagents', f); if (fs.existsSync(p)) return p; } }
};
const unwrap = (c) => c.replace(/node\s+(?:"[^"]*run\.mjs"|\S*run\.mjs)\s+/g, '');
const tally = { identicalRunsMax: [], epochBumpBy: {}, outcomes: {} };
for (const f of pick.slice(0, 12)) {
  const lines = fs.readFileSync(find(f), 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const results = new Map();
  for (const e of lines) if (e.type === 'user' && Array.isArray(e.message?.content)) for (const b of e.message.content) if (b?.type === 'tool_result')
    results.set(b.tool_use_id, { isError: b.is_error === true, text: typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join('') });
  const o = { ...core.DEFAULTS, mode: 'enforce', jevEnabled: false };
  let s = core.emptyState();
  const seenCount = {};
  console.log(`\n== ${f.slice(0, 22)}`);
  for (const e of lines) if (e.type === 'assistant') for (const c of e.message?.content ?? []) {
    if (c.type !== 'tool_use') continue;
    const r = results.get(c.id);
    if (['Edit', 'Write'].includes(c.name)) { s = { ...s, epoch: s.epoch + 1 }; console.log(`   ${c.name} -> epoch ${s.epoch}`); tally.epochBumpBy[c.name] = (tally.epochBumpBy[c.name] ?? 0) + 1; continue; }
    if (c.name !== 'Bash') continue;
    const cmd = unwrap(c.input.command ?? '');
    const cat = core.classify(cmd, '');
    if (!cat) {
      if (core.bashMayMutate(cmd, false)) { s = { ...s, epoch: s.epoch + 1 }; const k = cmd.split(/\s+/)[0]; tally.epochBumpBy[`bash:${k}`] = (tally.epochBumpBy[`bash:${k}`] ?? 0) + 1; console.log(`   bash(mutating?) "${cmd.slice(0, 60)}" -> epoch ${s.epoch}`); }
      continue;
    }
    const now = Date.parse(e.timestamp) || 0;
    const d = core.decideBefore(core.prune(s, now, o), 'w', cmd, now, o);
    const text = r?.text ?? '';
    const out = core.hasEchoExit(cmd) ? (core.echoedExit(cmd, text) === null ? { kind: 'ignored' } : core.echoedExit(cmd, text) === 0 ? { kind: 'passed' } : { kind: 'failed', text })
      : core.exitHiddenByPipe(cmd) ? { kind: 'ignored' } : r?.isError ? { kind: 'failed', text } : { kind: 'passed' };
    s = core.recordAfter(core.prune(s, now, o), 'w', cmd, cat, out, now, o);
    const rec = s.records.find((x) => x.normalized_action === core.normalizeCommand(cmd));
    seenCount[cmd] = (seenCount[cmd] ?? 0) + 1;
    tally.outcomes[out.kind] = (tally.outcomes[out.kind] ?? 0) + 1;
    console.log(`   ELIG "${cmd.slice(0, 70)}" epoch ${s.epoch} decide=${d.kind}(${d.reason}) outcome=${out.kind} repeat=${rec?.repeat_count ?? '-'} fp=${rec?.error_fingerprint ?? '-'}`);
  }
  tally.identicalRunsMax.push(Math.max(0, ...Object.values(seenCount)));
}
console.log('\nTALLY', JSON.stringify(tally));
