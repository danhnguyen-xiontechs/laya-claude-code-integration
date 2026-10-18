import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { render } = await import(pathToFileURL(path.join(process.env.WORK_DIR, 'src/template.js')).href);
let failed = 0;
const t = (name, fn) => { try { fn(); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); } };
t('falsy values render as strings', () => {
  assert.equal(render('{{a}}|{{b}}|{{c}}|{{d}}', { a: 0, b: '', c: false, d: null }), '0||false|null');
});
t('dollar patterns inserted literally', () => {
  assert.equal(render('cost: {{p}}', { p: 'US$& and $1' }), 'cost: US$& and $1');
  assert.equal(render('{{p}}', { p: "$'" }), "$'");
});
t('values are not rescanned', () => {
  assert.equal(render('{{a}} {{b}}', { a: '{{b}}', b: 'X' }), '{{b}} X');
});
t('repeated placeholders and spacing', () => {
  assert.equal(render('{{a}}{{ a }}{{  a  }}', { a: 'x' }), 'xxx');
});
t('single braces untouched', () => {
  assert.equal(render('{x} {{a}} }', { a: 1 }), '{x} 1 }');
});
t('missing variable error message, first in template order', () => {
  assert.throws(() => render('x {{ missing }}', {}), (e) => e instanceof Error && e.message === 'missing variable: missing');
  assert.throws(() => render('{{second}} {{first}}', { first: 1 }), (e) => e.message === 'missing variable: second');
});
process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} failed` : 'all strict checks passed');
