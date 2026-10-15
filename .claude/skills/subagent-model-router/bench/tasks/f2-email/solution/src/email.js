const LOCAL = /^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*$/;
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
export function isValidEmail(s) {
  const parts = String(s).split('@');
  if (parts.length !== 2 || !LOCAL.test(parts[0])) return false;
  const labels = parts[1].split('.');
  return labels.length >= 2 && labels.every((l) => LABEL.test(l)) && /^[A-Za-z]{2,}$/.test(labels.at(-1));
}
