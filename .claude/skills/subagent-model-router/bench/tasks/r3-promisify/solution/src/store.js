const DATA = { u1: { name: 'Ada', role: 'lead' }, u2: { name: 'Linus', role: 'dev' } };
export function readRecord(id) {
  return new Promise((resolve, reject) => setTimeout(() => (id in DATA ? resolve({ ...DATA[id] }) : reject(new Error(`not found: ${id}`))), 5));
}
