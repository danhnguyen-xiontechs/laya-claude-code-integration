import { loadUser } from './users.js';
export function loadTeam(ids, cb) {
  const out = new Array(ids.length);
  let left = ids.length, failed = false;
  if (!left) return cb(null, []);
  ids.forEach((id, i) => loadUser(id, (err, u) => {
    if (failed) return;
    if (err) { failed = true; return cb(err); }
    out[i] = u;
    if (--left === 0) cb(null, out);
  }));
}
