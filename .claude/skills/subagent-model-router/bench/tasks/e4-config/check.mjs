import { readAnswer } from '../../lib/check-util.mjs';
process.exit(readAnswer() === '3443' ? 0 : 1);
