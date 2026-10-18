export function parseAmount(text) {
  const s = String(text).trim();
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`bad amount: ${text}`);
  return Math.trunc(parseFloat(s) * 100);
}
