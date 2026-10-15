export function validateUsername(name) {
  const errors = [];
  if (typeof name !== 'string' || name.length < 3) errors.push('too short');
  if (name && name.length > 16) errors.push('too long');
  if (name && !/^[a-z0-9_]+$/.test(name)) errors.push('invalid characters');
  if (name && /^\d/.test(name)) errors.push('starts with digit');
  return errors;
}
