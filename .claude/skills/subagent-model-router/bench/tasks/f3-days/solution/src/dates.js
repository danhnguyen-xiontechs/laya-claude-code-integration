const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
