// Arm B filter: the Mod's own functions from retry-loop-breaker/hooks/core.ts, ENFORCE mode, Jev live on
// near-duplicates, the tool's defaults otherwise (threshold from DEFAULTS). Decides BEFORE the run, as the real hook:
// a block returns the Mod's denialText instead of running the command, and a denied call is not recorded.
// __CORE_URL__ is replaced by make_tasks.mjs with the absolute file URL of the measured core.ts.
import { tree, diff, load, save, log } from './common.mjs';
import {
  readOptions, classify, normalizeCommand, decideBefore, recordAfter, prune, emptyState, denialText,
  jevRequest, parseJev, jevBlocks, fingerprint, isTransient,
} from '__CORE_URL__';

const OPT = readOptions({ mode: 'enforce' }); // round 3: the tool's defaults (jevEnabled false)
let entry, st, cat;

async function askJev(body) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { v: { error: 'no_key' }, ms: 0 };
  const t0 = Date.now();
  const call = fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model: 'typesafe/jev-1.13', ...body }),
  }).then(async (r) => {
    if (!r.ok) return { error: 'http_' + r.status };
    try { return parseJev(JSON.parse(await r.text())); } catch { return { error: 'invalid_json' }; }
  }, () => ({ error: 'network' }));
  const timeout = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), OPT.jevTimeoutMs).unref());
  const v = await Promise.race([call, timeout]);
  return { v, ms: Date.now() - t0 };
}

export async function before(o) {
  st = load(o.state, () => ({ guard: emptyState(), post: null }));
  const pre = tree(o.dir);
  const changed = diff(st.post, pre);
  if (changed.length) st.guard.epoch += 1; // files changed since the last call: the hook's "successful Edit/Write"
  cat = classify(o.command, OPT.extraEligible);
  entry = {
    ts: new Date().toISOString(), arm: 'B', command: o.command, treeChanged: changed.length > 0, changedFiles: changed.slice(0, 20),
    eligible: !!cat, epoch: st.guard.epoch, mode: OPT.mode, threshold: OPT.maxIdenticalFailuresBeforeBlock,
  };
  if (!cat) return {};
  const t0 = Date.now();
  const now = Date.now();
  st.guard = prune(st.guard, now, OPT);
  const cmd = o.command; // the key is the whole command, as in the hook
  const d = decideBefore(st.guard, o.dir, cmd, now, OPT);
  let block = d.kind === 'block';
  Object.assign(entry, { decision: d.kind, reason: d.reason });
  if (d.kind === 'ambiguous' && OPT.jevEnabled) {
    const { v, ms } = await askJev(jevRequest(d.record, o.command, false));
    entry.jev = { called: true, latencyMs: ms, result: 'error' in v ? 'error:' + v.error : `${v.decision}@${v.confidence.toFixed(2)}` };
    block = jevBlocks(v, OPT); // onJevError = allow
  }
  entry.blocked = block && d.kind !== 'pass';
  entry.decisionMs = Date.now() - t0;
  if (entry.blocked) {
    const text = denialText(d.record, d.kind === 'ambiguous');
    Object.assign(entry, { ran: false, exit: null, out: text, record: { repeat: d.record.repeat_count, fp: d.record.error_fingerprint, epoch: d.record.state_epoch } });
    st.post = pre;
    save(o.state, st);
    log(o.log, entry);
    return { deny: text };
  }
  return {};
}

export async function after(o) {
  Object.assign(entry, { ran: true, exit: o.exit, ms: o.ms, out: o.text.slice(-6000) });
  if (cat) {
    const failed = o.exit !== 0;
    if (failed) Object.assign(entry, { fp: fingerprint(o.text).fp, transient: isTransient(o.text) });
    const now = Date.now();
    st.guard = recordAfter(prune(st.guard, now, OPT), o.dir, o.command, cat, failed ? { kind: 'failed', text: o.text } : { kind: 'passed' }, now, OPT);
    const action = normalizeCommand(o.command);
    entry.repeatAfter = st.guard.records.find((r) => r.normalized_action === action && r.workspace === o.dir)?.repeat_count ?? 0;
  }
  st.post = tree(o.dir);
  save(o.state, st);
  log(o.log, entry);
  return o.text;
}
