#!/usr/bin/env node
// Checks that a v2 run can start before any subagent is started: Node 22 or newer, and the haiku-100k setup
// marker that /haiku-100k:setup writes, modelSettings['claude-haiku-5-5'].autoCompactWindow in
// ~/.claude/settings.json. A failed check stops the run with a message.
//
// Usage: node preflight.mjs [--settings <file>]
//   Prints one line: "preflight ok ..." (exit 0) or "preflight failed: ..." (exit 1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_NODE_MAJOR = 22;
export const HAIKU_KEY = 'claude-haiku-5-5';
export const DEFAULT_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

function setupProblem(settingsFile) {
  if (!fs.existsSync(settingsFile)) return `haiku-100k setup missing: ${settingsFile} not found; run /haiku-100k:setup`;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, ''));
  } catch {
    return `haiku-100k setup missing: ${settingsFile} is not valid JSON; fix it, then run /haiku-100k:setup`;
  }
  const w = json?.modelSettings?.[HAIKU_KEY]?.autoCompactWindow;
  if (typeof w !== 'number') return `haiku-100k setup missing: no modelSettings['${HAIKU_KEY}'].autoCompactWindow in ${settingsFile}; run /haiku-100k:setup`;
  return null;
}

/** Returns { ok, problems: string[], message }. */
export function preflight({ nodeVersion = process.versions.node, settingsFile = DEFAULT_SETTINGS } = {}) {
  const problems = [];
  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) problems.push(`Node ${nodeVersion} is too old: haiku-build needs Node ${MIN_NODE_MAJOR} or newer`);
  const setup = setupProblem(settingsFile);
  if (setup) problems.push(setup);
  const ok = problems.length === 0;
  return { ok, problems, message: ok ? `preflight ok: Node ${nodeVersion}, haiku-100k setup found` : `preflight failed: ${problems.join('; ')}` };
}

/** Calls start() only when the preflight passed. Returns { started, message, value? }. */
export function startIfReady(result, start) {
  if (!result?.ok) return { started: false, message: result?.message ?? 'preflight failed: no result' };
  return { started: true, message: result.message, value: start() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--settings');
  const r = preflight(i >= 0 ? { settingsFile: args[i + 1] } : {});
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
