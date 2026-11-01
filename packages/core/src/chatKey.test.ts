import { describe, expect, it } from 'vitest';
import { makeChatKeyFn } from './chatKey';

describe('chatKey', () => {
  const secret = new Uint8Array(32).fill(7);
  it('is deterministic, prefixed and does not leak the id', () => {
    const f = makeChatKeyFn(secret);
    const k = f('whatsapp_web', '923001234567@c.us');
    expect(k).toBe(f('whatsapp_web', '923001234567@c.us'));
    expect(k).toMatch(/^ck_[0-9a-f]{32}$/);
    expect(k).not.toContain('923001234567');
  });
  it('differs per platform and per secret', () => {
    const f = makeChatKeyFn(secret);
    const g = makeChatKeyFn(new Uint8Array(32).fill(8));
    expect(f('whatsapp_web', 'x')).not.toBe(f('instagram_web', 'x'));
    expect(f('whatsapp_web', 'x')).not.toBe(g('whatsapp_web', 'x'));
  });
});
