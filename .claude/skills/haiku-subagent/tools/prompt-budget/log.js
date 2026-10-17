// Shared run log: one JSON object per line in <project>/.claude/prompt-budget/runs.jsonl
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// CLAUDE_PROJECT_DIR wins over the hook's cwd, which drifts after the agent `cd`s into a subfolder.
export const logPath = (projectDir) =>
  join(process.env.CLAUDE_PROJECT_DIR ?? projectDir ?? process.cwd(), '.claude', 'prompt-budget', 'runs.jsonl');

export function logEvent(obj, projectDir) {
  try {
    const file = logPath(projectDir);
    mkdirSync(join(file, '..'), { recursive: true });
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');
  } catch {
    /* logging is best-effort and must never block a subagent */
  }
}
