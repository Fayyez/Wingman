/** Shadow-DOM overlay: W button, command chip and side panel. Dumb view; the controller owns logic. */
import type { Tone, Tweak } from '@wingman/core';
import { CSS } from './styles';

export interface CardView {
  id: string;
  rank: number;
  kind: string;
  approach: string;
  text: string;
}

export type UiMode = 'reply' | 'topic' | 'guide' | 'rewrite' | 'auto';

export interface Analysis {
  their_mood?: string;
  energy?: string;
  interest?: string;
  boundary_signal?: boolean;
}

export interface UiState {
  open: boolean;
  commandMode: boolean;
  mode: UiMode;
  tone: Tone | null;
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error';
  analysis: Analysis | null;
  cards: CardView[];
  guide: string | null;
  error: { code: string; message: string } | null;
  /** cardId -> parts still to insert (only for multi-part cards that were started). */
  pending: Record<string, number>;
  toast: string;
}

export interface UiHandlers {
  onToggle(): void;
  onMode(m: UiMode): void;
  onTone(t: Tone): void;
  onTweak(t: Tweak): void;
  onRegenerate(): void;
  onRetry(): void;
  onSignIn(): void;
  onInsert(cardId: string): void;
  onInsertNext(cardId: string): void;
  onCopy(cardId: string): void;
}

export const initialState = (): UiState => ({
  open: false,
  commandMode: false,
  mode: 'reply',
  tone: null,
  status: 'idle',
  analysis: null,
  cards: [],
  guide: null,
  error: null,
  pending: {},
  toast: '',
});

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function vibeLine(a: Analysis | null): string {
  if (!a) return '';
  const parts = [
    a.their_mood,
    a.energy ? `${a.energy} energy` : '',
    a.interest ? `${a.interest} interest` : '',
  ].filter(Boolean);
  let line = parts.length ? `Vibe: ${parts.join(' · ')}` : '';
  if (a.boundary_signal) line += `${line ? '. ' : ''}They may want some space, so go gently.`;
  return line;
}

const MODES: [UiMode, string][] = [
  ['reply', 'Replies'],
  ['topic', 'Topics'],
  ['guide', 'Guide'],
];
const TONES: Tone[] = ['playful', 'flirty', 'sincere', 'chill'];
const TWEAKS: [Tweak, string][] = [
  ['shorter', 'Shorter'],
  ['funnier', 'Funnier'],
  ['more_flirty', 'More flirty'],
  ['more_urdu_hindi', 'More Urdu/Hindi'],
  ['more_english', 'More English'],
];

export function renderBody(s: UiState): string {
  const modes = MODES.map(
    ([m, label]) =>
      `<button class="seg" data-act="mode" data-v="${m}" aria-pressed="${s.mode === m}">${label}</button>`,
  ).join('');
  const tones = TONES.map(
    (t) =>
      `<button class="seg" data-act="tone" data-v="${t}" aria-pressed="${s.tone === t}">${t}</button>`,
  ).join('');
  const tweaks = TWEAKS.map(
    ([t, label]) => `<button class="tw" data-act="tweak" data-v="${t}">${label}</button>`,
  ).join('');

  const cards = s.cards
    .map((c, i) => {
      const left = s.pending[c.id];
      return `<div class="card" data-card="${esc(c.id)}">
  <div class="tag">${esc(c.approach || c.kind)}</div>
  <div class="txt" data-role="card-text">${esc(c.text)}</div>
  <div class="row">
    <button class="act pri" data-act="insert" data-id="${esc(c.id)}" title="Alt+${i + 1}">Insert</button>
    ${left ? `<button class="act" data-act="insert-next" data-id="${esc(c.id)}">Insert next (${left} left)</button>` : ''}
    <button class="act" data-act="copy" data-id="${esc(c.id)}">Copy</button>
  </div>
</div>`;
    })
    .join('');

  const loading = s.status === 'loading' || s.status === 'streaming';
  const skels = loading
    ? '<div class="skel" data-role="skeleton"></div>'.repeat(Math.max(0, 3 - s.cards.length))
    : '';

  let error = '';
  if (s.status === 'error' && s.error) {
    error =
      s.error.code === 'auth_required'
        ? `<div class="err" data-role="auth-required"><div>Sign in to get suggestions.</div><div class="row"><button class="act pri" data-act="signin">Sign in</button><button class="act" data-act="retry">Retry</button></div></div>`
        : `<div class="err" data-role="error"><div>${esc(s.error.message || 'Something went wrong.')}</div><div class="row"><button class="act pri" data-act="retry">Retry</button></div></div>`;
  }

  const vibe = vibeLine(s.analysis);
  const empty =
    s.status === 'idle'
      ? '<div class="empty">Press the W button or Alt+W for suggestions. Or type <b>//topic</b>, <b>//flirty</b> or <b>//? question</b> in the chat box and press Enter.</div>'
      : '';
  const actions =
    s.cards.length && s.status === 'done'
      ? `<div class="lbl">Adjust</div><div class="row"><button class="tw" data-act="regen">Regenerate</button>${tweaks}</div>`
      : '';

  return `<div class="row" data-role="modes">${modes}</div>
<div class="row" data-role="tones">${tones}</div>
${vibe ? `<div class="vibe" data-role="vibe">${esc(vibe)}</div>` : ''}
${empty}${error}${cards}${skels}
${s.guide ? `<div class="guide" data-role="guide">${esc(s.guide)}</div>` : ''}
${actions}
<div class="toast" data-role="toast">${esc(s.toast)}</div>`;
}

