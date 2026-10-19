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

export type IncidentState = 'OPEN' | 'ESCALATION_REQUESTED' | 'ESCALATED' | 'NEEDS_USER' | 'CLOSED';

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
};

declare module 'claude-code' {
  interface PluginState {
    'haiku-100k': { guard: GuardState };
  }
}
