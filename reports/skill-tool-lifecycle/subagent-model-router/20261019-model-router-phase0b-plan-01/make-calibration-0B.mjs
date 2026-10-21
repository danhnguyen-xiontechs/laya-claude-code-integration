// make-calibration-0B.mjs: writes calibration-stories-0B.json (the 15 calibration stories only).
// Reads real/stories-text.json and split-0B.json. Held-out stories are filtered by id and never printed or written.
// Prints ids and character counts only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SR = path.resolve(HERE, '../../../../.claude/skills/subagent-model-router');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const storiesText = readText(`${SR}/real/stories-text.json`);
const storiesSha = sha(storiesText);
const split = JSON.parse(readText(`${HERE}/split-0B.json`));
if (storiesSha !== split.inputs['real/stories-text.json']) throw new Error('stories-text.json does not match the split input hash');

// Recompute the split from the method in split-0B.json and compare with the recorded assignments.
const stories = JSON.parse(storiesText);
const recomputed = {};
for (const s of stories) {
  const h = parseInt(sha(`0B-v1|${s.id}`).slice(0, 8), 16);
  recomputed[s.id] = h < 0x55555555 ? 'held-out' : 'calibration';
}
for (const [id, a] of Object.entries(split.assignments)) {
  if (recomputed[id] !== a.split) throw new Error(`split mismatch for ${id}`);
}
const assignmentsSha = sha(JSON.stringify(split.assignments));
console.log(JSON.stringify({ storiesSha, assignmentsSha, splitMatchesMethod: true }));

const calib = stories.filter((s) => split.assignments[s.id]?.split === 'calibration');
if (calib.length !== 15) throw new Error(`expected 15 calibration stories, got ${calib.length}`);
const out = calib.map((s) => ({ id: s.id, summary: s.summary, task: s.task }));
const outText = JSON.stringify(out, null, 2) + '\n';
fs.writeFileSync(path.join(HERE, 'calibration-stories-0B.json'), outText);
console.log(JSON.stringify({ written: 'calibration-stories-0B.json', sha256: sha(outText.replace(/\r\n/g, '\n')), stories: out.map((s) => `${s.id}:${s.task.length}`) }));
