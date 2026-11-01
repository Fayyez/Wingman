/**
 * Slash-command interception. Registered on window in the CAPTURE phase so it runs before the
 * editor's own keydown handler (which sends on Enter). Content script should run at
 * document_start so our listener is registered before WhatsApp's own window-level listeners.
 *
 * Safety invariant: a draft that starts with `//` is never sent by Enter or the send button
 * while this interceptor is installed.
 */
import { isCommand } from '@wingman/core';
import { matchesAny, type WaSelectorConfig } from './config';
import { clearDraft, findCompose, readDraft } from './compose';

export interface InterceptorHandlers {
  onCommand: (raw: string) => void;
  /** true while the draft is a command (UI shows "Wingman command, Enter won't send"). */
  onCommandModeChange?: (active: boolean) => void;
  /** Clearing the command text failed; it stays in the box (still blocked from sending). */
  onClearFailed?: () => void;
}

export function installCommandInterceptor(
  win: Window & typeof globalThis,
  cfg: WaSelectorConfig,
  handlers: InterceptorHandlers,
): () => void {
  const doc = win.document;
  let commandMode = false;

  const composeFor = (target: EventTarget | null): HTMLElement | null => {
    const compose = findCompose(doc, cfg);
    if (!compose || !(target instanceof win.Node)) return null;
    return compose === target || compose.contains(target) ? compose : null;
  };

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
  };

  const fire = (compose: HTMLElement) => {
    const raw = readDraft(compose);
    void clearDraft(compose).then((ok) => {
      if (ok) setMode(false);
      else handlers.onClearFailed?.();
    });
    handlers.onCommand(raw);
  };

  const setMode = (active: boolean) => {
    if (active !== commandMode) {
      commandMode = active;
      handlers.onCommandModeChange?.(active);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const compose = composeFor(e.target);
    if (!compose) return;
    if (!isCommand(readDraft(compose))) return;
    swallow(e);
    fire(compose);
  };

  const onSendClick = (e: Event) => {
    if (!(e.target instanceof win.Element)) return;
    const btn = e.target.closest('button, [role="button"], span[data-icon]');
    if (!btn) return;
    const isSend = matchesAny(btn, cfg.sendButton) || cfg.sendButton.some((s) => { try { return !!e.target && (e.target as Element).closest(s); } catch { return false; } });
    if (!isSend) return;
    const compose = findCompose(doc, cfg);
    if (!compose || !isCommand(readDraft(compose))) return;
    swallow(e);
    if (e.type === 'click') fire(compose);
  };

  // Controlled editors cancel beforeinput, so native `input` may never fire: also check on keyup
  // and after paste (next frame, once the editor has applied it).
  const onInput = (e: Event) => {
    const compose = composeFor(e.target);
    if (!compose) return;
    const check = () => setMode(isCommand(readDraft(compose)));
    if (e.type === 'paste') win.requestAnimationFrame(check);
    else check();
  };
  const INPUT_EVENTS = ['input', 'keyup', 'paste'] as const;

  const opts = { capture: true } as const;
  win.addEventListener('keydown', onKeyDown, opts);
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const)
    win.addEventListener(t, onSendClick, opts);
  for (const t of INPUT_EVENTS) win.addEventListener(t, onInput, opts);

  return () => {
    win.removeEventListener('keydown', onKeyDown, opts);
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const)
      win.removeEventListener(t, onSendClick, opts);
    for (const t of INPUT_EVENTS) win.removeEventListener(t, onInput, opts);
  };
}
