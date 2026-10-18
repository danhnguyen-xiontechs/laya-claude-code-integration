// Content run for 20261018-sct-rerun-01 (collapseReruns). Builds 8 retry sequences from REAL recorded outputs and writes
// what Claude would read on each run, for two arms:
//   A = trimmed output of the round-2 code (collapseReruns off, memory null)
//   B = trimmed output with the re-run collapse (one memory per sequence, as the register hook keeps one per session)
// Re-run edits are deterministic and listed per sequence (same | volatile | fix | new); the base outputs are real.
// Guardrail: every diagnostic line that is new against the previous run's raw output and that A shows must also be
// shown verbatim by B (checked per run, reported in content-run.json as missingInB).
//
// Usage:
//   node content_run.mjs                  → writes evidence/texts/*, evidence/raw/*, content-run.json
//   node content_run.mjs list             → prints the re-run text files to count (identical texts once)
//   node content_run.mjs summarize        → reads evidence/token-count.json, writes content-summary.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EXP = import.meta.dirname;
const REPO = path.resolve(EXP, '../../../..');
const core = await import(pathToFileURL(path.resolve(EXP, '../../../../smart-context-trimming/hooks/trim-core.ts')).href);
const OPT = { ...core.DEFAULTS, useJev: false, collapseReruns: true };
const R2 = 'reports/skill-tool-lifecycle/smart-context-trimming/20261018-sct-r2-agent-01/evidence/texts';
const TEXTS = path.join(EXP, 'evidence/texts');
const RAWS = path.join(EXP, 'evidence/raw');

const BASES = {
  'dotnet-build': { file: `${REPO}/${R2}/dotnet-build.A.txt`, command: 'dotnet build --nologo -clp:NoSummary;Summary', source: 'round-2 agent run, case dotnet-build, arm A raw output' },
  'js-feature': { file: `${REPO}/${R2}/js-feature.A.txt`, command: 'node --test', source: 'round-2 agent run, case js-feature, arm A raw output' },
  'js-one-bug': { file: `${REPO}/${R2}/js-one-bug.A.txt`, command: 'node --test', source: 'round-2 agent run, case js-one-bug, arm A raw output' },
  'js-three-bugs': { file: `${REPO}/${R2}/js-three-bugs.A.txt`, command: 'node --test', source: 'round-2 agent run, case js-three-bugs, arm A raw output' },
  'js-root-exception': { file: `${REPO}/${R2}/js-root-exception.A.txt`, command: 'node --test', source: 'round-2 agent run, case js-root-exception, arm A raw output' },
  'dotnet-test-raw': { file: path.join(EXP, 'evidence/base/dotnet-test-raw.log'), command: 'dotnet test --no-build', source: 'local raw log saved by the observe-mode mod on 2026-10-15 (command text not recorded; assumed)' },
};

// 8 sequences: a real base output, then two re-run edits (r2 = edit1(r1), r3 = edit2(r2))
const SEQS = [
  { id: 'S1-build-flaky', base: 'dotnet-build', edits: ['same', 'same'] },
  { id: 'S2-build-error-fixed', base: 'dotnet-build', edits: ['fix', 'same'] },
  { id: 'S3-js-root-volatile', base: 'js-root-exception', edits: ['volatile', 'same'] },
  { id: 'S4-js-root-two-fixed', base: 'js-root-exception', edits: ['fix', 'fix'] },
  { id: 'S5-js-three-new-failure', base: 'js-three-bugs', edits: ['new', 'same'] },
  { id: 'S6-js-feature-flaky', base: 'js-feature', edits: ['same', 'volatile'] },
  { id: 'S7-js-one-bug-fixed', base: 'js-one-bug', edits: ['fix', 'volatile'] },
  { id: 'S8-dotnet-test-volatile', base: 'dotnet-test-raw', edits: ['volatile', 'same'] },
];

