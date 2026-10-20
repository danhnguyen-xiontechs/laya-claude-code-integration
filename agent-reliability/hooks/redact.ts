// The one redaction policy for everything that leaves the machine toward Jev, and for the
// local copies of agent text (dataset rows, raw dumps). core.ts, advisor.ts and register.ts
// import it from here; haiku-100k's offline report imports the shipped copy of this file.
//
// Only erasable TypeScript here (Node type stripping imports this file in tests and in report.mjs).

const HOME = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+|\/(?:c\/)?Users\/[^/\s"']+|\/home\/[^/\s"']+/gi;
const DRIVE = /\b[A-Za-z]:[\\/][^\s"'`;|&<>]*/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const AZURE_PATH = /\b((?:vssps\.)?dev\.azure\.com)\/[^/\s"'`<>]+/gi;
const AZURE_HOST = /\b[A-Za-z0-9-]+\.visualstudio\.com\b/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const TOKEN_PREFIX = /\b(?:sk|pk|ghp|gho|xox[bap]|AKIA|eyJ)[A-Za-z0-9_-]{10,}/g;
const KEY_VALUE = /(api[_-]?key|token|secret|password|passwd|pwd|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&;]{4,}/gi;
const LONG_ID = /[A-Za-z0-9_+=-]{32,}/g;

/**
 * Masks home directories (`~`), drive paths (kept to the basename, `<abs>/x.ts`), emails
 * (`<email>`), Azure DevOps organizations (`dev.azure.com/<org>`, `<org>.visualstudio.com`),
 * credentials (`Bearer <token>`, known token prefixes, `key=<redacted>`) and long opaque ids
 * (`<id>`); folds whitespace; cuts to `n`. Idempotent: redacting a redacted text changes nothing.
 */
export function redact(text: string, n = Number.POSITIVE_INFINITY): string {
  return String(text ?? '')
    .replace(HOME, '~')
    .replace(DRIVE, (p) => `<abs>/${p.split(/[\\/]/).pop()}`)
    .replace(EMAIL, '<email>')
    .replace(AZURE_PATH, (_m, host: string) => `${host}/<org>`)
    .replace(AZURE_HOST, '<org>.visualstudio.com')
    .replace(BEARER, '$1 <token>')
    .replace(TOKEN_PREFIX, '<token>')
    .replace(KEY_VALUE, '$1$2<redacted>')
    .replace(LONG_ID, '<id>')
    .replace(/\s+/g, ' ').trim().slice(0, n);
}
