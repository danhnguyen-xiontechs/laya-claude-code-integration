import { nodeTest, hiddenTests, visibleTests } from '../../lib/check-util.mjs';
// Run under zones with DST so a local-time implementation fails.
const ok = ['America/New_York', 'Europe/Berlin', 'Australia/Lord_Howe'].every((TZ) => nodeTest([...visibleTests(), ...hiddenTests(import.meta.url)], { env: { TZ } }));
process.exit(ok ? 0 : 1);
