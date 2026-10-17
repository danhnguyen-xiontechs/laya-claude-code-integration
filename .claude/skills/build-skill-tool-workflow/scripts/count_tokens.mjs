#!/usr/bin/env node
// Real token count of text files, as the API reports it: pipes each file to `claude -p` and subtracts the
// input tokens of an empty baseline call (system prompt + tools). No ANTHROPIC_API_KEY needed.
//
// Usage: node count_tokens.mjs <file...> [--model haiku]
// Prints JSON { model, baseline, files: { "<file>": tokens | null }, errors: { "<file>": reason } }.
// A failed call gives null (never an estimate) and exit code 1. Each call costs a few cents.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'haiku';
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
if (!files.length) {
  console.error('Usage: node count_tokens.mjs <file...> [--model haiku]');
  process.exit(2);
}
const claude = process.env.COUNT_TOKENS_CLAUDE ?? 'claude'; // override for tests

// returns input tokens, or throws with a short reason
function parseUsage(r) {
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${String(r.stderr ?? '').trim().slice(0, 200)}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(`not JSON: ${String(r.stdout ?? '').trim().slice(0, 200)}`);
  }
  if (out.is_error) throw new Error(`claude error: ${String(out.result ?? out.subtype ?? '').slice(0, 200)}`);
  const u = out.usage;
  if (!u || typeof u.input_tokens !== 'number') throw new Error('no usage in output');
  return u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}
const inputTokens = (stdin) =>
  parseUsage(spawnSync(claude, ['-p', 'Reply OK.', '--model', model, '--output-format', 'json', '--max-turns', '1'], {
    input: stdin, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 << 20,
  }));

let baseline;
try {
  baseline = inputTokens('');
} catch (e) {
  console.error(`baseline call failed, nothing counted: ${e.message}`);
  process.exit(1);
}
const out = { model, baseline, files: {}, errors: {} };
for (const f of files) {
  try {
    out.files[f] = Math.max(0, inputTokens(fs.readFileSync(f, 'utf8')) - baseline);
  } catch (e) {
    out.files[f] = null;
    out.errors[f] = e.message;
  }
}
console.log(JSON.stringify(out, null, 2));
if (Object.keys(out.errors).length) process.exit(1);
