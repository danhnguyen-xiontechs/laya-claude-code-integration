const RE = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/;
export function parseAmount(text) {
  const m = RE.exec(String(text));
  if (!m) throw new RangeError(`bad amount: ${text}`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}
