// Scores eval/results/raw-*.jsonl against the ground truth in eval/data/*.json, using each skill's own decision
// rules (thresholds from eval/questions.mjs). Writes eval/results/summary.json.   node eval/analyze.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE, gateRule, VERDICT, ORACLE, WAIT } from './questions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = (n) => JSON.parse(fs.readFileSync(path.join(here, 'data', n), 'utf8'));
const rawFile = (task, engine) => path.join(here, 'results', `raw-${task}-${engine}.jsonl`);
const raw = (task, engine) => fs.readFileSync(rawFile(task, engine), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r3 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(3)));
const pct = (n, d) => (d ? r3(n / d) : null);
const top = (probs = {}) => { const s = Object.entries(probs).sort((a, b) => b[1] - a[1]); return { label: s[0]?.[0] ?? null, p: s[0]?.[1] ?? 0 }; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pctile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };

/** Group raw rows by item id → { laya: [row], jev: [row, row, row] } */
function group(task) {
  const g = {};
  for (const engine of ['laya', 'jev']) for (const r of raw(task, engine)) ((g[r.id] ??= {})[engine] ??= []).push(r);
  return g;
}
const perf = (task) => Object.fromEntries(['laya', 'jev'].map((e) => {
  const rows = raw(task, e); const lat = rows.map((r) => r.latencyMs);
  return [e, { calls: rows.length, ok: rows.filter((r) => r.ok).length, p50ms: median(lat), p95ms: pctile(lat, 0.95), costUsd: r3(rows.reduce((s, r) => s + (r.cost || 0), 0) * 1e5 / 1e5) , costPerCallUsd: e === 'jev' ? Number((rows.reduce((s, r) => s + (r.cost || 0), 0) / rows.length).toFixed(7)) : 0 }];
}));

// ---------------------------------------------------------------------------------------------------- gate
function gate() {
  const items = data('gate.json'); const g = group('gate');
  const pw = (row) => row?.answers?.writes?.probabilities?.write ?? null;
  const preds = (it) => {
    const L = pw(g[it.id].laya?.[0]);
    const Js = g[it.id].jev.map(pw).filter((x) => x !== null).map((p) => p >= GATE.P);
    const jevVotes = Js.filter(Boolean).length;
    return { rule: gateRule(it.text), laya: L !== null && L >= GATE.P, layaP: L, jev: jevVotes * 2 > Js.length, jevP: g[it.id].jev.map(pw), jevStable: jevVotes === 0 || jevVotes === Js.length };
  };
  const score = (rows, key) => {
    const w = rows.filter((r) => r.it.truth === 'write'), rd = rows.filter((r) => r.it.truth === 'read');
    const f = (r) => (typeof key === 'function' ? key(r.p) : r.p[key]);
    return { missedWrites: `${w.filter((r) => !f(r)).length}/${w.length}`, falseFlagsOnReads: `${rd.filter(f).length}/${rd.length}`,
      recall: pct(w.filter(f).length, w.length), fpr: pct(rd.filter(f).length, rd.length), accuracy: pct(rows.filter((r) => f(r) === (r.it.truth === 'write')).length, rows.length) };
  };
  const rows = items.map((it) => ({ it, p: preds(it) }));
  const out = { perf: perf('gate') };
  for (const [name, sel] of [['heldout', (r) => r.it.set === 'heldout'], ['dev', (r) => r.it.set === 'dev'], ['all', () => true]]) {
    const sub = rows.filter(sel);
    out[name] = { n: sub.length, rule: score(sub, 'rule'), laya: score(sub, 'laya'), jev: score(sub, 'jev'),
      ruleOrLaya: score(sub, (p) => p.rule || p.laya), ruleOrJev: score(sub, (p) => p.rule || p.jev) };
  }
  // the false flags are what costs agent turns: each one becomes a "disputed" step the agent must re-check
  out.jevUnstableItems = rows.filter((r) => !r.p.jevStable).map((r) => r.it.text);
  out.layaMisses = rows.filter((r) => r.it.truth === 'write' && !r.p.laya).map((r) => r.it.text);
  out.jevMisses = rows.filter((r) => r.it.truth === 'write' && !r.p.jev).map((r) => r.it.text);
  out.layaFalseFlags = rows.filter((r) => r.it.truth === 'read' && r.p.laya).map((r) => ({ text: r.it.text, p: r3(r.p.layaP) }));
  out.jevFalseFlags = rows.filter((r) => r.it.truth === 'read' && r.p.jev).map((r) => ({ text: r.it.text, p: r.p.jevP }));
  // separability: do write and read probabilities overlap? (Laya report: 0.44–0.85 vs 0.51–0.73)
  const range = (xs) => (xs.length ? [r3(Math.min(...xs)), r3(Math.max(...xs))] : null);
  out.probRange = { layaWrite: range(rows.filter((r) => r.it.truth === 'write').map((r) => r.p.layaP)), layaRead: range(rows.filter((r) => r.it.truth === 'read').map((r) => r.p.layaP)),
    jevWrite: range(rows.filter((r) => r.it.truth === 'write').flatMap((r) => r.p.jevP)), jevRead: range(rows.filter((r) => r.it.truth === 'read').flatMap((r) => r.p.jevP)) };
  return out;
}

