// Arm A filter: no decision, the command always runs and the raw output is returned. Logs the run and whether the
// work folder changed since the previous call (the grader replays the Mod over this log as a shadow).
import { tree, diff, load, save, log } from './common.mjs';

let entry, st;

export async function before(o) {
  st = load(o.state, () => ({ post: null }));
  const changed = diff(st.post, tree(o.dir));
  entry = { ts: new Date().toISOString(), arm: 'A', command: o.command, treeChanged: changed.length > 0, changedFiles: changed.slice(0, 20) };
  return {};
}

export async function after(o) {
  Object.assign(entry, { ran: true, exit: o.exit, ms: o.ms, out: o.text.slice(-6000) });
  st.post = tree(o.dir);
  save(o.state, st);
  log(o.log, entry);
  return o.text;
}
