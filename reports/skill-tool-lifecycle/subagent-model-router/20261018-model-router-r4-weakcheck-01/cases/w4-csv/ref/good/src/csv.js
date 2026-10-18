export function parseCsv(text) {
  const rows = [];
  if (text === '') return rows;
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawQuote = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') { inQuotes = true; sawQuote = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; sawQuote = false; i += 2; continue;
    }
    if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; sawQuote = false; i++; continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  if (field !== '' || row.length > 0 || sawQuote) { row.push(field); rows.push(row); }
  return rows;
}
