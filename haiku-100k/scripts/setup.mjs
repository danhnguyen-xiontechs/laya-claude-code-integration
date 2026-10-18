#!/usr/bin/env node
// Sets the auto-compact window of main Haiku sessions to 125000 tokens (compaction then fires near 95k), so
// every Haiku request stays under the 100k price step. Writes `modelSettings` in ~/.claude/settings.json,
// only for Haiku model names; other models keep their window. A plugin cannot change settings by itself:
// the /haiku-100k:setup command runs this after the user agrees.
// Usage: node setup.mjs [--apply | --remove] [--settings <file>]   (no flag = show what would change)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const i = args.indexOf('--settings');
const file = i >= 0 ? args[i + 1] : path.join(os.homedir(), '.claude', 'settings.json');
const KEYS = ['claude-haiku-5-5', 'haiku'];
const WINDOW = 125000; // main sessions: the app starts at ~73k and the engine compacts ~30k below the window, so 100000 would compact on every request; 125000 compacts near 95k and the hook keeps requests under 100k

const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : {};
const before = JSON.stringify(json.modelSettings ?? {});
json.modelSettings ??= {};
for (const k of KEYS) {
  if (args.includes('--remove')) {
    if (json.modelSettings[k]) {
      delete json.modelSettings[k].autoCompactWindow;
      if (!Object.keys(json.modelSettings[k]).length) delete json.modelSettings[k];
    }
  } else {
    json.modelSettings[k] = { ...(json.modelSettings[k] ?? {}), autoCompactWindow: WINDOW };
  }
}
if (!Object.keys(json.modelSettings).length) delete json.modelSettings;
const after = JSON.stringify(json.modelSettings ?? {});
if (before === after) {
  console.log(`haiku-100k: nothing to change in ${file} (modelSettings ${after})`);
} else if (args.includes('--apply') || args.includes('--remove')) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-haiku-100k`);
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  console.log(`haiku-100k: ${file} modelSettings ${before} -> ${after} (backup ${path.basename(file)}.bak-haiku-100k). Takes effect in new sessions.`);
} else {
  console.log(`haiku-100k: would set modelSettings ${before} -> ${after} in ${file}. Run with --apply to write it.`);
}
