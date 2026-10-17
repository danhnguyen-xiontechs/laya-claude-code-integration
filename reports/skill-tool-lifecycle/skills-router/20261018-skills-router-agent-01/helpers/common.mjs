// Shared by both arms: the plain skill listing (name, kind, source, description) of the catalog for a project root.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const TOOL_DIR = process.env.SR_TOOL_DIR; // the real skills-router folder (outside the agents' copy)

export function listing(root) {
  const r = spawnSync(process.execPath, [path.join(TOOL_DIR, 'scripts', 'catalog.mjs'), '--project-root', root, '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const cat = JSON.parse(r.stdout);
  const lines = cat.entries.map((e) => {
    const d = String(e.description || '').replace(/\s+/g, ' ').trim();
    return `- ${e.id} [${e.kind}, ${e.source}]: ${d}`;
  });
  return `Installed skills, slash commands and subagents (${cat.entries.length}):\n${lines.join('\n')}\n`;
}
