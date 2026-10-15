export async function fetchAll(ids, fetchOne) {
  const results = [];
  const errors = [];
  ids.forEach(async (id) => {
    try {
      results.push(await fetchOne(id));
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  });
  return { results, errors };
}