// ---------------------------------------------------------------------------------------------------- verdict
function verdictScore(items, g, labels, decide) {
  const out = {};
  for (const engine of ['laya', 'jev']) {
    const recs = [];
    for (const it of items) for (const row of g[it.id][engine] ?? []) {
      const a = row.answers?.verdict; if (!a) continue; const t = top(a.probabilities); recs.push({ it, ...t, d: decide(t, it) });
    }
    out[engine] = summarize(recs, labels);
  }
  return out;
}
function summarize(recs, labels) {
  const n = recs.length;
  const reps = recs.length ? Math.max(...Object.values(recs.reduce((a, r) => ((a[r.it.id] = (a[r.it.id] || 0) + 1), a), {}))) : 1;
  const decided = recs.filter((r) => r.d.kind === 'engine'), conf = recs.filter((r) => r.d.kind === 'engine' && !r.d.review);
  const correct = (r) => r.d.status === r.it.truth || (r.it.truth === 'not-pass' && r.d.status !== 'pass');
  const confusion = {};
  for (const r of recs) { const k = `${r.it.truth}→${r.label}`; confusion[k] = (confusion[k] || 0) + 1; }
  return { n, accuracyTopLabel: pct(recs.filter((r) => r.label === r.it.truth || (r.it.truth === 'not-pass' && r.label !== 'pass')).length, n),
    decidedByEngine: pct(decided.length, n), decidedPrecision: pct(decided.filter(correct).length, decided.length),
    confidentNoReview: pct(conf.length, n), confidentPrecision: pct(conf.filter(correct).length, conf.length),
    sentToAgent: pct(recs.filter((r) => r.d.kind !== 'engine').length, n),
    falsePass: `${recs.filter((r) => r.d.status === 'pass' && r.it.truth !== 'pass').length}/${recs.filter((r) => r.it.truth !== 'pass').length}`,
    falsePassPerRun: r3(recs.filter((r) => r.d.status === 'pass' && r.it.truth !== 'pass').length / reps),
    wrongDecidedPerRun: r3(decided.filter((r) => !correct(r)).length / reps), itemsPerRun: n / reps,
    falseFailOnPass: `${r3(recs.filter((r) => r.d.status === 'fail' && r.it.truth === 'pass').length / reps)}/${r3(recs.filter((r) => r.it.truth === 'pass').length / reps)}`, medianP: r3(median(recs.map((r) => r.p))), confusion };
}

