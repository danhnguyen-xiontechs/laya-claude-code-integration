// pick helper (same text in both arms except the library it loads): prints what the agent reads first.
import fs from 'node:fs';
import path from 'node:path';
process.env.SR_TOOL_DIR = __TOOLDIR__;
const { run } = await import('./_h.mjs');
const request = fs.readFileSync(path.join(import.meta.dirname, 'request.txt'), 'utf8').trim();
const { text, log } = await run({ request, root: __REPO__ });
const LOG = __LOGDIR__;
const FIRST = __FIRSTDIR__;
const key = __KEY__;
fs.mkdirSync(LOG, { recursive: true });
fs.mkdirSync(FIRST, { recursive: true });
fs.appendFileSync(path.join(LOG, key + '.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...log }) + '\n');
const f = path.join(FIRST, key + '.txt');
if (!fs.existsSync(f)) fs.writeFileSync(f, text);
process.stdout.write(text);
