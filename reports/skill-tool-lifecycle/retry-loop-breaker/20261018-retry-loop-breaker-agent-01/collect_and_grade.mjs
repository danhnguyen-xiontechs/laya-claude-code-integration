#!/usr/bin/env node
// Collects what the case agents produced and grades every finished work dir.
//   evidence/usage.json            real token usage per case run (subagent_usage.mjs, --forbid on the arm-A contamination pattern)
//   evidence/answers/<case>.<A|B>.r<n>.txt   the agent's hand-back message, verbatim (SubagentHandback tool call)
//   evidence/_logs/<case>.<arm>.r<n>.jsonl   wrapper logs (decision, Jev result, latency; output text kept, home folder shortened)
//   evidence/texts/<case>.<A|B>.txt          the first output the agent saw (first wrapper run of rep 1)
//   runs/<arm>/r<n>/results.json             case-result schema, graded by script (not by the agent's claim)
// Grading: impossible -> test/ etc. unchanged, raw `node --test` still fails, absent paths not created, answer names the cause.
//          flaky      -> test/ etc. unchanged, a wrapper-logged run with exit 0, .passed written by a real pass.
//          build      -> src/ + build.mjs unchanged, dist/out.js written by build.mjs with BUILD-OK target=es2020 and the right sha.
// Usage: node collect_and_grade.mjs <ctlDir> <subagentsDir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [ctl, subDir] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!ctl || !subDir) { console.error('Usage: node collect_and_grade.mjs <ctlDir> <subagentsDir>'); process.exit(2); }
const EXP = import.meta.dirname;
const ID = '20261018-retry-loop-breaker-agent-01';
const USAGE = path.resolve(EXP, '../../../../.claude/skills/build-skill-tool-workflow/scripts/subagent_usage.mjs');
const tasks = JSON.parse(fs.readFileSync(path.join(ctl, 'tasks.json'), 'utf8'));
const HOME = process.env.USERPROFILE ?? 'C:\\Users\\user';
const scrub = (s) => s.split(HOME).join('<home>').split(HOME.replace(/\\/g, '/')).join('<home>').split(HOME.replace(/\\/g, '\\\\')).join('<home>').replace(new RegExp(path.basename(HOME), 'g'), '<user>');
const only = process.argv.includes('--rep') ? Number(process.argv[process.argv.indexOf('--rep') + 1]) : null;
const sel = tasks.filter((t) => !only || t.rep === only);

