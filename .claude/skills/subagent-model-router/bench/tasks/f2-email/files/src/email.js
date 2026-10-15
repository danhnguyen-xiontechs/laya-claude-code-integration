export function isValidEmail(s) {
  return /^[a-z0-9]+@[a-z0-9.]+$/i.test(s);
}
