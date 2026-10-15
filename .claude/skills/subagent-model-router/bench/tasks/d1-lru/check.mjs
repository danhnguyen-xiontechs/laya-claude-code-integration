import { nodeTest, hiddenTests } from '../../lib/check-util.mjs';
process.exit(nodeTest(hiddenTests(import.meta.url)) ? 0 : 1);
