/* Shared Playwright helpers for Spanish Vocab tests.
   Usage: const { launch, SITE } = require('./helpers');
   const { browser, page, errors } = await launch({ viewport });  // errors[] collects console errors + pageerrors
*/
const path = require('path');
const { chromium } = require('playwright');

const SITE = 'file://' + path.resolve(__dirname, '..', 'index.html');

async function launch(opts) {
  opts = opts || {};
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    hasTouch: !!opts.touch,
    isMobile: !!opts.mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const txt = m.text();
      // Ignore network noise from fonts / missing optional files when offline
      if (/fonts\.googleapis|fonts\.gstatic|net::ERR|Failed to load resource/.test(txt)) return;
      errors.push('console: ' + txt);
    }
  });
  if (opts.blockFonts !== false) {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  }
  return { browser, context, page, errors };
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

module.exports = { launch, assert, SITE };
