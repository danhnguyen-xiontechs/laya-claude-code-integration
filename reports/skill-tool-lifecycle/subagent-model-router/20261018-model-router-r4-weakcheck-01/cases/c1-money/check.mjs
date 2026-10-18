import { parseAmount } from './src/money.js';
const got = [parseAmount('12.5'), parseAmount('3'), parseAmount('0.29'), parseAmount('-4.20')];
if (JSON.stringify(got) !== '[1250,300,29,-420]') { console.log('FAIL', JSON.stringify(got)); process.exit(1); }
console.log('PASS');
