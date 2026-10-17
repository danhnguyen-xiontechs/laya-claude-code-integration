// Supplementary leak check: scans what each agent's tools RETURNED (and its inputs) for answer-key locations outside its work folder.
import fs from 'node:fs';
import path from 'node:path';
const sub = process.argv[2], here = import.meta.dirname;
const u = JSON.parse(fs.readFileSync(path.join(here, 'evidence/subagent-usage.json'), 'utf8'));
const re = /bench[\/]+tasks|subagent-model-router|[\/]hidden[\/]|[\/]solution[\/]|check\.mjs|mutants/i;
const out = {};
for (const f of fs.readdirSync(sub).filter((x) => x.endsWith('.jsonl'))) {
  const txt = fs.readFileSync(path.join(sub, f), 'utf8');
  const first = txt.split('\n').find((l) => l.includes('"type":"user"')) ?? '';
  const key = Object.keys(u).find((k) => first.includes(k + '.') === false && first.includes('work/' + k) );
  if (!key) continue;
  let hits = 0;
  for (const l of txt.split('\n')) { let e; try { e = JSON.parse(l); } catch { continue; } if (e.type !== 'user' && e.type !== 'assistant') continue; if (e.message?.content && typeof e.message.content !== 'string') for (const c of e.message.content) { const s = JSON.stringify(c.type === 'tool_result' ? c.content : c.type === 'tool_use' ? c.input : ''); if (re.test(s)) hits++; } }
  out[key] = hits;
}
fs.writeFileSync(path.join(here, 'evidence/leak-scan.json'), JSON.stringify(out, null, 2));
console.log(Object.keys(out).length, 'agents scanned; total hits', Object.values(out).reduce((a, b) => a + b, 0), JSON.stringify(out));
