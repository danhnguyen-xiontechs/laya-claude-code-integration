#!/usr/bin/env node
// make_tasks.mjs - builds work folders, neutral runtest.py wrappers and prompt files for the retro agent run of
// jev_advisor (TOOL=adv) or context-curator (TOOL=cur). Nothing is written into the JEV repo: all under scratch.
// Usage: node make_tasks.mjs adv|cur [reps=2]
// Writes: <SC>/<tool>/work/<case>.<A|B>.r<n>/ (scenario copy without gold.json + runtest.py [+ .jev-advisor.json]),
//         <SC>/<tool>/prompts/<case>.<A|B>.r<n>.txt, <SC>/<tool>/workmap.json
import fs from 'node:fs';
import path from 'node:path';

const TOOL = process.argv[2];
const REPS = Number(process.argv[3] ?? 2);
if (!['adv', 'cur'].includes(TOOL)) { console.error('usage: make_tasks.mjs adv|cur [reps]'); process.exit(2); }

const JEV = 'D:/XionTechs/JEV';
const REVIEW = path.join(JEV, '.claude', 'worktrees', 'review-5-plans-idea-folder-ce4d36'); // e551872: has jev_advisor + curator.py
const PY = 'D:/XionTechs/JEV/.venv/Scripts/python.exe';
const SC = process.env.SCRATCH_ROOT ?? '<home>/AppData/Local/Temp/claude/D--XionTechs-Laya--claude-worktrees-magical-shtern-feba85/c4cf5e0b-3d40-4d6a-8707-bea182c14834/scratchpad';
const ROOT = path.join(SC, TOOL === 'adv' ? 'adv' : 'cur');
const ENGINE = path.join(SC, 'engine');                 // jev_advisor package copy (B only imports it)
const CASES = TOOL === 'adv'
  ? ['h01_layered_config', 'h03_clock_leak', 'h05_deadline_budget', 'h07_payload_trace']
  : ['h02_stale_migration', 'h04_session_fixture', 'h06_swallowed_exception', 'h07_payload_trace'];

const WRAP_A = `"""Test command of this task."""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
os.makedirs(os.path.join(here, ".tool-output"), exist_ok=True)
log = ".tool-output/last.log"
print("[test] full log: " + log)
sys.stdout.flush()
p = subprocess.Popen([sys.executable, "-m", "pytest", "-p", "no:cacheprovider"], cwd=here, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
with open(os.path.join(here, log), "wb") as f:
    for raw in p.stdout:
        f.write(raw)
        sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()
p.wait()
sys.exit(p.returncode)
`;
const WRAP_B_ADV = `"""Test command of this task."""
import os, sys
sys.path.insert(0, ${JSON.stringify(ENGINE)})
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from jev_advisor.__main__ import main
sys.exit(main(["run", "case"]))
`;
const WRAP_B_CUR = `"""Test command of this task."""
import io, os, sys, time
sys.path.insert(0, ${JSON.stringify(ENGINE)})
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from jev_advisor import config, curator, runner, storage
cfg = config.load()
real, sys.stdout = sys.stdout, io.StringIO()
try:
    code = runner.run(cfg, "case", [])          # the advisor run (Jev live), its console output is not shown
    first = sys.stdout.getvalue().splitlines()[0]
finally:
    sys.stdout = real
run_id = first.split()[2]
paths = storage.run_paths(cfg, run_id)
deadline = time.time() + 30
while not paths["advice"].exists() and time.time() < deadline:   # Jev answers arrive from the detached worker
    time.sleep(0.2)
try:
    curator.curate(cfg, run_id)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    print(open(str(paths["log"].with_suffix("")) + ".curated.txt", encoding="utf-8").read(), end="")
except Exception as e:                           # fall back to the plain log
    print("[curator] failed (" + type(e).__name__ + "); full log follows")
    print(paths["log"].read_text(encoding="utf-8"), end="")
sys.exit(code)
`;
const CFG = {
  profiles: { case: { argv: ['python', '-m', 'pytest', '-p', 'no:cacheprovider'], workingDirectory: '.', parser: 'pytest', timeoutSec: 300, allowedArgs: ['^-q$', '^-v$', '^-x$'] } },
  advisor: { enabled: true, showJevHints: true, minLines: 150, minBytes: 8000, finalWaitMs: 3000, maxChunks: 80, hintThreshold: 0.6, maxJevHints: 3, model: 'typesafe/jev-1.13', maxJevInputChars: 90000 },
  storage: { dir: '.tool-output', ttlHours: 24 },
};

