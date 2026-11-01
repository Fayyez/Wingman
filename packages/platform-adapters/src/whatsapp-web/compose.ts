/**
 * Compose-box interaction. WhatsApp Web uses a rich-text editor (Lexical) that keeps its own
 * model, so writing textContent directly does not work: we go through the events the editor
 * listens to (paste, beforeinput via execCommand) and verify by reading back.
 */
import { q1, type WaSelectorConfig } from './config';

export function findCompose(doc: Document, cfg: WaSelectorConfig): HTMLElement | null {
  return q1(doc, cfg.compose);
}

export function readDraft(el: HTMLElement): string {
  // innerText respects <p>/<br> line breaks in real browsers; jsdom lacks it.
  const raw = typeof el.innerText === 'string' && el.innerText !== '' ? el.innerText : el.textContent ?? '';
  return raw.replace(/\u00a0/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

function selectAllIn(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretAtEnd(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (!sel) return;
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export type InsertStrategy = 'paste' | 'execCommand' | 'none';

export interface InsertResult {
  ok: boolean;
  strategy: InsertStrategy;
}

function tryPaste(el: HTMLElement, text: string): void {
  const win = el.ownerDocument.defaultView;
  if (!win || typeof win.DataTransfer !== 'function' || typeof win.ClipboardEvent !== 'function') return;
  const dt = new win.DataTransfer();
  dt.setData('text/plain', text);
  el.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}

function tryExec(el: HTMLElement, text: string): void {
  // Deprecated but still the most reliable way to produce trusted-like beforeinput/input events.
  el.ownerDocument.execCommand?.('insertText', false, text);
}

const STRATEGIES: Record<Exclude<InsertStrategy, 'none'>, (e: HTMLElement, t: string) => void> = {
  paste: tryPaste,
  execCommand: tryExec,
};

/**
 * Insert text into the compose box. Never sends. `strategies` comes from the selector config:
 * default is paste-only; execCommand must be verified on the live editor (SPIKE.md) before it is
 * enabled, because it can desync a controlled editor's model from the DOM.
 */
export async function insertDraft(
  el: HTMLElement,
  text: string,
  mode: 'replace' | 'append' = 'replace',
  strategies: Exclude<InsertStrategy, 'none'>[] = ['paste'],
): Promise<InsertResult> {
  el.focus();
  const before = readDraft(el);
  for (const name of strategies) {
    const fn = STRATEGIES[name];
    if (mode === 'replace') selectAllIn(el);
    else placeCaretAtEnd(el);
    fn(el, text);
    await nextFrame(el);
    const now = readDraft(el);
    const expected = mode === 'replace' ? text.trim() : `${before}${text}`.trim();
    if (now === expected || (now.includes(text.trim()) && now !== before)) return { ok: true, strategy: name };
  }
  return { ok: false, strategy: 'none' };
}

/**
 * Clear the compose box through editor-visible events ONLY.
 * Never use execCommand('delete') here: in Chromium it mutates the DOM without beforeinput, so a
 * controlled editor (Lexical) can keep the old text in its model while the DOM looks empty. If
 * that happens after the user resumed typing, Enter would send hidden text (regression test:
 * "fast typing after a command"). If clearing fails we leave the command text in place: the
 * interceptor still blocks it, which is safe.
 */
export async function clearDraft(el: HTMLElement): Promise<boolean> {
  el.focus();
  const win = el.ownerDocument.defaultView;
  if (!win || typeof win.InputEvent !== 'function') return false;
  selectAllIn(el);
  el.dispatchEvent(
    new win.InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }),
  );
  await nextFrame(el);
  return readDraft(el) === '';
}

function nextFrame(el: HTMLElement): Promise<void> {
  const win = el.ownerDocument.defaultView;
  return new Promise((r) => (win?.requestAnimationFrame ? win.requestAnimationFrame(() => r()) : setTimeout(r, 0)));
}
