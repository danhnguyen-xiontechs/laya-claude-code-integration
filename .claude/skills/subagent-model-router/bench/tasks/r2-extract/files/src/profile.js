export function updateProfile(profile, patch) {
  if ('name' in patch) {
    const name = patch.name;
    const errors = [];
    if (typeof name !== 'string' || name.length < 3) errors.push('too short');
    if (name && name.length > 16) errors.push('too long');
    if (name && !/^[a-z0-9_]+$/.test(name)) errors.push('invalid characters');
    if (name && /^\d/.test(name)) errors.push('starts with digit');
    if (errors.length) return { ok: false, errors, profile };
  }
  return { ok: true, errors: [], profile: { ...profile, ...patch } };
}
