import fs from 'node:fs';
const S = JSON.parse(fs.readFileSync('samples.json','utf8'));
const variants = {
  'choice/english/verb': { model:'english', q:{ writes:{ type:'choice', instructions:'What is the main verb of this test step: one that changes data, or one that only looks at data?',
     criteria:{ write:'Changes data: submit, approve, reject, cancel, withdraw, upload, save, delete, add, create, edit, send, confirm, apply, complete.', read:'Only looks: open, view, navigate, inspect, check, verify, switch view, filter, search, download, read.'} } } },
  'noul/english': { model:'english', q:{ writes:{ type:'noul', instructions:'Performing this test step creates, changes or deletes stored data (submit, approve, reject, cancel, upload, save, delete, add, send). Opening, viewing, checking, filtering or downloading does not.' } } },
  'noul/typed': { model:'typed-decisions', q:{ writes:{ type:'noul', instructions:'Performing this test step creates, changes or deletes stored data (submit, approve, reject, cancel, upload, save, delete, add, send). Opening, viewing, checking, filtering or downloading does not.' } } },
  'choice/typed': { model:'typed-decisions', q:{ writes:{ type:'choice', instructions:'Does this test step change stored data?', criteria:{ write:'Yes, it submits, approves, rejects, cancels, uploads, saves, deletes, adds or sends something.', read:'No, it only opens, views, navigates, checks, filters, searches or downloads.'} } } },
};
for (const [name, v] of Object.entries(variants)) {
  let ok=0, wr=0, wt=0, ps=[];
  for (const [a, gold] of S) {
    const r = await fetch('http://localhost:8000/v1/systemone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({state:{step_action:a},questions:v.q,model:v.model,max_len:256})}).then(r=>r.json());
    const ans=r.answers?.writes; if(!ans){ console.log(name,'ERR',JSON.stringify(r).slice(0,200)); break; }
    const pw = ans.noul ?? ans.probabilities?.write; const w = pw>=0.5;
    ok += (w===gold); if (gold){ wt++; wr+=w; } ps.push([gold,pw]);
  }
  const sep = (g)=>ps.filter(x=>x[0]===g).map(x=>x[1]); const mn=a=>Math.min(...a).toFixed(2), mx=a=>Math.max(...a).toFixed(2);
  console.log(`${name.padEnd(22)} acc ${ok}/${S.length}  write-recall ${wr}/${wt}  p(write) on W: ${mn(sep(true))}–${mx(sep(true))}  on R: ${mn(sep(false))}–${mx(sep(false))}`);
}
