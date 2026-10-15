import { readRecord } from './store.js';
export async function loadUser(id) {
  const rec = await readRecord(id);
  return { id, ...rec, display: `${rec.name} (${rec.role})` };
}