function verdict() {
  const items = data('verdict.json'); const g = group('verdict');
  const decide = (t) => (t.p >= VERDICT.LOW ? { kind: 'engine', status: t.label, review: t.p < VERDICT.HIGH } : { kind: 'agent', status: 'review' });
  const out = { perf: perf('verdict'), all: verdictScore(items, g, ['pass', 'fail', 'blocked'], decide), bySet: {} };
  for (const s of ['real', 'mut-fail', 'mut-blocked', 'hw']) out.bySet[s] = { n: items.filter((i) => i.set === s).length, ...verdictScore(items.filter((i) => i.set === s), g, ['pass', 'fail', 'blocked'], decide) };
  // threshold sensitivity (the skill's cut-offs were set for Laya)
  out.sweep = {};
  for (const engine of ['laya', 'jev']) {
    out.sweep[engine] = [0.5, 0.6, 0.7, 0.85, 0.95, 0.99].map((t) => {
      const recs = items.flatMap((it) => (g[it.id][engine] ?? []).map((row) => ({ it, ...top(row.answers?.verdict?.probabilities) })));
      const d = recs.filter((r) => r.p >= t);
      return { t, decided: pct(d.length, recs.length), precision: pct(d.filter((r) => r.label === r.it.truth).length, d.length) };
    });
  }
  // stability of Jev across the 3 repeats
  out.jevUnstable = items.filter((it) => new Set(g[it.id].jev.map((r) => top(r.answers?.verdict?.probabilities).label)).size > 1).map((it) => ({ id: it.id, labels: g[it.id].jev.map((r) => top(r.answers?.verdict?.probabilities).label) }));
  out.pRange = Object.fromEntries(['laya', 'jev'].map((e) => [e, (() => { const ps = items.flatMap((it) => (g[it.id][e] ?? []).map((r) => top(r.answers?.verdict?.probabilities).p)); return { min: r3(Math.min(...ps)), median: r3(median(ps)), max: r3(Math.max(...ps)), below60: pct(ps.filter((p) => p < 0.6).length, ps.length), atLeast85: pct(ps.filter((p) => p >= 0.85).length, ps.length) }; })()]));
  out.errors = Object.fromEntries(['laya', 'jev'].map((e) => [e, items.flatMap((it) => { const row = (g[it.id][e] ?? [])[0]; const t = top(row?.answers?.verdict?.probabilities); return t.label !== it.truth && t.p >= VERDICT.LOW ? [{ id: it.id, truth: it.truth, said: t.label, p: r3(t.p), expected: it.expected.slice(0, 90), actual: it.actual.slice(0, 120) }] : []; })]));
  // history: what Laya said in the real runs (verdict.laya in results.json) vs the final status
  const hist = items.filter((i) => i.set === 'real' && i.historicLaya);
  out.historicRealRuns = { n: hist.length, sameAsFinal: hist.filter((i) => i.historicLaya.label === i.truth).length, decidedAt60: hist.filter((i) => i.historicLaya.p >= 0.6).length };
  return out;
}

