import { readAnswer } from '../../lib/check-util.mjs';
process.exit(readAnswer() === 'src/core/parse/duration-impl.js' ? 0 : 1);
