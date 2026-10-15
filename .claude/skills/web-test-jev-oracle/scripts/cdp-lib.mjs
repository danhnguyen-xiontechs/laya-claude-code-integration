// Shared: attach to the role browser on port 9222 (the one chrome-devtools MCP uses) through playwright-core.
// Attaching never opens or closes tabs; browser.close() afterwards only disconnects.
import path from 'node:path';
import { createRequire } from 'node:module';

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const appdata = process.env.APPDATA || '';
  const candidates = ['playwright-core', 'playwright',
    path.join(appdata, 'npm', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(appdata, 'npm', 'node_modules', 'playwright-core')];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  throw new Error('playwright-core not found: npm i -g playwright-core, or install playwright-cli');
}

/** { browser, page } or { error }. Picks the visible http(s) tab (not devtools:// or extension pages). */
export async function attach(cdpUrl = 'http://127.0.0.1:9222') {
  let browser;
  try { browser = await loadPlaywright().chromium.connectOverCDP(cdpUrl, { timeout: 5000 }); }
  catch (e) { return { error: `no-browser cdp=${cdpUrl} detail=${e.message.split('\n')[0]}` }; }
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => /^https?:/.test(p.url()));
  let page = null;
  for (const p of pages) {
    try { if ((await p.evaluate(() => document.visibilityState)) === 'visible') { page = p; break; } } catch { /* navigating */ }
  }
  page ??= pages.at(-1) ?? null;
  if (!page) { await browser.close().catch(() => {}); return { error: 'no-page' }; }
  return { browser, page };
}
