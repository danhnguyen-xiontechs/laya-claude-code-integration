// context-governor I/O: userConfig, state and metrics files, artifact scan. Errors here are
// caught by the hook; a corrupt state file counts as fresh state.
import type { EngineInterface } from 'claude-code';
import { DEFAULTS, type Artifact, type Config, type State, emptyState } from './core.ts';

const MAX_DEPTH = 3;
const MAX_ENTRIES = 500;

/** userConfig with defaults; a bad or missing value falls back to its default. */
export function readConfig(raw: Readonly<Record<string, unknown>> = {}): Config {
  const num = (k: 'softTokens' | 'strongTokens' | 'rearmGapTokens' | 'staleTurns' | 'subagentFlagTokens'): number => {
    const v = raw[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULTS[k];
  };
  const str = (k: 'softText' | 'strongText' | 'staleText'): string => {
    const v = raw[k];
    return typeof v === 'string' && v.trim() ? v : DEFAULTS[k];
  };
  return {
    mode: raw.mode === 'off' ? 'off' : 'warn',
    softText: str('softText'),
    strongText: str('strongText'),
    staleText: str('staleText'),
    softTokens: num('softTokens'),
    strongTokens: num('strongTokens'),
    rearmGapTokens: num('rearmGapTokens'),
    staleTurns: num('staleTurns'),
    subagentFlagTokens: num('subagentFlagTokens'),
  };
}

/** Home directory from the environment (Windows USERPROFILE first, then HOME). */
export async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.';
}

export const stateDir = (home: string) => `${home}/.claude/context-governor`;

export async function readState($: EngineInterface, path: string): Promise<State> {
  try {
    const parsed = JSON.parse(await $.fs.read(path)) as Partial<State>;
    return { ...emptyState(), ...parsed, armed: { ...emptyState().armed, ...parsed.armed } };
  } catch {
    return emptyState();
  }
}

export async function writeState($: EngineInterface, path: string, s: State): Promise<void> {
  await $.fs.write(path, JSON.stringify(s));
}

/** Newest file mtime under dir, scanning at most MAX_DEPTH levels and MAX_ENTRIES entries. Null if dir is missing. */
export async function scanArtifact($: EngineInterface, dir: string): Promise<Artifact> {
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>>;
  try {
    entries = await $.fs.list(dir);
  } catch {
    return null;
  }
  let newest = 0;
  let seen = 0;
  const queue: { path: string; depth: number }[] = [{ path: dir, depth: 0 }];
  while (queue.length && seen < MAX_ENTRIES) {
    const cur = queue.shift()!;
    const list = cur.path === dir ? entries : await $.fs.list(cur.path).catch(() => []);
    for (const ent of list) {
      if (++seen > MAX_ENTRIES) break;
      if (ent.kind === 'file') newest = Math.max(newest, ent.mtimeMs);
      else if (ent.kind === 'dir' && cur.depth + 1 < MAX_DEPTH) queue.push({ path: `${cur.path}/${ent.name}`, depth: cur.depth + 1 });
    }
  }
  return { mtimeMs: newest };
}

export const metricsPath = (home: string, sid: string) => `${stateDir(home)}/${sid}.jsonl`;
export const statePath = (home: string, sid: string) => `${stateDir(home)}/${sid}.state.json`;

export async function appendMetrics($: EngineInterface, path: string, line: object): Promise<void> {
  const prev = await $.fs.read(path).catch(() => '');
  await $.fs.write(path, prev + JSON.stringify(line) + '\n');
}
