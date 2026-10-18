// context-governor: warn-only context watch. Wiring only; the rules are in src/core.ts.
// Runs after the turn finishes and only adds a note; the model never sees it.
// A failure to read or write the state and metrics files never hides a note, and nothing here
// blocks, compacts or ends a turn.
import type { EngineInterface, Register } from 'claude-code';
import { contextOf, decide, noteText, type Config, type Note } from '../src/core.ts';
import { appendMetrics, homeDir, metricsPath, readConfig, readState, scanArtifact, statePath, writeState } from '../src/io.ts';

const SLOW_MS = 200;

// The engine always has these in a session; a bare test harness may not, so each one falls back.
async function sessionId($: EngineInterface): Promise<string> {
  try { return await $.session.id(); } catch { return 'unknown'; }
}

async function usedTokens($: EngineInterface): Promise<number> {
  try { return (await $.session.usage()).context.tokens ?? 0; } catch { return 0; }
}

export const register: Register = (on, options) => {
  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    const t0 = Date.now();
    try {
      const cfg: Config = readConfig(options as Readonly<Record<string, unknown>>);
      const home = await homeDir($);
      const sid = await sessionId($);
      const context = contextOf(e.usage) ?? (await usedTokens($));
      const dir = (await $.env.get('CONTEXT_GOVERNOR_ARTIFACT_DIR')) || (options as Record<string, unknown>).artifactDir || '';
      const artifact = e.agentId === undefined && dir ? await scanArtifact($, String(dir)) : null;

      const statePth = statePath(home, sid);
      const prev = await readState($, statePth);
      const d = decide(prev, { context, agentId: e.agentId, artifact }, cfg);

      // Notes are decided first, so a file error below cannot hide them.
      const texts = d.notes.map((n: Note) => noteText(n, context, cfg));
      const slow = Date.now() - t0 > SLOW_MS;
      if (e.agentId === undefined) {
        $.ui.status(`ctx ${Math.round(context / 1000)}k / ${Math.round(cfg.strongTokens / 1000)}k`);
        d.notes.forEach((n, i) => (n === 'soft' ? $.ui.log(texts[i]!) : $.ui.toast(texts[i]!)));
      }

      try {
        if (e.agentId === undefined) await writeState($, statePth, d.state);
        await appendMetrics($, metricsPath(home, sid), {
          ts: Date.now(), session: sid, turnId: e.turnId, agentId: e.agentId ?? null, model: e.usage?.model ?? null,
          input: e.usage?.input_tokens ?? null, cacheRead: e.usage?.cache_read_input_tokens ?? null,
          cacheCreation: e.usage?.cache_creation_input_tokens ?? null, context, output: e.usage?.output_tokens ?? null,
          durationMs: e.durationMs, isAborted: e.isAborted, notes: d.notes, flagged: d.flagged, hookMs: Date.now() - t0, slow,
        });
      } catch {
        // metrics are best effort
      }

      // Above SLOW_MS the hook takes no other action: no note is shown, the metrics line says so.
      if (e.agentId !== undefined || d.notes.length === 0 || slow) return r;
      return { ...r, text: texts.join('\n') };
    } catch {
      return r; // a failure here shows nothing and never changes the turn
    }
  });
};
