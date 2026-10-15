import { readAnswer } from '../../lib/check-util.mjs';
process.exit(readAnswer() === '5' ? 0 : 1);
