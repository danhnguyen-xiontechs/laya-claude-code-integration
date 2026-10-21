// Second reader for the 14 calibration rubrics (rule 2 check). One Sonnet call, sees story text and rubrics only.
// No candidate output, no JEV, no grading. Logged in rubric-drafting-calls-0B.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_BIN = 'C:/Users/ADMIN/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
const CAP = 0.4;
const RUBRIC_DIR = path.join(HERE, 'rubrics');

const stories = JSON.parse(readFileSync(path.join(HERE, 'calibration-stories-0B.json'), 'utf8'))
  .filter((s) => s.id !== 'W-19279');
const ids = stories.map((s) => s.id);

const parts = stories.map((s) => {
  const rubric = readFileSync(path.join(RUBRIC_DIR, `rubric-${s.id}.md`), 'utf8').replace(/\r\n/g, '\n');
  return `=== STORY ${s.id} ===\n${s.task}\n\n--- RUBRIC ${s.id} ---\n${rubric}`;
});

const prompt = `You are checking written grading rubrics for a set of software bug stories. For each story you see the story text and its rubric.

Rule to check: each rubric must contain at least one required (R) criterion that a plausible wrong answer would fail. A plausible wrong answer is one a reasonable engineer might write for this story. Also check:
(a) every R criterion is grounded in what the story text states or clearly implies (no invented requirement);
(b) R criteria do not require details the story leaves open (those belong in D criteria);
(c) if a story has no criterion that separates a plausible wrong answer from an acceptable one, say so.

For each story reply with one line: "<story id>: PASS" or "<story id>: FAIL - <short reason>" or "<story id>: NON_DISCRIMINATIVE - <reason>". Then one line per R criterion that you think is not grounded, labelled with the story id and criterion. Do not rewrite the rubrics. Do not grade any answer. Keep the whole reply under 400 words.

${parts.join('\n\n')}`;

const args = ['-p', '--model', 'sonnet', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--max-budget-usd', String(CAP)];
const res = spawnSync(CLAUDE_BIN, args, { input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (res.error) throw res.error;
const out = JSON.parse(res.stdout);
const rawPath = path.join(RUBRIC_DIR, 'second-read-raw.json');
writeFileSync(rawPath, res.stdout, 'utf8');
const cost = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : CAP;
console.log(JSON.stringify({ ids, promptSha256: createHash('sha256').update(prompt).digest('hex'), is_error: out.is_error, cost, status: res.status }, null, 2));
console.log('--- answer ---');
console.log(out.result);
