#!/usr/bin/env node
// Write <expDir>/capsule-<phase>.md: the small handoff a fresh phase session starts from.
// Built only from manifest.json and the experiment's artifacts, never from chat history.
// Usage: node make_capsule.mjs <expDir> --phase P2|P3|P4 [--max-chars 12000]
import fs from 'node:fs';
import path from 'node:path';

const PHASES = {
  P2: { file: 'phase-2-build.md', model: 'Haiku 5.5, effort xhigh (main model)', trim: 'enforce',
    done: 'Approved design implemented behind its flag on the experiment branch; whole relevant suite run; `unit-tests.json` written from the real output; committed. Hand back in 5 lines or fewer.' },
  P3: { file: 'phase-3-measure.md', model: 'Haiku 5.5, effort xhigh (main model); case agents `haiku-case`, at most 4 in flight', trim: 'off (SMART_TRIM_MODE=observe)',
    done: 'Every case run in both arms (and repetitions) on the commit below; `results.json` per arm and run, evidence saved, `build_tool_report.mjs` run once so `summary.json` exists. Hand back in 5 lines or fewer.' },
  P4: { file: 'phase-4-review-fix-report.md', model: 'Haiku 5.5, effort xhigh (main model); one Opus review subagent with a closed pack', trim: 'enforce for fixes, off for any re-measure',
    done: 'Without accepted findings: Opus review saved to `agent-review.json` (+ `improvements.md` if the result is bad), then stop and hand back the findings. With accepted findings: fixes committed, tests re-run, affected cases re-measured if behaviour changed, both reports rebuilt. Hand back in 5 lines or fewer.' },
};

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : def;
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n).trimEnd()}\n[… clipped, read the file for the rest]`);

const expDir = process.argv[2];
const phase = arg('--phase');
const maxChars = Number(arg('--max-chars', '12000'));   // ~3k tokens
if (!expDir || !PHASES[phase]) {
  console.error('usage: make_capsule.mjs <expDir> --phase P2|P3|P4 [--max-chars N]');
  process.exit(2);
}
const manifest = readJson(path.join(expDir, 'manifest.json'));
if (!manifest) {
  console.error(`no readable manifest.json in ${expDir}`);
  process.exit(1);
}
const P = PHASES[phase];
const rel = (f) => path.join(expDir, f).replace(/\\/g, '/');
const exists = (f) => fs.existsSync(path.join(expDir, f));
const tool = manifest.tool || {};
const out = [];

out.push(`# Capsule ${phase}: ${tool.name || '?'} / ${manifest.experimentId}`, '');
out.push(`Follow \`.claude/skills/build-skill-tool-workflow/phases/${P.file}\`. This capsule is all the context you get: no earlier chat. Do not ask the user for gate decisions; stop and hand back instead.`, '');
out.push('## Setup');
out.push(`- Experiment folder: \`${rel('')}\``);
out.push(`- Tool: ${tool.name || '?'} (${tool.kind || '?'}, engine ${tool.provider || 'none'})`);
out.push(`- Branch: \`${tool.branch || 'not set'}\`, commit: \`${tool.commit || 'not set'}\``);
out.push(`- Status: ${manifest.status}; model: ${P.model}; smart-context-trimming: ${P.trim}`);
if (manifest.baseline) out.push(`- Baseline experiment: \`${manifest.baseline}\``);
const ideaAt = manifest.approvals?.ideaApprovedAt;
out.push(`- Gate A: ${ideaAt ? `approved ${ideaAt}` : 'not recorded (Track E or pending)'}`);

const tests = readJson(path.join(expDir, 'unit-tests.json'))?.suites || [];
if (tests.length) {
  out.push('', '## Tests');
  for (const s of tests) out.push(`- ${s.level || 'suite'}: \`${s.command}\` (last: ${s.passed ?? '?'} pass, ${s.failed ?? '?'} fail)`);
}

const artifacts = ['idea-brief.md', 'design.md', 'context-pack.md', 'unit-tests.json', 'summary.json', 'agent-review.json', 'improvements.md', 'report.html']
  .filter(exists).map((f) => `\`${rel(f)}\``);
out.push('', '## Artifacts to read (paths only, read what the phase file asks for)', artifacts.length ? artifacts.map((a) => `- ${a}`).join('\n') : '- none yet');

const brief = readText(path.join(expDir, 'idea-brief.md'));
if (brief) out.push('', '## Goal (from idea-brief.md)', clip(brief.replace(/\r/g, '').trim(), 2500));

if (phase === 'P3' || phase === 'P4') {
  const crit = manifest.evaluation?.criteriaFrozenAt;
  out.push('', '## Measurement', `- Design frozen: ${crit || 'NOT frozen (freeze design.md before measuring)'}`,
    `- Cases: ${manifest.evaluation?.caseCount ?? '?'}, repetitions: ${manifest.evaluation?.repetitions ?? '?'}`);
}

if (phase === 'P4') {
  const s = readJson(path.join(expDir, 'summary.json'));
  if (s) {
    const a = s.arms?.A || {}, b = s.arms?.B || {};
    out.push('', '## Results (summary.json)',
      `- Pass A ${a.pass ?? '?'}/${a.cases ?? '?'}, B ${b.pass ?? '?'}/${b.cases ?? '?'}; paired cases ${s.pairedCases ?? '?'}; worse cases ${(s.regressions || []).length}`,
      `- Paired tokens A ${a.pairedTokens ?? '?'} → B ${b.pairedTokens ?? '?'}`,
      `- Recommendation so far: ${s.recommendation || '?'} (${s.confidence || '?'})`);
  } else out.push('', '## Results', '- `summary.json` missing: run P3 first.');
  const findings = readJson(path.join(expDir, 'agent-review.json'))?.findings || [];
  const accepted = findings.filter((f) => /^accepted/i.test(f.resolution || ''));
  const open = findings.filter((f) => !f.resolution);
  out.push('', '## Review findings');
  if (!findings.length) out.push('- none yet: run step 4a (Opus review).');
  else {
    out.push(`- ${findings.length} total, ${accepted.length} accepted by the user to fix, ${open.length} undecided.`);
    for (const f of accepted) out.push(`- FIX [${f.severity}] ${clip(String(f.finding), 300)}${f.ref ? ` (${f.ref})` : ''}${f.proposedFix ? ` → ${clip(String(f.proposedFix), 200)}` : ''}`);
  }
}

out.push('', '## Done when', P.done, '',
  'Keep output quiet: scripts print one line, git with `-q` and `-c core.safecrlf=false`, long output through `| tail -n 5`; never paste diffs or logs into chat.');

let text = out.join('\n') + '\n';
if (text.length > maxChars) text = clip(text, maxChars - 60) + '\n';
const file = path.join(expDir, `capsule-${phase}.md`);
fs.writeFileSync(file, text);
console.log(`capsule ${phase}: ${file.replace(/\\/g, '/')} (${text.length} chars, ~${Math.ceil(text.length / 4)} tokens)`);
