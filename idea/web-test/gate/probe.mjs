import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('samples.json','utf8'));
const Q = { writes: { type: 'choice', instructions: 'Does performing this test step create, change or delete data in the system (for example submit, approve, reject, cancel, withdraw, upload, save, delete, send)? Only opening, viewing, navigating, filtering, searching or checking a page does not change data.',
  criteria: { write: 'Yes: performing the step changes stored data.', read: 'No: the step only opens, views, navigates or checks something.' } } };
let ok=0;
for (const [a, gold] of S) {
  const t=Date.now();
  const r = await fetch('http://localhost:8000/v1/systemone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:{step_action:a},questions:Q,model:'english',max_len:256})}).then(r=>r.json());
  const p=r.answers.writes.probabilities; const lab=p.write>=p.read?'write':'read';
  const good=(lab==='write')===gold; ok+=good;
  console.log(`${good?'  ':'XX'} gold=${gold?'W':'R'} laya=${lab[0].toUpperCase()} p(write)=${p.write.toFixed(2)} ${Date.now()-t}ms | ${a}`);
}
console.log(`${ok}/${S.length}`);
