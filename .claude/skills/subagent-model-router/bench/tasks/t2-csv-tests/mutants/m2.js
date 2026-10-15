export function parseCsvLine(line, sep = ',') {
  const out = [];
  let cur = '', i = 0, quoted = false;
  while (i < line.length) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === sep) { out.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (quoted) throw new Error('unterminated quote');
  out.push(cur);
  return out;
}
