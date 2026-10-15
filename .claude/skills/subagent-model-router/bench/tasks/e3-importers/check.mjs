import { readAnswer } from '../../lib/check-util.mjs';
const want = ['src/orders/repo.js', 'src/reports/lazy.js', 'src/users/store.js'].join('\n');
process.exit(readAnswer().split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('\n') === want ? 0 : 1);