export interface Overlay {
  host: HTMLElement;
  root: ShadowRoot;
  getState(): UiState;
  set(patch: Partial<UiState>): void;
  destroy(): void;
}

export function createOverlay(
  doc: Document,
  handlers: UiHandlers,
  getAnchor: () => HTMLElement | null,
): Overlay {
  const host = doc.createElement('div');
  host.id = 'wingman-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
<div class="w" id="w" data-theme="auto">
  <div class="chip-cmd" id="chip">Wingman command, Enter won't send</div>
  <button class="fab" id="fab" aria-label="Wingman suggestions" title="Wingman (Alt+W)">W</button>
  <aside class="panel" id="panel" aria-label="Wingman panel">
    <div class="head"><span>Wingman</span><span class="sp"></span><button class="x" id="close" aria-label="Close panel">✕</button></div>
    <div class="scroll" id="body"></div>
    <div class="foot">Alt+W panel · Alt+1..3 insert · you always press send</div>
  </aside>
</div>`;
  (doc.body ?? doc.documentElement).appendChild(host);
  const $ = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;

  let state = initialState();

  const theme = () => {
    const cl = doc.body?.classList;
    if (cl?.contains('dark')) return 'dark';
    if (cl?.contains('web')) return 'light'; // WhatsApp sets "web" (+ "dark" in dark mode)
    return 'auto';
  };

  const layout = () => {
    $('w').dataset.theme = theme();
    const view = doc.defaultView!;
    const r = getAnchor()?.getBoundingClientRect();
    const right = state.open ? 336 : 16;
    const fab = $('fab');
    const chip = $('chip');
    if (r && r.width > 0) {
      const bottom = Math.max(8, view.innerHeight - r.top + 8);
      fab.style.right = `${right}px`;
      fab.style.bottom = `${bottom}px`;
      chip.style.left = `${Math.max(8, r.left + 16)}px`;
      chip.style.bottom = `${bottom}px`;
    } else {
      fab.style.right = `${right}px`;
      fab.style.bottom = '16px';
      chip.style.left = '16px';
      chip.style.bottom = '16px';
    }
  };

  const render = () => {
    $('panel').classList.toggle('open', state.open);
    $('chip').classList.toggle('on', state.commandMode);
    const body = $('body');
    const top = body.scrollTop;
    body.innerHTML = renderBody(state);
    body.scrollTop = top;
    layout();
  };

  // Keep focus in WhatsApp's compose box when clicking our buttons.
  root.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('button')) e.preventDefault();
  });
  root.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('button');
    if (!el) return;
    if (el.id === 'fab') return handlers.onToggle();
    if (el.id === 'close') return handlers.onToggle();
    const { act, v, id } = el.dataset;
    switch (act) {
      case 'mode':
        return handlers.onMode(v as UiMode);
      case 'tone':
        return handlers.onTone(v as Tone);
      case 'tweak':
        return handlers.onTweak(v as Tweak);
      case 'regen':
        return handlers.onRegenerate();
      case 'retry':
        return handlers.onRetry();
      case 'signin':
        return handlers.onSignIn();
      case 'insert':
        return handlers.onInsert(id!);
      case 'insert-next':
        return handlers.onInsertNext(id!);
      case 'copy':
        return handlers.onCopy(id!);
    }
  });

  const timer = doc.defaultView!.setInterval(layout, 800);
  doc.defaultView!.addEventListener('resize', layout);
  render();

  return {
    host,
    root,
    getState: () => state,
    set(patch) {
      state = { ...state, ...patch };
      render();
    },
    destroy() {
      doc.defaultView!.clearInterval(timer);
      doc.defaultView!.removeEventListener('resize', layout);
      host.remove();
    },
  };
}
