import { validateUsername } from './validate-username.js';
export function updateProfile(profile, patch) {
  if ('name' in patch) {
    const errors = validateUsername(patch.name);
    if (errors.length) return { ok: false, errors, profile };
  }
  return { ok: true, errors: [], profile: { ...profile, ...patch } };
}