const TASK = 'The test suite in the work folder fails. Find the ROOT CAUSE of the failure(s). Diagnosis only: do not edit the code or fix anything (the only files you may create are under .tool-output/ of the work folder). Work only inside the work folder; the test command is `cd "{DIR}" && "' + PY + '" runtest.py` (you may run it more than once). Hand back your answer in exactly this form:\nCAUSE: <one or two sentences, what is wrong and why the tests fail>\nLOCATION: <file:line of the faulty code or setup>\nEVIDENCE: <quote verbatim the log line(s) that show the cause>\nRUNS: <how many times you ran the test command>';
const SENT_A = 'No test-output tool is available in this task: decide yourself from the output of the test command; do not look for or use any skill, script, helper or file from the repo or elsewhere on disk other than the files in the work folder.';
const SENT_B = TOOL === 'adv'
  ? 'The test command is wrapped by jev-advisor: the output is unchanged, followed by a short block of hints (a [jev]/[local] line points at log lines worth reading); the full log is kept under .tool-output/ in the work folder. Use it as you see fit.'
  : 'The test command prints a curated view of the full log (a context curator left out low-relevance captured-output chunks; each "[curator: omitted lines a-b ...]" marker tells you how to read those lines back from the full log in .tool-output/). Use it as you see fit.';

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'prompts'), { recursive: true });
fs.mkdirSync(path.join(ENGINE), { recursive: true });
fs.rmSync(path.join(ENGINE, 'jev_advisor'), { recursive: true, force: true });
fs.cpSync(path.join(REVIEW, 'jev_advisor'), path.join(ENGINE, 'jev_advisor'), { recursive: true, filter: (s) => !s.includes('__pycache__') });
fs.cpSync(path.join(JEV, 'examples', 'scenarios', '_shared'), path.join(ROOT, 'work', '_shared'), { recursive: true, filter: (s) => !s.includes('__pycache__') });
const map = [];
for (const c of CASES) for (let rep = 1; rep <= REPS; rep++) for (const arm of ['A', 'B']) {
  const dir = path.join(ROOT, 'work', `${c}.${arm}.r${rep}`);
  fs.mkdirSync(dir, { recursive: true });
  // scenario copy without gold.json (the answer key) and without caches
  fs.cpSync(path.join(JEV, 'examples', 'scenarios', c), dir, { recursive: true, filter: (s) => !s.endsWith('gold.json') && !s.includes('__pycache__') && !s.includes('.pytest_cache') });
  fs.writeFileSync(path.join(dir, 'runtest.py'), arm === 'A' ? WRAP_A : TOOL === 'adv' ? WRAP_B_ADV : WRAP_B_CUR);
  if (arm === 'B') fs.writeFileSync(path.join(dir, '.jev-advisor.json'), JSON.stringify(CFG, null, 2));
  // the shared noise helper lives in examples/scenarios/_shared: copy it where the scenario imports it from
  const prompt = `Work folder: ${dir}\n${TASK.replaceAll('{DIR}', dir.split(path.sep).join('/'))}\n${arm === 'A' ? SENT_A : SENT_B}`;
  const id = `${c}.${arm}.r${rep}`;
  fs.writeFileSync(path.join(ROOT, 'prompts', `${id}.txt`), prompt);
  map.push({ caseId: c, arm, rep, workDir: dir });
}
fs.writeFileSync(path.join(ROOT, 'workmap.json'), JSON.stringify(map, null, 2));
console.log(`${map.length} work folders under ${ROOT}`);
