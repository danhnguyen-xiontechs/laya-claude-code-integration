// agent-reliability I/O: telemetry JSONL and the git content token. Everything here
// is best effort; callers treat a throw or null as "unknown" and fail open.
import type { EngineInterface } from 'claude-code';

type Web = {
  crypto: { subtle: { digest(alg: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(s: string): Uint8Array };
};

export async function sha256(text: string): Promise<string> {
  const g = globalThis as unknown as Web;
  const buf = await g.crypto.subtle.digest('SHA-256', new g.TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Home directory from the environment (Windows USERPROFILE first, then HOME). */
export async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.';
}

export async function sessionId($: EngineInterface): Promise<string> {
  try { return (await $.session.id()) || 'unknown'; } catch { return 'unknown'; }
}

const MAX_LOG = 1_000_000;

/** Appends one line; past ~1 MB the oldest half is dropped. */
export async function appendJsonl($: EngineInterface, path: string, line: object): Promise<void> {
  let prev = await $.fs.read(path).catch(() => '');
  if (prev.length > MAX_LOG) prev = prev.slice(prev.indexOf('\n', prev.length / 2) + 1);
  await $.fs.write(path, prev + JSON.stringify(line) + '\n');
}

export async function logPath($: EngineInterface, kind: 'events' | 'diag'): Promise<string | null> {
  const sid = await sessionId($);
  if (sid === 'unknown') return null;
  const home = (await homeDir($)).replace(/\\/g, '/');
  return `${home}/.claude/agent-reliability/${kind === 'diag' ? 'diag-' : ''}${sid}.jsonl`;
}

/**
 * SHA-256 over the working tree as git sees it: status (with untracked files),
 * the full diff against HEAD, and the blob ids of untracked files (≤ 50).
 * null = unknown: not a repo, no HEAD, a nonzero exit, truncated output, too many
 * untracked files, or the total budget spent. Buffered, not streamed: a mod cannot
 * import node:crypto/child_process (docs/api-findings.md).
 */
export async function gitToken($: EngineInterface, cwd: string, budgetMs: number): Promise<string | null> {
  const t0 = Date.now();
  const run = async (argv: string[]): Promise<string | null> => {
    const left = budgetMs - (Date.now() - t0);
    if (left < 50) return null;
    try {
      const r = await $.process.run(argv, { cwd, timeoutMs: Math.round(left) });
      if (r.exitCode !== 0 || r.isStdoutTruncated) return null;
      return r.stdout;
    } catch { return null; }
  };
  const status = await run(['git', 'status', '--porcelain=v1', '-uall', '-z']);
  if (status === null) return null;
  const untracked = status.split('\0').filter((e) => e.startsWith('?? ')).map((e) => e.slice(3));
  if (untracked.length > 50) return null;
  const diff = await run(['git', '-c', 'core.quotepath=off', 'diff', 'HEAD', '--no-ext-diff', '--binary']);
  if (diff === null) return null;
  let blobs = '';
  if (untracked.length) {
    const b = await run(['git', 'hash-object', '--', ...untracked]);
    if (b === null) return null;
    blobs = b;
  }
  if (Date.now() - t0 > budgetMs) return null;
  try { return await sha256(`${status}\n--\n${diff}\n--\n${blobs}`); } catch { return null; }
}
