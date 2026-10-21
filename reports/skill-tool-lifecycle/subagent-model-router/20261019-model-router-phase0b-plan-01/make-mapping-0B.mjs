// make-mapping-0B.mjs: writes mapping-0B.json, one A/B/C permutation of the tiers per calibration story.
// Seeded PRNG (mulberry32, seed sha256("0B-map-v1")), so the mapping is reproducible. Kept out of every prompt.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_TEXT = '0B-map-v1';
const TIERS = ['haiku', 'sonnet', 'opus'];
const LETTERS = ['A', 'B', 'C'];

const seedBytes = crypto.createHash('sha256').update(SEED_TEXT).digest();
let state = seedBytes.readUInt32BE(0);
function rand() { // mulberry32
  state |= 0; state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const stories = JSON.parse(fs.readFileSync(path.join(HERE, 'calibration-stories-0B.json'), 'utf8'));
const perStory = {};
for (const s of stories) {
  const letters = [...LETTERS];
  for (let i = letters.length - 1; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  perStory[s.id] = Object.fromEntries(TIERS.map((t, k) => [letters[k], t])); // letter -> tier
}
const out = { version: '0B-map-v1', seedText: SEED_TEXT, seedSha256Prefix: seedBytes.toString('hex').slice(0, 16), note: 'Letter -> tier per story. Never shown to a grader. Read only for labels after grading.', map: perStory };
const text = JSON.stringify(out, null, 2) + '\n';
fs.writeFileSync(path.join(HERE, 'mapping-0B.json'), text);
const sha = crypto.createHash('sha256').update(text).digest('hex');
console.log(JSON.stringify({ written: 'mapping-0B.json', sha256: sha, stories: Object.keys(perStory).length }));
