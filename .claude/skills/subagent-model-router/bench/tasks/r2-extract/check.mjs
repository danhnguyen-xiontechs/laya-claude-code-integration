import fs from 'node:fs';
import { nodeTest, hiddenTests, visibleTests, WORK } from '../../lib/check-util.mjs';
const dup = ['src/signup.js', 'src/profile.js'].some((f) => /starts with digit|invalid characters/.test(fs.readFileSync(`${WORK}/${f}`, 'utf8')));
const uses = ['src/signup.js', 'src/profile.js'].every((f) => /validate-username/.test(fs.readFileSync(`${WORK}/${f}`, 'utf8')));
process.exit(!dup && uses && nodeTest([...visibleTests(), ...hiddenTests(import.meta.url)]) ? 0 : 1);
