// retry-loop-breaker's $.state contract (self-contained, per `claude plugin validate`).
export type Category = 'test_run' | 'build';

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

export type GuardState = {
  /** Mutation epoch: +1 on each successful Edit/Write, possibly-mutating Bash, or a user "rerun" prompt. */
  epoch: number;
  records: FailureRecord[];
  /** Keys of actions seen both passing and failing at one epoch: never blocked. */
  flaky: string[];
  passed: string[];
  stats: { eligible: number; wouldBlock: number; blocked: number; jevCalls: number; jevErrors: number };
  audit: AuditEntry[];
};

declare module 'claude-code' {
  interface PluginState {
    'retry-loop-breaker': { guard: GuardState };
  }
}
