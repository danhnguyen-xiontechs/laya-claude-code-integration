#!/usr/bin/env node
// Collects what the 24 case agents produced, from their subagent transcripts (found by the work folder in each prompt),
// scores them and writes the run folders. Usage: node collect.mjs <subagentsDir> <scratchDir> [--forbid-out]
//   evidence/answers/<case>.<A|B>.r<n>.txt  the hand-back message, verbatim
//   evidence/texts/<case>.<A|B>.txt         the first output the agent saw (from rep 1; machine paths shortened)
//   evidence/logs/<case>.<A|B>.r<n>.jsonl   the helper's engine log (route mode, Jev latency, cost, error)
//   evidence/usage.scrubbed.json, evidence/scores.json, runs/<arm>/<rn>/results.json
// Scoring is by script from cases.json (the answer key): never by the agent's own claim.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [subDir, scratch] = process.argv.slice(2);
if (!subDir || !scratch) { console.error('Usage: node collect.mjs <subagentsDir> <scratchDir>'); process.exit(2); }
const EXP = import.meta.dirname;
const REPO = path.resolve(EXP, '..', '..', '..', '..');
const USAGE = path.join(REPO, '.claude', 'skills', 'build-skill-tool-workflow', 'scripts', 'subagent_usage.mjs');
const map = JSON.parse(fs.readFileSync(path.join(scratch, 'workmap.json'), 'utf8'));
const gold = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(EXP, 'cases.json'), 'utf8')).cases.map((c) => [c.id, c]));
const dirs = map.map((x) => x.workDir);
const scrub = (s) => s.replace(/C:\\\\Users\\\\[^\\"/]+/gi, '<home>').replace(/C:\/Users\/[^/"\\]+/gi, '<home>').replace(/[A-Za-z]:\/[^"\s]*?\/scratchpad\/sr\/w\//g, '<work>/').replace(/[A-Za-z]:\/[^"\s]*?\/scratchpad\/sr\//g, '<base>/');

const run = (extra) => {
  const r = spawnSync(process.execPath, [USAGE, subDir, ...extra, ...dirs], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  return JSON.parse(r.stdout);
};
const usage = run([]);
const forbid = run(['--forbid', 'skills-router|route\\.mjs|catalog\\.mjs']);

for (const d of ['answers', 'texts', 'logs']) fs.mkdirSync(path.join(EXP, 'evidence', d), { recursive: true });
const norm = (s) => String(s ?? '').trim().replace(/^\/+/, '').replace(/^[\w-]+:(?=[\w-])/, '').replace(/[`*"'.]+$/g, '').replace(/^[`*"']+/, '').toLowerCase();
const results = {};
const scores = [];
for (const x of map) {
  const u = usage[x.workDir];
  const key = x.key;
  let answer = null, model = null;
  if (u?.transcript) {
    for (const l of fs.readFileSync(u.transcript, 'utf8').split('\n')) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type !== 'assistant') continue;
      model ??= e.message?.model ?? null;
      for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
    }
  }
  if (answer) fs.writeFileSync(path.join(EXP, 'evidence', 'answers', `${key}.txt`), answer.endsWith('\n') ? answer : answer + '\n');
  const m = answer && /PICK:\s*`?([^\s`\n]+)/i.exec(answer);
  const pick = m ? norm(m[1]) : null;
  const goldIds = gold[x.caseId].gold.map(norm);
  const pass = pick ? goldIds.includes(pick) : false;
  const logFile = path.join(scratch, '_logs', `${x.opaque}.jsonl`);
  const logLines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (logLines.length) fs.writeFileSync(path.join(EXP, 'evidence', 'logs', `${key}.jsonl`), logLines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const first = path.join(scratch, 'first', `${x.opaque}.txt`);
  if (fs.existsSync(first) && x.rep === 1) fs.writeFileSync(path.join(EXP, 'evidence', 'texts', `${x.caseId}.${x.arm}.txt`), scrub(fs.readFileSync(first, 'utf8')));
  const fb = forbid[x.workDir]?.forbiddenCalls ?? null;
  const routeCalls = logLines.filter((l) => l.tool === 'route.mjs');
  scores.push({ key, caseId: x.caseId, arm: x.arm, rep: x.rep, pick, gold: goldIds, pass, model, forbiddenCalls: fb, helperCalls: logLines.length, routeSuggestion: routeCalls[0]?.suggestion ?? null, routeError: routeCalls[0]?.error ?? null, usage: u?.usage ?? null, error: u?.error ?? null });
  const U = u?.usage ?? {};
  const rn = `r${x.rep}`;
  const dir = path.join(EXP, 'runs', x.arm === 'A' ? 'A-claude' : 'B-claude-jev', rn);
  (results[dir] ??= { arm: x.arm, rn, cases: [] }).cases.push({
    experimentId: '20261018-skills-router-agent-01',
    caseId: x.caseId, arm: x.arm, runId: rn,
    status: !answer || !pick ? 'error' : pass ? 'pass' : 'fail',
    goldOutcome: goldIds.join(' | '),
    observedOutcome: pick ? `picked ${pick}${x.arm === 'B' && routeCalls[0] ? `; router said ${routeCalls[0].suggestion ?? 'none'}${routeCalls[0].error ? ' (error: ' + routeCalls[0].error + ')' : ''}` : ''}` : 'no PICK line in the answer',
    correct: pass,
    usage: {
      inputTokens: U.inputTokens ?? null, outputTokens: U.outputTokens ?? null, cacheReadTokens: U.cacheReadTokens ?? null, cacheWriteTokens: U.cacheWriteTokens ?? null,
      modelTurns: U.modelTurns ?? null, toolCalls: U.toolCalls ?? null,
      providerCalls: x.arm === 'B' ? routeCalls.length : 0,
      fallbackCount: x.arm === 'B' ? routeCalls.filter((l) => l.error || l.mode !== 'provider').length : 0,
      providerLatencyMs: x.arm === 'B' ? routeCalls.reduce((s, l) => s + (l.latencyMs ?? 0), 0) : null,
      elapsedMs: U.elapsedMs ?? null,
      source: `subagent transcript (${model ?? 'unknown model'}, effort xhigh)`,
    },
    errors: [],
    evidenceRefs: [`../../../evidence/answers/${key}.txt`, `../../../evidence/texts/${x.caseId}.${x.arm}.txt`],
    startedAt: u?.usage?.firstTimestamp ?? null, finishedAt: u?.usage?.lastTimestamp ?? null,
  });
}
for (const [dir, r] of Object.entries(results)) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ experimentId: '20261018-skills-router-agent-01', arm: r.arm, runId: r.rn, note: 'Subagent (Agent tool) runs, one per case. Pick scored by collect.mjs against cases.json.', cases: r.cases }, null, 2) + '\n');
}
fs.writeFileSync(path.join(EXP, 'evidence', 'scores.json'), scrub(JSON.stringify(scores, null, 2)) + '\n');
fs.writeFileSync(path.join(EXP, 'evidence', 'usage.scrubbed.json'), scrub(JSON.stringify(usage, null, 2)) + '\n');
for (const s of scores) console.log(s.key.padEnd(34), (s.pick ?? '-').padEnd(26), s.pass ? 'pass' : 'FAIL', 'forbid', s.forbiddenCalls, 'tok', s.usage ? (s.usage.inputTokens + s.usage.outputTokens + s.usage.cacheReadTokens + s.usage.cacheWriteTokens) : null, 'turns', s.usage?.modelTurns);
