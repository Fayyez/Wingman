/** Panel logic: runs suggest over a port, folds events into UI state, handles insert/copy. */
import type {
  Controls,
  ParsedCommand,
  SuggestMode,
  SuggestTrigger,
  Tone,
  Tweak,
} from '@wingman/core';
import { InsertQueue } from '../cards';
import type { PortLike } from '../background/core';
import type { PortEvent, SuggestPortRequest } from '../messages';
import type { UiHandlers, UiMode, UiState } from '../ui/overlay';

export interface ControllerDeps {
  ui: { getState(): UiState; set(patch: Partial<UiState>): void };
  /** Inserts text into the compose box (replace). Never sends. */
  insert(text: string): Promise<boolean>;
  copy(text: string): Promise<boolean>;
  connect(): PortLike;
  getChatKey(): string | null;
  /** Make sure the active chat and visible messages are persisted before a run. */
  syncChat(): Promise<void>;
  signIn(): void;
}

type RunOpts = Omit<SuggestPortRequest, 'chatKey' | 'controls'> & { controls?: Controls };

const PANEL_MODES: SuggestMode[] = ['reply', 'topic', 'guide'];

export class Controller implements UiHandlers {
  private port: PortLike | null = null;
  private last: RunOpts | null = null;
  private queues = new Map<string, InsertQueue>();

  constructor(private readonly d: ControllerDeps) {}

  private get s() {
    return this.d.ui.getState();
  }

  // ---------- running ----------
  async run(opts: RunOpts): Promise<void> {
    this.closePort();
    this.last = opts;
    this.queues.clear();
    this.d.ui.set({
      open: true,
      status: 'loading',
      cards: [],
      guide: null,
      analysis: null,
      error: null,
      pending: {},
      toast: '',
    });
    const chatKey = this.d.getChatKey();
    if (!chatKey) return this.fail('no_chat', 'Open a chat first.');
    try {
      await this.d.syncChat();
    } catch {
      /* best effort: the SW may already hold the chat */
    }
    const port = this.d.connect();
    this.port = port;
    port.onMessage.addListener((m) => {
      if (this.port === port) this.onEvent(m as PortEvent);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      const st = this.s.status;
      if (st === 'loading' || st === 'streaming')
        this.fail('disconnected', 'Lost connection to the extension. Retry.');
    });
    const req: SuggestPortRequest = { ...opts, chatKey, controls: { ...(opts.controls ?? {}) } };
    port.postMessage(req);
  }

  /** Chat changed: drop in-flight run and stale suggestions so they can't be inserted elsewhere. */
  reset(): void {
    this.closePort();
    this.last = null;
    this.queues.clear();
    this.d.ui.set({
      status: 'idle',
      cards: [],
      guide: null,
      analysis: null,
      error: null,
      pending: {},
      toast: '',
    });
  }

  private closePort() {
    const p = this.port;
    this.port = null;
    try {
      (p as (PortLike & { disconnect?: () => void }) | null)?.disconnect?.();
    } catch {
      /* already closed */
    }
  }

  private fail(code: string, message: string) {
    this.d.ui.set({ status: 'error', error: { code, message } });
  }

  private onEvent(ev: PortEvent) {
    switch (ev.event) {
      case 'analysis':
        this.d.ui.set({ analysis: ev.data });
        break;
      case 'card': {
        const c = ev.data;
        const cards = this.s.cards.filter((x) => x.id !== c.id);
        cards.push({ id: c.id, rank: c.rank, kind: c.kind, approach: c.approach, text: c.text });
        cards.sort((a, b) => a.rank - b.rank);
        this.d.ui.set({ cards, status: 'streaming' });
        break;
      }
      case 'guide':
        this.d.ui.set({ guide: ev.data.text });
        break;
      case 'done':
        this.d.ui.set({ status: 'done' });
        this.closePort();
        break;
      case 'error':
        this.fail(ev.data.code, ev.data.message);
        this.closePort();
        break;
      default:
        break; // meta, memory (applied by the SW)
    }
  }

