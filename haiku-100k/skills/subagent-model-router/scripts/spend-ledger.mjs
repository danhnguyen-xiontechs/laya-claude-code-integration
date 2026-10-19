// spend-ledger.mjs — per-session provider spend (USD) and call counts, kept in one JSON file.
// Zero dependencies, Node >= 18. Read-modify-write with no lock: two routes that finish at the same
// instant can lose one update, so the cap can be exceeded by the calls already in flight.
//
//   { "sessions": { "<session id>": { "usd": 0.0312, "calls": 6, "unreported": 0, "updated": "…" } } }
//
// Delete the file to reset every session. A file that cannot be parsed makes the router stop calling the
// provider (fail closed), so a corrupt ledger never resets the cap silently.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LEDGER = path.join(os.homedir(), '.subagent-model-router', 'spend.json');

export const round = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

export function readLedger(file) {
  if (!fs.existsSync(file)) return { sessions: {} };
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || typeof j !== 'object' || !j.sessions || typeof j.sessions !== 'object') throw new Error(`not a ledger: ${file}`);
  return j;
}

/** { usd, calls, unreported } spent so far by one session (zeros when the session is new). */
export function sessionSpend(file, session) {
  const s = readLedger(file).sessions[session] ?? {};
  return { usd: Number(s.usd) || 0, calls: Number(s.calls) || 0, unreported: Number(s.unreported) || 0 };
}

/** Add one batch of provider calls to a session. `unreported` counts calls that returned no cost. */
export function addSpend(file, session, { usd = 0, calls = 0, unreported = 0 } = {}) {
  const j = readLedger(file);
  const s = sessionSpend(file, session);
  j.sessions[session] = {
    usd: round(s.usd + usd),
    calls: s.calls + calls,
    unreported: s.unreported + unreported,
    updated: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
}
