#!/usr/bin/env node
// Stage decisions of an unattended haiku-build v2 run (haiku-build-auto). Every question haiku-build asks is
// answered here: an Opus or Fable start switches the main session to Sonnet ("yes"), a failed plan or review
// hand-back gets one automatic retry (approved by "haiku-build-auto (automatic retry)"), and the fix loop
// runs at most 3 rounds. A run ends in exactly one terminal status: done, done_with_findings or blocked. A
// blocked run names its condition and exits 1. Every end writes <runDir>/result.json; under folder+id
// dispatch (spec folder + story id) the story spec gets its `status` updated and `## Auto Run Result`.
// The haiku-build v2 scripts do the rest: status.mjs (ladder, final status), routing.mjs, preflight.mjs,
// jev_advice.mjs and save_opus.mjs. v3 shares haiku-build's helpers with the manual mode: the AC map
// (ac_map.mjs, recorded by savePlanSpec), failure records (failure.mjs: plan, review and test failures, the
// recovery advice state and the `failure` of a sonnet-retry / fix-tests request), the context bundle
// (context_bundle.mjs: built before the plan call, each review attempt and each re-review, passed as
// `context`) and the run metrics (run_metrics.mjs: manifest.metrics and result.json.metrics at every end).
//
// Usage: node auto.mjs start  <runDir> [--model <startModel>] [--task "<text>"]
//                             [--spec-folder <dir> --story-id <id> --title "<title from stories.yaml>"]
//          preflight, clean tree, intent, routing (switch answered yes), manifest.json; resumes an existing run
//        node auto.mjs gate   plan|review <runDir> <textFile>
//          saves a hand-back with save_opus.mjs; action continue | retry (attempt 2) | halt (failed twice)
//        node auto.mjs round  <runDir> [--re-review <textFile>]
//          applies a re-review (its findings replace the open list), then: fix (next round) | finish | halt
//        node auto.mjs halt   <runDir> "<condition>" [--reason "<text>"]
//          ends the run blocked with that condition (exit 1)
//        node auto.mjs finish <runDir> [--no-commit]
//          final status through status.mjs finalStatus (exit 1 when blocked); a run that ends done or
//          done_with_findings commits the working tree of the current directory on its branch, as
//          bmad-build-auto does (never pushed, no PR); --no-commit leaves the tree as it is
//   Every command prints one JSON line. Exit 1 means the run is blocked; exit 2 is a usage error.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nextAttempt, finalStatus, missingArtifacts } from '../../haiku-build/scripts/status.mjs';
import { routeStages } from '../../haiku-build/scripts/routing.mjs';
import { preflight as haikuPreflight } from '../../haiku-build/scripts/preflight.mjs';
import { advise, jevMode } from '../../haiku-build/scripts/jev_advice.mjs';
import { saveOpus } from '../../haiku-build/scripts/save_opus.mjs';
import { checkReviewJson } from '../../haiku-build/scripts/build_report.mjs';
import { startPhase, endPhase } from '../../haiku-build/scripts/phase.mjs';
import { recordFailure, recoveryState } from '../../haiku-build/scripts/failure.mjs';
import { useBundle } from '../../haiku-build/scripts/context_bundle.mjs';
import { runMetrics } from '../../haiku-build/scripts/run_metrics.mjs';

/** The only statuses a run can end in. */
export const TERMINAL = ['done', 'done_with_findings', 'blocked'];

/** Fix rounds allowed while a Major finding is open; a Major still open after the last one blocks the run. */
export const MAX_FIX_ROUNDS = 3;

export const LOOP_EXCEEDED = `review repair loop exceeded ${MAX_FIX_ROUNDS} iterations`;

/** Stored as retryApprovedBy on the automatic second plan or review attempt (save_opus.mjs needs one). */
export const AUTO_APPROVER = 'haiku-build-auto (automatic retry)';

/** Blocking conditions, named in result.json, manifest.finalReason and the story spec write-back. */
export const CONDITIONS = {
  preflight: 'preflight failed',
  dirtyTree: 'dirty working tree',
  intentGap: 'intent gap',
  noSubagents: 'no subagents',
  noTestRunner: 'no test runner',
  planFailedTwice: 'plan failed twice',
  reviewFailedTwice: 'review failed twice',
  ladder: 'retry ladder used up',
  testsFail: 'tests still fail',
  loopExceeded: LOOP_EXCEEDED,
  ambiguous: 'ambiguous story file match',
  commitFailed: 'commit failed',
  unexpected: 'unexpected error',
};

/** The three review lenses of stage 05, one Sonnet reviewer each. */
export const LENSES = ['blind-hunter', 'edge-case-hunter', 'verification-gap'];

export const HAIKU_BUILD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'haiku-build');

const HAND_BACK_STEP = { plan: '02-plan', review: '04-review' };

class AutoHalt extends Error {
  constructor(condition, reason = condition) {
    super(reason);
    this.condition = condition;
    this.reason = reason;
  }
}

