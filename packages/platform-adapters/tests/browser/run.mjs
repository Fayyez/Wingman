// Real-Chromium tests for compose insertion + command interception against mock-wa.html.
// Run: pnpm --filter @wingman/platform-adapters test:browser
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
let browser, page, bundle;

before(async () => {
  const out = await build({ entryPoints: [join(here, 'entry.ts')], bundle: true, write: false, format: 'iife', target: 'chrome120' });
  bundle = out.outputFiles[0].text;
  browser = await chromium.launch();
});
after(async () => browser?.close());

async function fresh() {
  page = await browser.newPage();
  await page.setContent(readFileSync(join(here, 'mock-wa.html'), 'utf8'));
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.__commands = [];
    window.__modes = [];
    window.__wingman.installCommandInterceptor(window, window.__wingman.DEFAULT_WA_CONFIG, {
      onCommand: (c) => window.__commands.push(c),
      onCommandModeChange: (m) => window.__modes.push(m),
    });
  });
  await page.click('#ed');
}
const sent = () => page.evaluate(() => window.__sent);
const state = () => page.evaluate(() => window.__state());

test('direct DOM writes do not reach a controlled editor (why we need events)', async () => {
  await fresh();
  await page.evaluate(() => window.__setDomDirectly('hello'));
  assert.equal(await state(), '');
  await page.close();
});

test('insertDraft replaces the draft via editor events and never sends', async () => {
  await fresh();
  await page.keyboard.type('purana draft');
  const res = await page.evaluate(async () => {
    const w = window.__wingman;
    const el = w.findCompose(document, w.DEFAULT_WA_CONFIG);
    return w.insertDraft(el, 'viva ke baad chai pe chalein? 😄', 'replace');
  });
  assert.equal(res.ok, true);
  console.log('    insert strategy:', res.strategy);
  assert.equal(await state(), 'viva ke baad chai pe chalein? 😄');
  assert.deepEqual(await sent(), []);
  await page.keyboard.press('Enter'); // user sends manually
  assert.deepEqual(await sent(), ['viva ke baad chai pe chalein? 😄']);
  await page.close();
});

test('append mode keeps existing text', async () => {
  await fresh();
  await page.keyboard.type('haha ');
  const res = await page.evaluate(async () => {
    const w = window.__wingman;
    return w.insertDraft(w.findCompose(document, w.DEFAULT_WA_CONFIG), 'acha sun', 'append');
  });
  assert.equal(res.ok, true);
  assert.equal(await state(), 'haha acha sun');
  await page.close();
});

test('//command + Enter is intercepted, cleared, never sent (50 tries, mixed commands)', async () => {
  await fresh();
  const cmds = ['//', '//flirty', '//topic', '//ask out', '//fix kia kar rahi ho', '//? she left me on read', '//eng'];
  for (let i = 0; i < 50; i++) {
    await page.keyboard.type(cmds[i % cmds.length]);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__state() === '');
  }
  assert.deepEqual(await sent(), []);
  const commands = await page.evaluate(() => window.__commands);
  assert.equal(commands.length, 50);
  assert.equal(commands[1], '//flirty');
  const modes = await page.evaluate(() => window.__modes);
  assert.ok(modes.includes(true), 'command mode chip signal fired');
  await page.close();
});

test('fast typing right after a command never sends hidden text (regression)', async () => {
  await fresh();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.type('//topic');
    await page.keyboard.press('Enter');
    // no waiting: the user immediately types the next real message
    await page.keyboard.type(`msg ${i}`);
    await page.keyboard.press('Enter');
  }
  const s = await sent();
  assert.ok(s.every((m) => !m.includes('//')), `command text leaked: ${JSON.stringify(s)}`);
  assert.ok(s.every((m) => /^msg \d+$/.test(m)), `unexpected sends: ${JSON.stringify(s)}`);
  await page.close();
});

test('//command + send-button click is intercepted', async () => {
  await fresh();
  await page.keyboard.type('//topic');
  await page.click('#send');
  await page.waitForFunction(() => window.__state() === '');
  assert.deepEqual(await sent(), []);
  assert.deepEqual(await page.evaluate(() => window.__commands), ['//topic']);
  await page.close();
});

test('normal messages still send with Enter and button (interceptor is transparent)', async () => {
  await fresh();
  await page.keyboard.type('haha acha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('https://example.com //not a command');
  await page.click('#send');
  assert.deepEqual(await sent(), ['haha acha', 'https://example.com //not a command']);
  assert.deepEqual(await page.evaluate(() => window.__commands), []);
  await page.close();
});

test('adapter parses messages the user sent in the mock', async () => {
  await fresh();
  await page.keyboard.type('kesa gaya din?');
  await page.keyboard.press('Enter');
  const msgs = await page.evaluate(() => window.__wingman.parseMessages(document.querySelector('#main'), window.__wingman.DEFAULT_WA_CONFIG).messages);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].dir, 'out');
  assert.equal(msgs[0].text, 'kesa gaya din?');
  await page.close();
});
