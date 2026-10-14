// The element-grounding decision, shared by find.mjs (live) and replay.mjs (offline A/B), so Laya and
// Jev always get the same state, the same question and the same acceptance gate.
// Moved unchanged out of find.mjs (web-test-laya-ground): wording, criteria format and thresholds are as there.

export const MAX_LAYA = 15;          // never send more candidates than this to the model
export const LAYA_MIN = 0.8;         // the model's pick is used only at or above this (top probability)
export const LAYA_MARGIN = 0.25;     // …and only when it beats the runner-up by this much

/** { state, questions } for a shortlist of { id, role, name, hint, disabled }. */
export function buildGroundRequest(goal, url, shortlist) {
  const criteria = Object.fromEntries(shortlist.map((c) => [c.id, `${c.role} "${c.name}"${c.hint ? ` (${c.hint})` : ''}${c.disabled ? ' [disabled]' : ''}`.slice(0, 160)]));
  criteria.none = 'None of these elements matches the goal.';
  return { state: { goal, page: url }, questions: { target: { type: 'choice', instructions: 'Which page element should a tester use for this goal?', criteria } } };
}

/**
 * Gate on top probability and margin (same rule for both providers — Jev's native `confidence`
 * is logged but not used here, so the comparison is not skewed by different confidence formulas).
 * Returns { label, p, second, accepted }.
 */
export function gate(probabilities = {}) {
  const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const label = sorted[0]?.[0] ?? null, p = sorted[0]?.[1] ?? 0, second = sorted[1]?.[1] ?? 0;
  return { label, p: Number(p.toFixed(3)), second: Number(second.toFixed(3)), accepted: !!label && label !== 'none' && p >= LAYA_MIN && p - second >= LAYA_MARGIN };
}
