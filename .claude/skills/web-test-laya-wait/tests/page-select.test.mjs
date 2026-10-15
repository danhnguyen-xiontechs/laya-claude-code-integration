// page-select.mjs: the page under test is chosen deterministically; hidden tabs are ignored; ambiguity is an error.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { choosePage, matchesUrl, selectPage, NEWER_MS } from '../scripts/page-select.mjs';

const ESS = 'https://ess-staging.example.com';
const tab = (url, o = {}) => ({ url, visibility: 'visible', focused: false, timeOrigin: 1000, ...o });

describe('matchesUrl', () => {
  it('route matches the path and its sub-paths, not a prefix of another word', () => {
    assert.ok(matchesUrl(`${ESS}/attendance`, '/attendance'));
    assert.ok(matchesUrl(`${ESS}/attendance/team?m=10`, '/attendance'));
    assert.ok(matchesUrl(`${ESS}/attendance/`, '/attendance/'));
    assert.ok(!matchesUrl(`${ESS}/attendance-report`, '/attendance'));
    assert.ok(!matchesUrl(`${ESS}/`, '/attendance'));
  });
  it("route '/' matches only the root", () => {
    assert.ok(matchesUrl(`${ESS}/`, '/'));
    assert.ok(!matchesUrl(`${ESS}/attendance`, '/'));
  });
  it('hash routes, full URLs and plain substrings', () => {
    assert.ok(matchesUrl(`${ESS}/#/time-off/new`, '#/time-off'));
    assert.ok(matchesUrl(`${ESS}/attendance?x=1`, `${ESS}/attendance`));
    assert.ok(matchesUrl(`${ESS}/`, `${ESS}`));
    assert.ok(!matchesUrl(`${ESS}/`, `${ESS}/attendance`));
    assert.ok(matchesUrl(`${ESS}/payslips/2026-09`, 'payslips'));
    assert.ok(matchesUrl(`${ESS}/Attendance`, '/attendance'), 'case-insensitive');
  });
});

