// Decide, once per run, whether the optional Jev decision engine may be used. Prints ONE line:
//   jev=on model=…                       → user consented and OPENROUTER_API_KEY is set: scripts will call Jev
//   jev=off reason=disabled              → user said never; don't mention it
//   jev=off reason=ask                   → never asked: ask the user once, then `jev-check.mjs --set true|false`
//   jev=off reason=no-openrouter-key     → consented but OPENROUTER_API_KEY is missing: say so in one line, continue in rule mode
// Jev is a hosted API (OpenRouter → TypeSafe): compact step / page text is sent to it, so the first use needs a yes.
// Usage: node jev-check.mjs [--set true|false] [--jev]
import { loadConfig, saveConfig } from './jev-lib.mjs';
import { jevReady } from './decision-provider.mjs';

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
if (setIdx !== -1) {
  const v = args[setIdx + 1];
  if (v !== 'true' && v !== 'false') { console.error('--set true|false'); process.exit(2); }
  saveConfig({ enabled: v === 'true' });
}
if (args.includes('--jev')) saveConfig({ enabled: true });

const cfg = loadConfig();
if (cfg.enabled === false) console.log('jev=off reason=disabled');
else if (cfg.enabled !== true) console.log('jev=off reason=ask');
else if (!jevReady()) console.log('jev=off reason=no-openrouter-key');
else console.log(`jev=on model=${cfg.model}`);