// ---------------------------------------------------------------------------------------------------- oracle
function oracle() {
  const allItems = data('oracle.json'); const g = group('oracle');
  const bySet = {};
  let items = allItems;
  const ruleOf = (it) => { const frags = ORACLE.quoted(it.expected); if (it.loading) return { kind: 'rule', status: 'not_ready' };
    const text = it.observed.join(' | ').toLowerCase();
    return frags.length && frags.every((f) => text.includes(f.toLowerCase())) && !ORACLE.ERROR_RE.test(it.observed.join(' ')) ? { kind: 'rule', status: 'pass' } : null; };
  const decide = (t, it) => { const r = ruleOf(it); if (r) return r;
    if ((t.label === 'pass' && t.p >= ORACLE.PASS_MIN) || (t.label === 'fail' && t.p >= ORACLE.FAIL_MIN)) return { kind: 'engine', status: t.label, review: false };
    return { kind: 'agent', status: 'review' }; };
  const out = { perf: perf('oracle'), ruleDecided: items.filter(ruleOf).length, ruleFalsePass: items.filter((it) => ruleOf(it)?.status === 'pass' && it.truth !== 'pass').length };
  const scoreEngine = (engine, subset) => {
    const recs = [];
    for (const it of subset) for (const row of g[it.id][engine] ?? []) { const t = top(row.answers?.verdict?.probabilities); recs.push({ it, ...t, d: decide(t, it) }); }
    const reps = recs.length ? recs.length / subset.length : 1;
    const byTruth = (tr) => recs.filter((r) => r.it.truth === tr);
    const pass = byTruth('pass'), fail = byTruth('fail'), np = byTruth('not-pass'), nr = byTruth('not_ready');
    const dec = (r, s) => r.d.status === s && r.d.kind !== 'agent';
    return {
      n: subset.length,
      passRecall: pct(pass.filter((r) => dec(r, 'pass')).length, pass.length),
      failCatch: pct(fail.filter((r) => dec(r, 'fail')).length, fail.length),
      falsePassPerRun: r3(recs.filter((r) => dec(r, 'pass') && r.it.truth !== 'pass').length / reps),
      nonPassItems: (fail.length + np.length + nr.length) / reps,
      falseFailPerRun: r3(pass.filter((r) => dec(r, 'fail')).length / reps), passItems: pass.length / reps,
      notPassHandled: pct(np.filter((r) => !dec(r, 'pass')).length, np.length),
      notReadyNotPassed: pct(nr.filter((r) => !dec(r, 'pass')).length, nr.length),
      engineDecidedShare: pct(recs.filter((r) => r.d.kind === 'engine').length, recs.length),
      sentToAgent: pct(recs.filter((r) => r.d.kind === 'agent').length, recs.length),
      labelDist: Object.fromEntries(Object.entries(recs.reduce((a, r) => ((a[r.label] = (a[r.label] || 0) + 1), a), {})).map(([k, v]) => [k, r3(v / reps)])),
      topLabelAccuracy: pct(recs.filter((r) => r.label === r.it.truth || (r.it.truth === 'not-pass' && r.label !== 'pass')).length, recs.length),
      falsePassItems: [...new Set(recs.filter((r) => dec(r, 'pass') && r.it.truth !== 'pass').map((r) => `${r.it.id} (${r.it.truth}, p=${r3(r.p)})`))],
      falseFailItems: [...new Set(pass.filter((r) => dec(r, 'fail')).map((r) => r.it.id))],
    };
  };
  for (const engine of ['laya', 'jev']) {
    out[engine] = scoreEngine(engine, allItems);
    out.bySet ??= {};
    for (const s of ['real', 'mut-fail', 'mut-blocked', 'hw', 'not-ready']) (out.bySet[s] ??= {})[engine] = scoreEngine(engine, allItems.filter((i) => i.set === s));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- wait
function wait() {
  const items = data('wait.json'); const g = group('wait');
  const regexLogin = (it) => WAIT.LOGIN_RE.test(it.text) || WAIT.LOGIN_RE.test(it.url) || WAIT.LOGIN_RE.test(it.title);
  const regexError = (it) => WAIT.ERROR_RE.test(it.text);
  const ans = (row, q) => top(row?.answers?.[q]?.probabilities);
  const out = { perf: perf('wait'), regexLoginCatches: items.filter((i) => i.truth.login && regexLogin(i)).length, loginItems: items.filter((i) => i.truth.login).length,
    regexErrorCatches: items.filter((i) => i.truth.state === 'error' && regexError(i)).length, errorItems: items.filter((i) => i.truth.state === 'error').length };
  for (const engine of ['laya', 'jev']) {
    const recs = items.flatMap((it) => (g[it.id][engine] ?? []).map((row) => ({ it, st: ans(row, 'state'), sc: ans(row, 'screen'), lg: ans(row, 'login') })));
    const sure = (a) => a.p >= WAIT.MIN_P;
    const ready = recs.filter((r) => r.it.truth.state === 'ready' && !r.it.truth.login), loading = recs.filter((r) => r.it.truth.state === 'loading'), err = recs.filter((r) => r.it.truth.state === 'error');
    const login = recs.filter((r) => r.it.truth.login), notLogin = recs.filter((r) => !r.it.truth.login);
    const loginMiss = login.filter((r) => !regexLogin(r.it)), errMiss = err.filter((r) => !regexError(r.it));
    const loginMissClean = loginMiss.filter((r) => !r.it.truth.debatable);
    const reps = recs.length / items.length;
    const fpNav = recs.filter((r) => r.it.set === 'with-nav' && !r.it.truth.login), fpClean = recs.filter((r) => r.it.set === 'clean' && !r.it.truth.login);
    const app = recs.filter((r) => !r.it.truth.login && r.it.truth.state !== 'error' && r.it.truth.screen !== 'unknown');
    out[engine] = {
      n: recs.length,
      readyCalledLoading: `${ready.filter((r) => r.st.label === 'loading' && sure(r.st)).length}/${ready.length}`,
      readyCalledLoadingAny: `${ready.filter((r) => r.st.label === 'loading').length}/${ready.length}`,
      readyCalledReady: `${ready.filter((r) => r.st.label === 'ready' && sure(r.st)).length}/${ready.length}`,
      loadingCalledLoading: `${loading.filter((r) => r.st.label === 'loading' && sure(r.st)).length}/${loading.length}`,
      loadingCalledReady: `${loading.filter((r) => r.st.label === 'ready' && sure(r.st)).length}/${loading.length}`,
      stateAccuracyAll: pct(recs.filter((r) => r.st.label === r.it.truth.state).length, recs.length),
      loginDetected: `${login.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${login.length}`,
      loginDetectedWhereRegexMisses: `${loginMiss.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${loginMiss.length}`,
      loginDetectedWhereRegexMissesNoDebatable: `${loginMissClean.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${loginMissClean.length}`,
      loginFalsePositives: `${notLogin.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${notLogin.length}`,
      loginFalsePositivesCleanPages: `${fpClean.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${fpClean.length}`,
      loginFalsePositivesNavPages: `${fpNav.filter((r) => r.lg.label === 'true' && sure(r.lg)).length}/${fpNav.length}`,
      readyWrongOnNav: `${recs.filter((r) => r.it.set === 'with-nav' && r.it.truth.state === 'ready' && !(r.st.label === 'ready' && sure(r.st))).length}/${recs.filter((r) => r.it.set === 'with-nav' && r.it.truth.state === 'ready').length}`,
      errorDetected: `${err.filter((r) => r.st.label === 'error' && sure(r.st)).length}/${err.length}`,
      errorDetectedWhereRegexMisses: `${errMiss.filter((r) => r.st.label === 'error' && sure(r.st)).length}/${errMiss.length}`,
      errorFalsePositives: `${recs.filter((r) => r.it.truth.state !== 'error' && r.st.label === 'error' && sure(r.st)).length}/${recs.filter((r) => r.it.truth.state !== 'error').length}`,
      screenCorrectSure: `${app.filter((r) => r.sc.label === r.it.truth.screen && sure(r.sc)).length}/${app.length}`,
      screenWrongSure: `${app.filter((r) => r.sc.label !== r.it.truth.screen && sure(r.sc)).length}/${app.length}`,
      screenSureShare: pct(app.filter((r) => sure(r.sc)).length, app.length),
      medianP: { state: r3(median(recs.map((r) => r.st.p))), screen: r3(median(recs.map((r) => r.sc.p))), login: r3(median(recs.map((r) => r.lg.p))) },
      readyCalledLoadingItems: [...new Set(ready.filter((r) => r.st.label === 'loading' && sure(r.st)).map((r) => r.it.id))],
      loginMissedItems: [...new Set(login.filter((r) => !(r.lg.label === 'true' && sure(r.lg))).map((r) => r.it.id))],
      loginFalsePositiveItems: [...new Set(notLogin.filter((r) => r.lg.label === 'true' && sure(r.lg)).map((r) => r.it.id))],
      errorMissedItems: [...new Set(err.filter((r) => !(r.st.label === 'error' && sure(r.st))).map((r) => r.it.id))],
    };
  }
  return out;
}

const summary = { generatedAt: new Date().toISOString(), jevModel: raw('gate', 'jev')[0]?.model, gate: gate(), verdict: verdict(), oracle: oracle(), wait: wait() };
fs.writeFileSync(path.join(here, 'results', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('summary written:', path.join(here, 'results', 'summary.json'));