describe('choosePage', () => {
  it('11840 case: a hidden ESS tab at / and the test tab on /attendance → the visible one, even listed second', () => {
    const r = choosePage([tab(`${ESS}/`, { visibility: 'hidden' }), tab(`${ESS}/attendance`)]);
    assert.deepEqual(r, { index: 1, reason: 'only-visible' });
  });
  it('11840 case with --url: the matching tab wins over an earlier visible one', () => {
    const r = choosePage([tab(`${ESS}/`), tab(`${ESS}/attendance`)], { url: '/attendance' });
    assert.deepEqual(r, { index: 1, reason: 'url' });
  });
  it('devtools, extension and about:blank pages never count', () => {
    const r = choosePage([tab('devtools://devtools/bundled/inspector.html'), tab('chrome-extension://abc/popup.html'), tab('about:blank'), tab(`${ESS}/profile`)]);
    assert.deepEqual(r, { index: 3, reason: 'only-visible' });
  });
  it('two visible tabs → the focused one', () => {
    const r = choosePage([tab(`${ESS}/`), tab(`${ESS}/payslips`, { focused: true })]);
    assert.deepEqual(r, { index: 1, reason: 'focused' });
  });
  it('two visible tabs, none focused → the most recently navigated, when clearly newer', () => {
    const r = choosePage([tab(`${ESS}/attendance`, { timeOrigin: 50_000 }), tab(`${ESS}/`, { timeOrigin: 1_000 })]);
    assert.deepEqual(r, { index: 0, reason: 'newest' });
  });
  it('two visible tabs loaded at nearly the same time → ambiguous error listing them, no silent pick', () => {
    const r = choosePage([tab(`${ESS}/`, { timeOrigin: 1000 }), tab(`${ESS}/attendance`, { timeOrigin: 1000 + NEWER_MS - 1 })]);
    assert.equal(r.index, undefined);
    assert.match(r.error, /^ambiguous: 2 visible tabs/);
    assert.match(r.error, /--url/);
    assert.match(r.error, /\/attendance/);
  });
  it('a tab that did not answer the probe (unknown time) makes the newest rule unusable → ambiguous', () => {
    const r = choosePage([tab(`${ESS}/a`, { timeOrigin: 90_000 }), tab(`${ESS}/b`, { visibility: null, focused: null, timeOrigin: null })]);
    assert.match(r.error, /^ambiguous/);
  });
  it('a tab mid-navigation (visibility unknown) is kept, not treated as hidden', () => {
    const r = choosePage([tab(`${ESS}/`, { visibility: 'hidden' }), tab(`${ESS}/attendance`, { visibility: null, focused: null, timeOrigin: null })]);
    assert.deepEqual(r, { index: 1, reason: 'only-visible' });
  });
  it('two focused tabs (two windows) are not a unique answer', () => {
    const r = choosePage([tab(`${ESS}/a`, { focused: true }), tab(`${ESS}/b`, { focused: true })]);
    assert.match(r.error, /^ambiguous/);
  });
  it('--url with no matching tab → no-match error naming the open tabs', () => {
    const r = choosePage([tab(`${ESS}/`)], { url: '/attendance' });
    assert.match(r.error, /^no-match: no tab matches --url \/attendance; open: https:\/\/ess-staging\.example\.com\//);
  });
  it('--url matching only a hidden tab → hidden error, not a pick', () => {
    const r = choosePage([tab(`${ESS}/attendance`, { visibility: 'hidden' }), tab(`${ESS}/`)], { url: '/attendance' });
    assert.match(r.error, /^hidden:/);
  });
  it('only hidden tabs → hidden error', () => {
    assert.match(choosePage([tab(`${ESS}/`, { visibility: 'hidden' })]).error, /^hidden:/);
  });
  it('no http(s) tab → no-page', () => {
    assert.match(choosePage([tab('about:blank')]).error, /^no-page/);
    assert.match(choosePage([]).error, /^no-page/);
  });
  it('--url matching two visible tabs falls through to focus', () => {
    const r = choosePage([tab(`${ESS}/attendance`), tab(`${ESS}/attendance/team`, { focused: true }), tab(`${ESS}/`, { focused: true })], { url: '/attendance' });
    assert.deepEqual(r, { index: 1, reason: 'focused' });
  });
});

describe('selectPage on a mocked CDP browser', () => {
  const page = (url, state) => ({
    url: () => url,
    evaluate: async () => { if (state instanceof Error) throw state; return state; },
  });
  const browser = (...ctxPages) => ({ contexts: () => ctxPages.map((ps) => ({ pages: () => ps })) });

  it('returns the playwright page object of the visible tab across contexts', async () => {
    const hidden = page(`${ESS}/`, { visibility: 'hidden', focused: false, timeOrigin: 1 });
    const test = page(`${ESS}/attendance`, { visibility: 'visible', focused: false, timeOrigin: 2 });
    const r = await selectPage(browser([page('devtools://x', null), hidden], [test]));
    assert.equal(r.page, test);
    assert.equal(r.reason, 'only-visible');
  });
  it('a page whose evaluate throws (navigating) is kept as unknown', async () => {
    const hidden = page(`${ESS}/`, { visibility: 'hidden', focused: false, timeOrigin: 1 });
    const nav = page(`${ESS}/attendance`, new Error('Execution context was destroyed'));
    const r = await selectPage(browser([hidden, nav]));
    assert.equal(r.page, nav);
  });
  it('ambiguous browser → { error }, no page', async () => {
    const s = { visibility: 'visible', focused: false, timeOrigin: 5 };
    const r = await selectPage(browser([page(`${ESS}/`, s), page(`${ESS}/profile`, s)]));
    assert.equal(r.page, undefined);
    assert.match(r.error, /^ambiguous/);
  });
  it('url option is passed through', async () => {
    const s = { visibility: 'visible', focused: false, timeOrigin: 5 };
    const want = page(`${ESS}/profile`, s);
    const r = await selectPage(browser([page(`${ESS}/`, s), want]), { url: '/profile' });
    assert.equal(r.page, want);
    assert.equal(r.reason, 'url');
  });
});
