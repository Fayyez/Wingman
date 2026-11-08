/** Keyboard shortcuts: Alt+W toggles the panel and runs suggest; Alt+1..3 inserts card n. */
export type HotkeyAction = { type: 'toggle' } | { type: 'insert'; n: 1 | 2 | 3 };

export interface KeyLike {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  code: string;
  key?: string;
}

export function parseHotkey(e: KeyLike): HotkeyAction | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  // Use `code`: on macOS Alt+letter produces a different `key` character.
  if (e.code === 'KeyW') return { type: 'toggle' };
  const m = /^Digit([1-3])$/.exec(e.code) ?? /^Numpad([1-3])$/.exec(e.code);
  if (m) return { type: 'insert', n: Number(m[1]) as 1 | 2 | 3 };
  return null;
}
