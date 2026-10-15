export function signup(name, users) {
  const errors = [];
  if (typeof name !== 'string' || name.length < 3) errors.push('too short');
  if (name && name.length > 16) errors.push('too long');
  if (name && !/^[a-z0-9_]+$/.test(name)) errors.push('invalid characters');
  if (name && /^\d/.test(name)) errors.push('starts with digit');
  if (errors.length) return { ok: false, errors };
  if (users.includes(name)) return { ok: false, errors: ['taken'] };
  users.push(name);
  return { ok: true, errors: [] };
}
