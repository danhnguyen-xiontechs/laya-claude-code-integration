import { render } from './src/template.js';
const a = render('Hi {{ name }}, you have {{n}} items', { name: 'Ann', n: 3 });
if (a !== 'Hi Ann, you have 3 items') { console.log('FAIL', a); process.exit(1); }
let msg = '';
try { render('x {{x}}', {}); } catch (e) { msg = e.message; }
if (msg !== 'missing variable: x') { console.log('FAIL', msg); process.exit(1); }
console.log('PASS');