const isOpen = (f) => (f?.resolution ?? 'open') === 'open';

function readManifest(runDir) {
  const mf = path.join(runDir, 'manifest.json');
  return fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
}

function writeManifest(runDir, m) {
  fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(m, null, 2));
}

/**
 * Routing with the switch question answered automatically: an Opus or Fable start gets `yes` (main session
 * on Sonnet); any other start keeps routing.mjs behaviour and has no question.
 * Returns routeStages(...) plus { switchAnswer, answeredBy }.
 */
export function autoRouting(startModel, { planAdvice = null } = {}) {
  const probe = routeStages(startModel, { planAdvice });
  if (!probe.switchQuestion) return { ...probe, switchAnswer: null, answeredBy: null };
  return { ...routeStages(startModel, { planAdvice, switchAnswer: 'yes' }), switchAnswer: 'yes', answeredBy: 'haiku-build-auto' };
}

/**
 * Decision after a plan or review hand-back was saved. `failures` is the number of failed hand-backs of that
 * kind so far. 0: continue; 1: retry once as attempt 2, approved automatically; 2 or more: halt.
 * Returns { action: 'continue' | 'retry' | 'halt', attempt?, approvedBy?, condition? }.
 */
export function handBackGate(kind, failures = 0) {
  if (!HAND_BACK_STEP[kind]) throw new Error(`unknown kind "${kind}" (use plan or review)`);
  if (failures <= 0) return { action: 'continue' };
  if (failures === 1) return { action: 'retry', attempt: 2, approvedBy: AUTO_APPROVER };
  return { action: 'halt', condition: kind === 'plan' ? CONDITIONS.planFailedTwice : CONDITIONS.reviewFailedTwice };
}

/** Failed hand-backs of a kind recorded in manifest.opusCalls. */
export function handBackFailures(m, kind) {
  return (m?.opusCalls ?? []).filter((c) => c.step === HAND_BACK_STEP[kind] && !c.ok).length;
}

/**
 * Review loop decision. `round` is the number of fix rounds already run; `findings` the current list.
 * No open Major: finish. Open Major and round < MAX_FIX_ROUNDS: fix (round + 1). Open Major after the last
 * round: halt with LOOP_EXCEEDED. Returns { action, round, open, major, condition? }.
 */
export function reviewRound({ round = 0, findings = [] } = {}) {
  const open = findings.filter(isOpen);
  const major = open.filter((f) => f.severity === 'Major').length;
  if (!major) return { action: 'finish', round, open: open.length, major };
  if (round >= MAX_FIX_ROUNDS) return { action: 'halt', round, open: open.length, major, condition: LOOP_EXCEEDED };
  return { action: 'fix', round: round + 1, open: open.length, major };
}

/**
 * Re-review result after fix round `round`: every finding open before it is marked fixed, and the re-review
 * findings become the new open list. Returns the new findings array.
 */
export function replaceOpen(findings = [], reReview = [], round = 1) {
  const kept = findings.map((f) => (isOpen(f) ? { ...f, resolution: 'fixed', reason: `fix round ${round}` } : f));
  return [...kept, ...reReview.map((f) => ({ ...f, resolution: 'open', round }))];
}

/**
 * Terminal status. A blocking `condition` wins; otherwise status.mjs finalStatus decides (it takes no JEV
 * input). Returns { status, condition, reason }; condition is null unless blocked.
 */
export function autoFinal({ missing = [], tests = {}, attempts = [], findings = [], condition = null } = {}) {
  if (condition) return { status: 'blocked', condition, reason: condition };
  const r = finalStatus({ missing, tests, attempts, findings });
  if (r.status !== 'blocked') return { status: r.status, condition: null, reason: r.reason };
  const named = r.reason.startsWith('retry ladder') ? CONDITIONS.ladder : r.reason.startsWith('tests') ? CONDITIONS.testsFail : r.reason;
  return { status: 'blocked', condition: named, reason: r.reason };
}

/** Kebab-case slug of a story title: "haiku-build-auto: v2" -> "haiku-build-auto-v2". */
export function slugify(title = '') {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The story spec of a folder+id dispatch: the one `<specFolder>/stories/<id>-*.md`, else
 * `<id>-<slug of title>.md` (`<id>-unresolved.md` without a title). More than one match is ambiguous and
 * points at `<id>-ambiguous.md`, so the write-back never lands on one of the matches.
 * Returns { file, ambiguous, matches }.
 */
export function specFileFor(specFolder, storyId, title = null) {
  const dir = path.join(specFolder, 'stories');
  const own = `${storyId}-ambiguous.md`;
  const matches = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.startsWith(`${storyId}-`) && f.endsWith('.md') && f !== own).sort()
    : [];
  if (matches.length > 1) return { file: path.join(dir, own), ambiguous: true, matches };
  if (matches.length === 1) return { file: path.join(dir, matches[0]), ambiguous: false, matches };
  return { file: path.join(dir, `${storyId}-${slugify(title) || 'unresolved'}.md`), ambiguous: false, matches };
}

