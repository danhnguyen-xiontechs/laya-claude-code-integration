#!/usr/bin/env node
// Real token count of text files, as the API reports it: pipes each file to `claude -p` and subtracts the
// input tokens of an empty baseline call (system prompt + tools). No ANTHROPIC_API_KEY needed.
//
// Usage: node count_tokens.mjs <file...> [--model haiku]
// Prints JSON { model, baseline, files: { "<file>": tokens } }. Each call costs a few cents.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'haiku';
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--model');
if (!files.length) {
  console.error('Usage: node count_tokens.mjs <file...> [--model haiku]');
  process.exit(2);
}

function inputTokens(stdin) {
  const r = spawnSync('claude', ['-p', 'Reply OK.', '--model', model, '--output-format', 'json', '--max-turns', '1'], {
    input: stdin, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 << 20,
  });
  const u = JSON.parse(r.stdout).usage;
  return u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
}

const baseline = inputTokens('');
const out = { model, baseline, files: {} };
for (const f of files) out.files[f] = Math.max(0, inputTokens(fs.readFileSync(f, 'utf8')) - baseline);
console.log(JSON.stringify(out, null, 2));
