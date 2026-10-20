// Ships agent-reliability inside the haiku-100k plugin: copies the hooks, the state
// types and the engine test to haiku-100k/hooks/reliability/, renames the plugin in the
// places that must be literals (state ref, PluginState key, agent prefix), adds the
// module to haiku-100k/hooks/hooks.json and the userConfig + types to its plugin.json.
// agent-reliability/ stays the source; edit there, then run this again.
//   node agent-reliability/scripts/ship-haiku-100k.mjs          write
//   node agent-reliability/scripts/ship-haiku-100k.mjs --check  exit 1 if the shipped copy is stale
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.resolve(src, '..', 'haiku-100k');
const dest = path.join(plugin, 'hooks', 'reliability');
const NAME = 'haiku-100k';
const check = process.argv.includes('--check');

const FILES = [
  ['hooks/core.ts', 'core.ts'],
  ['hooks/incident.ts', 'incident.ts'],
  ['hooks/io.ts', 'io.ts'],
  ['hooks/advisor.ts', 'advisor.ts'],
  ['hooks/register.ts', 'register.ts'],
  ['types/index.d.ts', 'types.d.ts'],
  ['tests/engine.test.ts', 'engine.test.ts'],
];

const rename = (text) => text
  .replaceAll("'../types/index.d.ts'", "'./types.d.ts'")
  .replace("const PLUGIN = 'agent-reliability';", `const PLUGIN = '${NAME}';`)
  .replace("{ plugin: 'agent-reliability', key: 'guard' }", `{ plugin: '${NAME}', key: 'guard' }`)
  .replace("'agent-reliability': { guard: GuardState }", `'${NAME}': { guard: GuardState }`)
  .replaceAll("'agent-reliability:opus-recovery'", `'${NAME}:opus-recovery'`);

const out = new Map();
for (const [from, to] of FILES) {
  const nl = fs.readFileSync(path.join(src, from), 'utf8').includes('\r\n') ? '\r\n' : '\n';
  out.set(path.join(dest, to), `// Shipped copy of agent-reliability/${from} (scripts/ship-haiku-100k.mjs). Edit the source, not this file.${nl}${rename(fs.readFileSync(path.join(src, from), 'utf8'))}`);
}

// One hooks module per plugin and one unmatched session.start per event: haiku-100k's own
// register.ts writes startSession's registrations out in its session.start (the runtime cannot
// follow $ into an imported startSession) and calls registerHooks at its end (by hand).
const host = fs.readFileSync(path.join(plugin, 'hooks', 'register.ts'), 'utf8');
if (!host.includes("name: 'reliability'") || !host.includes("name: 'retry-guard'") || !host.includes('RECOVERY_AGENT') || !host.includes('registerHooks(on, options)')) {
  console.error('haiku-100k/hooks/register.ts must register /reliability, /retry-guard and RECOVERY_AGENT in session.start, and call registerHooks(on, options)');
  process.exit(1);
}

// Skills ship as they are, one folder each, into haiku-100k/skills/ (0.3: reliability-report).
const skillsSrc = path.join(src, 'skills');
if (fs.existsSync(skillsSrc)) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  for (const file of walk(skillsSrc)) out.set(path.join(plugin, 'skills', path.relative(skillsSrc, file)), fs.readFileSync(file, 'utf8'));
}

const manifestPath = path.join(plugin, '.claude-plugin', 'plugin.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const own = JSON.parse(fs.readFileSync(path.join(src, '.claude-plugin', 'plugin.json'), 'utf8'));
manifest.types = './hooks/reliability/types.d.ts';
manifest.userConfig = Object.fromEntries(Object.entries(own.userConfig).map(([k, v]) => [k, { ...v, title: `Reliability: ${v.title}` }]));
out.set(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

let stale = 0;
for (const [file, text] of out) {
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const same = now !== null && now.replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n');
  if (same) continue;
  stale++;
  if (check) { console.log(`stale: ${path.relative(path.dirname(src), file)}`); continue; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`wrote: ${path.relative(path.dirname(src), file)}`);
}
if (check && stale) process.exit(1);
if (!stale) console.log('haiku-100k reliability copy is up to date');