const edit = (kind, text, base) => {
  if (kind === 'same') return text;
  if (kind === 'volatile') return text.replace(/\b(\d+)(\s?)ms\b/g, (_m, n, sp) => `${Number(n) + 3}${sp}ms`);
  const lines = core.splitLines(text);
  const cands = core.extractCandidates(lines);
  if (kind === 'fix') {
    // one real failure or compile error goes away (the fix): the first block of that kind in the text
    const kinds = base === 'dotnet-build' ? ['compiler_error'] : ['failed_test', 'exception'];
    const c = cands.find((x) => kinds.includes(x.kind));
    if (!c) throw new Error(`no ${kinds} block to fix in ${base}`);
    lines.splice(c.line_start - 1, c.line_end - c.line_start + 1);
    return lines.join('\n');
  }
  if (kind === 'new') {
    // a new failure: a copy of a real failure block whose head line carries a new test name
    const c = cands.find((x) => x.kind === 'failed_test' && x.line_end > x.line_start) ?? cands.find((x) => x.kind === 'failed_test');
    if (!c) throw new Error(`no failure block to copy in ${base}`);
    const block = lines.slice(c.line_start - 1, c.line_end).map((l, i) => (i === 0 ? `${l} [retry]` : l));
    lines.splice(c.line_end, 0, ...block);
    return lines.join('\n');
  }
  throw new Error(`unknown edit ${kind}`);
};

const hasFailure = (raw) => core.extractCandidates(core.splitLines(raw)).some((c) => c.mandatory && c.kind !== 'exit_status' && c.kind !== 'summary');
const statusFor = (raw) => (hasFailure(raw) ? 'Command FAILED (Exit code 1); the error status is preserved.' : 'Command succeeded (exit code 0).');
const mandatoryLines = (raw) => {
  const lines = core.splitLines(raw);
  return core.extractCandidates(lines).filter((c) => c.mandatory).flatMap((c) => lines.slice(c.line_start - 1, c.line_end)).filter((l) => l.trim());
};
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const bytes = (s) => Buffer.byteLength(s);
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function build() {
  const report = { experiment: '20261018-sct-rerun-01', options: OPT, sequences: [] };
  for (const seq of SEQS) {
    const base = BASES[seq.base];
    const raw = [fs.readFileSync(base.file, 'utf8')];
    for (const k of seq.edits) raw.push(edit(k, raw[raw.length - 1], seq.base));
    const memory = core.newRerunMemory(); // one per sequence = one per session in the hook
    const s = { id: seq.id, base: seq.base, command: base.command, source: base.source, edits: ['base', ...seq.edits], runs: [] };
    for (let i = 0; i < raw.length; i++) {
      const n = i + 1;
      const text = raw[i];
      const status = statusFor(text);
      const rawPath = `/raw/${seq.id}.r${n}.log`;
      write(path.join(RAWS, `${seq.id}.r${n}.txt`), text);
      const a = await core.decideAndBuild({ command: base.command, text, opt: OPT, statusLine: status, rawPath, memory: null });
      const b = await core.decideAndBuild({ command: base.command, text, opt: OPT, statusLine: status, rawPath, memory });
      const aText = a.built?.text ?? text;
      const bText = b.built?.text ?? text;
      write(path.join(TEXTS, `${seq.id}.r${n}.A.txt`), aText);
      write(path.join(TEXTS, `${seq.id}.r${n}.B.txt`), bText);
      // "new" compares volatile-normalised lines, the same rule the collapse uses (durations, timestamps, temp paths are not changes)
      const prevN = i === 0 ? new Set() : new Set(core.splitLines(raw[i - 1]).map(core.normaliseVolatile));
      const fresh = i === 0 ? [] : [...new Set(mandatoryLines(text).filter((l) => !prevN.has(core.normaliseVolatile(l))))];
      const volatileOnly = i === 0 ? 0 : mandatoryLines(text).filter((l) => !core.splitLines(raw[i - 1]).includes(l) && prevN.has(core.normaliseVolatile(l))).length;
      const shownByA = fresh.filter((l) => aText.includes(l));
      s.runs.push({
        run: n, status, rawBytes: bytes(text), rawLines: text.split('\n').length,
        A: { bytes: bytes(aText), lines: aText.split('\n').length, action: a.plan.action, reason: a.plan.reason, file: `evidence/texts/${seq.id}.r${n}.A.txt` },
        B: { bytes: bytes(bText), lines: bText.split('\n').length, action: b.plan.action, reason: b.plan.reason, collapsed: b.plan.reason.includes('rerun_collapsed'), file: `evidence/texts/${seq.id}.r${n}.B.txt` },
        newDiagnostics: fresh.length, newShownByA: shownByA.length, newNotShownByA: fresh.length - shownByA.length, volatileOnlyLines: volatileOnly,
        missingInB: shownByA.filter((l) => !bText.includes(l)),
      });
    }
    report.sequences.push(s);
  }
  write(path.join(EXP, 'content-run.json'), JSON.stringify(report, null, 2));
  console.log(`wrote ${SEQS.length} sequences to content-run.json`);
}

