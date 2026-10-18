Create src/template.js exporting `render(template, vars)`, a small placeholder renderer.

- A placeholder is `{{name}}`, where name is an identifier (letters, digits, underscore, not starting with a digit). Spaces just inside the braces are allowed: `{{ name }}` is the same placeholder.
- Each placeholder is replaced with String(vars[name]). A value is inserted exactly as it is: `$&`, `$1` and similar text in a value stay as literal text, and values are never scanned for placeholders again.
- A value that is 0, '', false or null is rendered as its String form ("0", "", "false", "null"). Only a name that is missing from vars (not an own property) counts as missing.
- If a placeholder names a missing variable, throw an Error with message `missing variable: ` followed by the name. If several are missing, report the first one in template order.
- Anything that is not a placeholder, including single braces like `{x}`, is copied unchanged.

Before you finish, run `node check.mjs` in the work folder; it must pass. Reply with one short line saying what you did.
