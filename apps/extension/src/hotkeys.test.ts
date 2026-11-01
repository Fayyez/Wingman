import { describe, expect, it } from 'vitest';
import { parseHotkey } from './hotkeys';

const k = (code: string, o: Partial<Parameters<typeof parseHotkey>[0]> = {}) =>
  parseHotkey({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...o });

describe('parseHotkey', () => {
  it('Alt+W toggles', () => expect(k('KeyW')).toEqual({ type: 'toggle' }));
  it('Alt+1..3 insert, 4 and 0 do not', () => {
    expect(k('Digit1')).toEqual({ type: 'insert', n: 1 });
    expect(k('Digit3')).toEqual({ type: 'insert', n: 3 });
    expect(k('Numpad2')).toEqual({ type: 'insert', n: 2 });
    expect(k('Digit4')).toBeNull();
    expect(k('Digit0')).toBeNull();
  });
  it('requires Alt alone', () => {
    expect(k('KeyW', { altKey: false })).toBeNull();
    expect(k('KeyW', { ctrlKey: true })).toBeNull();
    expect(k('KeyW', { shiftKey: true })).toBeNull();
    expect(k('KeyW', { metaKey: true })).toBeNull();
    expect(k('KeyQ')).toBeNull();
  });
});
