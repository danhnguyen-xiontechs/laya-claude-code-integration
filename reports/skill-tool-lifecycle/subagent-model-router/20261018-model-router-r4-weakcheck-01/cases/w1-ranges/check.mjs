import { mergeRanges } from './src/ranges.js';
const got = JSON.stringify(mergeRanges([[1, 5], [3, 8], [10, 12]]));
if (got !== '[[1,8],[10,12]]') { console.log('FAIL', got); process.exit(1); }
console.log('PASS');
