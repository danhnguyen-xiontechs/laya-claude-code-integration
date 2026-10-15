export async function fetchAll(ids, fetchOne) {
  const settled = await Promise.allSettled(ids.map((id) => fetchOne(id)));
  const results = [], errors = [];
  settled.forEach((r, i) => (r.status === 'fulfilled' ? results.push(r.value) : errors.push({ id: ids[i], error: r.reason.message })));
  return { results, errors };
}
