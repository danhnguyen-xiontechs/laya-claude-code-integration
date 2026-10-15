#!/usr/bin/env node
// shadow-report.mjs — joins the shadow log with the transcripts and scores the router against what
// Claude actually invoked in that turn (Skill tool or typed slash command, else "none").
// "Invoked" is what Claude chose, not necessarily the correct skill.
//
//   node shadow-report.mjs [--log ~/.skills-router/shadow.jsonl] [--projects ~/.claude/projects] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareName } from './catalog.mjs';
import { parseArgs } from './decision-provider.mjs';
import { BUILTIN_COMMANDS, classifyUser, invokedSkill, readJsonl } from './mine-history.mjs';
import { promptHash, SHADOW_LOG } from './shadow-hook.mjs';

/**
 * What each prompt in a transcript led to: [{ hash, invoked, via }]. A typed `/x args` is hashed as
 * the raw "/x args" text the hook saw; built-in commands are left out.
 */
export function turnLabels(records) {
  const out = [];
  let open = null;
  for (const rec of records) {
    const u = classifyUser(rec, { includeSdk: true });
    if (u) {
      open = null;
      if (u.kind === 'slash') {
        if (!BUILTIN_COMMANDS.has(u.command.toLowerCase())) out.push({ hash: promptHash(`/${u.command} ${u.args}`), invoked: u.command, via: 'slash' });
      } else if (u.kind === 'prompt') {
        open = { hash: promptHash(u.text), invoked: null, via: 'prompt' };
        out.push(open);
      }
      continue;
    }
    const s = open && !open.invoked && invokedSkill(rec);
    if (s) { open.invoked = s; open.via = 'skill-tool'; }
  }
  return out;
}

const same = (a, b) => Boolean(a && b) && (a === b || bareName(a) === bareName(b));
const r3 = (x) => (x === null ? null : Number(x.toFixed(3)));
const div = (a, b) => (b ? a / b : null);

/** Joins shadow entries with labels (by session + prompt hash) and scores them. */
export function score(entries, labelsBySession) {
  const s = { logged: entries.length, labelled: 0, unmatched: 0, skillCases: 0, noneCases: 0, agree: 0, wrong: 0, missed: 0, needless: 0, abstains: 0, abstainsOnNone: 0, typed: 0 };
  const rows = [];
  for (const e of entries) {
    const label = (labelsBySession.get(e.session) || []).find((l) => l.hash === e.hash);
    if (!label) { s.unmatched++; continue; }
    s.labelled++;
    if (label.via === 'slash') s.typed++;
    const got = e.abstain ? null : e.suggestion;
    if (e.abstain) { s.abstains++; if (!label.invoked) s.abstainsOnNone++; }
    if (label.invoked) {
      s.skillCases++;
      if (same(got, label.invoked)) s.agree++;
      else if (got) s.wrong++;
      else s.missed++;
    } else {
      s.noneCases++;
      if (got) s.needless++;
      else s.agree++;
    }
    rows.push({ t: e.t, hash: e.hash, suggested: got, invoked: label.invoked, via: label.via, provider: e.provider });
  }
  return {
    ...s,
    agreement: r3(div(s.agree, s.labelled)),
    wrongRate: r3(div(s.wrong, s.skillCases)),
    missRate: r3(div(s.missed, s.skillCases)),
    needlessRate: r3(div(s.needless, s.noneCases)),
    abstainPrecision: r3(div(s.abstainsOnNone, s.abstains)),
    rows,
  };
}

/** Transcript records for a session: the logged path, else <projects>/*\/<session>.jsonl. */
function transcriptFor(entry, projectsDir) {
  if (entry.transcript && fs.existsSync(entry.transcript)) return entry.transcript;
  try {
    for (const d of fs.readdirSync(projectsDir)) {
      const f = path.join(projectsDir, d, `${entry.session}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch { /* none */ }
  return null;
}

export function report({ logFile = SHADOW_LOG, projectsDir = path.join(os.homedir(), '.claude', 'projects') } = {}) {
  const entries = readJsonl(logFile);
  const labels = new Map();
  for (const e of entries) {
    if (!e.session || labels.has(e.session)) continue;
    const f = transcriptFor(e, projectsDir);
    labels.set(e.session, f ? turnLabels(readJsonl(f)) : []);
  }
  return score(entries, labels);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const r = report({ logFile: typeof a.log === 'string' ? a.log : undefined, projectsDir: typeof a.projects === 'string' ? a.projects : undefined });
  const { rows, ...summary } = r;
  console.log(JSON.stringify(a.json ? r : summary, null, 2));
}
