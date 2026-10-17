// Arm A: the plain listing only; the tool is off.
import { listing } from './common.mjs';

export async function run({ request, root }) {
  return { text: listing(root) + '\n(skills-router: disabled in this task)\n', log: { tool: 'off' } };
}
