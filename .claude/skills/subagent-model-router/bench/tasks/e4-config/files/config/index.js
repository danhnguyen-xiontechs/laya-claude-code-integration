import base from './default.js';
import prod from './production.js';
const byEnv = { production: prod };
// Later sources win, but only for values that are not undefined.
function merge(...sources) {
  const out = {};
  for (const s of sources) for (const [k, v] of Object.entries(s)) if (v !== undefined) out[k] = v;
  return out;
}
export const config = merge(base, byEnv[process.env.NODE_ENV] ?? {}, { port: process.env.PORT && Number(process.env.PORT) });
