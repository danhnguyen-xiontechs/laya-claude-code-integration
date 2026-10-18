export function pageWindow(total, page, perPage, span) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const len = Math.min(span, totalPages);
  const start = Math.max(1, Math.min(page - Math.floor((span - 1) / 2), totalPages - len + 1));
  return Array.from({ length: len }, (_, i) => start + i);
}
