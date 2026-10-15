import { parseDuration } from '../core/duration.js';
export const toMs = (s) => parseDuration(s) * 1000;