/** Writes <runDir>/result.json. Returns the written object (with exitCode: 1 when blocked, else 0). */
export function writeResult(runDir, { status, condition = null, reason = null, specFile = null, commit = null, metrics = null } = {}, now = new Date()) {
  if (!TERMINAL.includes(status)) throw new Error(`not a terminal status: ${status}`);
  fs.mkdirSync(runDir, { recursive: true });
  const result = {
    status,
    condition: status === 'blocked' ? condition ?? reason ?? 'unnamed' : null,
    reason: reason ?? null,
    exitCode: status === 'blocked' ? 1 : 0,
    runId: path.basename(path.resolve(runDir)),
    specFile,
    commit: commit ? { committed: commit.committed === true, sha: commit.sha ?? null, reason: commit.reason ?? null } : null,
    metrics,
    at: now.toISOString(),
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

/**
 * Story spec write-back: sets frontmatter `status` and appends the result under `## Auto Run Result`
 * (added when missing). A missing file is created as a skeletal story spec. Line endings are kept.
 */
export function writeBackSpec(file, { status, condition = null, reason = null, title = null, storyId = null, runDir = null } = {}, now = new Date()) {
  const block = [
    `Status: ${status}`,
    `Blocking condition: ${condition ?? 'none'}`,
    ...(reason && reason !== condition ? [`Reason: ${reason}`] : []),
    ...(runDir ? [`Run folder: ${runDir}`] : []),
    `Finished: ${now.toISOString()}`,
  ].join('\n');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const heading = title || `Story ${storyId ?? ''}`.trim();
    fs.writeFileSync(file, `---\nstatus: ${status}\n---\n\n# ${heading}\n\n## Auto Run Result\n\n${block}\n`);
    return { file, created: true };
  }
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let text = raw.replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---(\n|$)/.exec(text);
  if (fm) {
    const body = /^status:.*$/m.test(fm[1]) ? fm[1].replace(/^status:.*$/m, `status: ${status}`) : `${fm[1]}\nstatus: ${status}`;
    text = `---\n${body}\n---${fm[2]}${text.slice(fm[0].length)}`;
  } else {
    text = `---\nstatus: ${status}\n---\n\n${text}`;
  }
  const head = /^## Auto Run Result[ \t]*$/m.exec(text);
  if (!head) {
    text = `${text.replace(/\n*$/, '')}\n\n## Auto Run Result\n\n${block}\n`;
  } else {
    const after = head.index + head[0].length;
    const next = /^## /m.exec(text.slice(after));
    const at = next ? after + next.index : text.length;
    const before = text.slice(0, at).replace(/\n*$/, '');
    text = `${before}\n\n${block}\n${next ? `\n${text.slice(at)}` : ''}`;
  }
  fs.writeFileSync(file, text.replace(/\n/g, eol));
  return { file, created: false };
}

/**
 * Ends a run in a terminal status: manifest.finalStatus / finalReason (when a manifest exists), result.json,
 * and the story spec write-back under folder+id dispatch (`dispatch`, else manifest.auto.dispatch).
 * v3: the run metrics (run_metrics.mjs) go to manifest.metrics and result.json.metrics, blocked runs included;
 * without a manifest every measurement is listed as missing.
 * Returns the result.json object.
 */
export function endRun(runDir, { status, condition = null, reason = null }, { dispatch = null, now = new Date(), commit = null } = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  const m = readManifest(runDir);
  const d = dispatch ?? m?.auto?.dispatch ?? null;
  let metrics = runMetrics({});
  if (m) {
    const closed = endPhase(m, now);
    metrics = runMetrics(closed);
    writeManifest(runDir, {
      ...closed, finalStatus: status, finalReason: reason ?? condition ?? null,
      auto: { ...(m.auto ?? {}), status, condition: status === 'blocked' ? condition : null },
      metrics,
    });
  }
  let specFile = null;
  if (d?.specFolder && d?.storyId) {
    specFile = specFileFor(d.specFolder, d.storyId, d.title).file;
    writeBackSpec(specFile, { status, condition, reason, title: d.title, storyId: d.storyId, runDir }, now);
  }
  return writeResult(runDir, { status, condition, reason, specFile, commit: commit ?? m?.auto?.commit ?? null, metrics }, now);
}

/** Halts the run `blocked` with `condition` named. Returns the result.json object (exitCode 1). */
export function halt(runDir, condition, { reason = null, dispatch = null, now = new Date() } = {}) {
  return endRun(runDir, { status: 'blocked', condition, reason: reason ?? condition }, { dispatch, now });
}

/** True when `git status --porcelain` is empty in cwd. Without git (not a repo, no git) the check is skipped. */
export function gitIsClean(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === '';
  } catch {
    return true;
  }
}

