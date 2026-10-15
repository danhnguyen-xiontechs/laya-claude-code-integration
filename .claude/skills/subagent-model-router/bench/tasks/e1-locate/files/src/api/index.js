export { parseDuration } from '../core/duration.js';
export function parseDurationLoose(t) { try { return parseDuration(t); } catch { return 0; } }
