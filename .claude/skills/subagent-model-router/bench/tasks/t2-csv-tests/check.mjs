import { mutationCheck } from '../../lib/mutation.mjs';
process.exit(mutationCheck(import.meta.url, 'src/csv.js', 'test/csv.test.mjs') ? 0 : 1);