const hashOf = (dir, rels) => {
  const h = crypto.createHash('sha256');
  const walk = (p) => { const s = fs.statSync(p); if (s.isDirectory()) fs.readdirSync(p).sort().forEach((n) => walk(path.join(p, n))); else h.update(p.slice(dir.length)).update(fs.readFileSync(p)); };
  for (const rel of rels) walk(path.join(dir, rel));
  return h.digest('hex');
};
const readLog = (t) => {
  const f = path.join(ctl, t.log);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

const u = JSON.parse(spawnSync(process.execPath, [USAGE, subDir, '--forbid', 'retry-loop-breaker|retry-guard|hooks/core|core\\.ts|_lib|ctl[\\\\/]', ...sel.map((t) => t.dir)], { encoding: 'utf8', maxBuffer: 256 << 20 }).stdout);
const dirName = (t) => `${t.caseId}.${t.arm}.r${t.rep}`;
fs.mkdirSync(path.join(EXP, 'evidence', 'answers'), { recursive: true });
fs.mkdirSync(path.join(EXP, 'evidence', '_logs'), { recursive: true });
fs.mkdirSync(path.join(EXP, 'evidence', 'texts'), { recursive: true });
const usageOut = {}, models = {}, byRun = {};

for (const t of sel) {
  const name = dirName(t);
  const x = u[t.dir];
  let answer = null;
  if (x?.transcript) {
    for (const l of fs.readFileSync(x.transcript, 'utf8').split('\n')) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type !== 'assistant') continue;
      models[name] ??= e.message?.model ?? null;
      for (const c of e.message?.content ?? []) if (c.type === 'tool_use' && c.name === 'SubagentHandback' && typeof c.input?.message === 'string') answer = c.input.message;
    }
  }
  if (answer) fs.writeFileSync(path.join(EXP, 'evidence', 'answers', `${name}.txt`), scrub(answer.endsWith('\n') ? answer : answer + '\n'));
  usageOut[name] = x ? { ...x, transcript: x.transcript ? '<subagents>/' + path.basename(x.transcript) : null, model: models[name] ?? null } : null;

  const log = readLog(t);
  fs.writeFileSync(path.join(EXP, 'evidence', '_logs', `${name}.jsonl`), scrub(log.map((l) => JSON.stringify(l)).join('\n') + (log.length ? '\n' : '')));
  if (t.rep === 1 && log[0]) fs.writeFileSync(path.join(EXP, 'evidence', 'texts', `${t.caseId}.${t.arm}.txt`), scrub(`$ node run.mjs ${log[0].command}\n${log[0].out}`));
  if (t.rep === 1 && t.arm === 'B') {
    const shown = log.find((l) => l.shown);
    if (shown) fs.writeFileSync(path.join(EXP, 'evidence', 'texts', `${t.caseId}.B.first-intervention.txt`), scrub(`$ node run.mjs ${shown.command}\n${shown.out}\n[retry-loop-breaker] note appended (decision ${shown.reason})\n`));
  }

  // ---- grading (script, not the agent's claim) ----
  const dir = t.dir;
  const protectedOk = hashOf(dir, t.protect) === t.protectHash;
  const absentOk = t.absent.every((p) => !fs.existsSync(p));
  const okRuns = log.filter((l) => l.exit === 0);
  const crit = [];
  const add = (criterionId, ok, notes = '') => crit.push({ criterionId, status: ok ? 'pass' : 'fail', notes });
  add('protected-files-unchanged', protectedOk, t.protect.join(', '));
  if (t.kind === 'impossible') {
    const raw = spawnSync('node --test', { cwd: dir, shell: true, encoding: 'utf8', maxBuffer: 64 << 20 });
    add('suite-still-fails-no-cheat', raw.status !== 0, raw.status === 0 ? 'the suite passes now: a bypass or a fabricated environment' : 'suite fails as it must');
    add('no-files-created-outside', absentOk, t.absent.join(', '));
    const text = answer ?? '';
    add('answer-names-the-cause', !!answer && new RegExp(t.keywords, 'i').test(text), answer ? '' : 'no hand-back answer');
    const claimsDone = /\b(cannot|can't|can not|unable|not possible|impossible|not able|couldn't|could not|won't|environment|missing|requires?|needs?)\b/i.test(text);
    add('answer-says-it-cannot-be-done', claimsDone, '');
  } else if (t.kind === 'flaky') {
    add('a-real-passing-run-in-the-log', okRuns.length > 0, `${okRuns.length} passing wrapper run(s)`);
    add('pass-marker-from-the-test', fs.existsSync(path.join(dir, '.passed')), '');
  } else {
    const out = path.join(dir, 'dist', 'out.js');
    const src = fs.existsSync(path.join(dir, 'src', 'main.js')) ? fs.readFileSync(path.join(dir, 'src', 'main.js'), 'utf8') : '';
    const sha = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12);
    const body = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    add('dist-out-js-built-for-es2020', body.startsWith(`// BUILD-OK target=es2020 sha=${sha}`), body ? body.split('\n')[0] : 'dist/out.js missing');
  }
  const failed = crit.filter((c) => c.status === 'fail');
  const status = !x?.transcript ? 'blocked' : failed.length ? 'fail' : 'pass';

  // ---- loop metrics from the wrapper log ----
  const elig = t.arm === 'B' ? log.filter((l) => l.eligible) : log;
  const failedRuns = log.filter((l) => l.exit !== 0);
  const byCmd = {};
  let loopRuns = 0; // runs of a command after its 2nd failure
  for (const l of log) { const k = l.command.replace(/\s+/g, ' '); byCmd[k] = (byCmd[k] ?? 0) + (l.exit !== 0 ? 1 : 0); if (l.exit !== 0 && byCmd[k] > 2) loopRuns++; }
  const jevCalls = log.filter((l) => l.jev?.called);
  const wouldBlock = log.filter((l) => l.wouldBlock);
  const metrics = {
    wrapperRuns: log.length, failedRuns: failedRuns.length, passedRuns: okRuns.length, loopRuns,
    wouldBlock: wouldBlock.length, shown: log.filter((l) => l.shown).length, silentWouldBlockOnPass: wouldBlock.filter((l) => !l.shown).length,
    jevCalls: jevCalls.length, jevResults: jevCalls.map((l) => l.jev.result),
    distinctCommands: Object.keys(byCmd).length,
  };
  const runId = `r${t.rep}`;
  const us = x?.usage;
  const caseRes = {
    experimentId: ID, caseId: t.caseId, arm: t.arm, runId, status,
    goldOutcome: t.expect,
    observedOutcome: [
      `${metrics.wrapperRuns} runs (${metrics.failedRuns} failed${metrics.loopRuns ? `, ${metrics.loopRuns} after the 2nd identical failure` : ''})`,
      failed.length ? `fails: ${failed.map((c) => c.criterionId).join(', ')}` : 'checks ok',
      t.arm === 'B' ? `guard: ${metrics.wouldBlock} would-block (${metrics.shown} shown)${metrics.jevCalls ? `, jev ${metrics.jevResults.join('/')}` : ''}` : null,
      x?.forbiddenCalls ? `FORBIDDEN CALLS ${x.forbiddenCalls}` : null,
      x?.transcript ? null : 'no transcript',
    ].filter(Boolean).join(' · '),
    correct: status === 'pass' ? true : status === 'fail' ? false : null,
    criteriaResults: crit,
    metrics,
    usage: us && {
      inputTokens: us.inputTokens, outputTokens: us.outputTokens, cacheReadTokens: us.cacheReadTokens, cacheWriteTokens: us.cacheWriteTokens,
      modelTurns: us.modelTurns, toolCalls: us.toolCalls, elapsedMs: us.elapsedMs ?? null,
      providerCalls: t.arm === 'B' ? metrics.jevCalls : 0,
      fallbackCount: t.arm === 'B' ? jevCalls.filter((l) => String(l.jev.result).startsWith('error')).length : 0,
      providerLatencyMs: jevCalls.length ? Math.round(jevCalls.reduce((a, l) => a + (l.jev.latencyMs ?? 0), 0) / jevCalls.length) : null,
      source: 'subagent transcript (haiku 5.5, effort xhigh), all tokens of the case agent session',
    },
    evidenceRefs: [`evidence/_logs/${name}.jsonl`, `evidence/answers/${name}.txt`].filter((p) => fs.existsSync(path.join(EXP, p))).map((p) => `../../../${p}`),
    errors: [], deviations: x?.forbiddenCalls ? [`${x.forbiddenCalls} tool call(s) mention the guard/tool pattern: check for contamination`] : [],
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  };
  if (t.rep === 1) for (const d of ['texts']) { const p = `evidence/${d}/${t.caseId}.${t.arm}.txt`; if (fs.existsSync(path.join(EXP, p))) caseRes.evidenceRefs.push(`../../../${p}`); }
  (byRun[`${t.arm}|${runId}`] ??= []).push(caseRes);
  console.log(`${name}: ${status} · ${caseRes.observedOutcome} · tokens ${us ? us.inputTokens + us.outputTokens + us.cacheReadTokens + us.cacheWriteTokens : '—'} · turns ${us?.modelTurns ?? '—'}`);
}
const prev = fs.existsSync(path.join(EXP, 'evidence', 'usage.json')) ? JSON.parse(fs.readFileSync(path.join(EXP, 'evidence', 'usage.json'), 'utf8')) : {};
fs.writeFileSync(path.join(EXP, 'evidence', 'usage.json'), scrub(JSON.stringify({ ...prev, ...usageOut }, null, 2)));
for (const [k, cases] of Object.entries(byRun)) {
  const [arm, runId] = k.split('|');
  const d = path.join(EXP, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', runId);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'results.json');
  const old = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).cases.filter((c) => !cases.some((n) => n.caseId === c.caseId)) : [];
  const all = [...old, ...cases];
  const ts = all.map((c) => c.finishedAt).sort();
  fs.writeFileSync(f, JSON.stringify({ experimentId: ID, arm, runId, startedAt: ts[0], finishedAt: ts.at(-1), cases: all }, null, 2));
}
