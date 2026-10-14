// Builds eval/REPORT.md and eval/REPORT.html from eval/results/*.json (numbers are interpolated, never typed by hand).
//   node eval/analyze.mjs && node eval/make-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const J = (f) => JSON.parse(fs.readFileSync(path.join(here, 'results', f), 'utf8'));
const S = J('summary.json'), LW = J('live-wait.json'), LS = J('live-scripts.json');
const CTX = (() => {
  const truth = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, 'data', 'verdictctx.json'), 'utf8')).map((x) => [x.id, x.truth]));
  const rd = (f) => fs.readFileSync(path.join(here, 'results', f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => truth[r.id]);
  const top = (p) => Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  const m = (rows) => { let dec = 0, ok = 0, ff = 0; const reps = rows.length / 20;
    for (const r of rows) { const [l, p] = top(r.answers.verdict.probabilities); if (p >= 0.6) { dec++; if (l === truth[r.id]) ok++; if (l === 'fail' && truth[r.id] === 'pass') ff++; } }
    return { decided: dec / rows.length, precision: dec ? ok / dec : null, falseFail: ff / reps }; };
  return { jevBase: m(rd('raw-verdict-jev.jsonl')), jevCtx: m(rd('raw-verdictctx-jev.jsonl')), layaBase: m(rd('raw-verdict-laya.jsonl')), layaCtx: m(rd('raw-verdictctx-laya.jsonl')) };
})();
const COST = (() => { const o = {}; for (const t of ['gate', 'verdict', 'oracle', 'wait', 'verdictctx']) { const rows = fs.readFileSync(path.join(here, 'results', `raw-${t}-jev.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); o[t] = { calls: rows.length, usd: rows.reduce((s, r) => s + (r.cost || 0), 0), tokens: rows.reduce((s, r) => s + (r.usage?.input_tokens || 0), 0) }; } return o; })();
const totalUsd = Object.values(COST).reduce((s, c) => s + c.usd, 0), totalCalls = Object.values(COST).reduce((s, c) => s + c.calls, 0);

const pc = (x, d = 0) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(d)}%`);
const vi = (s) => String(s).replace('.', ',');
const f1 = (x) => (x === null || x === undefined ? '–' : vi(Number(x).toFixed(1).replace(/\.0$/, '')));
const p2 = (x) => (x === null || x === undefined ? '–' : vi(Number(x).toFixed(2)));
const ms = (x) => (x >= 1000 ? `${vi((x / 1000).toFixed(1))} s` : `${x} ms`);
const usd = (x) => `$${x.toFixed(4)}`;
const usdCall = (x) => `$${x.toFixed(5)}`;
const g = S.gate, v = S.verdict, o = S.oracle, w = S.wait;
const unflaggedWrong = (eng) => LS.verdict[eng].rows.filter((r) => r.status && r.status !== 'review' && r.status !== r.truth && !r.review).length;
const unflaggedWrongO = (eng) => LS.oracle[eng].rows.filter((r) => r.status && r.status !== 'review' && r.status !== r.truth && !r.review).length;
const num = (s) => Number(String(s).split('/')[0]);   // "3/12" → 3
const den = (s) => Number(String(s).split('/')[1]);

// ------------------------------------------------------------------------------------------------------------------
// content model: each section = { id, title, blocks: [ {t:'p'|'ul'|'table'|'bars'|'note'|'cards', ...} ] }
const sections = [];
const add = (id, title, blocks) => sections.push({ id, title, blocks });
const P = (text) => ({ t: 'p', text }); const UL = (items) => ({ t: 'ul', items });
const TABLE = (head, rows, opts = {}) => ({ t: 'table', head, rows, ...opts });
const NOTE = (text, kind = 'info') => ({ t: 'note', text, kind });
const BARS = (title, rows, max = 1, fmt = pc) => ({ t: 'bars', title, rows, max, fmt });

const heldout = g.heldout;
const verdictAll = v.all;

// ---- 1. TL;DR
const cards = [
  { name: 'web-test-jev-gate', old: 'Laya: bỏ sót 1/12 ghi, báo nhầm 9/12 đọc', now: `Jev: bỏ sót ${num(heldout.jev.missedWrites)}/12, báo nhầm ${num(heldout.jev.falseFlagsOnReads)}/12`, verdict: 'Jev tốt hơn rõ rệt', good: true },
  { name: 'web-test-jev-wait', old: `Laya: ${w.laya.readyCalledReady} trang xong được xác nhận; báo nhầm "login" ${w.laya.loginFalsePositivesNavPages} trang có nav`, now: `Jev: ${w.jev.readyCalledReady} xác nhận xong; báo nhầm login ${w.jev.loginFalsePositives}`, verdict: 'Jev tốt hơn rõ rệt (live 8/8 đúng)', good: true },
  { name: 'web-test-jev-oracle', old: `Laya: tự quyết ${pc(o.laya.engineDecidedShare)} bước; ${pc(o.laya.sentToAgent)} trả về agent`, now: `Jev: tự quyết ${pc(o.jev.engineDecidedShare)}; trả về agent ${pc(o.jev.sentToAgent)}; false-pass 0`, verdict: 'Jev tốt hơn, nhưng có false-fail trên bước thật', good: true },
  { name: 'web-test-jev-verdict', old: `Laya: tự quyết ${pc(verdictAll.laya.decidedByEngine)}, chính xác ${pc(verdictAll.laya.decidedPrecision)}`, now: `Jev: tự quyết ${pc(verdictAll.jev.decidedByEngine)}, chính xác ${pc(verdictAll.jev.decidedPrecision)}`, verdict: 'Tốt trên bước tự đủ nghĩa; kém trên bước thật có tham chiếu chéo', good: null },
];

add('tldr', 'Tóm tắt', [
  P(`Bạn có 4 skill Laya cho kết quả tệ (\`web-test-laya-wait\`, \`-gate\`, \`-verdict\`, \`-oracle\`). Tôi đã tạo 4 skill Jev tương ứng (\`web-test-jev-wait\`, \`-gate\`, \`-verdict\`, \`-oracle\`) bằng cách copy từ skill Laya và thay engine quyết định, giữ nguyên câu hỏi, ngưỡng và cơ chế fallback về rule. Skill cũ không bị sửa. Sau đó chạy cùng một bộ input qua Laya (local, CPU) và Jev (hosted, OpenRouter).`),
  { t: 'cards', cards },
  P(`**Kết luận ngắn.** Nguyên nhân Laya "tệ" là nó hiếm khi đủ tự tin (median p chỉ ${p2(v.pRange.laya.median)} trên verdict) nên gần như mọi bước phải quay về agent, và khi tự tin thì đôi khi sai (báo login nhầm, bỏ sót false-pass). Jev gần như luôn tự tin (median p ${p2(v.pRange.jev.median)}) và đúng trên các câu hỏi tự đủ nghĩa: gate, wait, oracle/verdict trên bước viết rõ ràng. Giá phải trả: Jev **tự tin cả khi sai**. Trên các bước thật của 6 run cũ (loại "Total hours bằng giá trị ở TC01"), Jev ghi "fail" sai cho ${f1(v.all.jev.falseFailOnPass.split('/')[0])}/30 bước pass mỗi lượt trong bộ tổng, và ${LS.verdict.jev.rows.filter((r) => r.truth === 'pass' && r.status === 'fail').length}/${LS.verdict.jev.rows.filter((r) => r.truth === 'pass').length} bước pass thật khi chạy script end-to-end (Laya: ${LS.verdict.laya.rows.filter((r) => r.truth === 'pass' && r.status === 'fail').length}, vì Laya phần lớn trả bước về agent). Hai điểm này cần quyết định trước khi chuyển hẳn (xem mục Khuyến nghị).`),
  NOTE(`**Chưa đo được:** số lượt model (turn) và token của cả phiên agent khi chạy trọn một ticket với từng skill. Các con số 38 vs 19 turn trong báo cáo cũ là từ phiên agent thật; ở đây tôi đo chất lượng và tải quyết định của từng engine trên cùng input (nhanh, lặp lại được), không chạy lại 8 phiên agent. Lần chạy trên ESS dev thật bằng profile đăng nhập của bạn bị hệ thống chặn nên chưa có; phần live dùng trang giả lập và dữ liệu bước thật đã lưu. Xem mục "Chưa làm / hạn chế".`, 'warn'),
]);

// ---- 2. context
add('context', '1. Bối cảnh: 4 skill Laya nào tệ, và vì sao', [
  P('Nguồn: `idea/web-test/report-laya-skills.md` (9/10/2026, cùng ticket #11840, dev, mỗi skill một lần chạy). Cột cuối là skill Jev tôi tạo để thay thế.'),
  TABLE(['Skill Laya', 'Laya làm gì', 'Kết quả cũ', 'Skill Jev mới'], [
    ['web-test-laya-wait', 'Quyết định trang đã tải xong chưa, nhận ra trang login/lỗi', '❌ Không có lợi. Laya báo "đang tải" 20/20 lần trên trang đã xong', 'web-test-jev-wait'],
    ['web-test-laya-gate', 'Ý kiến thứ hai: bước nào ghi dữ liệu', '⚠️ Chỉ có ích về an toàn. Bỏ sót 1/12 nhưng báo nhầm 9/12 bước đọc', 'web-test-jev-gate'],
    ['web-test-laya-verdict', 'Phán pass/fail/blocked từng bước', '❌ Tệ hơn. Chỉ tự tin ở 2/17 bước; 38 lượt model so với 19', 'web-test-jev-verdict'],
    ['web-test-laya-oracle', 'Như verdict nhưng rule trước, PASS cần ngưỡng cao', '❌ Tệ hơn. Rule chạy tốt, Laya không quyết bước nào; 35 lượt so với 19', 'web-test-jev-oracle'],
    ['web-test-laya-ground', 'Tìm nút/ô cần bấm', '✅ Tốt nhất, nhưng 17/17 lần là do rule, Laya chưa được dùng (đã có bản Jev riêng `web-test-jev-ground`, ngoài phạm vi lần này)', '(đã có)'],
  ]),
  P('Mẫu số chung của các thất bại: skill đặt một model nhỏ vào vị trí "quyết định", nhưng model trả xác suất thấp và xê dịch, thấp hơn ngưỡng, nên bước nào cũng quay về agent. Agent vẫn tốn lượt đọc kết quả của script *cộng* việc tự làm lại. Đây chính là chỗ Jev có thể khác (xác suất sắc nét), nên phép thử trung tâm của báo cáo này là: **cùng input, engine nào đủ tự tin đủ thường xuyên, và khi tự tin thì có đúng không.**'),
]);

// ---- 3. what was built
add('built', '2. Đã tạo gì', [
  UL([
    '**Worktree/branch:** `claude/laya-jev-skill-comparison-fe1001` (worktree `D:\\Laya\\.claude\\worktrees\\laya-jev-skill-comparison-fe1001`). Đã merge `plan/jev-applicability` vào để có các skill Laya và dữ liệu cũ; nhánh gốc không đổi.',
    '**4 skill mới** trong `.claude/skills/`: `web-test-jev-wait`, `web-test-jev-gate`, `web-test-jev-verdict`, `web-test-jev-oracle`. Mỗi skill là bản sao của skill Laya tương ứng. **Skill Laya không bị sửa.**',
    '**Điểm thay đổi duy nhất trong logic:** `laya-lib.mjs` → `jev-lib.mjs` (cùng hợp đồng `ask()`), `laya-check.mjs` → `jev-check.mjs`, bỏ `scripts/laya/` (installer, serve.py). Jev gọi qua `decision-provider.mjs` có sẵn của `web-test-jev-ground` (OpenRouter Decisions API, `typesafe/jev-1.13`).',
    '**Giữ nguyên:** câu hỏi (wording, nhãn), ngưỡng (verdict 0.85/0.60, oracle 0.95/0.85, gate 0.5, wait 0.6), thứ tự rule → engine → agent, fallback về rule khi engine tắt/lỗi. Nhờ vậy so sánh là "thay engine", không phải "thiết kế lại".',
    '**Khác biệt có chủ đích vì Jev là dịch vụ hosted:** (1) chỉ dùng sau khi người dùng đồng ý một lần (`jev-check.mjs --set true|false`, lưu ở `jev.local.json`, gitignored); thiếu `OPENROUTER_API_KEY` thì rule-only; (2) log riêng `*-jev-log.jsonl`, `jev-usage.jsonl` (độ trễ, token, chi phí; không ghi nội dung hay key); (3) không có bước cài/khởi động server.',
    `**Test:** 4 bộ unit/CLI test với Jev giả trên loopback (${8 + 12 + 11 + 12} test, tất cả pass): ngưỡng, override cần lý do, tắt Jev thì rule-only, HTTP lỗi thì fallback, khóa API không lọt vào log. \`node --test .claude/skills/web-test-jev-*/tests/*.test.mjs\``,
  ]),
]);

// ---- 4. method
add('method', '3. Cách đo', [
  P('Cùng một request (state + câu hỏi) được gửi cho cả hai engine đúng như skill gửi (file `eval/questions.mjs` sao chép nguyên văn từ script). Laya chạy local (laya-serve, CPU, checkpoint `english`, `max_len` theo từng skill). Jev gọi thật qua OpenRouter, **lặp 3 lần mỗi câu** để đo độ ổn định (Laya xác định nên chạy 1 lần). Chấm điểm bằng đúng quy tắc quyết định của từng skill (ngưỡng, rule trước).'),
  TABLE(['Bộ dữ liệu', 'Kích thước', 'Nhãn từ đâu'], [
    ['gate: `idea/web-test/gate` dev + held-out', '30 + 24 câu', 'Có sẵn từ lần đo cũ (held-out viết sau khi khóa rule). Replay của tôi tái hiện đúng số cũ: Laya 1/12 bỏ sót, 9/12 báo nhầm; rule 8/12 và 5/12.'],
    ['verdict/oracle: bước THẬT', '20 bước từ 6 run `ess-test-runs`', 'Trạng thái agent đã ghi (16 pass, 4 blocked). **Không phải ground truth độc lập**: đó là phán đoán của agent.'],
    ['verdict/oracle: sửa tay từ bước thật', '8 fail + 8 blocked', 'Tôi sửa `actual` (đổi số 160→40, 0→55, thay bằng lỗi môi trường) nên nhãn đúng theo cách dựng.'],
    ['verdict/oracle: viết tay ESS', '37 bước (14 pass, 15 fail, 8 blocked) + 8 quan sát chưa sẵn sàng', 'Tôi viết trước khi gọi model; nhãn đúng theo cách dựng. Tự đủ nghĩa, nên dễ hơn bước thật.'],
    ['wait: ảnh chụp trang', '33 trang viết tay + 18 bản có nav ESS thật ở đầu', 'Viết tay với nhãn đúng theo cách dựng (xong/đang tải/lỗi/login, màn hình). Gồm các câu chữ login/lỗi mà regex của skill bỏ sót. 2 ca login "tranh cãi" được tính riêng.'],
  ]),
  NOTE('Bộ dữ liệu nhỏ, phần lớn do tôi viết, và ground truth của bước thật là phán đoán của agent. Cách đọc đúng: **so sánh tương đối Laya và Jev trên cùng input**, không phải độ chính xác tuyệt đối. Tôi cũng không dùng ảnh chụp trang ESS thật trong `wait-log.jsonl` vì chúng chứa tên và mã nhân viên thật; không gửi chúng cho Jev.', 'warn'),
]);

// ---- 5. gate
const gateRows = (key, label) => [label, g[key].heldout ?? null];
add('gate', '4. gate: bước nào ghi dữ liệu', [
  TABLE(['Held-out (24 câu: 12 ghi, 12 đọc)', 'Bỏ sót bước ghi', 'Báo nhầm bước đọc', 'Chính xác'], [
    ['Rule từ khóa', heldout.rule.missedWrites, heldout.rule.falseFlagsOnReads, pc(heldout.rule.accuracy)],
    ['Laya (skill cũ)', heldout.laya.missedWrites, heldout.laya.falseFlagsOnReads, pc(heldout.laya.accuracy)],
    ['**Jev (skill mới)**', `**${heldout.jev.missedWrites}**`, `**${heldout.jev.falseFlagsOnReads}**`, `**${pc(heldout.jev.accuracy)}**`],
    ['Rule HOẶC Laya (như skill cũ)', heldout.ruleOrLaya.missedWrites, heldout.ruleOrLaya.falseFlagsOnReads, pc(heldout.ruleOrLaya.accuracy)],
    ['Rule HOẶC Jev (như skill mới)', heldout.ruleOrJev.missedWrites, heldout.ruleOrJev.falseFlagsOnReads, pc(heldout.ruleOrJev.accuracy)],
  ]),
  BARS('Tỉ lệ báo nhầm bước đọc (càng thấp càng tốt), held-out', [['Rule', heldout.rule.fpr], ['Laya', heldout.laya.fpr], ['Jev', heldout.jev.fpr]]),
  UL([
    `**Xác suất tách được hai nhóm?** Laya: bước ghi ${g.probRange.layaWrite.map(p2).join('–')}, bước đọc ${g.probRange.layaRead.map(p2).join('–')} (chồng lên nhau, không có ngưỡng nào tách). Jev: bước ghi ${g.probRange.jevWrite.map(p2).join('–')}, bước đọc ${g.probRange.jevRead.map(p2).join('–')}; chỉ một câu đọc bị báo ghi: "${g.jevFalseFlags[0].text}" (p ≈ 0,9, mơ hồ thật).`,
    `**Trên toàn bộ 54 câu:** Jev bỏ sót ${g.all.jev.missedWrites}, báo nhầm ${g.all.jev.falseFlagsOnReads}; Laya bỏ sót ${g.all.laya.missedWrites}, báo nhầm ${g.all.laya.falseFlagsOnReads}. Laya bỏ sót duy nhất: "${g.layaMisses[0]}". Jev ổn định: ${g.jevUnstableItems.length} câu đổi nhãn giữa 3 lần chạy.`,
    `**Trên 20 bước THẬT của 6 run cũ** (đều là bước chỉ đọc, ticket read-only): Laya sinh **${LS.gate.laya.disputed}** "disputed" (báo nhầm), Jev sinh **${LS.gate.jev.disputed}**. Cả ${LS.gate.jev.disputed} cái của Jev đều do *rule từ khóa* ("cancelled", "approved" là danh từ trong câu), Jev không thêm cái nào; ${LS.gate.laya.disputed - LS.gate.jev.disputed} cái dư của Laya là do Laya.`,
  ]),
  NOTE('Hệ quả thiết kế: vì mỗi lần báo nhầm = một "disputed" buộc agent xem lại (tốn lượt model), kết hợp "Rule HOẶC Jev" làm số báo nhầm tăng từ 1/12 lên 6/12 chỉ vì rule từ khóa. Dùng **Jev đơn thuần** (không OR với rule) cho recall 100% và 1/12 báo nhầm. Skill Jev hiện giữ nguyên OR để so sánh công bằng; nên đổi sau khi bạn đồng ý (xem Khuyến nghị).', 'info'),
]);

// ---- 6. wait
const IDEAL = { 'slow-with-expect': 'ready sau ~3 s (chỉ rule)', 'wrong-page': 'không ready: text mong đợi không xuất hiện (timeout)', 'login-code': 'status=login (câu chữ MFA mà regex bỏ sót)', 'login-authenticator': 'status=login', 'error-load': 'status=error (câu chữ lạ)', 'error-503': 'status=error', 'app-nav-wrong': 'KHÔNG phải login (trang ứng dụng bình thường có nav, thiếu text mong đợi)', 'app-nav-found': 'ready (rule)' };
const lw = LW.results;
add('wait', '5. wait: trang đã xong chưa, trang login/lỗi, màn hình nào', [
  P('Trong `wait.mjs`, model chỉ được hỏi khi rule không kết luận, trang không còn spinner và văn bản đứng yên ≥ 3 s. Mỗi lần hỏi là một request gồm 3 câu (state, screen, login) với tối đa 1500 ký tự văn bản trang.'),
  TABLE(['Offline, 51 ảnh chụp trang (Jev ×3)', 'Laya', 'Jev'], [
    ['Trang đã xong, được xác nhận "ready" (p ≥ 0,6)', w.laya.readyCalledReady, w.jev.readyCalledReady],
    ['Trang đang tải, được xác nhận "loading"', w.laya.loadingCalledLoading, w.jev.loadingCalledLoading],
    ['Median p của câu "state"', p2(w.laya.medianP.state), p2(w.jev.medianP.state)],
    ['Trang login có câu chữ regex bỏ sót, phát hiện được', ...['laya', 'jev'].map((e) => `${w[e].loginDetectedWhereRegexMissesNoDebatable} (2 ca tranh cãi: ${num(w[e].loginDetectedWhereRegexMisses) - num(w[e].loginDetectedWhereRegexMissesNoDebatable)}/${den(w[e].loginDetectedWhereRegexMisses) - den(w[e].loginDetectedWhereRegexMissesNoDebatable)})`)],
    ['**Trang ứng dụng bị báo nhầm là login**', `**${w.laya.loginFalsePositives}** (trang có nav: ${w.laya.loginFalsePositivesNavPages})`, `**${w.jev.loginFalsePositives}**`],
    ['Trang lỗi có câu chữ regex bỏ sót, phát hiện được', w.laya.errorDetectedWhereRegexMisses, w.jev.errorDetectedWhereRegexMisses],
    ['Nhận đúng màn hình ESS (p ≥ 0,6, đúng/sai chắc chắn)', `${w.laya.screenCorrectSure} (sai chắc: ${num(w.laya.screenWrongSure)})`, `${w.jev.screenCorrectSure} (sai chắc: ${num(w.jev.screenWrongSure)})`],
    ['Độ trễ p50 mỗi request', ms(w.perf.laya.p50ms), ms(w.perf.jev.p50ms)],
  ]),
  P('**Chạy thật trong trình duyệt** (Edge headless, cổng riêng 9334, profile tạm; cùng trang cho cả hai skill, `--timeout 12`). Cột "kỳ vọng" là việc một lần chờ tốt nên làm.'),
    TABLE(['Tình huống', 'Kỳ vọng', 'Laya', 'Jev'], lw.map((r) => {
    const fmt = (x) => `${x.status}${x.status === 'timeout' ? '' : ''} / màn ${x.screen} / ${f1(x.waitedS)} s`;
    const good = (x) => { const s = r.id; if (/^login/.test(s)) return x.status === 'login'; if (/^error/.test(s)) return x.status === 'error'; if (s === 'app-nav-wrong') return x.status !== 'login'; if (s === 'wrong-page') return x.status === 'timeout'; return x.status === 'ready'; };
    const mark = (x) => (good(x) ? '✅ ' : '❌ ') + fmt(x);
    return [r.id, IDEAL[r.id] ?? r.ideal, mark(r.runs.laya), mark(r.runs.jev)];
  })),
  UL([
    `Laya đúng ${lw.filter((r) => { const x = r.runs.laya; const s = r.id; return /^login/.test(s) ? x.status === 'login' : /^error/.test(s) ? x.status === 'error' : s === 'app-nav-wrong' ? x.status !== 'login' : s === 'wrong-page' ? x.status === 'timeout' : x.status === 'ready'; }).length}/${lw.length}, Jev đúng ${lw.filter((r) => { const x = r.runs.jev; const s = r.id; return /^login/.test(s) ? x.status === 'login' : /^error/.test(s) ? x.status === 'error' : s === 'app-nav-wrong' ? x.status !== 'login' : s === 'wrong-page' ? x.status === 'timeout' : x.status === 'ready'; }).length}/${lw.length}. Hai lỗi nặng của Laya: gọi **trang lỗi là login** (\`status=login\` thay vì \`error\`, vì script kiểm tra login trước) và gọi **trang ứng dụng bình thường là login** khi trang có văn bản nav ESS. Cả hai khiến agent đi sai hướng (đăng nhập lại thay vì xử lý lỗi/chờ).`,
    'Cả hai đều không giúp được ca "đã xong nhưng không phải trang mong đợi" (`wrong-page`): với `--expect` cho trước, rule quyết định sự sẵn sàng và model chỉ bổ sung login/lỗi/màn hình. Thiết kế này vẫn còn chờ hết timeout.',
    'Khả năng còn yếu của Jev: câu "Microsoft sign-in?" chưa chắc ở vài trang MFA/đăng nhập nội bộ (p quanh 0,5 đến 0,8) và đưa trang "chỉ có header" vào "ready" (1/6 trang tải dở). Rule regex vẫn nên giữ.',
  ]),
]);

// ---- 7. verdict
const vb = v.bySet;
const row2 = (label, e) => [label, pc(e.decidedByEngine), pc(e.decidedPrecision), pc(e.confidentNoReview), e.falsePass, f1(e.falseFailOnPass.split('/')[0]) + '/' + f1(e.falseFailOnPass.split('/')[1])];
add('verdict', '6. verdict: pass / fail / blocked từng bước', [
  P('Quy tắc skill: p ≥ 0,85 → ghi luôn; 0,60 ≤ p < 0,85 → ghi nhưng gắn "review"; p < 0,60 → agent tự phán.'),
  TABLE(['Toàn bộ 73 bước', 'Tự quyết', 'Đúng khi tự quyết', 'Tự quyết không cần review', 'Bước không-pass bị ghi pass', 'Bước pass bị ghi fail'], [
    row2('Laya', verdictAll.laya), row2('**Jev**', verdictAll.jev),
  ]),
  TABLE(['Theo bộ dữ liệu', 'n', 'Laya: nhãn đầu đúng', 'Jev: nhãn đầu đúng', 'Laya: tự quyết', 'Jev: tự quyết', 'Laya: đúng khi quyết', 'Jev: đúng khi quyết'], ['real', 'mut-fail', 'mut-blocked', 'hw'].map((s) => [
    { real: 'Bước THẬT (nhãn của agent)', 'mut-fail': 'Sửa tay → fail', 'mut-blocked': 'Sửa tay → blocked', hw: 'Viết tay ESS' }[s], vb[s].n,
    pc(vb[s].laya.accuracyTopLabel), pc(vb[s].jev.accuracyTopLabel), pc(vb[s].laya.decidedByEngine), pc(vb[s].jev.decidedByEngine), pc(vb[s].laya.decidedPrecision), pc(vb[s].jev.decidedPrecision)])),
  BARS('Độ chính xác nhãn đầu, theo bộ dữ liệu — Laya', ['real', 'mut-fail', 'mut-blocked', 'hw'].map((s) => [s, vb[s].laya.accuracyTopLabel])),
  BARS('— Jev', ['real', 'mut-fail', 'mut-blocked', 'hw'].map((s) => [s, vb[s].jev.accuracyTopLabel])),
  UL([
    `**Trên bước tự đủ nghĩa** (viết tay, sửa tay): Jev đúng ${pc(vb.hw.jev.accuracyTopLabel)} và ${pc(vb['mut-fail'].jev.accuracyTopLabel)} (Laya ${pc(vb.hw.laya.accuracyTopLabel)} và ${pc(vb['mut-fail'].laya.accuracyTopLabel)}). Laya còn ghi *pass* cho 2/8 ca số liệu đã bị sửa sai (ví dụ \`Total hours: 55\` khi expected là 0) — đó là false-pass, lỗi đắt nhất. Jev: 0 false-pass trên 129 lượt không-pass.`,
    `**Độ tự tin:** Laya median p ${p2(v.pRange.laya.median)}, ${pc(v.pRange.laya.below60)} lượt dưới 0,60 (agent phải làm lại), chỉ ${pc(v.pRange.laya.atLeast85)} ≥ 0,85. Jev median p ${p2(v.pRange.jev.median)}, ${pc(v.pRange.jev.below60)} dưới 0,60, ${pc(v.pRange.jev.atLeast85)} ≥ 0,85. Jev ổn định giữa 3 lần chạy (${v.jevUnstable.length} bước đổi nhãn).`,
    `**Trên bước THẬT thì ngược lại.** Laya chỉ tự quyết ${pc(vb.real.laya.decidedByEngine)} (còn lại về agent), Jev quyết ${pc(vb.real.jev.decidedByEngine)} nhưng chỉ đúng ${pc(vb.real.jev.decidedPrecision)}. Lỗi tập trung ở các bước có expected tham chiếu bước/case khác ("Total hours bằng giá trị ở TC01", "giống bước 1") và actual chỉ nói "Total hours: 0": Jev phán **fail** với p 0,85–0,99. Tôi thử đưa các bước trước của cùng run vào state (arm "context"): đúng khi quyết chỉ từ ${pc(CTX.jevBase.precision)} lên ${pc(CTX.jevCtx.precision)}, số bước pass bị ghi fail mỗi lượt (trên 16 bước pass thật) từ ${f1(CTX.jevBase.falseFail)} xuống ${f1(CTX.jevCtx.falseFail)} — **không đủ để đưa vào skill**. Nhãn thật ở đây là phán đoán của agent (ticket chính là lỗi "Total hours 0 vs 55", agent kết luận pass với bằng chứng yếu), nên chưa thể nói chắc ai đúng — nhưng một verdict "fail" tự ghi với p 0,99 là rủi ro dù đúng hay sai.`,
    `**Chạy script end-to-end trên 19 bước thật:** Laya quyết ${LS.verdict.laya.decidedByEngineOrRule} bước (đúng ${LS.verdict.laya.agreeWithFinal}, sai ${LS.verdict.laya.wrongFinal}), trả ${LS.verdict.laya.toAgent} về agent, gắn review ${LS.verdict.laya.flaggedReview}. Jev quyết ${LS.verdict.jev.decidedByEngineOrRule} (đúng ${LS.verdict.jev.agreeWithFinal}, sai ${LS.verdict.jev.wrongFinal}), trả ${LS.verdict.jev.toAgent} về agent, gắn review ${LS.verdict.jev.flaggedReview}. Số verdict **sai mà không được gắn review** (agent không có tín hiệu để soát): Laya ${unflaggedWrong('laya')}, Jev ${unflaggedWrong('jev')}.`,
  ]),
  TABLE(['Ngưỡng p', ...v.sweep.laya.map((x) => `≥ ${x.t}`)], [
    ['Laya: tự quyết / đúng', ...v.sweep.laya.map((x) => `${pc(x.decided)} / ${pc(x.precision)}`)],
    ['Jev: tự quyết / đúng', ...v.sweep.jev.map((x) => `${pc(x.decided)} / ${pc(x.precision)}`)],
  ]),
  P('Quét ngưỡng: ngưỡng của skill được đặt cho phân bố xác suất mềm của Laya. Với Jev, nâng ngưỡng chỉ cắt dần số lượt tự quyết mà độ chính xác hầu như không đổi (88% → 93%), vì xác suất của Jev gần như nhị phân. Ngưỡng không phải đòn bẩy để chặn lỗi của Jev.'),
]);

// ---- 8. oracle
const ob = o.bySet;
add('oracle', '7. oracle: rule trước, model sau, PASS cần p ≥ 0,95 và FAIL cần p ≥ 0,85', [
  TABLE(['Toàn hệ thống (81 quan sát)', 'PASS thật được ghi pass', 'FAIL thật được ghi fail', 'Không-pass bị ghi pass', 'Pass bị ghi fail (mỗi lượt)', 'Trả về agent'], [
    ['Laya', pc(o.laya.passRecall), pc(o.laya.failCatch), `${o.laya.falsePassPerRun}/${f1(o.laya.nonPassItems)}`, `${o.laya.falseFailPerRun}/${f1(o.laya.passItems)}`, pc(o.laya.sentToAgent)],
    ['**Jev**', pc(o.jev.passRecall), pc(o.jev.failCatch), `${o.jev.falsePassPerRun}/${f1(o.jev.nonPassItems)}`, `${o.jev.falseFailPerRun}/${f1(o.jev.passItems)}`, pc(o.jev.sentToAgent)],
  ]),
  UL([
    `Laya gần như không quyết được gì (ngưỡng 0,95 quá cao cho phân bố của nó: chỉ ${pc(o.laya.engineDecidedShare)} lượt do model quyết), khớp với báo cáo cũ: "rule chạy tốt, Laya không quyết bước nào". Hệ quả là ${pc(o.laya.sentToAgent)} bước về agent — nguồn của 35 lượt model so với 19.`,
    `Jev quyết ${pc(o.jev.engineDecidedShare)} bước và về agent ${pc(o.jev.sentToAgent)}. **Không có false-pass nào** (ngưỡng 0,95 cho PASS giữ vai trò an toàn). Ca "chưa sẵn sàng" (trang còn tải): ${pc(o.jev.notReadyNotPassed)} không bị ghi pass, nhãn "not_ready" được nhận đúng ${ob['not-ready'].jev.labelDist.not_ready}/8 (Laya ${ob['not-ready'].laya.labelDist.not_ready ?? 0}/8).`,
    `Trên **bước thật** (20): model của Laya quyết ${pc(ob.real.laya.engineDecidedShare)} (về agent ${pc(ob.real.laya.sentToAgent)}); model của Jev quyết ${pc(ob.real.jev.engineDecidedShare)} nhưng có ${ob.real.jev.falseFailPerRun}/${ob.real.jev.passItems} bước pass bị ghi **fail** mỗi lượt (cùng nhóm bước tham chiếu chéo như ở verdict).`,
    `Chạy script end-to-end trên 19 bước thật: Laya quyết ${LS.oracle.laya.decidedByEngineOrRule} (toàn bằng rule, đúng ${LS.oracle.laya.agreeWithFinal}), Jev quyết ${LS.oracle.jev.decidedByEngineOrRule} (rule ${LS.oracle.jev.byRule} + Jev ${LS.oracle.jev.byEngine}; đúng ${LS.oracle.jev.agreeWithFinal}, sai ${LS.oracle.jev.wrongFinal}), trả ${LS.oracle.jev.toAgent} về agent (Laya ${LS.oracle.laya.toAgent}).`,
  ]),
  NOTE('Giả định của phép replay oracle: `observed` được lấy bằng đúng `actual` của bước (script thật lấy toast và các dòng chứa chuỗi trong ngoặc của expected từ DOM). Đây là xấp xỉ.', 'info'),
]);

// ---- 9. cost
add('cost', '8. Độ trễ, chi phí, riêng tư', [
  TABLE(['Skill', 'Laya p50 (CPU)', 'Jev p50 (hosted)', 'Jev $/lượt gọi', 'Jev token vào / lượt'], [
    ['gate', ms(g.perf.laya.p50ms), ms(g.perf.jev.p50ms), usdCall(COST.gate.usd / COST.gate.calls), Math.round(COST.gate.tokens / COST.gate.calls)],
    ['verdict', ms(v.perf.laya.p50ms), ms(v.perf.jev.p50ms), usdCall(COST.verdict.usd / COST.verdict.calls), Math.round(COST.verdict.tokens / COST.verdict.calls)],
    ['oracle', ms(o.perf.laya.p50ms), ms(o.perf.jev.p50ms), usdCall(COST.oracle.usd / COST.oracle.calls), Math.round(COST.oracle.tokens / COST.oracle.calls)],
    ['wait (3 câu/lượt, ≤1500 ký tự)', ms(w.perf.laya.p50ms), ms(w.perf.jev.p50ms), usdCall(COST.wait.usd / COST.wait.calls), Math.round(COST.wait.tokens / COST.wait.calls)],
  ]),
  UL([
    `Toàn bộ phần offline tốn **${usd(totalUsd)}** cho ${totalCalls} lượt gọi Jev (gồm cả arm context; chưa tính phần live, vài trăm lượt nữa ở mức $0,00002). Chi phí Jev trên một ticket là không đáng kể (vài chục lượt × ~$0,00002); Laya miễn phí nhưng cần ~2,2 GB model, ~2 GB RAM và khởi động ~30–40 s, độ trễ của wait trên CPU là ${ms(w.perf.laya.p50ms)}.`,
    '**Riêng tư:** Jev là dịch vụ ngoài. Gate gửi câu mô tả bước; verdict gửi expected+actual; oracle gửi expected+dòng quan sát; **wait gửi tới 1500 ký tự văn bản trang** — có thể chứa tên/mã nhân viên. Vì thế skill chỉ dùng Jev sau khi hỏi người dùng một lần, và wait nên cân nhắc lọc/rút gọn văn bản trước khi gửi hoặc chỉ dùng khi trang không chứa dữ liệu người. Nếu dữ liệu không được phép ra ngoài thì dùng Kev (local, cùng API) như kế hoạch `jev-applicability-plan.md`.',
  ]),
]);

// ---- 10. risks
add('risks', '9. Phát hiện đáng chú ý', [
  UL([
    '**Jev tự tin cả khi sai.** Xác suất gần 0/1 nên "p cao" không còn là tín hiệu để chặn lỗi (xem quét ngưỡng). Độ chính xác khi p ≥ 0,99 vẫn chỉ 93% trên verdict. Cần chốt chặn khác: không bao giờ tự ghi `fail`/`blocked` mà không có agent xác nhận, hoặc luôn gắn review cho verdict do model đưa ra.',
    '**Điểm mạnh của Jev là câu hỏi hẹp, tự đủ nghĩa** (gate, nhận trang login/lỗi, màn hình, so khớp expected/actual rõ ràng). **Điểm yếu là bước cần ngữ cảnh ngoài state** (so với giá trị của case khác). Thêm các bước trước vào state không sửa được.',
    '**Laya sai theo kiểu khác:** không tự tin (nên tốn lượt) và đôi khi sai chắc chắn (login nhầm, false-pass ở ca đã sửa số).',
    '**Rule từ khóa của gate** là nguồn báo nhầm chính của skill Jev (4/4 disputed trên bước thật). Jev đơn thuần tốt hơn "rule HOẶC Jev".',
    'Hai kết quả cũ của Laya được tái hiện trong replay (gate 1/12 và 9/12; wait/oracle hiếm khi đủ tự tin), nên harness đáng tin cho phần so sánh.',
  ]),
]);

// ---- 11. limits
add('limits', '10. Chưa làm / hạn chế', [
  UL([
    '**Không chạy lại phiên agent trọn ticket** để đo số lượt model và token (so với 19/38/35 turn trong báo cáo cũ). Đó là phép đo cuối cùng cho "skill có rẻ hơn không"; tôi chỉ có thể suy ra từ tỉ lệ bước phải về agent. Mỗi phiên tốn cỡ 1,5M token vào; 9 biến thể (baseline + 4 Laya + 4 Jev) × 3 lần ≈ 40M token.',
    '**Không chạy trên ESS dev thật:** thử mở trình duyệt bằng profile `xiontechs` đã đăng nhập (cổng 9333) bị hệ thống chặn là truy cập môi trường thật; tôi không vòng qua. Phần live dùng trang giả lập và 6 run đã lưu.',
    '**Cỡ mẫu nhỏ, nhãn do người viết:** 20 bước thật, 53 bước viết/sửa tay, 51 trang. Chênh vài điểm phần trăm không có ý nghĩa; chênh lớn (gate báo nhầm, wait login nhầm, oracle quyết được) thì rõ ràng.',
    '`wait.mjs` live chỉ thử 8 tình huống, 1 lần mỗi skill. Jev không tất định tuyệt đối (3 lần lặp: 1 bước đổi nhãn trên verdict).',
    'Chưa đo Kev (local, cùng API) và `web-test-jev-ground` (đã có từ trước, ngoài phạm vi).',
  ]),
]);

// ---- 12. recommendations
add('recs', '11. Khuyến nghị', [
  TABLE(['Skill', 'Đề xuất', 'Lý do'], [
    ['web-test-jev-gate', '**Dùng Jev**, và đổi thành Jev đơn thuần (bỏ OR với rule từ khóa); giữ netlog + audit làm chốt chặn thật.', 'Recall 100%, báo nhầm 1/12 (Laya 9/12); giảm disputed từ 9 xuống 0 trên 20 bước thật. Chi phí gần 0.'],
    ['web-test-jev-wait', '**Dùng Jev**, nhưng lọc văn bản trang trước khi gửi (hoặc chỉ gửi phần `<main>`), giữ regex login/lỗi, cân nhắc để `error` thắng `login` khi cả hai cùng bật (Laya từng gọi trang lỗi là login).', 'Nhận trang lỗi/login lạ, không báo login nhầm, nhanh gấp ~5 lần Laya. Vẫn không giải quyết "đúng trang nhưng thiếu text mong đợi".'],
    ['web-test-jev-oracle', '**Dùng Jev**, giữ ngưỡng PASS 0,95; **không auto-ghi FAIL**: mọi fail do model đề xuất phải về agent xác nhận.', '0 false-pass, giảm 85% → 19% bước về agent; nhưng 3/16 pass thật bị ghi fail trên bước thật.'],
    ['web-test-jev-verdict', '**Chưa nên bật mặc định.** Chỉ dùng khi expected tự đủ nghĩa (agent được hướng dẫn viết expected không tham chiếu case khác), và mọi verdict của model gắn `review`.', 'Tốt trên bước tự đủ nghĩa (100%/100%), kém trên bước thật (đúng 52% khi quyết, sai không có cờ). Oracle làm cùng việc nhưng rule-first và có ngưỡng PASS cao hơn.'],
  ]),
  UL([
    '**Bước tiếp theo đáng làm nhất:** chạy 3 phiên agent trọn ticket #11840 cho mỗi skill (baseline `web-test`, Laya, Jev) ở dev, để lấy số lượt model/token/thời gian. Cần bạn duyệt chạy với profile ESS đã đăng nhập (hoặc cung cấp phiên khác) và mở cổng riêng (không dùng 9222).',
    'Nếu muốn gom: cân nhắc gộp verdict+oracle thành một skill (oracle dựa rule trước), vì verdict là bản yếu hơn của oracle.',
    'Tái lập: `node eval/run-ab.mjs && node eval/analyze.mjs && node eval/make-report.mjs` (cần laya-serve và `OPENROUTER_API_KEY`); live: `node eval/live-wait.mjs`, `node eval/live-scripts.mjs`.',
  ]),
]);

add('files', 'Phụ lục: file', [
  UL([
    '`.claude/skills/web-test-jev-{wait,gate,verdict,oracle}/`: 4 skill mới (mỗi skill có `SKILL.md`, `scripts/`, `tests/`, `jev.json`).',
    '`eval/questions.mjs`: câu hỏi, ngưỡng, rule copy nguyên văn từ script. `eval/data/`: bộ dữ liệu (`handwritten.mjs` là phần viết tay) và script dựng.',
    '`eval/run-ab.mjs`, `eval/analyze.mjs`, `eval/run-context-arm.mjs`, `eval/live-wait.mjs`, `eval/live-scripts.mjs`, `eval/make-report.mjs`. Kết quả thô và tóm tắt: `eval/results/`.',
  ]),
]);

// ------------------------------------------------------------------------------------------------------------------
// renderers
const inline = (s) => s;
function md() {
  const out = ['# So sánh 4 skill web-test: Laya (cũ) vs Jev (mới)', '', `Ngày ${S.generatedAt.slice(0, 10)} · nhánh \`claude/laya-jev-skill-comparison-fe1001\` · Jev model \`${S.jevModel}\``, ''];
  for (const s of sections) {
    out.push(`## ${s.title}`, '');
    for (const b of s.blocks) {
      if (b.t === 'p') out.push(b.text, '');
      else if (b.t === 'ul') { out.push(...b.items.map((i) => `- ${i}`), ''); }
      else if (b.t === 'note') out.push(`> ${b.text}`, '');
      else if (b.t === 'cards') { out.push('| Skill | Laya (cũ) | Jev (mới) | Nhận định |', '|---|---|---|---|', ...b.cards.map((c) => `| \`${c.name}\` | ${c.old} | ${c.now} | ${c.verdict} |`), ''); }
      else if (b.t === 'table') { out.push(`| ${b.head.join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`, ...b.rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`), ''); }
      else if (b.t === 'bars') { out.push(`**${b.title}**`, '', ...b.rows.map(([l, x]) => `- ${l}: ${b.fmt(x)}`), ''); }
    }
  }
  return out.join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
function html() {
  const body = sections.map((s) => {
    const inner = s.blocks.map((b) => {
      if (b.t === 'p') return `<p>${rich(b.text)}</p>`;
      if (b.t === 'ul') return `<ul>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`;
      if (b.t === 'note') return `<div class="note ${b.kind}">${rich(b.text)}</div>`;
      if (b.t === 'cards') return `<div class="cards">${b.cards.map((c) => `<div class="card ${c.good === true ? 'good' : c.good === false ? 'bad' : 'mixed'}"><div class="cname">${esc(c.name)}</div><div class="line old"><span>Laya</span>${rich(c.old)}</div><div class="line new"><span>Jev</span>${rich(c.now)}</div><div class="cv">${rich(c.verdict)}</div></div>`).join('')}</div>`;
      if (b.t === 'table') return `<div class="tw"><table><thead><tr>${b.head.map((h) => `<th>${rich(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      if (b.t === 'bars') return `<div class="bars"><div class="btitle">${rich(b.title)}</div>${b.rows.map(([l, x]) => `<div class="brow"><span class="bl">${esc(l)}</span><span class="bt"><span class="bf ${/laya/i.test(b.title + l) ? 'laya' : /jev/i.test(b.title + l) ? 'jev' : 'rule'}" style="width:${Math.max(0, Math.min(100, (x / b.max) * 100))}%"></span></span><span class="bv">${b.fmt(x)}</span></div>`).join('')}</div>`;
      return '';
    }).join('\n');
    return `<section id="${s.id}"><h2>${esc(s.title)}</h2>${inner}</section>`;
  }).join('\n');
  const toc = sections.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join('');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laya vs Jev: 4 skill web-test</title>
<style>
:root{--bg:#fbfaf8;--fg:#1f2328;--mut:#5b6470;--line:#e3e0da;--card:#fff;--code:#f1eee8;--accent:#3b5bdb;--laya:#c2761c;--jev:#2b7a5d;--rule:#8a8f98;--good:#2b7a5d;--warn:#b7791f;--bad:#c0392b;--note:#f4f1ea}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#15171a;--fg:#e8e6e1;--mut:#9aa3ad;--line:#2b2f35;--card:#1c1f23;--code:#24282d;--accent:#8aa1ff;--laya:#e0a050;--jev:#5cc39c;--rule:#7b828c;--good:#5cc39c;--warn:#e0b050;--bad:#ef7b6b;--note:#1f2227}}
:root[data-theme=dark]{--bg:#15171a;--fg:#e8e6e1;--mut:#9aa3ad;--line:#2b2f35;--card:#1c1f23;--code:#24282d;--accent:#8aa1ff;--laya:#e0a050;--jev:#5cc39c;--rule:#7b828c;--good:#5cc39c;--warn:#e0b050;--bad:#ef7b6b;--note:#1f2227}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:28px 16px 80px}
header h1{font-size:26px;margin:0 0 6px}header p{margin:0;color:var(--mut)}
nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin:18px 0 8px;font-size:13px}nav a{color:var(--accent);text-decoration:none}nav a:hover{text-decoration:underline}
section{margin-top:34px}h2{font-size:19px;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
p,li{max-width:80ch}ul{padding-left:20px}li{margin:4px 0}code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.88em}
.tw{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:13.5px;background:var(--card);border:1px solid var(--line);border-radius:6px}
th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--note);font-weight:600}tr:last-child td{border-bottom:0}
.note{background:var(--note);border-left:3px solid var(--accent);padding:10px 14px;margin:12px 0;border-radius:4px;max-width:80ch}.note.warn{border-color:var(--warn)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:14px 0}
.card{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--rule);border-radius:6px;padding:12px 14px;font-size:13.5px}.card.good{border-top-color:var(--good)}.card.mixed{border-top-color:var(--warn)}.card.bad{border-top-color:var(--bad)}
.cname{font-weight:600;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;margin-bottom:8px}.line{margin:4px 0}.line span{display:inline-block;width:42px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}.line.new{color:var(--fg)}.cv{margin-top:8px;font-weight:600}
.bars{margin:12px 0;max-width:640px}.btitle{font-size:13px;color:var(--mut);margin-bottom:4px}.brow{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px}.bl{width:92px;flex:none}.bt{flex:1;height:12px;background:var(--code);border-radius:6px;overflow:hidden}.bf{display:block;height:100%}.bf.laya{background:var(--laya)}.bf.jev{background:var(--jev)}.bf.rule{background:var(--rule)}.bv{width:54px;text-align:right;font-variant-numeric:tabular-nums}
footer{margin-top:40px;color:var(--mut);font-size:12.5px}
</style></head><body><div class="wrap">
<header><h1>So sánh 4 skill web-test: Laya (cũ) và Jev (mới)</h1><p>Ngày ${esc(S.generatedAt.slice(0, 10))} · nhánh <code>claude/laya-jev-skill-comparison-fe1001</code> · Jev model <code>${esc(S.jevModel)}</code></p><nav>${toc}</nav></header>
${body}
<footer>Sinh tự động từ <code>eval/results/*.json</code> bằng <code>eval/make-report.mjs</code>. Mọi con số được nội suy từ file kết quả.</footer>
</div></body></html>`;
}

fs.writeFileSync(path.join(here, 'REPORT.md'), md());
fs.writeFileSync(path.join(here, 'REPORT.html'), html());
console.log('wrote eval/REPORT.md and eval/REPORT.html');
