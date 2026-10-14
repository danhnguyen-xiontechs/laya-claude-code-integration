import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('samples.json','utf8'));
const WRITE_RE = /\b(submit|approve|reject|cancel|withdraw|upload|save|delete|remove|add|create|edit|update|send|confirm|apply|complete|finish|delegate|sign|accept|decline|assign|book|enrol|enroll|register|reset|change)\w*/i;
// a write verb used as the object of a look-only verb ("check the Cancel button is disabled") is not a write
const LOOK_RE = /\b(check|verify|ensure|confirm that|see|observe|inspect|assert)\b[^;]*\b(button|link|option|tab|is (disabled|enabled|hidden|visible|greyed)|greyed|access is denied|denied)\b/i;
const Q = { writes:{ type:'choice', instructions:'What is the main verb of this test step: one that changes data, or one that only looks at data?',
  criteria:{ write:'Changes data: submit, approve, reject, cancel, withdraw, upload, save, delete, add, create, edit, send, confirm, apply, complete.', read:'Only looks: open, view, navigate, inspect, check, verify, switch view, filter, search, download, read.'} } };
const rows=[];
for (const [a, gold] of S) {
  const r = await fetch('http://localhost:8000/v1/systemone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:{step_action:a},questions:Q,model:'english',max_len:256})}).then(r=>r.json());
  const p=r.answers.writes.probabilities.write;
  const rw = WRITE_RE.test(a) && !LOOK_RE.test(a);
  rows.push({a,gold,p,rw,kw:WRITE_RE.test(a)});
}
const score=(name,f)=>{ let tp=0,fp=0,fn=0,tn=0,uns=0; for(const x of rows){ const v=f(x); if(v==='unsure'){uns++; if(!x.gold) fp+=0; continue;} if(v&&x.gold)tp++; else if(v&&!x.gold)fp++; else if(!v&&x.gold)fn++; else tn++; }
  console.log(`${name.padEnd(34)} missed-writes ${fn}  false-alarms ${fp}  unsure(ask) ${uns}  clean-read ${tn}`); };
score('keyword only', x=>x.kw);
score('keyword + look-exception', x=>x.rw);
score('laya only (p>=.5)', x=>x.p>=0.5);
score('OR(rule, laya)', x=>x.rw||x.p>=0.5);
score('rule decides, laya disagrees→unsure', x=> (x.rw===(x.p>=0.5)) ? x.rw : 'unsure');
for (const x of rows) if ((x.rw!==x.gold) || ((x.p>=0.5)!==x.gold)) console.log(`  gold=${x.gold?'W':'R'} rule=${x.rw?'W':'R'} laya=${x.p.toFixed(2)} | ${x.a}`);
