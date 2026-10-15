// Shared: attach to the role browser on port 9222 (the one chrome-devtools MCP uses) through playwright-core.
// Attaching never opens or closes tabs; browser.close() afterwards only disconnects.
import path from 'node:path';
import { createRequire } from 'node:module';
import { selectPage } from './page-select.mjs';

export function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const appdata = process.env.APPDATA || '';
  const candidates = ['playwright-core', 'playwright',
    path.join(appdata, 'npm', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(appdata, 'npm', 'node_modules', 'playwright-core')];
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  throw new Error('playwright-core not found: npm i -g playwright-core, or install playwright-cli');
}

/**
 * { browser, page, reason } or { error }. Picks the page under test with page-select.mjs: http(s) only, hidden tabs
 * ignored, `url` (a route like /attendance or a URL) narrows it down; an ambiguous choice is an error, not a guess.
 */
export async function attach(cdpUrl = 'http://127.0.0.1:9222', { url } = {}) {
  let browser;
  try { browser = await loadPlaywright().chromium.connectOverCDP(cdpUrl, { timeout: 5000 }); }
  catch (e) { return { error: `no-browser cdp=${cdpUrl} detail=${e.message.split('\n')[0]}` }; }
  const pick = await selectPage(browser, { url });
  if (pick.error) { await browser.close().catch(() => {}); return { error: pick.error }; }
  return { browser, page: pick.page, reason: pick.reason };
}
