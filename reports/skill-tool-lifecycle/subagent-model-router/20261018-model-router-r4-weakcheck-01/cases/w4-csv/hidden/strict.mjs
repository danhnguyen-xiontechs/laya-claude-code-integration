import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { parseCsv } = await import(pathToFileURL(path.join(process.env.WORK_DIR, 'src/csv.js')).href);
let failed = 0;
const t = (name, fn) => { try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); } };
t('trailing newline adds no record', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});
t('quoted field with comma', () => assert.deepEqual(parseCsv('"a,b",c'), [['a,b', 'c']]));
t('quoted field with newline', () => assert.deepEqual(parseCsv('x,"line1\nline2"\ny,z'), [['x', 'line1\nline2'], ['y', 'z']]));
t('quoted field with CRLF inside', () => assert.deepEqual(parseCsv('"p\r\nq",r'), [['p\r\nq', 'r']]));
t('doubled quotes', () => assert.deepEqual(parseCsv('"say ""hi""",2'), [['say "hi"', '2']]));
t('quote inside unquoted field is literal', () => assert.deepEqual(parseCsv('6" pipe,x'), [['6" pipe', 'x']]));
t('empty middle line', () => assert.deepEqual(parseCsv('a\n\nb'), [['a'], [''], ['b']]));
t('empty input and lone quoted empty', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv('a,""\n'), [['a', '']]);
});
t('unterminated quote throws', () => assert.throws(() => parseCsv('a,"b'), (e) => e.message === 'unterminated quoted field'));
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} failed` : 'all strict checks passed');
