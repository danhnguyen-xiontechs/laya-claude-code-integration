import { spawnSync } from 'node:child_process';
const [id, dir] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['D:/XionTechs/Laya/.claude/worktrees/inspiring-knuth-d490f8/.claude/skills/subagent-model-router/bench/tasks/' + id + '/check.mjs'], { cwd: dir, encoding: 'utf8', timeout: 180000 });
console.log(id, dir.split('/').pop(), r.status === 0 ? 'PASS' : 'FAIL', (r.stderr||'').slice(0,200).replace(/\n/g,' | '));
