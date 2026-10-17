// Final answers of the 4 arm-A re-run agents (folders <case>.A2), copied from their hand-back reports.
// They replace the run-1 arm-A answers, which are kept in evidence/contaminated-run1/. Run: node save_answers_rerun.mjs
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(import.meta.dirname, 'answers');
fs.mkdirSync(out, { recursive: true });
const A = {
  '03-api-dto.A': `{"waves": [["S-1"], ["S-2", "S-3"]], "needs_decision": []}\n\nReasoning: S-1 creates the GET /api/leave/balance endpoint and LeaveBalanceDto that S-2 consumes and S-3 extends, so it runs first; S-2 (widget, reads annual and sick days) and S-3 (additive carryOverDays field) depend only on S-1 and not on each other, so they share wave 2, though S-3 should land before S-2 if the widget keeps its own copy of the DTO type. The carry-over source is unspecified, but S-3's AC only checks that the field is present, so no story is blocked.\n`,
  '04-migration.A': `{"waves": [["S-1"], ["S-2", "S-3"]], "needs_decision": []}\n\nReasoning: S-3 reads the nickname column that S-1 adds, so it waits for S-1; S-1 and S-2 both add schema migrations, so they are serialized; S-2 (departments) and S-3 (employee search) touch different tables and share no migration, so they run together in wave 2.\n`,
  '06-explicit.A': `{"waves": [["S-1"], ["S-2", "S-3"]], "needs_decision": ["S-4"]}\n\nReasoning: S-2 has an explicit depends_on S-1 and S-3's description says "Builds on S-1" (prose, not a link), so both wait for S-1 and then run together since they touch disjoint files (PayslipMailer.cs vs History.tsx); S-4 depends_on OPS-99, which is not in the batch and has no known status, so its placement needs a decision.\n`,
  '07-cycle.A': `{"waves": [["S-5"]], "needs_decision": ["S-1", "S-2", "S-3", "S-4"]}\n\nReasoning: S-1, S-2 and S-3 form a depends_on cycle (S-1 to S-2 to S-3 to S-1) so no safe order exists, and S-4 depends on the cyclic S-3, so it is blocked until the cycle is resolved; S-5 has no links and touches calendar/HolidayImport.cs, which no other story touches, so it can run alone in wave 1.\n`,
};
for (const [k, v] of Object.entries(A)) fs.writeFileSync(path.join(out, `${k}.txt`), v);
console.log(Object.keys(A).length, 'answers written');
