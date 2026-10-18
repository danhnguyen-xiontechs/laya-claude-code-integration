// design §4 core.spec.ts: pure rules over fixtures (node --test "tests/*.spec.ts").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, type Config, type Note, type State, type Turn, contextOf, decide, emptyState, noteText } from '../src/core.ts';

const CFG: Config = { ...DEFAULTS };
const MAIN = (context: number, artifact: Turn['artifact'] = null): Turn => ({ context, artifact });

/** Runs main-loop turns in order and returns the notes each turn produced. */
function run(contexts: number[], cfg: Config = CFG, start: State = emptyState()) {
  let s = start;
  const out: Note[][] = [];
  for (const c of contexts) {
    const d = decide(s, MAIN(c), cfg);
    s = d.state;
    out.push(d.notes);
  }
  return { notes: out, state: s };
}

test('119,999 gives no note; 120,000 gives the soft note once', () => {
  assert.deepEqual(run([119_999]).notes, [[]]);
  assert.deepEqual(run([120_000, 130_000]).notes, [['soft'], []]);
});

test('200k gives only the strong note; 180k to 250k afterwards give nothing', () => {
  assert.deepEqual(run([200_000, 180_000, 220_000, 250_000]).notes, [['strong'], [], [], []]);
});

test('drop to 95k re-arms soft; rising back to 121k shows soft again', () => {
  assert.deepEqual(run([125_000, 95_000, 121_000]).notes, [['soft'], [], ['soft']]);
});

test('drop to 179k re-arms strong', () => {
  assert.deepEqual(run([200_000, 179_000, 200_000]).notes, [['strong'], [], ['strong']]);
});

test('single jump 50k to 210k gives only the strong note', () => {
  assert.deepEqual(run([50_000, 210_000, 215_000]).notes, [[], ['strong'], []]);
});

test('stale counter resets on new mtime, fires on the 16th turn without one, then resets', () => {
  const seq: Turn[] = [MAIN(10_000, { mtimeMs: 1 })];
  for (let i = 0; i < 16; i++) seq.push(MAIN(10_000, { mtimeMs: 1 }));
  let s = emptyState();
  const notes = seq.map((t) => { const d = decide(s, t, CFG); s = d.state; return d.notes; });
  assert.deepEqual(notes.slice(0, 16).flat(), []);
  assert.deepEqual(notes[16], ['stale']);
  assert.equal(s.turnsSinceArtifact, 0);
  // a new mtime resets the counter before it can fire
  const fresh = decide(s, MAIN(10_000, { mtimeMs: 2 }), CFG);
  assert.equal(fresh.state.turnsSinceArtifact, 0);
  assert.deepEqual(fresh.notes, []);
});

test('empty or missing artifactDir (artifact null) turns the stale rule off', () => {
  let s = emptyState();
  for (let i = 0; i < 40; i++) { const d = decide(s, MAIN(10_000, null), CFG); s = d.state; assert.deepEqual(d.notes, []); }
  assert.equal(s.turnsSinceArtifact, 0);
});

test('subagent turns give no note, leave counters unchanged, and are flagged at 90k', () => {
  const before = run([130_000]).state;
  const sub = decide(before, { context: 250_000, agentId: 'a1', artifact: { mtimeMs: 9 } }, CFG);
  assert.deepEqual(sub.notes, []);
  assert.deepEqual(sub.state, before);
  assert.equal(sub.flagged, true);
  assert.equal(decide(before, { context: 89_000, agentId: 'a1', artifact: null }, CFG).flagged, false);
  assert.equal(decide(before, { context: 90_000, agentId: 'a1', artifact: null }, CFG).flagged, true);
});

test('missing usage goes through the fallback path (contextOf undefined, caller uses session tokens)', () => {
  assert.equal(contextOf(undefined), undefined);
  assert.equal(contextOf(null), undefined);
  assert.equal(contextOf({ input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }), 152);
});

test('mode off gives no notes but still advances state and arms', () => {
  const off: Config = { ...CFG, mode: 'off' };
  const d = decide(emptyState(), MAIN(210_000), off);
  assert.deepEqual(d.notes, []);
  assert.equal(d.state.armed.strong, false);
  assert.equal(d.state.mainTurns, 1);
});

test('strong text names 200k and the compact path; soft text names the checkpoint', () => {
  assert.match(noteText('strong', 210_000, CFG), /200k/);
  assert.match(noteText('strong', 210_000, CFG), /\/fast-compact/);
  assert.match(noteText('soft', 121_000, CFG), /^checkpoint: context 121k/);
  assert.match(noteText('stale', 0, CFG), /^16 turns without a new artifact/);
});

test('a stale note swallowed by a threshold note keeps the counter, and shows on the next turn', () => {
  const cfg: Config = { ...CFG, staleTurns: 2 };
  const seq: Turn[] = [
    MAIN(10_000, { mtimeMs: 1 }), MAIN(10_000, { mtimeMs: 1 }), MAIN(10_000, { mtimeMs: 1 }),
    MAIN(125_000, { mtimeMs: 1 }), // counter 3 > 2, but soft shows, so stale is not shown and the counter stays
    MAIN(10_000, { mtimeMs: 1 }), // stale shows now
    MAIN(10_000, { mtimeMs: 1 }), // counter reset, nothing
  ];
  let s = emptyState();
  const notes = seq.map((t) => { const d = decide(s, t, cfg); s = d.state; return d.notes; });
  assert.deepEqual(notes, [[], [], [], ['soft'], ['stale'], []]);
});

test('note text comes from config, with placeholders filled', () => {
  const cfg: Config = { ...CFG, softText: 'save {k} now', strongText: 'compact at {limit}k, now {k}', staleText: '{turns} idle' };
  assert.equal(noteText('soft', 121_000, cfg), 'save 121k now');
  assert.equal(noteText('strong', 210_000, cfg), 'compact at 200k, now 210k');
  assert.equal(noteText('stale', 0, cfg), '16 idle');
});
