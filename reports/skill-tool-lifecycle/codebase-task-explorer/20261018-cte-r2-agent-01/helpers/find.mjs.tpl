#!/usr/bin/env node
// Helper for a read-only task. Usage: node find.mjs "<task>" "<query1|query2|...>"
// make_tasks.mjs writes one copy per case into its work folder; the placeholders are filled there.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.PATH = __BIN__ + path.delimiter + (process.env.PATH ?? ''); // ripgrep for the content search
const task = process.argv[2];
const queries = (process.argv[3] ?? '').split('|').map((s) => s.trim()).filter(Boolean);
if (!task) {
  console.error('usage: node find.mjs "<task>" "<query1|query2|...>"');
  process.exit(2);
}
const lib = await import(pathToFileURL(__LIB__).href);
const out = await lib.run({ root: __REPO__, task, queries, mode: __MODE__, caseId: __CASE__, logDir: __LOGDIR__, firstDir: __FIRSTDIR__ });
process.stdout.write(out);
