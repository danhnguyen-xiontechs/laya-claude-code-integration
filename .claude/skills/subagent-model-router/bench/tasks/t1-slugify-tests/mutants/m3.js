export function slugify(text, { maxLength = 60 } = {}) {
  let s = String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/-+$/, '');
  return s;
}
