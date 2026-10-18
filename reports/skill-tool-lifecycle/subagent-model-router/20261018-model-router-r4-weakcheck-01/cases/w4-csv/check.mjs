import { parseCsv } from './src/csv.js';
const got = JSON.stringify(parseCsv('name,qty\napple,3\npear,10'));
if (got !== '[["name","qty"],["apple","3"],["pear","10"]]') { console.log('FAIL', got); process.exit(1); }
console.log('PASS');
