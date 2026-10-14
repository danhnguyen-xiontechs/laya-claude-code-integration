// Decide, once per run, whether the optional Laya engine is available — and start it when it is
// installed but not running. Prints ONE line:
//   laya=on url=…                        → already running (not started by this skill; leave it running)
//   laya=on url=… started=<pid> waited=<s> → this call started laya-serve; run `laya-check.mjs --stop` at the end
//   laya=off reason=disabled             → user said never; don't mention it
//   laya=off reason=ask                  → never asked: ask the user once, then `laya-check.mjs --set true|false`
//   laya=off reason=start-failed log=…   → installed but would not start: say so in one line, continue in rule mode
//   laya=off reason=not-installed        → enabled but not installed: offer the installer, continue in rule mode
// A/B variant — with provider jev (--provider jev, env DECISION_PROVIDER, or laya.json `provider`) Laya is not
// checked or started; it prints instead:
//   decider=jev model=…                  → OPENROUTER_API_KEY is set: find.mjs uses Jev
//   decider=off reason=no-openrouter-key → key missing: say so in one line, continue in rule mode
// Usage: node laya-check.mjs [--set true|false] [--laya] [--no-start] [--provider laya|jev]
//        node laya-check.mjs --stop     stop the server this skill started (no-op otherwise)
import { loadConfig, saveConfig, alive, installed, start, stop, SERVE_LOG } from './laya-lib.mjs';
import { JEV_MODEL, jevReady, resolveProvider } from './decision-provider.mjs';

const args = process.argv.slice(2);
const pIdx = args.indexOf('--provider');
let provider;
try { provider = resolveProvider({ flag: pIdx === -1 ? undefined : args[pIdx + 1], cfg: loadConfig() }); } catch (e) { console.error(e.message); process.exit(2); }
if (provider === 'jev' && !args.includes('--stop')) {
  console.log(jevReady() ? `decider=jev model=${loadConfig().jevModel || JEV_MODEL}` : 'decider=off reason=no-openrouter-key');
  process.exit(0);
}
if (args.includes('--stop')) {
  const r = await stop();
  console.log(r.stopped ? `laya=stopped pid=${r.pid}` : `laya=left-running reason=${r.reason}`);
  process.exit(0);
}
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
if (!installed()) { console.log(cfg.enabled === null ? 'laya=off reason=ask' : 'laya=off reason=not-installed'); process.exit(0); }
if (args.includes('--no-start')) { console.log(`laya=off reason=not-running url=${cfg.url}`); process.exit(0); }

// Installed but down: start it (installed counts as consent — the user installed it for this skill).
const r = await start(cfg);
if (r.ok) {
  if (cfg.enabled === null) saveConfig({ enabled: true });
  console.log(`laya=on url=${cfg.url} started=${r.pid} waited=${r.waited}`);
} else {
  await stop(); // don't leave a half-started server behind
  console.log(`laya=off reason=${r.reason} log=${SERVE_LOG}`);
}
