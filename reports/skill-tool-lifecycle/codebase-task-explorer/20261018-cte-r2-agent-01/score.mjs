#!/usr/bin/env node
// Scores the case agents' answers against the gold groups and writes the per-arm results.
// Grading is by this script, not by the agent's claim. Pass = Recall@5 of 1.0 (every gold group hit by one of the
// first five distinct paths of the answer). Fractional recall is kept too.
//
// Usage: node score.mjs --workmap <scratch>/workmap.json --scratch <scratch> --usage <exp>/evidence/usage.json
//                       --models <scratch>/models.json --exp <expDir> --tasks <tasks.json>
// Reads  <exp>/evidence/answers/<caseId>.<A|B>.txt (the subagent's final message, saved verbatim)
//        <scratch>/first/<caseId>.<A|B>.txt, <scratch>/_logs/<caseId>.<A|B>.jsonl
// Writes <exp>/runs/A-claude/r1/results.json, <exp>/runs/B-claude-jev/r1/results.json, <exp>/evidence/scores.json,
//        <exp>/evidence/texts/<caseId>.<A|B>.txt (first helper output, paths shortened), <exp>/evidence/logs/*.jsonl
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const need = (k) => opt(k) ?? (() => { console.error(`missing ${k}`); process.exit(2); })();
const workmap = JSON.parse(fs.readFileSync(need('--workmap'), 'utf8'));
const scratch = need('--scratch');
const exp = need('--exp');
const tasks = JSON.parse(fs.readFileSync(need('--tasks'), 'utf8')).tasks;
const usage = opt('--usage') && fs.existsSync(opt('--usage')) ? JSON.parse(fs.readFileSync(opt('--usage'), 'utf8')) : {};
const models = opt('--models') && fs.existsSync(opt('--models')) ? JSON.parse(fs.readFileSync(opt('--models'), 'utf8')) : {};
const EXP_ID = path.basename(exp);
const EXT = /[A-Za-z0-9_.@\-/\\]+\.(?:mjs|cjs|js|ts|tsx|jsx|cs|json|md|html|ya?ml|py|ps1|sh|txt|csproj|sln|xml|toml|ini)\b/gi;

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
// The answer is asked for as a ranked list, so the numbered items come first; a path mentioned in a preamble or in
// notes ("config.json sets mode shadow") must not count as one of the five. Only an answer with fewer than five
// numbered paths falls back to scanning the whole text. Same rule for both arms.
export function parseTop5(text) {
  const seen = [];
  for (const line of text.split('\n')) {
    if (!/^\s*\d+[.)]\s/.test(line)) continue;
    const m = line.match(new RegExp(EXT.source, 'i'));
    if (!m) continue;
    const p = norm(m[0]);
    if (!seen.includes(p)) seen.push(p);
    if (seen.length === 5) return seen;
  }
  seen.length = 0;
  for (const m of text.matchAll(EXT)) {
    const p = norm(m[0]);
    if (!seen.includes(p)) seen.push(p);
    if (seen.length === 5) break;
  }
  return seen;
}
// a group is hit by any of its acceptable paths; returns the answer path that hit it
// A relative answer path (e.g. scripts/x.mjs) counts when the gold path ends with it AND the answer names the gold's top folder
// as its base ("all under …/<skill>/"). Added after seeing two such answers; same rule for both arms.
const hitBy = (group, paths, text = '') => {
  for (const g of group) {
    const top = norm(g).split('/')[0];
    const m = paths.find((p) => p === norm(g) || p.endsWith('/' + norm(g)) || (!p.includes(top + '/') && norm(g).endsWith('/' + p) && text.toLowerCase().replaceAll('\\', '/').includes(top + '/')));
    if (m) return m;
  }
  return null;
};

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const transcriptTimes = (file) => {
  if (!file || !fs.existsSync(file)) return null;
  const ts = fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return JSON.parse(l).timestamp; } catch { return null; } }).filter(Boolean);
  return ts.length ? { startedAt: ts[0], finishedAt: ts[ts.length - 1] } : null;
};

const REPS = [...new Set(workmap.map((x) => x.rep))].sort();
const perArm = { A: {}, B: {} };
const scores = [];
const texts = path.join(exp, 'evidence', 'texts');
const logsOut = path.join(exp, 'evidence', 'logs');
fs.mkdirSync(texts, { recursive: true });
fs.mkdirSync(logsOut, { recursive: true });

