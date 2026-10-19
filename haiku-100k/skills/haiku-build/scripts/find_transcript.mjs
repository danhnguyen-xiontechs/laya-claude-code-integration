#!/usr/bin/env node
// Finds the main transcript (.jsonl) of the session running a haiku-build run, so step 01 can set
// manifest.transcript without guessing. Several sessions can share one project folder, so the newest file
// alone is not enough: the pick is the .jsonl that mentions the run id most often (see best()).
//
// Usage: node find_transcript.mjs <runId> [--write <runDir>] [--cwd <dir>] [--projects <dir>]
//   Prints the transcript path with forward slashes, or "null" (exit 1) when none mentions the run id.
//   --write also stores it as manifest.transcript in <runDir>/manifest.json.
//   Mention the run id in the conversation (for example in your first message) before calling it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Claude Code names a project folder after the session's start directory, every
// non-alphanumeric character replaced by '-' (D:\Laya -> D--Laya).
export function projectDirName(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function jsonlFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }));
  } catch {
    return [];
  }
}

// The run's own session names the run id far more often (every path, every manifest write) than a
// session that only started or watched it, so the most mentions wins; ties go to the newest file.
function best(candidates, runId) {
  let pick = null;
  for (const c of candidates) {
    const mentions = fs.readFileSync(c.p, 'utf8').split(runId).length - 1;
    if (!mentions) continue;
    if (!pick || mentions > pick.mentions || (mentions === pick.mentions && c.mtime > pick.mtime)) pick = { ...c, mentions };
  }
  return pick?.p ?? null;
}

// HAIKU_BUILD_PROJECTS_DIR overrides the projects folder (tests point it at an empty folder).
const defaultProjects = () => process.env.HAIKU_BUILD_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');

export function findTranscript(runId, { cwd = process.cwd(), projects = defaultProjects() } = {}) {
  if (!runId) return null;
  const found = best(jsonlFiles(path.join(projects, projectDirName(cwd))), runId);
  if (found) return found;
  // The session may have started in another folder: look in every project folder.
  let dirs = [];
  try { dirs = fs.readdirSync(projects).map((d) => path.join(projects, d)); } catch { dirs = []; }
  return best(dirs.flatMap(jsonlFiles), runId);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runId = process.argv[2];
  const opts = {};
  if (arg('--cwd')) opts.cwd = arg('--cwd');
  if (arg('--projects')) opts.projects = arg('--projects');
  const found = findTranscript(runId, opts);
  const out = found ? found.replace(/\\/g, '/') : null;
  // --write <runDir>: store the path in manifest.json directly, so it is never retyped through a shell.
  const runDir = arg('--write');
  if (runDir) {
    const mf = path.join(runDir, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.transcript = out;
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  }
  console.log(out ?? 'null');
  process.exit(found ? 0 : 1);
}
