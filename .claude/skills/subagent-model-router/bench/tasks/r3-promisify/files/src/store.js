const DATA = { u1: { name: 'Ada', role: 'lead' }, u2: { name: 'Linus', role: 'dev' } };
export function readRecord(id, cb) {
  setTimeout(() => {
    if (!(id in DATA)) return cb(new Error(`not found: ${id}`));
    cb(null, { ...DATA[id] });
  }, 5);
}
