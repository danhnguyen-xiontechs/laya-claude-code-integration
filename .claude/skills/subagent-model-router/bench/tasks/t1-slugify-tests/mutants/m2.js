export function slugify(text, { maxLength = 60 } = {}) {
  let s = String(text);
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/-+$/, '');
  return s;
}
