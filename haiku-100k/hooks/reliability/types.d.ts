// Shipped copy of agent-reliability/types/index.d.ts (scripts/ship-haiku-100k.mjs). Edit the source, not this file.
// agent-reliability's $.state contract (self-contained, per `claude plugin validate`).
export type Category = 'test_run' | 'build';
export type Mode = 'observe' | 'enforce' | 'off';

export type FailureRecord = {
  schema_version: '1.0';
  key: string;
  workspace: string;
  tool_category: Category;
  normalized_action: string;
  exit_code: number | null;
  error_fingerprint: string;
  error_summary: string;
  transient: boolean;
  state_epoch: number;
  timestamp: number;
  repeat_count: number;
};

export type AuditEntry = { t: number; action: string; decision: string; reason: string; jev?: string };

export type IncidentState =
  | 'OPEN' | 'ESCALATION_REQUESTED' | 'ESCALATED' | 'NEEDS_USER' | 'CLOSED'
  /** 0.3, set only by an applied Jev decision: an external blocker / automatic recovery stopped. Never success. */
  | 'BLOCKED' | 'STOPPED'
  /** 0.3: a new user prompt ended the incident (resolution says how); kept for the report. */
  | 'SUPERSEDED';

/** One failed attempt of an incident, redacted, as the Jev advisor sees it. */
export type Attempt = { tool: string; action: string; error: string; changes: string[] };

/** The 5 recovery actions the Jev advisor chooses from. */
export type NextAction = 'RETRY_NEW_STRATEGY' | 'ESCALATE_MODEL' | 'ASK_USER' | 'MARK_BLOCKED' | 'STOP_AND_REPORT';

export type RefusalKind = 'harness_refusal' | 'user_denied';

/** Rule C: a refused call. `core` = command key (Bash/PS), `raw` = the form refused, `file` = file key. */
export type Refusal = {
  n: number;
  kind: RefusalKind;
  /** harness only: the form was refused (another form may pass); false = the action needs approval. */
  form: boolean;
  agent: string;
  tool: string;
  label: string;
  core?: string;
  raw?: string;
  file?: string;
  at: number;
  /** user_denied only: lifted by /reliability allow. */
  lifted?: boolean;
};

export type Incident = {
  id: string;
  /** Same key as the Case B record: scope (workspace + agent) :: normalized command. */
  key: string;
  agent: string;
  action: string;
  state: IncidentState;
  fails: number;
  /** Failed recovery strategies (Rule A): the changes made before each failing rerun. */
  strategies: { changes: string[]; errorKey: string; summary: string }[];
  /** Mutations seen since the last failure (not yet a strategy). */
  pending: string[];
  errorKey: string;
  summary: string;
  /** Baseline at the last failure: mutation epoch and git content token (null = unknown). */
  baseEpoch: number;
  baseToken: string | null;
  escalationDenied?: boolean;
  recoveryAgentId?: string;
  recoveryBackground?: boolean;
  recoveryDone?: boolean;
  /** 0.3: 'verify' = Rule A verification (default), 'streak' = any other failing Bash/PS/Edit/Write key. */
  kind?: 'verify' | 'streak';
  /** 0.3: the last 4 failed attempts (redacted). */
  attempts?: Attempt[];
  /** 0.3: the current state was set by an applied Jev decision (else by Rule A). */
  decidedBy?: 'jev';
  /** 0.3: Jev already escalated this incident once. */
  jevEscalated?: boolean;
  /** 0.3: RETRY_NEW_STRATEGY applied: a near-identical rerun with nothing changed is denied. */
  retryArmed?: { epoch: number; actions: string[] };
  /** 0.3: opened after a NEEDS_USER that a prompt ended: budget 1. */
  afterNeedsUser?: boolean;
  /** 0.3: why it ended (SUPERSEDED: prompt_received; CLOSED: pass / success). */
  resolution?: string;
  openedAt: number;
  updatedAt: number;
};

export type GuardState = {
  schema: 2;
  /** Mutation epoch: +1 on each successful Edit/Write, possibly-mutating Bash, a user "rerun" prompt, or a git token change. */
  epoch: number;
  records: FailureRecord[];
  /** Keys of actions seen both passing and failing at one epoch: never blocked. */
  flaky: string[];
  passed: string[];
  incidents: Incident[];
  nextIncident: number;
  /** /reliability observe|enforce|off for this session; absent = not set. */
  modeOverride?: Mode;
  stats: { eligible: number; wouldBlock: number; blocked: number; jevCalls: number; jevErrors: number; escalations: number; failOpen: number };
  audit: AuditEntry[];
  /** 0.3 Rule C. */
  refusals: Refusal[];
  nextRefusal: number;
  /** 0.3: consecutive refusals per agent. */
  refusalStreak: Record<string, number>;
  /** 0.3: keys whose NEEDS_USER incident a prompt ended: the next incident on the key gets budget 1. */
  needsUserKeys: string[];
  /** 0.3: the last Jev advisor decisions, for /reliability. */
  jevLog: { t: number; incident: string; action: string; decision: string; p: number; applied: string }[];
  /** 0.3: the last user prompt, redacted (kept only when includePromptInJev). */
  lastPrompt?: string;
};

declare module 'claude-code' {
  interface PluginState {
    'haiku-100k': { guard: GuardState };
  }
}