  // ---------- entry points ----------
  private baseControls(): Controls {
    const t = this.s.tone;
    return t ? { tone: t } : {};
  }

  private freshMode(): SuggestMode {
    const m = this.s.mode;
    return PANEL_MODES.includes(m as SuggestMode) ? (m as SuggestMode) : 'reply';
  }

  /** W button / Alt+W: toggle the panel; opening runs a fresh suggest. */
  onToggle(): void {
    if (this.s.open) {
      this.d.ui.set({ open: false });
      return;
    }
    void this.run({ mode: this.freshMode(), trigger: 'button', controls: this.baseControls() });
  }

  /** `//command` typed in the compose box. */
  runCommand(cmd: ParsedCommand): void {
    const controls: Controls = { ...this.baseControls(), ...cmd.controls };
    this.d.ui.set({ mode: cmd.mode as UiMode, tone: controls.tone ?? this.s.tone });
    void this.run({
      mode: cmd.mode,
      trigger: 'command',
      controls,
      directive: cmd.directive,
      draft: cmd.draft,
    });
  }

  onMode(m: UiMode): void {
    this.d.ui.set({ mode: m });
    void this.run({ mode: m as SuggestMode, trigger: 'button', controls: this.baseControls() });
  }

  onTone(t: Tone): void {
    const tone = this.s.tone === t ? null : t;
    this.d.ui.set({ tone });
    const controls = { ...(this.last?.controls ?? {}) };
    if (tone) controls.tone = tone;
    else delete controls.tone;
    void this.run({
      ...(this.last ?? { mode: this.freshMode() }),
      trigger: 'button',
      controls,
      tweak: undefined,
      avoid: undefined,
    });
  }

  private currentTexts(): string[] {
    return this.s.cards.map((c) => c.text);
  }

  onRegenerate(): void {
    const base = this.last ?? { mode: this.freshMode(), controls: this.baseControls() };
    void this.run({
      ...base,
      trigger: 'regenerate' as SuggestTrigger,
      tweak: undefined,
      avoid: this.currentTexts(),
    });
  }

  onTweak(t: Tweak): void {
    const base = this.last ?? { mode: this.freshMode(), controls: this.baseControls() };
    void this.run({ ...base, trigger: 'tweak', tweak: t, avoid: this.currentTexts() });
  }

  onRetry(): void {
    void this.run(
      this.last ?? { mode: this.freshMode(), trigger: 'button', controls: this.baseControls() },
    );
  }

  onSignIn(): void {
    this.d.signIn();
  }

  // ---------- card actions ----------
  private card(id: string) {
    return this.s.cards.find((c) => c.id === id);
  }

  private async insertPart(id: string, q: InsertQueue): Promise<void> {
    const part = q.next();
    if (part == null) return;
    const ok = await this.d.insert(part);
    const pending = { ...this.s.pending };
    if (ok && q.remaining > 0) pending[id] = q.remaining;
    else delete pending[id];
    this.d.ui.set({
      pending,
      toast: ok
        ? q.remaining > 0
          ? 'Inserted part 1. Send it, then insert next.'
          : 'Inserted. Press Enter to send.'
        : 'Could not insert into the chat box. Use Copy instead.',
    });
  }

  async onInsert(id: string): Promise<void> {
    const c = this.card(id);
    if (!c) return;
    const q = new InsertQueue(c.text);
    this.queues.set(id, q);
    await this.insertPart(id, q);
  }

  async onInsertNext(id: string): Promise<void> {
    const q = this.queues.get(id);
    if (q) await this.insertPart(id, q);
  }

  /** Alt+1..3 */
  async insertByIndex(n: number): Promise<void> {
    const c = this.s.cards[n - 1];
    if (c) await this.onInsert(c.id);
  }

  async onCopy(id: string): Promise<void> {
    const c = this.card(id);
    if (!c) return;
    const ok = await this.d.copy(c.text);
    this.d.ui.set({ toast: ok ? 'Copied.' : 'Copy failed.' });
  }
}
