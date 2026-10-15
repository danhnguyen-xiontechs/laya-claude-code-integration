import { readRecord } from './store.js';
export function loadUser(id, cb) {
  readRecord(id, (err, rec) => {
    if (err) return cb(err);
    cb(null, { id, ...rec, display: `${rec.name} (${rec.role})` });
  });
}
