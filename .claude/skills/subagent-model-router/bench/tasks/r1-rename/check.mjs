import { nodeTest, hiddenTests, visibleTests, grepWork } from '../../lib/check-util.mjs';
const leftovers = grepWork(/\bgetUserName\b(?!Length)/);
process.exit(leftovers.length === 0 && nodeTest([...visibleTests(), ...hiddenTests(import.meta.url)]) ? 0 : 1);
