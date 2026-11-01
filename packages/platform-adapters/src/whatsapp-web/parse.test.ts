// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeChatKeyFn } from '@wingman/core';
import { DEFAULT_WA_CONFIG as cfg } from './config';
import { parseDataId, parseMessages, parsePrePlainText } from './parse';
import { sanitizeFixture } from './sanitize';
import { WhatsAppWebAdapter } from './adapter';

const html = readFileSync(join(__dirname, 'fixtures/synthetic-chat.html'), 'utf8');

describe('parse helpers', () => {
  it('parses data-id variants', () => {
    expect(parseDataId('false_923001234567@c.us_3EB0AB')).toEqual({ fromMe: false, chatJid: '923001234567@c.us', msgId: '3EB0AB' });
    expect(parseDataId('true_120363@g.us_3EB0AB_923009999999@c.us')).toMatchObject({ fromMe: true, chatJid: '120363@g.us', participant: '923009999999@c.us' });
    expect(parseDataId('garbage')).toBeNull();
  });
  it('parses pre-plain-text in dmy and mdy, 12h and 24h', () => {
    expect(parsePrePlainText('[5:03 pm, 01/11/2026] Ayesha: ')).toMatchObject({ sender: 'Ayesha', iso: '2026-11-01T17:03:00' });
    expect(parsePrePlainText('[17:03, 11/1/2026] Ayesha: ', 'mdy')?.iso).toBe('2026-11-01T17:03:00');
    expect(parsePrePlainText('[12:10 am, 25/12/2026] Rahul Sharma: ')).toMatchObject({ sender: 'Rahul Sharma', iso: '2026-12-25T00:10:00' });
    expect(parsePrePlainText('nonsense')).toBeNull();
  });
});

describe('parseMessages on synthetic fixture', () => {
  beforeEach(() => { document.body.innerHTML = html; });

  it('reads direction, kind, text with emoji + line breaks, skips quotes and separators', () => {
    const r = parseMessages(document.querySelector('#main')!, cfg);
    expect(r.chatJid).toBe('923001234567@c.us');
    expect(r.messages.map((m) => [m.dir, m.kind])).toEqual([
      ['out', 'text'], ['in', 'text'], ['in', 'text'], ['in', 'voice'], ['out', 'image'], ['in', 'deleted'],
    ]);
    expect(r.messages[1]!.text).toBe('thak gai hun yaar viva ki tension hai 😭');
    expect(r.messages[2]!.text).toBe('aur tumhara?\nkuch khaya?');
    expect(r.messages[1]!.ts).toBe('2026-11-01T17:03:00');
  });
});

describe('WhatsAppWebAdapter', () => {
  beforeEach(() => { document.body.innerHTML = html; });
  const key = makeChatKeyFn(new Uint8Array(32).fill(1));

  it('detects active chat with hashed key and passes self-test', async () => {
    const a = new WhatsAppWebAdapter(window, key);
    await a.init();
    const chat = a.getActiveChat()!;
    expect(chat.title).toBe('Ayesha');
    expect(chat.isGroup).toBe(false);
    expect(chat.chatKey).toMatch(/^ck_/);
    expect(a.readVisibleMessages().every((m) => m.chatKey === chat.chatKey)).toBe(true);
    expect(a.selfTest().ok).toBe(true);
    a.destroy();
  });

  it('emits message_added only for new messages after init', async () => {
    const a = new WhatsAppWebAdapter(window, key);
    const events: string[] = [];
    a.onEvent((e) => events.push(e.type === 'message_added' ? `msg:${e.message.text}` : e.type));
    await a.init();
    const list = document.querySelector('[role="application"]')!;
    list.insertAdjacentHTML('beforeend', `<div role="row"><div data-id="false_923001234567@c.us_NEW1"><div class="message-in"><div class="copyable-text" data-pre-plain-text="[5:10 pm, 01/11/2026] Ayesha: "><span class="selectable-text"><span>hello?</span></span></div></div></div></div>`);
    a.scan();
    expect(events).toEqual(['chat_switched', 'msg:hello?']);
    a.destroy();
  });

  it('merges partial remote config over defaults', async () => {
    const a = new WhatsAppWebAdapter(window, key);
    await a.init({ version: 'remote-1', main: ['#nope', '#main'] });
    expect(a.selfTest()).toMatchObject({ ok: true, configVersion: 'remote-1' });
    a.destroy();
  });
});

describe('sanitizeFixture', () => {
  it('removes names, digits, text and blob urls but keeps structure', () => {
    document.body.innerHTML = html;
    const out = sanitizeFixture(document.querySelector('#main')!);
    expect(out).not.toMatch(/Ayesha|Ali|923001234567|viva|abc/);
    expect(out).toContain('data-icon="ptt-play"');
    expect(out).toContain('message-in');
    expect(out).toContain('alt="😭"');
    document.body.innerHTML = out;
    const r = parseMessages(document.querySelector('#main')!, cfg);
    expect(r.messages).toHaveLength(6); // still parseable
  });
});
