import { nodeTest, hiddenTests, visibleTests } from '../../lib/check-util.mjs';
process.exit(nodeTest([...visibleTests(), ...hiddenTests(import.meta.url)]) ? 0 : 1);
