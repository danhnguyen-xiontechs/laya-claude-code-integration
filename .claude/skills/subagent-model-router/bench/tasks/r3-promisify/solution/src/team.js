import { loadUser } from './users.js';
export function loadTeam(ids) { return Promise.all(ids.map((id) => loadUser(id))); }
