import { createLimiter } from './src/limiter.js';
const run = createLimiter(2);
const got = await Promise.all([1, 2, 3, 4].map((i) => run(() => new Promise((res) => setTimeout(() => res(i * 2), 5)))));
const s = JSON.stringify(got);
if (s !== '[2,4,6,8]') { console.log('FAIL', s); process.exit(1); }
console.log('PASS');
