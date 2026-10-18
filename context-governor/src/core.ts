// context-governor pure rules (design §2). No I/O: io.ts reads and writes, hooks/ wires.
// Warn only: decide() returns notes to show; nothing here blocks, compacts or ends a turn.

export type Config = {
  mode: 'warn' | 'off';
  softTokens: number;
  strongTokens: number;
  rearmGapTokens: number;
  staleTurns: number;
  subagentFlagTokens: number;
};

export const DEFAULTS: Config = {
  mode: 'warn',
  softTokens: 120_000,
  strongTokens: 200_000,
  rearmGapTokens: 20_000,
  staleTurns: 15,
  subagentFlagTokens: 90_000,
};

export type State = {
  armed: { soft: boolean; strong: boolean };
  turnsSinceArtifact: number;
  lastArtifactMtimeMs: number;
  mainTurns: number;
};

export const emptyState = (): State => ({
  armed: { soft: true, strong: true },
  turnsSinceArtifact: 0,
  lastArtifactMtimeMs: 0,
  mainTurns: 0,
});

/** Newest mtime under artifactDir; null when the rule is off (no dir set, or it is missing). */
export type Artifact = { mtimeMs: number } | null;

export type Turn = { context: number; agentId?: string; artifact: Artifact };

export type Note = 'soft' | 'strong' | 'stale';

export type Decision = { state: State; notes: Note[]; flagged: boolean };

type UsageLike = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/** Context of one turn: input + cache read + cache creation (design §1). */
export function contextOf(usage: UsageLike | null | undefined): number | undefined {
  if (!usage) return undefined;
  return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

/**
 * Applies the rules to one turn. Subagent turns (agentId set) give no note and leave the
 * counters alone; they are flagged in metrics at or above subagentFlagTokens.
 * At most one note per turn: strong beats soft, and stale only shows when no threshold note does.
 * mode off still updates the state, but shows nothing.
 */
export function decide(prev: State, turn: Turn, cfg: Config): Decision {
  if (turn.agentId !== undefined) {
    return { state: prev, notes: [], flagged: turn.context >= cfg.subagentFlagTokens };
  }
  const s: State = { ...prev, armed: { ...prev.armed }, mainTurns: prev.mainTurns + 1 };

  if (!s.armed.soft && turn.context < cfg.softTokens - cfg.rearmGapTokens) s.armed.soft = true;
  if (!s.armed.strong && turn.context < cfg.strongTokens - cfg.rearmGapTokens) s.armed.strong = true;

  const notes: Note[] = [];
  if (turn.context >= cfg.strongTokens && s.armed.strong) {
    notes.push('strong');
    s.armed.strong = false;
    s.armed.soft = false;
  } else if (turn.context >= cfg.softTokens && s.armed.soft) {
    notes.push('soft');
    s.armed.soft = false;
  }

  if (turn.artifact) {
    if (turn.artifact.mtimeMs > s.lastArtifactMtimeMs) {
      s.lastArtifactMtimeMs = turn.artifact.mtimeMs;
      s.turnsSinceArtifact = 0;
    } else {
      s.turnsSinceArtifact += 1;
    }
    if (s.turnsSinceArtifact > cfg.staleTurns) {
      s.turnsSinceArtifact = 0;
      if (notes.length === 0) notes.push('stale');
    }
  }

  return { state: s, notes: cfg.mode === 'warn' ? notes : [], flagged: false };
}

/** The text shown for a note (design §1 "What the user sees"). */
export function noteText(note: Note, context: number, cfg: Config): string {
  const k = `${Math.round(context / 1000)}k`;
  if (note === 'soft') return `checkpoint: context ${k}, consider writing state to the experiment folder`;
  if (note === 'strong') {
    return `context ${k} ≥ ${Math.round(cfg.strongTokens / 1000)}k: run \`/fast-compact\` then \`/compact\`, or hand off with \`make_capsule.mjs\` to a fresh phase session`;
  }
  return `${cfg.staleTurns + 1} turns without a new artifact: logs piling up?`;
}
