// Picks the page under test in the role browser (port 9222), deterministically.
// The browser can hold tabs the chrome-devtools MCP does not list (in the 11840 agent runs, a hidden ESS page
// at `/`), so "the first non-devtools page" polled the wrong tab. Order of choice:
//   1. http(s) pages only (no devtools://, chrome-extension://, about:blank)
//   2. --url given → only pages whose URL matches it (full URL prefix, route like /attendance, or substring)
//   3. hidden tabs are ignored (document.visibilityState === 'hidden'); unknown (mid-navigation) is kept
//   4. one page left → it; else the focused one; else the most recently navigated one (newer by ≥ NEWER_MS)
//   5. anything else is ambiguous → an error that lists the open pages, never a silent guess
// choosePage() is pure (unit-tested); selectPage() probes real playwright pages and calls it.

export const NEWER_MS = 2000;
const PROBE_MS = 2000;

/** Does pageUrl match `want`: a full URL (prefix), a route ('/attendance', '#/x'), or any other substring. */
export function matchesUrl(pageUrl, want) {
  if (!want) return true;
  const w = String(want).trim().toLowerCase();
  const u = String(pageUrl || '').toLowerCase();
  if (/^https?:\/\//.test(w)) return u.replace(/\/$/, '') === w.replace(/\/$/, '') || u.startsWith(w);
  if (w.startsWith('/') || w.startsWith('#')) {
    let loc;
    try { loc = new URL(u); } catch { return false; }
    const route = w.replace(/^#/, '').replace(/\/$/, '') || '/';
    for (const p of [loc.pathname, loc.hash.replace(/^#/, '')].filter(Boolean)) {
      const path = p.replace(/\/$/, '') || '/';
      if (path === route || (route !== '/' && path.startsWith(route + '/'))) return true;
    }
    return false;
  }
  return u.includes(w);
}

/**
 * candidates: [{ url, visibility: 'visible'|'hidden'|null, focused: bool|null, timeOrigin: number|null }]
 * Returns { index, reason } (index into candidates) or { error } — one line, safe to print.
 */
export function choosePage(candidates, { url } = {}) {
  const all = candidates.map((c, index) => ({ ...c, index }));
  const web = all.filter((c) => /^https?:/i.test(c.url || ''));
  const list = (xs) => xs.map((c) => `${c.url}${c.visibility === 'hidden' ? ' (hidden)' : ''}`).join(' | ');
  if (!web.length) return { error: 'no-page: no http(s) tab is open' };
  const pool = url ? web.filter((c) => matchesUrl(c.url, url)) : web;
  if (!pool.length) return { error: `no-match: no tab matches --url ${url}; open: ${list(web)}` };
  const shown = pool.filter((c) => c.visibility !== 'hidden');
  if (!shown.length) return { error: `hidden: every matching tab is hidden (bring the role browser window to the front); open: ${list(pool)}` };
  if (shown.length === 1) return { index: shown[0].index, reason: url ? 'url' : 'only-visible' };
  const focused = shown.filter((c) => c.focused === true);
  if (focused.length === 1) return { index: focused[0].index, reason: 'focused' };
  const timed = shown.filter((c) => Number.isFinite(c.timeOrigin)).sort((a, b) => b.timeOrigin - a.timeOrigin);
  if (timed.length === shown.length && timed[0].timeOrigin - timed[1].timeOrigin >= NEWER_MS) return { index: timed[0].index, reason: 'newest' };
  return { error: `ambiguous: ${shown.length} visible tabs — pass --url <route of the page under test>; open: ${list(shown)}` };
}

/** Reads visibility / focus / navigation time of each playwright page; a page that does not answer gets nulls. */
export async function probePages(pages) {
  return Promise.all(pages.map(async (p) => {
    const url = p.url();
    if (!/^https?:/i.test(url)) return { url, visibility: null, focused: null, timeOrigin: null };
    try {
      const r = await Promise.race([
        p.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus(), timeOrigin: performance.timeOrigin })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), PROBE_MS)),
      ]);
      return { url, ...r };
    } catch { return { url, visibility: null, focused: null, timeOrigin: null }; }
  }));
}

/** { page, reason } or { error } for a playwright browser connected over CDP. */
export async function selectPage(browser, { url } = {}) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const pick = choosePage(await probePages(pages), { url });
  return pick.error ? { error: pick.error } : { page: pages[pick.index], reason: pick.reason };
}
