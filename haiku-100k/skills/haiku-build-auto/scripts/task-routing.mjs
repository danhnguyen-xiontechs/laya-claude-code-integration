// task-routing.mjs — the task router at haiku-build-auto's two dispatch points: Implement (after the plan
// is accepted, `auto.mjs gate plan`) and Fix (`auto.mjs round` with action fix). It may move that stage
// from haiku to sonnet when the change looks likely to fail on haiku (saving a wasted ladder rung), or keep
// haiku; it never touches the Opus plan or the Sonnet review. One decision per run + phase, cached in
// manifest.taskRouting; any error keeps the existing model. HAIKU_BUILD_TASK_ROUTER=off turns it off,
// HAIKU_BUILD_TASK_ROUTER_PROVIDER=none keeps it on the rules only.
import fs from 'node:fs';
import path from 'node:path';
import { routeTask } from '../../subagent-model-router/scripts/task-router.mjs';

const FILE_RE = /(?:[\w.-]+[\\/])*[\w.-]+\.(?:m?[jt]sx?|py|cs|java|go|rs|rb|php|kt|swift|c|cc|cpp|h|hpp|json|ya?ml|toml|sql|html|css|scss|sh|ps1|razor|cshtml)\b/gi;
const CHECK_RE = /\b(dotnet test|npm (run )?test|node --test|pytest|go test|cargo test|jest|vitest|mvn test|gradle\w* test)\b/i;
export const STAGE_OF = { implement: '03-implement', fix: '06-fix' };

export const routerMode = (env = process.env) => (String(env.HAIKU_BUILD_TASK_ROUTER ?? 'on').trim().toLowerCase() === 'off' ? 'off' : 'on');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** Whether the story has an executable check: a cli case in <specFolder>/tests.json, or a test command in the text. */
export function hasExecutableCheck(m, text) {
  const d = m?.dispatch;
  const tests = d?.specFolder ? readJson(path.join(d.specFolder, 'tests.json')) : null;
  const cases = Array.isArray(tests?.cases) ? tests.cases : Array.isArray(tests) ? tests : [];
  const mine = cases.filter((c) => !d?.storyId || String(c.story ?? c.storyId ?? '') === String(d.storyId));
  if (mine.some((c) => (c.type ?? c.kind) === 'cli' || typeof c.command === 'string')) return true;
  return CHECK_RE.test(String(text ?? ''));
}

/** The text and facts the router sees for one phase. */
export function routingInput(runDir, m, phase) {
  const spec = (() => { try { return fs.readFileSync(path.join(runDir, 'spec.md'), 'utf8'); } catch { return ''; } })();
  const open = (m?.review?.findings ?? []).filter((f) => !['fixed', 'dismissed', 'closed'].includes(String(f.status ?? '').toLowerCase()));
  const text = phase === 'fix'
    ? `Fix these review findings of the change:\n${open.map((f) => `- [${f.severity ?? '?'}] ${f.title ?? f.summary ?? ''} (${f.ref ?? f.file ?? ''})`).join('\n')}`
    : spec;
  const files = new Set((text.match(FILE_RE) ?? []).map((f) => f.toLowerCase()));
  return { text, facts: { kind: phase === 'fix' ? 'fix' : 'backend', fix: phase === 'fix', files: files.size, hasCheck: hasExecutableCheck(m, `${spec}\n${text}`), haikuAllowed: true, chars: text.length } };
}

/**
 * Routes one phase and writes the result into manifest.json: routing.stages[<stage>].model and
 * taskRouting[<phase>] (the decision with its timings). Returns the decision, or null when off.
 */
export async function routeStage(runDir, phase, { env = process.env, fetchImpl, ask } = {}) {
  if (routerMode(env) === 'off' || !STAGE_OF[phase]) return null;
  const mf = path.join(runDir, 'manifest.json');
  const m = readJson(mf);
  if (!m) return null;
  const stage = STAGE_OF[phase];
  const current = m.routing?.stages?.find((s) => s.id === stage)?.model === 'sonnet' ? 'sonnet' : 'haiku';
  const { text, facts } = routingInput(runDir, m, phase);
  const d = await routeTask({
    runId: m.runId, taskId: m.dispatch?.storyId ?? m.runId, phase, worker: 'haiku-build-auto', text, facts, current,
    provider: String(env.HAIKU_BUILD_TASK_ROUTER_PROVIDER ?? 'jev').toLowerCase(), cacheFile: path.join(runDir, 'task-routing.json'), env,
    ...(fetchImpl ? { fetchImpl } : {}), ...(ask ? { ask } : {}),
  });
  const fresh = readJson(mf) ?? m;
  fresh.routing = { ...(fresh.routing ?? {}), stages: (fresh.routing?.stages ?? []).map((s) => (s.id === stage ? { ...s, model: d.tier, routedBy: d.source } : s)) };
  fresh.taskRouting = { ...(fresh.taskRouting ?? {}), [phase]: { ...d, stage, at: new Date().toISOString() } };
  fs.writeFileSync(mf, JSON.stringify(fresh, null, 2));
  return d;
}
