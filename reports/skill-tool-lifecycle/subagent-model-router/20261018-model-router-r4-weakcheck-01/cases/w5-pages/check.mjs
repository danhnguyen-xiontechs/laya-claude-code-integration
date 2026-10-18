import { pageWindow } from './src/pages.js';
const got = JSON.stringify([pageWindow(100, 5, 10, 5), pageWindow(10, 1, 10, 5)]);
if (got !== '[[3,4,5,6,7],[1]]') { console.log('FAIL', got); process.exit(1); }
console.log('PASS');
