const UNITS = { s: 1, m: 60, h: 3600 };
export function parseDuration(text) {
  const m = /^(\d+)([smh])$/.exec(String(text).trim());
  if (!m) throw new Error(`bad duration: ${text}`);
  return Number(m[1]) * UNITS[m[2]];
}
