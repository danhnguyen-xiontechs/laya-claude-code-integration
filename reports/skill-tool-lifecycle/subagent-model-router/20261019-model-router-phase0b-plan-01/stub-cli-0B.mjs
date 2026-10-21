// Stub stand-in for claude.exe, used only by stub-test-0B.mjs. Makes no model call and costs nothing.
// Behaviour is set by env: STUB_MODE (ok | nocost | error | empty | overcap | badgrade), STUB_COST (USD per call), STUB_LOG (jsonl path).
// nocost: as ok, but the first generation omits total_cost_usd, so the runner must charge it at the cap.
import fs from 'node:fs';

const prompt = fs.readFileSync(0, 'utf8');
const mode = process.env.STUB_MODE || 'ok';
const cost = Number(process.env.STUB_COST || '0.01');
const log = process.env.STUB_LOG;

const isGrader = prompt.includes('Criterion ids:');
const prev = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const sameKind = prev.filter((r) => r.grader === isGrader).length; // 0 on the first call of this kind
fs.appendFileSync(log, JSON.stringify({ n: prev.length + 1, grader: isGrader, args: process.argv.slice(2), promptChars: prompt.length }) + '\n');

if (mode === 'error') {
  console.error('stub failure');
  process.exit(1);
}

const okLike = mode === 'ok' || mode === 'nocost';
let result;
let total = cost;
if (isGrader) {
  if (mode === 'badgrade' && sameKind === 0) {
    result = 'this is not json';
  } else {
    const ids = prompt.match(/Criterion ids: (.*)/)[1].split(',').map((s) => s.trim());
    const g = {};
    ids.forEach((id, i) => {
      if (id.startsWith('E')) g[id] = { result: 'absent', quote: 'none' };
      else g[id] = { result: 'pass', quote: i === 0 && okLike ? 'NOT IN ANSWER' : 'none' };
    });
    g.overall = 'pass';
    result = JSON.stringify(g);
  }
} else {
  if (mode === 'empty' && sameKind === 0) result = '';
  else result = okLike ? 'Stub answer. I ran the tests and they pass (see Foo.cs:12).' : 'Stub answer.';
  if (mode === 'overcap' && sameKind === 0) total = 0.5;
  if (mode === 'nocost' && sameKind === 0) total = undefined; // omitted from the JSON, so the runner charges the cap
}
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: total }));
