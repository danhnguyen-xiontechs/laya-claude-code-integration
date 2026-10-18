export function render(template, vars) {
  let out = template;
  for (const name of Object.keys(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'), String(vars[name]));
  }
  const left = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/.exec(out);
  if (left) throw new Error(`missing variable: ${left[1]}`);
  return out;
}
