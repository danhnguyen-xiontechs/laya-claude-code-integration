// Decide, once per run, whether the optional Laya engine is available. Prints ONE line:
//   laya=on url=…                        → scripts will use it
//   laya=off reason=disabled             → user said never; don't mention it
//   laya=off reason=ask                  → never asked: ask the user once, then `laya-check.mjs --set true|false`
//   laya=off reason=not-running          → installed but laya-serve is down: remind in one line, continue in rule mode
//   laya=off reason=not-installed        → enabled but not installed: offer the installer, continue in rule mode
// Usage: node laya-check.mjs [--set true|false] [--laya]
import { loadConfig, saveConfig, alive, installed } from './laya-lib.mjs';

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
if (setIdx !== -1) {
  const v = args[setIdx + 1];
  if (v !== 'true' && v !== 'false') { console.error('--set true|false'); process.exit(2); }
  saveConfig({ enabled: v === 'true' });
}
if (args.includes('--laya')) saveConfig({ enabled: true });

const cfg = loadConfig();
if (cfg.enabled === false) { console.log('laya=off reason=disabled'); process.exit(0); }

if (await alive(cfg.url)) {
  if (cfg.enabled === null) saveConfig({ enabled: true }); // it's there and running: no need to ask
  console.log(`laya=on url=${cfg.url}`);
  process.exit(0);
}
if (cfg.enabled === null) { console.log(installed() ? 'laya=off reason=not-running' : 'laya=off reason=ask'); process.exit(0); }
console.log(installed() ? `laya=off reason=not-running url=${cfg.url}` : 'laya=off reason=not-installed');