for (const rep of REPS) for (const t of tasks) {
  for (const arm of ['A', 'B']) {
    const w = workmap.find((x) => x.caseId === t.id && x.arm === arm && x.rep === rep);
    const key = w.key;
    const answerFile = path.join(exp, 'evidence', 'answers', `${key}.${arm}.txt`);
    const answer = fs.existsSync(answerFile) ? fs.readFileSync(answerFile, 'utf8') : '';
    const top5 = parseTop5(answer);
    const groups = t.relevant.map((g) => ({ group: g, hitBy: hitBy(g, top5, answer) }));
    const hit = groups.filter((g) => g.hitBy).length;
    const recall = groups.length ? hit / groups.length : null;
    const usable = top5.length === 5;
    const pass = usable && hit === groups.length;

    // first helper output, paths shortened so the evidence reads the same anywhere
    const firstFile = path.join(scratch, 'first', `${key}.${arm}.txt`);
    if (fs.existsSync(firstFile)) {
      const shortened = fs.readFileSync(firstFile, 'utf8').split(w.workDir).join('<work>').split(w.workDir.replace(/\//g, '\\')).join('<work>');
      fs.writeFileSync(path.join(texts, `${key}.${arm}.txt`), shortened);
    }
    const logFile = path.join(scratch, '_logs', `${key}.${arm}.jsonl`);
    const logRows = readJsonl(logFile);
    if (fs.existsSync(logFile)) fs.copyFileSync(logFile, path.join(logsOut, `${key}.${arm}.jsonl`));
    const jev = arm === 'B' ? logRows.map((r) => r.jev).filter(Boolean).at(-1) ?? null : null;

    const u = usage[w.workDir]?.usage ?? null; // null = no transcript match, never an estimate
    const times = transcriptTimes(usage[w.workDir]?.transcript) ?? { startedAt: null, finishedAt: null };
    const errors = [];
    if (!usable) errors.push(`answer has ${top5.length} distinct paths, needs 5`);
    if (u == null) errors.push('no subagent transcript matched this work folder');
    const status = !usable ? 'error' : pass ? 'pass' : 'fail';
    const observed = usable
      ? `recall ${hit}/${groups.length} groups in top 5: ${top5.join(', ')}`
      : `answer unusable (${top5.length} paths)`;
    const caseResult = {
      experimentId: EXP_ID, caseId: t.id, arm, runId: `r${rep}`,
      status, goldOutcome: `all ${groups.length} gold groups hit in top 5`, observedOutcome: observed,
      correct: usable ? pass : null,
      criteriaResults: groups.map((g, i) => ({ criterionId: `group-${i + 1}`, status: g.hitBy ? 'pass' : 'fail', evidenceRef: g.hitBy ? `answers/${key}.${arm}.txt` : null, notes: g.hitBy ? `hit by ${g.hitBy}` : 'no path of this group in the top 5' })),
      usage: {
        inputTokens: u?.inputTokens ?? null,
        outputTokens: u?.outputTokens ?? null,
        cacheReadTokens: u?.cacheReadTokens ?? null,
        cacheWriteTokens: u?.cacheWriteTokens ?? null,
        modelTurns: u?.modelTurns ?? null,
        toolCalls: u?.toolCalls ?? null,
        providerCalls: arm === 'B' ? (jev?.calls ?? 0) : 0,
        fallbackCount: arm === 'B' ? (jev?.fallback ? 1 : 0) : 0,
        elapsedMs: u?.elapsedMs ?? null,
        providerLatencyMs: arm === 'B' ? (jev?.latencyMs ?? null) : null,
        source: `subagent transcript (${models[`${key}.${arm}`] ?? 'model not recorded'}, effort xhigh)`,
      },
      errors,
      evidenceRefs: [`../../../evidence/texts/${key}.${arm}.txt`],
      startedAt: times.startedAt, finishedAt: times.finishedAt,
    };
    (perArm[arm][rep] ??= []).push(caseResult);
    scores.push({ caseId: t.id, rep, arm, top5, recall, fractionalGroups: `${hit}/${groups.length}`, pass, usable, groups, usage: caseResult.usage, jevFallback: jev?.fallback ?? null, jevReason: jev?.reason ?? null });
  }
}

for (const arm of ['A', 'B']) for (const rep of REPS) {
  const dir = path.join(exp, 'runs', arm === 'A' ? 'A-claude' : 'B-claude-jev', `r${rep}`);
  fs.mkdirSync(dir, { recursive: true });
  const cases = perArm[arm][rep];
  const starts = cases.map((c) => c.startedAt).filter(Boolean).sort();
  const ends = cases.map((c) => c.finishedAt).filter(Boolean).sort();
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({
    experimentId: EXP_ID, arm, runId: `r${rep}`,
    startedAt: starts[0] ?? null, finishedAt: ends.at(-1) ?? null,
    note: 'Subagent (Agent tool) runs, one per case, repetition ' + rep + ' of ' + REPS.length + '. Recall@5 scored by score.mjs.',
    cases,
  }, null, 2));
}
fs.writeFileSync(path.join(exp, 'evidence', 'scores.json'), JSON.stringify({ scores }, null, 2));
const all = (arm) => Object.values(perArm[arm]).flat();
const sum = (arm, k) => all(arm).reduce((s, c) => s + (c.usage[k] ?? 0), 0);
const summary = Object.fromEntries(['A', 'B'].map((arm) => [arm, {
  passed: all(arm).filter((c) => c.status === 'pass').length,
  cases: all(arm).length,
  meanRecall: all(arm).length ? scores.filter((s) => s.arm === arm).reduce((a, s) => a + (s.recall ?? 0), 0) / all(arm).length : null,
  tokensTotal: sum(arm, 'inputTokens') + sum(arm, 'outputTokens') + sum(arm, 'cacheReadTokens') + sum(arm, 'cacheWriteTokens'),
  nullTokenCases: all(arm).filter((c) => c.usage.inputTokens == null).length,
}]));
console.log(JSON.stringify({ summary, perCase: scores.map(({ caseId, rep, arm, fractionalGroups, pass, top5 }) => ({ caseId, rep, arm, fractionalGroups, pass, top5 })) }, null, 2));
