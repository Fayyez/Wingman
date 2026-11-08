// M1-12 automated E2E: real FastAPI backend (fake LLM) + built extension + mock WhatsApp Web.
// Run: pnpm --filter @wingman/extension test:e2e   (requires Postgres with the migrated wingman_test DB)
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(here, '..');
const repo = resolve(here, '../../..');
const PORT = process.env.E2E_API_PORT || '8099';
const API = `http://localhost:${PORT}`;
const DB =
  process.env.E2E_DATABASE_URL ||
  'postgresql+asyncpg://wingman:wingman@localhost:5432/wingman_test';
const mock = readFileSync(
  resolve(repo, 'packages/platform-adapters/tests/browser/mock-wa.html'),
  'utf8',
);

let server;
let ctx;
const stopServer = () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
};
process.on('exit', stopServer);

async function startServer() {
  server = spawn('uv', ['run', 'uvicorn', 'app.main:create_app', '--factory', '--port', PORT], {
    cwd: resolve(repo, 'services/api'),
    env: { ...process.env, APP_ENV: 'dev', LLM_MODE: 'fake', DATABASE_URL: DB },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`backend did not start:\n${log}`);
}

function buildExtension() {
  const outDir = '.output/e2e';
  execFileSync('pnpm', ['exec', 'wxt', 'build'], {
    cwd: extDir,
    stdio: 'inherit',
    env: { ...process.env, WXT_API_URL: API, WXT_DEV_LOGIN: 'true', WXT_OUT_DIR: outDir },
  });
  return resolve(extDir, outDir, 'chrome-mv3');
}

const host = (page) => page.locator('#wingman-host');
const cardTexts = (page) => page.locator('#wingman-host [data-role=card-text]').allTextContents();

try {
  await startServer();
  const ext = buildExtension();

  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium', // new headless mode; the default headless shell cannot load extensions
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://web.whatsapp.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: mock }),
  );
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;

  // --- sign in through the popup (dev login) ---
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.fill('#dev-email', 'e2e@example.com');
  await popup.click('#dev button[type=submit]');
  await popup.waitForSelector('#signed-in:not([hidden])');
  assert.equal(await popup.textContent('#email'), 'e2e@example.com');
  assert.equal(await popup.textContent('#api'), API);
  await popup.close();

  // --- WhatsApp mock with some chat content ---
  const page = await ctx.newPage();
  await page.goto('https://web.whatsapp.com/');
  await host(page).waitFor({ state: 'attached', timeout: 15000 });
  await page.click('#ed');
  await page.keyboard.type('kesa gaya din?');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__sent), ['kesa gaya din?']);
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.innerHTML =
      '<div data-id="false_923001234567@c.us_IN1"><div class="message-in"><div class="copyable-text" data-pre-plain-text="[5:03 pm, 01/11/2026] Ayesha: "><span class="selectable-text"><span>thak gai hun yaar viva ki tension hai</span></span></div></div></div>';
    document.getElementById('list').appendChild(row);
  });
  await page.waitForTimeout(800); // adapter debounce + persist round-trips to the SW store

  // --- W button -> 3 cards ---
  await page.locator('#wingman-host #fab').click();
  await page.locator('#wingman-host .card').nth(2).waitFor({ timeout: 20000 });
  await page.locator('#wingman-host [data-role=skeleton]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#wingman-host .card').count(), 3);
  assert.match(
    (await page.locator('#wingman-host [data-role=vibe]').textContent()) ?? '',
    /^Vibe:/,
  );
  const texts = await cardTexts(page);
  assert.ok(texts.every((t) => t.length > 0));

  // --- Insert card 1: editor gets the text, nothing is sent ---
  await page.locator('#wingman-host [data-act=insert]').first().click();
  await page.waitForFunction((t) => window.__state() === t, texts[0]);
  assert.equal(await page.evaluate(() => window.__state()), texts[0]);
  assert.deepEqual(
    await page.evaluate(() => window.__sent),
    ['kesa gaya din?'],
    'insert must not send',
  );

  // --- user presses Enter -> exactly that text is sent ---
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__sent.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__sent), ['kesa gaya din?', texts[0]]);

  // --- //topic + Enter: cards appear, nothing sent ---
  const sentBefore = await page.evaluate(() => window.__sent.length);
  await page.click('#ed');
  await page.keyboard.type('//topic');
  assert.equal(
    await page.locator('#wingman-host #chip').evaluate((e) => e.classList.contains('on')),
    true,
    'command chip visible',
  );
  await page.keyboard.press('Enter');
  await page.locator('#wingman-host [data-act=mode][data-v=topic][aria-pressed=true]').waitFor();
  await page.locator('#wingman-host .card').nth(2).waitFor({ timeout: 20000 });
  await page.locator('#wingman-host [data-role=skeleton]').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => window.__sent.length),
    sentBefore,
    'command must not be sent',
  );
  assert.equal(await page.evaluate(() => window.__state()), '', 'command text cleared');

  // --- hotkeys: Alt+1 inserts card 1; Alt+W closes the panel ---
  const topicTexts = await cardTexts(page);
  await page.keyboard.press('Alt+1');
  await page.waitForFunction((t) => window.__state() === t, topicTexts[0]);
  assert.equal(await page.evaluate(() => window.__sent.length), sentBefore);
  await page.keyboard.press('Alt+W');
  assert.equal(
    await page.locator('#wingman-host #panel').evaluate((e) => e.classList.contains('open')),
    false,
  );

  // --- signed out -> Sign in prompt ---
  await sw.evaluate(() =>
    chrome.storage.session
      .remove('accessToken')
      .then(() => chrome.storage.local.remove('refreshToken')),
  );
  await page.keyboard.press('Alt+W');
  await page.locator('#wingman-host [data-role=auth-required]').waitFor({ timeout: 10000 });

  console.log('E2E suggest OK');
} finally {
  await ctx?.close().catch(() => undefined);
  stopServer();
}
