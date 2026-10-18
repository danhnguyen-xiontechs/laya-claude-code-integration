export function parseCsv(text) {
  if (text === '') return [];
  return text.split(/\r?\n/).map((line) => line.split(',').map((f) => f.replace(/^"(.*)"$/, '$1')));
}
