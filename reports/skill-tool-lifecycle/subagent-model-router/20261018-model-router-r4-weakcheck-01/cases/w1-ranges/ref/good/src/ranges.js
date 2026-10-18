export function mergeRanges(ranges) {
  for (const r of ranges) {
    if (r[0] > r[1]) throw new RangeError(`bad range: ${JSON.stringify(r)}`);
  }
  const sorted = ranges.map((r) => [r[0], r[1]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}
