export function pageWindow(total, page, perPage, span) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    throw new RangeError(`page out of range: ${page}`);
  }
  const len = Math.min(span, totalPages);
  const start = Math.max(1, Math.min(page - Math.floor(span / 2), totalPages - len + 1));
  return Array.from({ length: len }, (_, i) => start + i);
}
