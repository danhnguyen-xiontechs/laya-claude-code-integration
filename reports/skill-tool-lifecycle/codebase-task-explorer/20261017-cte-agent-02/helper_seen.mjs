#!/usr/bin/env node
// Did each case agent actually receive the helper's output? (some helper calls ran past the agents' 120 s Bash timeout
// while 20 agents ran codemap + Jev at once). Looks for the helper's heading in the tool results of the agent's transcript.
// Usage: node helper_seen.mjs <workmap.json> <evidence/usage.json> > evidence/helper-seen.json
import fs from 'node:fs';
const [wm, us] = process.argv.slice(2);
const map = JSON.parse(fs.readFileSync(wm, 'utf8')), usage = JSON.parse(fs.readFileSync(us, 'utf8'));
const out = map.map((x) => {
  const t = usage[x.workDir]?.transcript;
  const txt = t && fs.existsSync(t) ? fs.readFileSync(t, 'utf8') : '';
  return { key: x.key, arm: x.arm, helperSeen: /Candidate starting points/.test(txt.split('\n').filter((l) => l.includes('"tool_result"')).join('\n')) };
});
console.log(JSON.stringify(out, null, 1));
