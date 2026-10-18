// context-governor: warn-only context watch. Wiring only; the rules are in src/core.ts.
// Runs after the turn finishes and only adds a note; the model never sees it.
// A failure to read or write the state and metrics files never hides a note, and nothing here
// blocks, compacts or ends a turn.
import type { EngineInterface, Register } from 'claude-code';
import { contextOf, decide, emptyState, noteText, type Config, type Note, type State } from '../src/core.ts';
import { appendMetrics, homeDir, metricsPath, readConfig, readState, scanArtifact, statePath, writeState } from '../src/io.ts';

const SLOW_MS = 200;
const UNKNOWN = 'unknown';

// Armed flags kept per session in this process. If the state file cannot be written, the next
// turn still sees what was already shown, so a note never repeats on every turn above a threshold.
const memo = new Map<string, State>();

// The engine always has these in a session; a bare test harness may not, so each one falls back.
async function sessionId($: EngineInterface): Promise<string> {
  try { return (await $.session.id()) || UNKNOWN; } catch { return UNKNOWN; }
}

/** Context from the session's own usage; undefined when it cannot be read (no note is then decided). */
async function usedTokens($: EngineInterface): Promise<number | undefined> {
  try {
    const t = (await $.session.usage()).context.tokens;
    return typeof t === 'number' ? t : undefined;
  } catch {
    return undefined;
  }
}

export const register: Register = (on, options) => {
  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    const t0 = Date.now();
    try {
      const cfg: Config = readConfig(options as Readonly<Record<string, unknown>>);
      const context = contextOf(e.usage) ?? (await usedTokens($));
      const main = e.agentId === undefined;
      if (main && context !== undefined) $.ui.status(`ctx ${Math.round(context / 1000)}k / ${Math.round(cfg.strongTokens / 1000)}k`);
      // Unknown context: nothing is decided. Unknown session: notes are decided from a fresh state, and
      // no state or metrics file is written, so the counters cannot leak into another session.
      if (context === undefined) return r;
      const sid = await sessionId($);
      const known = sid !== UNKNOWN;

      const home = await homeDir($);
      const dir = (await $.env.get('CONTEXT_GOVERNOR_ARTIFACT_DIR')) || (options as Record<string, unknown>).artifactDir || '';
      const artifact = main && dir ? await scanArtifact($, String(dir)) : null;

      const statePth = statePath(home, sid);
      const prev = known ? (memo.get(sid) ?? (await readState($, statePth))) : emptyState();
      const d = decide(prev, { context, agentId: e.agentId, artifact }, cfg);
      if (known) memo.set(sid, d.state);

      // Notes are decided first, so a file error below cannot hide them.
      const texts = d.notes.map((n: Note) => noteText(n, context, cfg));
      // A slow hook (over SLOW_MS) takes no visible action: its note is left out and only the metrics line says so.
      const shown = main && Date.now() - t0 <= SLOW_MS;
      if (shown) d.notes.forEach((n, i) => (n === 'soft' ? $.ui.log(texts[i]!) : $.ui.toast(texts[i]!)));

      try {
        if (main && known) await writeState($, statePth, d.state);
      } catch {
        // the state file is best effort; memo keeps the armed flags for this process
      }
      try {
        if (known) await appendMetrics($, metricsPath(home, sid), {
          ts: Date.now(), session: sid, turnId: e.turnId, agentId: e.agentId ?? null, model: e.usage?.model ?? null,
          input: e.usage?.input_tokens ?? null, cacheRead: e.usage?.cache_read_input_tokens ?? null,
          cacheCreation: e.usage?.cache_creation_input_tokens ?? null, context, output: e.usage?.output_tokens ?? null,
          durationMs: e.durationMs, isAborted: e.isAborted, notes: d.notes, flagged: d.flagged, hookMs: Date.now() - t0, slow: !shown && main,
        });
      } catch {
        // metrics are best effort
      }

      if (!shown || d.notes.length === 0) return r;
      return { ...r, text: texts.join('\n') };
    } catch {
      return r; // a failure here shows nothing and never changes the turn
    }
  });
};