function listFiles() {
  // re-runs only (run 2 and 3); identical texts are counted once, under the first path
  const seen = new Map();
  for (const seq of SEQS) for (const n of [2, 3]) for (const arm of ['A', 'B']) {
    const p = path.join('evidence/texts', `${seq.id}.r${n}.${arm}.txt`);
    const h = hash(fs.readFileSync(path.join(EXP, p), 'utf8'));
    if (!seen.has(h)) seen.set(h, p);
  }
  return [...seen.values()];
}

function summarize() {
  const report = JSON.parse(fs.readFileSync(path.join(EXP, 'content-run.json'), 'utf8'));
  // token-count.json may hold the first attempt and a retry (token-count-retry.json); a later non-null count wins
  const counts = {};
  for (const f of ['evidence/token-count.json', 'evidence/token-count-retry.json']) {
    if (!fs.existsSync(path.join(EXP, f))) continue;
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(EXP, f), 'utf8')).files)) {
      if (v !== null) counts[k.replace(/\\/g, '/')] = v;
    }
  }
  const tokensOf = (p) => {
    const h = hash(fs.readFileSync(path.join(EXP, p), 'utf8'));
    const same = listFiles().find((q) => hash(fs.readFileSync(path.join(EXP, q), 'utf8')) === h);
    const t = counts[same.replace(/\\/g, '/')];
    if (t === undefined || t === null) throw new Error(`no token count for ${p} (${same})`);
    return t;
  };
  let totA = 0, totB = 0, missing = 0, newDiag = 0, notShown = 0;
  const perSeq = report.sequences.map((s) => {
    let a = 0, b = 0;
    for (const r of s.runs.filter((x) => x.run > 1)) {
      a += tokensOf(r.A.file);
      b += tokensOf(r.B.file);
      missing += r.missingInB.length;
      newDiag += r.newDiagnostics;
      notShown += r.newNotShownByA;
    }
    totA += a; totB += b;
    return { id: s.id, rerunTokensA: a, rerunTokensB: b, savingPct: +(100 * (1 - b / a)).toFixed(1), collapsedRuns: s.runs.filter((x) => x.B.collapsed).length, rerunRuns: s.runs.length - 1 };
  });
  const saving = +(100 * (1 - totB / totA)).toFixed(1);
  const summary = {
    experiment: report.experiment, unit: 'input tokens of re-run texts (run 2 and 3 of each sequence), count_tokens.mjs, haiku',
    rerunTokensA: totA, rerunTokensB: totB, savingPct: saving,
    target: '>= 50% fewer tokens on re-runs; every new or changed diagnostic line still shown',
    targetMet: saving >= 50 && missing === 0,
    guardrail: { newDiagnosticLines: newDiag, shownByA: newDiag - notShown, notShownByAEvenBefore: notShown, missingInB: missing },
    perSequence: perSeq,
  };
  write(path.join(EXP, 'content-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ rerunTokensA: totA, rerunTokensB: totB, savingPct: saving, missingInB: missing, targetMet: summary.targetMet }, null, 2));
}

if (process.argv[2] === 'list') console.log(listFiles().join('\n'));
else if (process.argv[2] === 'summarize') summarize();
else await build();
