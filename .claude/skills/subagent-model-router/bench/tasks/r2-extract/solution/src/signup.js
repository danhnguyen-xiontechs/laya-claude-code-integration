import { validateUsername } from './validate-username.js';
export function signup(name, users) {
  const errors = validateUsername(name);
  if (errors.length) return { ok: false, errors };
  if (users.includes(name)) return { ok: false, errors: ['taken'] };
  users.push(name);
  return { ok: true, errors: [] };
}