/** `git diff` of the working tree (new files must be intent-to-add, as in haiku-build step 03). */
export function gitDiffText(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['-c', 'core.safecrlf=false', 'diff'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/**
 * Commits every change of the working tree in cwd on the current branch, never pushing: the changed and
 * untracked paths are staged one by one (never a whole folder) and committed with `message`. Paths under
 * an `exclude` folder (the run folder, when it lies inside the repository) are left out of the commit.
 * Returns { committed: true, sha, files, skipped } or { committed: false, reason: 'clean' | 'no git', skipped }.
 * A git failure after a dirty status throws (the caller blocks the run as `commit failed`).
 */
export function gitCommitAll(cwd = process.cwd(), message = 'haiku-build-auto', { exclude = [] } = {}) {
  const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  let status, top;
  try {
    top = run(['rev-parse', '--show-toplevel']).trim();
    status = run(['status', '--porcelain', '--untracked-files=all', '-z']);
  } catch {
    return { committed: false, reason: 'no git', skipped: [] };
  }
  // Excluded folders as repo-relative prefixes (git status paths are relative to the top level, '/'-separated).
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const topNorm = norm(top);
  const prefixes = exclude.map(norm).filter((p) => p === topNorm || p.startsWith(`${topNorm}/`)).map((p) => p.slice(topNorm.length + 1));
  const excluded = (file) => prefixes.some((p) => p === '' || file === p || file.startsWith(`${p}/`));
  // -z: NUL-separated "XY path" records; a rename or copy adds the old path as the next record.
  const files = [], skipped = [];
  const parts = status.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const rec = parts[i];
    const file = rec.slice(3);
    (excluded(file) ? skipped : files).push(file);
    if (rec[0] === 'R' || rec[0] === 'C') i += 1;
  }
  if (!files.length) return { committed: false, reason: 'clean', skipped };
  run(['-c', 'core.safecrlf=false', 'add', '-A', '--', ...files]);
  run(['commit', '-q', '--no-verify', '-m', message]);
  return { committed: true, sha: run(['rev-parse', 'HEAD']).trim(), files, skipped };
}

/**
 * Commit message of a finished run: the story title or the task's first line, then the run id and status.
 * Returns the message text.
 */
export function commitMessage(m = {}, status = 'done') {
  const subject = String(m.auto?.dispatch?.title || m.task || 'haiku-build-auto change').split('\n')[0].trim().slice(0, 72);
  return `${subject}\n\nhaiku-build-auto run ${m.runId ?? '?'}: ${status}`;
}

/**
 * Commits the finished run's working tree when the run ends done or done_with_findings (as bmad-build-auto
 * does; `commit: false` skips it). The outcome goes to manifest.auto.commit and result.json.
 * Returns the commit record, or null when nothing was attempted; throws AutoHalt `commit failed` on an error.
 */
export function commitRun(runDir, { status, commit = true, gitCommit = (msg) => gitCommitAll(process.cwd(), msg, { exclude: [runDir] }), now = new Date() } = {}) {
  const m = readManifest(runDir);
  if (!m || status === 'blocked' || commit === false) return null;
  const message = commitMessage(m, status);
  let record;
  try {
    const r = gitCommit(message) ?? { committed: false, reason: 'no result' };
    record = { ...r, message, at: now.toISOString() };
  } catch (e) {
    const last = String(e?.stderr || e?.message || e).split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? String(e);
    const reason = `${CONDITIONS.commitFailed}: ${last}`;
    writeManifest(runDir, { ...m, auto: { ...(m.auto ?? {}), commit: { committed: false, reason, message, at: now.toISOString() } } });
    throw new AutoHalt(CONDITIONS.commitFailed, reason);
  }
  writeManifest(runDir, { ...m, auto: { ...(m.auto ?? {}), commit: record } });
  return record;
}

/** Joins the reviewers' JSON arrays into one array text; anything unparseable is joined raw (the save check fails it). */
export function mergeReviews(texts = []) {
  const arrays = texts.map((t) => {
    try {
      const v = JSON.parse(String(t ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  });
  return arrays.every(Boolean) ? JSON.stringify(arrays.flat()) : texts.map((t) => String(t ?? '')).join('\n');
}

function newManifest(runDir, task, routing, dispatch, now) {
  return {
    schemaVersion: 1,
    runId: path.basename(path.resolve(runDir)),
    tool: 'haiku-build',
    status: 'INTAKE',
    task,
    opusCalls: [],
    attempts: [],
    phases: [],
    haiku: { haiku_request_count: null, haiku_requests_over_100k: null, max_haiku_input_tokens: null, input_limit_verification: 'not_measured' },
    routing: {
      start: routing.start, main: routing.main,
      stages: routing.stages.map(({ id, model, fallback }) => ({ id, model, fallback })),
      switchQuestion: routing.switchQuestion, switchAnswer: routing.switchAnswer, switchAnsweredBy: routing.answeredBy,
    },
    auto: { mode: 'unattended', dispatch, fixRounds: 0, questionsAsked: 0, createdAt: now.toISOString() },
  };
}

/**
 * Intake checks shared by runAuto and the `start` command, in order: preflight, clean tree (new runs only),
 * folder+id file match, intent. Throws AutoHalt on a blocking condition. Returns { manifest, resumed }.
 */
async function intake({ runDir, task, startModel, dispatch, gitClean, preflight, env, ask, now }) {
  const existing = readManifest(runDir);
  if (existing?.finalStatus && TERMINAL.includes(existing.finalStatus) && existing.auto?.status) {
    return { manifest: existing, resumed: true, finished: true };
  }
  const pf = preflight();
  if (!pf?.ok) throw new AutoHalt(CONDITIONS.preflight, pf?.message ?? CONDITIONS.preflight);
  if (!existing && !gitClean()) throw new AutoHalt(CONDITIONS.dirtyTree);
  if (dispatch) {
    const sf = specFileFor(dispatch.specFolder, dispatch.storyId, dispatch.title);
    if (sf.ambiguous) throw new AutoHalt(CONDITIONS.ambiguous, `${CONDITIONS.ambiguous}: ${sf.matches.join(', ')}`);
  }
  if (existing) return { manifest: existing, resumed: true };
  const intent = String(task ?? dispatch?.title ?? '').trim();
  if (!intent) throw new AutoHalt(CONDITIONS.intentGap, `${CONDITIONS.intentGap}: no task, no spec folder + story id + title, no resumable run`);
  fs.mkdirSync(path.join(runDir, 'evidence'), { recursive: true });
  const advice = await advise({ point: 'intake', baseline: 'opus', choices: ['opus', 'sonnet'], state: intent, used: 0, env, ...(ask ? { ask } : {}) });
  const { used: _u, ...entry } = advice;
  const m = newManifest(runDir, intent, autoRouting(startModel, { planAdvice: advice.choice }), dispatch, now());
  m.jev = { mode: jevMode(env), calls: [{ ...entry, at: now().toISOString() }] };
  writeManifest(runDir, startPhase(m, '01-intake', now()));
  return { manifest: readManifest(runDir), resumed: false };
}

/**
 * One unattended run, start to terminal status, with every outside effect injected:
 *   agent({ stage, model, role, attempt?, round?, lens?, runDir, task, findings? }) -> hand-back text
 *     (02-plan: spec text; 05-review and the 06-fix re-review: a JSON array of findings; others: ignored).
 *     Missing or throwing: blocked `no subagents`.
 *   runTests({ attempt, model }) -> { passed, failed, log?, command? }; a throw counts as a failed run.
 *   ask: JEV ask for jev_advice.mjs advise (tests inject it; HAIKU_BUILD_JEV=off makes no call).
 *   gitClean() -> boolean, gitDiff() -> diff text, preflight() -> { ok, message }, now() -> Date.
 *   gitCommit(message) -> { committed, sha?, reason? }: commits the working tree at the end of a run that is
 *     not blocked (the default leaves `runDir` out when it lies inside the repository); `commit: false` skips
 *     it. A throw blocks the run `commit failed`.
 * Dispatch: `task` (free intent), or `specFolder` + `storyId` + `title` (folder+id), or an existing
 * manifest in `runDir` (resume). Never asks the user. Returns the result.json object.
 */
export async function runAuto({
  runDir, task = null, startModel = null, specFolder = null, storyId = null, title = null,
  agent, runTests, ask = null, env = process.env,
  gitClean = () => gitIsClean(), gitDiff = () => gitDiffText(), preflight = () => haikuPreflight(), now = () => new Date(),
  gitCommit = (message) => gitCommitAll(process.cwd(), message, { exclude: [runDir] }), commit = true,
} = {}) {
  if (!runDir) throw new Error('runAuto needs runDir');
  const dispatch = specFolder && storyId ? { specFolder, storyId: String(storyId), title } : null;
  try {
    const { manifest, finished } = await intake({ runDir, task, startModel, dispatch, gitClean, preflight, env, ask, now });
    if (finished) return JSON.parse(fs.readFileSync(path.join(runDir, 'result.json'), 'utf8'));
    if (typeof agent !== 'function') throw new AutoHalt(CONDITIONS.noSubagents);
    if (typeof runTests !== 'function') throw new AutoHalt(CONDITIONS.noTestRunner);
    let m = manifest;
    const save = () => writeManifest(runDir, m);
    const reload = () => { m = readManifest(runDir); return m; };
    const phase = (id) => { m = startPhase(reload(), id, now()); save(); };
    const model = (id) => m.routing?.stages?.find((s) => s.id === id)?.model ?? null;
    const call = async (req) => {
      try {
        const out = await agent({ runDir, task: m.task, ...req });
        return typeof out === 'string' ? out : JSON.stringify(out ?? '');
      } catch (e) {
        throw new AutoHalt(CONDITIONS.noSubagents, `${CONDITIONS.noSubagents}: ${req.stage} ${String(e?.message ?? e).split('\n')[0]}`);
      }
    };
    const writeDiff = () => fs.writeFileSync(path.join(runDir, 'evidence', 'diff.patch'), String(gitDiff() ?? ''));
    // One test run; a failed run appends a failure record (kind test) for the stage it ran in.
    const test = async (req, stage = '04-test') => {
      let t;
      try { t = await runTests(req); } catch (e) { t = { passed: 0, failed: 1, log: `test runner threw: ${e?.message ?? e}` }; }
      const failed = Number(t?.failed ?? 0);
      const log = String(t?.log ?? `passed ${t?.passed ?? 0} failed ${failed}`);
      fs.writeFileSync(path.join(runDir, 'evidence', 'unit-tests.log'), log);
      m.tests = { command: t?.command ?? null, passed: Number(t?.passed ?? 0), failed };
      if (failed !== 0) recordFailure(m, { kind: 'test', stage, attempt: req.attempt, text: log, passed: m.tests.passed, failed });
      return failed === 0;
    };
    // The shared context bundle for a Plan or Review input; its use is logged in manifest.contextBundle.
    const bundle = (stage) => { const b = useBundle(runDir, m, { stage }); save(); return b.text; };
    // A failed plan or review hand-back (or an invalid re-review) as a failure record.
    const handBackFailure = (kind, stage, attempt, reason) => { recordFailure(m, { kind, stage, attempt, text: reason ?? '' }); save(); };

    // 02 Plan: one closed call; a failed hand-back is retried once automatically.
    if (!fs.existsSync(path.join(runDir, 'spec.md'))) {
      phase('02-plan');
      for (;;) {
        const attempt = handBackFailures(m, 'plan') + 1;
        const gate0 = handBackGate('plan', attempt - 1);
        if (gate0.action === 'halt') throw new AutoHalt(gate0.condition);
        const context = bundle('02-plan');
        const text = await call({ stage: '02-plan', model: model('02-plan'), role: 'plan', attempt, context, promptFile: path.join(HAIKU_BUILD_DIR, 'prompts', 'plan-opus.md') });
        const file = path.join(runDir, 'evidence', `plan-raw-${attempt}.md`);
        fs.writeFileSync(file, text);
        const saved = saveOpus('plan', runDir, file, { attempt, approvedBy: attempt > 1 ? AUTO_APPROVER : null, now: now() });
        reload();
        if (!saved.ok) handBackFailure('plan', '02-plan', attempt, saved.reason);
        const gate = handBackGate('plan', handBackFailures(m, 'plan'));
        if (gate.action === 'halt') throw new AutoHalt(gate.condition);
        if (fs.existsSync(path.join(runDir, 'spec.md')) && m.opusCalls.at(-1)?.ok) break;
      }
    }

    // 03 Implement + 04 Test: Haiku, then the fixed ladder T1, T2, sonnet-retry, T3.
    if (!nextAttempt(m.attempts ?? []).done) {
      if (!(m.attempts ?? []).length) {
        phase('03-implement');
        await call({ stage: '03-implement', model: model('03-implement'), role: 'implement' });
        writeDiff();
        m.status = 'BUILT';
        save();
      }
      phase('04-test');
      for (;;) {
        const n = nextAttempt(m.attempts ?? []);
        if (n.done) break;
        if (n.refused) { m.status = 'TESTS_FAIL'; save(); throw new AutoHalt(CONDITIONS.ladder, n.reason); }
        const rung = n.next;
        if ((m.attempts ?? []).length) {
          if (rung.model === 'sonnet') {
            const used = (m.jev?.calls ?? []).filter((c) => c.called).length;
            const a = await advise({ point: 'recovery', baseline: 'fix-code', choices: ['fix-code', 'fix-test', 'rewrite'], state: recoveryState(m.failures ?? []), used, env, ...(ask ? { ask } : {}) });
            const { used: _u, ...entry } = a;
            m.jev = { mode: m.jev?.mode ?? 'apply', calls: [...(m.jev?.calls ?? []), { ...entry, at: now().toISOString() }] };
            save();
            await call({ stage: '03-implement', model: 'sonnet', role: 'sonnet-retry', approach: a.choice, failure: m.failures?.at(-1) ?? null });
          } else {
            await call({ stage: '04-test', model: rung.model, role: 'fix-tests', attempt: rung.attempt, failure: m.failures?.at(-1) ?? null });
          }
          writeDiff();
        }
        const ok = await test({ attempt: rung.attempt, model: rung.model });
        m.attempts = [...(m.attempts ?? []), { ...rung, ok, passed: m.tests.passed, failed: m.tests.failed, at: now().toISOString() }];
        m.status = ok ? 'TESTS_PASS' : 'TESTS_FAIL';
        save();
      }
    }

    // 05 Review: three parallel Sonnet reviewers; a failed hand-back is retried once automatically.
    if (m.review?.status !== 'done') {
      phase('05-review');
      for (;;) {
        const attempt = handBackFailures(m, 'review') + 1;
        const gate0 = handBackGate('review', attempt - 1);
        if (gate0.action === 'halt') throw new AutoHalt(gate0.condition);
        const context = bundle('05-review');
        const texts = await Promise.all(LENSES.map((lens) => call({ stage: '05-review', model: model('05-review'), role: 'review', lens, attempt, context, promptFile: path.join(HAIKU_BUILD_DIR, 'prompts', 'review.md') })));
        const file = path.join(runDir, 'evidence', `review-handback-${attempt}.txt`);
        fs.writeFileSync(file, mergeReviews(texts));
        const saved = saveOpus('review', runDir, file, { attempt, approvedBy: attempt > 1 ? AUTO_APPROVER : null, now: now() });
        reload();
        if (!saved.ok) handBackFailure('review', '05-review', attempt, saved.reason);
        const gate = handBackGate('review', handBackFailures(m, 'review'));
        if (gate.action === 'halt') throw new AutoHalt(gate.condition);
        if (m.review?.status === 'done' && m.opusCalls.at(-1)?.ok) break;
      }
    }

    // 06 Fix: while a Major is open, at most MAX_FIX_ROUNDS rounds of fix -> tests -> re-review.
    for (;;) {
      const d = reviewRound({ round: m.auto?.fixRounds ?? 0, findings: m.review?.findings ?? [] });
      if (d.action === 'finish') break;
      if (d.action === 'halt') throw new AutoHalt(d.condition);
      phase('06-fix');
      m.auto = { ...(m.auto ?? {}), fixRounds: d.round };
      save();
      const open = m.review.findings.filter(isOpen);
      await call({ stage: '06-fix', model: model('06-fix'), role: 'fix', round: d.round, findings: open });
      writeDiff();
      let ok = await test({ attempt: `fix-${d.round}`, model: model('06-fix') }, '06-fix');
      if (!ok) {
        save();
        await call({ stage: '06-fix', model: model('06-fix'), role: 'fix-tests', round: d.round, failure: m.failures?.at(-1) ?? null });
        writeDiff();
        ok = await test({ attempt: `fix-${d.round}-retry`, model: model('06-fix') }, '06-fix');
      }
      save();
      if (!ok) throw new AutoHalt(CONDITIONS.testsFail);
      let parsed = null;
      for (let i = 1; i <= 2 && !parsed; i++) {
        const context = bundle('06-fix');
        const text = await call({ stage: '06-fix', model: 'sonnet', role: 're-review', lens: 'blind-hunter', round: d.round, attempt: i, findings: open, context, promptFile: path.join(HAIKU_BUILD_DIR, 'prompts', 'review.md') });
        fs.writeFileSync(path.join(runDir, 'evidence', 're-review.json'), text);
        const c = checkReviewJson(text);
        if (c.ok) parsed = c.findings;
        else handBackFailure('review', '06-fix', `re-review-${d.round}-${i}`, c.reason);
      }
      if (!parsed) throw new AutoHalt(CONDITIONS.reviewFailedTwice, `${CONDITIONS.reviewFailedTwice}: re-review of fix round ${d.round}`);
      m.review = { ...m.review, findings: replaceOpen(m.review.findings, parsed, d.round) };
      m.status = 'FIXED';
      save();
    }

    // 07 Present: the final status comes from status.mjs; a run that is not blocked commits its change.
    phase('07-present');
    const r = autoFinal({ missing: missingArtifacts(runDir), tests: m.tests, attempts: m.attempts, findings: m.review?.findings });
    const c = commitRun(runDir, { status: r.status, commit, gitCommit, now: now() });
    return endRun(runDir, r, { dispatch, now: now(), commit: c });
  } catch (e) {
    if (e instanceof AutoHalt) return halt(runDir, e.condition, { reason: e.reason, dispatch, now: now() });
    const msg = String(e?.message ?? e).split('\n')[0];
    return halt(runDir, CONDITIONS.unexpected, { reason: `${CONDITIONS.unexpected}: ${msg}`, dispatch, now: now() });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const usage = () => {
    console.log('usage: node auto.mjs start <runDir> [--model m] [--task "<text>"] [--spec-folder d --story-id id --title "<t>"]'
      + ' | gate plan|review <runDir> <textFile> | round <runDir> [--re-review <file>] | halt <runDir> "<condition>" | finish <runDir> [--no-commit]');
    process.exit(2);
  };
  const out = (obj, code) => { console.log(JSON.stringify(obj)); process.exit(code); };
  const ended = (r) => out(r, r.exitCode);
  const cmd = args.shift();

  if (cmd === 'start') {
    const startModel = opt('--model');
    const task = opt('--task');
    const specFolder = opt('--spec-folder');
    const storyId = opt('--story-id');
    const title = opt('--title');
    const [runDir] = args;
    if (!runDir) usage();
    const dispatch = specFolder && storyId ? { specFolder, storyId, title } : null;
    try {
      const { manifest: m, resumed, finished } = await intake({
        runDir, task, startModel, dispatch, gitClean: () => gitIsClean(), preflight: () => haikuPreflight(), env: process.env, ask: null, now: () => new Date(),
      });
      if (finished) out({ resumed: true, finished: true, finalStatus: m.finalStatus }, m.finalStatus === 'blocked' ? 1 : 0);
      out({
        ok: true, resumed, runId: m.runId, status: m.status, main: m.routing?.main,
        stages: (m.routing?.stages ?? []).map((s) => `${s.id}:${s.model}`).join(' '), switchAnswer: m.routing?.switchAnswer ?? null,
      }, 0);
    } catch (e) {
      if (e instanceof AutoHalt) ended(halt(runDir, e.condition, { reason: e.reason, dispatch }));
      ended(halt(runDir, CONDITIONS.unexpected, { reason: `${CONDITIONS.unexpected}: ${e?.message ?? e}`, dispatch }));
    }
  }

  if (cmd === 'gate') {
    const [kind, runDir, textFile] = args;
    if (!HAND_BACK_STEP[kind] || !runDir || !textFile) usage();
    const m = readManifest(runDir);
    if (!m) out({ error: `missing required artifact: manifest.json in ${runDir}` }, 1);
    const attempt = handBackFailures(m, kind) + 1;
    const before = handBackGate(kind, attempt - 1);
    if (before.action === 'halt') ended(halt(runDir, before.condition));
    let saved;
    try {
      saved = saveOpus(kind, runDir, textFile, { attempt, approvedBy: attempt > 1 ? AUTO_APPROVER : null });
    } catch (e) {
      out({ ok: false, reason: e.message }, 2);
    }
    let failure = null;
    if (!saved.ok) {
      const m2 = readManifest(runDir);
      failure = recordFailure(m2, { kind, stage: kind === 'plan' ? '02-plan' : '05-review', attempt, text: saved.reason ?? '' });
      writeManifest(runDir, m2);
    }
    const gate = saved.ok ? { action: 'continue' } : handBackGate(kind, handBackFailures(readManifest(runDir), kind));
    if (gate.action === 'halt') ended(halt(runDir, gate.condition, { reason: `${gate.condition}: ${saved.reason}` }));
    out({ kind, attempt, ok: saved.ok, reason: saved.reason, ...gate, ...(failure ? { failure: { fingerprint: failure.fingerprint, category: failure.category, progress: failure.progress } } : {}) }, 0);
  }

  if (cmd === 'round') {
    const reReview = opt('--re-review');
    const [runDir] = args;
    if (!runDir) usage();
    const m = readManifest(runDir);
    if (!m) out({ error: `missing required artifact: manifest.json in ${runDir}` }, 1);
    const round = m.auto?.fixRounds ?? 0;
    if (reReview) {
      const c = checkReviewJson(fs.readFileSync(reReview, 'utf8'));
      if (!c.ok) {
        const failures = (m.auto?.reReviewFailures ?? 0) + 1;
        recordFailure(m, { kind: 'review', stage: '06-fix', attempt: `re-review-${round}-${failures}`, text: c.reason ?? '' });
        writeManifest(runDir, { ...m, auto: { ...(m.auto ?? {}), reReviewFailures: failures } });
        if (failures >= 2) ended(halt(runDir, CONDITIONS.reviewFailedTwice, { reason: `${CONDITIONS.reviewFailedTwice}: re-review of fix round ${round}: ${c.reason}` }));
        out({ action: 'retry', round, reason: c.reason }, 0);
      }
      m.review = { ...(m.review ?? {}), findings: replaceOpen(m.review?.findings ?? [], c.findings, round) };
      m.auto = { ...(m.auto ?? {}), reReviewFailures: 0 };
      m.status = 'FIXED';
    }
    const d = reviewRound({ round, findings: m.review?.findings ?? [] });
    if (d.action === 'fix') m.auto = { ...(m.auto ?? {}), fixRounds: d.round };
    writeManifest(runDir, m);
    if (d.action === 'halt') ended(halt(runDir, d.condition));
    out(d, 0);
  }

  if (cmd === 'halt') {
    const reason = opt('--reason');
    const [runDir, condition] = args;
    if (!runDir || !condition) usage();
    ended(halt(runDir, condition, { reason: reason ?? condition }));
  }

  if (cmd === 'finish') {
    const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
    const never = flag('--no-commit');
    const [runDir] = args;
    if (!runDir) usage();
    const m = readManifest(runDir);
    const r = autoFinal({ missing: missingArtifacts(runDir), tests: m?.tests, attempts: m?.attempts, findings: m?.review?.findings });
    try {
      const c = commitRun(runDir, { status: r.status, commit: !never });
      ended(endRun(runDir, r, { commit: c }));
    } catch (e) {
      if (e instanceof AutoHalt) ended(halt(runDir, e.condition, { reason: e.reason }));
      ended(halt(runDir, CONDITIONS.unexpected, { reason: `${CONDITIONS.unexpected}: ${e?.message ?? e}` }));
    }
  }

  usage();
}
