// Best-effort E2E: load the built extension in headless Chromium against mock-wa.html.
// Run: pnpm --filter @wingman/extension build && pnpm --filter @wingman/extension test:e2e
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '../.output/chrome-mv3');
const mock = readFileSync(
  resolve(here, '../../../packages/platform-adapters/tests/browser/mock-wa.html'),
  'utf8',
);

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', // new headless mode; the default headless shell cannot load extensions
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  // The legacy debug panel is only mounted when enabled from the options page.
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(() => chrome.storage.local.set({ debugPanel: true }));
  await ctx.route('https://web.whatsapp.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: mock }),
  );
  const page = await ctx.newPage();
  await page.goto('https://web.whatsapp.com/');
  await page.waitForSelector('#wingman-spike-host', { state: 'attached', timeout: 15000 });
  const panelText = () =>
    page.evaluate(
      () =>
        document.querySelector('#wingman-spike-host').shadowRoot.getElementById('log').textContent,
    );

  await page.click('#ed');
  await page.keyboard.type('//flirty');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.__sent), [], 'command must not be sent');
  assert.match(await panelText(), /command:/, 'panel log should show the command');

  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__sent), ['hello']);
  console.log('E2E OK');
} finally {
  await ctx.close();
}
