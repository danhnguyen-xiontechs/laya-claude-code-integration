// Writes rubric-lock-0B.md: sha256 of each LF-normalised rubric. Run once, after the rubrics are final.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUBRIC_DIR = path.join(HERE, 'rubrics');
const PILOT_RUBRIC = path.join(HERE, 'pilot', 'rubric-W-19279.md');
const ids = JSON.parse(readFileSync(path.join(HERE, 'calibration-stories-0B.json'), 'utf8'))
  .map((s) => s.id)
  .filter((id) => id !== 'W-19279');

const sha = (file) => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

const rows = ids.map((id) => `| ${id} | rubrics/rubric-${id}.md | ${sha(path.join(RUBRIC_DIR, `rubric-${id}.md`))} |`);
const pilotSha = sha(PILOT_RUBRIC);
rows.push(`| W-19279 (pilot-exposed) | pilot/rubric-W-19279.md | ${pilotSha} |`);

const md = `# Rubric lock, Phase 0B

Locked: 2026-10-19. Hash: sha256 of the file text with CRLF normalised to LF.
Rubrics were written from the story text only, before any output for their story existed. Second read: see \`rubric-drafting-calls-0B.md\`.

## Locked rubrics

| Story | File | sha256 |
|---|---|---|
${rows.join('\n')}

## Notes
- W-19279 is pilot-exposed. Its rubric was locked for the pilot and is not replaced. It is a runner and provenance check only and is excluded from every 0B conclusion, including \`minimum_sufficient_tier\`.
- Evaluable calibration stories: 14.
- Any change to a locked rubric needs a new lock.
`;
writeFileSync(path.join(HERE, 'rubric-lock-0B.md'), md, 'utf8');
console.log(rows.join('\n'));
