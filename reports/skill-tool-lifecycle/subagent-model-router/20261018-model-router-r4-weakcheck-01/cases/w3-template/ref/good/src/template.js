const RE = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;
export function render(template, vars) {
  return template.replace(RE, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`missing variable: ${name}`);
    return String(vars[name]);
  });
}
