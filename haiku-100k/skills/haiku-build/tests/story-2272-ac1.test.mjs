// Story 2272 AC1: parseAcMap maps each spec AC; renderHtml lists every AC and marks missing/unverified ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAcMap, acSummary } from '../scripts/v3.mjs';
import { renderHtml } from '../scripts/build_report.mjs';

const SPEC_TEXT = [
  '## 6. Tasks & Acceptance Criteria',
  '- `src/a.mjs` add the flag',
  '- AC1: flag works. Checked by `tests/a.test.mjs` "2272 AC1 flag works".',
  '- AC2: no test names this one.',
  '',
  '## 7. Red Checks',
  '',
  '## 8. Verification',
  '- `node --test tests/a.test.mjs`',
].join('\n');

test('2272 AC1 plan and report map every AC', () => {
  const map = parseAcMap(SPEC_TEXT);
  assert.deepEqual(map.map((a) => a.id), ['AC1', 'AC2']);
  assert.equal(map[0].target, 'src/a.mjs');
  assert.ok(map[0].test.includes('2272 AC1 flag works'));
  assert.ok(map[1].missing.includes('test'));
  assert.deepEqual(acSummary(map).missing, ['AC2']);
  assert.equal(acSummary(map).total, 2);

  const html = renderHtml({ schemaVersion: 1, runId: 'ac1', tool: 'haiku-build', status: 'REPORTED', task: 't', opusCalls: [], phases: [], haiku: {}, acMap: map }, {});
  assert.match(html, /AC1/);
  assert.match(html, /AC2/);
  assert.match(html, /unverified/i);
  assert.match(html, /missing/i);
});
