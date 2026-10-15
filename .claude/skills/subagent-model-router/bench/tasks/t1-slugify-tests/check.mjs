import { mutationCheck } from '../../lib/mutation.mjs';
process.exit(mutationCheck(import.meta.url, 'src/slugify.js', 'test/slugify.test.mjs') ? 0 : 1);
