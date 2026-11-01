import type {
  AdapterEvent,
  AdapterHealth,
  AdapterSelectorConfig,
  ChatKeyFn,
  ChatRef,
  NormalizedMessage,
  PlatformAdapter,
} from '@wingman/core';
import { DEFAULT_WA_CONFIG, q1, type WaSelectorConfig } from './config';
import { findCompose, insertDraft, readDraft, type InsertResult } from './compose';
import { chatTitle, parseMessages } from './parse';

export class WhatsAppWebAdapter implements PlatformAdapter {
  readonly id = 'whatsapp_web' as const;
  readonly capabilities = {
    readHistory: true,
    observeIncoming: true,
    insertDraft: true,
    interceptCommands: true,
    overlay: 'inline-panel' as const,
  };

  private cfg: WaSelectorConfig = DEFAULT_WA_CONFIG;
  private listeners = new Set<(e: AdapterEvent) => void>();
  private observer: MutationObserver | null = null;
  private seen = new Set<string>();
  private currentChatId: string | null = null;
  private scheduled = false;
  lastInsert: InsertResult | null = null;

  constructor(
    private readonly win: Window & typeof globalThis,
    private readonly chatKey: ChatKeyFn,
  ) {}

  async init(config: AdapterSelectorConfig = DEFAULT_WA_CONFIG): Promise<void> {
    // Remote config is merged over bundled defaults so a partial/stale payload can't drop selectors.
    this.cfg = { ...DEFAULT_WA_CONFIG, ...(config as Partial<WaSelectorConfig>) };
    this.observer = new this.win.MutationObserver(() => this.schedule());
    this.observer.observe(this.win.document.body, { childList: true, subtree: true });
    this.scan();
  }

  destroy(): void {
    this.observer?.disconnect();
    this.listeners.clear();
  }

  private get doc() {
    return this.win.document;
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.win.setTimeout(() => {
      this.scheduled = false;
      this.scan();
    }, 250);
  }

  /** Diff current DOM against what we've seen; emit chat switches and new messages. */
  scan(): void {
    const chat = this.getActiveChat();
    const chatId = chat?.platformChatId ?? null;
    if (chatId !== this.currentChatId) {
      this.currentChatId = chatId;
      this.seen.clear();
      this.emit({ type: 'chat_switched', chat });
      // Messages already on screen at switch time are history, not "new".
      for (const m of this.readVisibleMessages()) this.seen.add(m.id);
      return;
    }
    if (!chat) return;
    for (const m of this.readVisibleMessages()) {
      if (this.seen.has(m.id)) continue;
      this.seen.add(m.id);
      this.emit({ type: 'message_added', chat, message: m });
    }
  }

  private emit(e: AdapterEvent) {
    for (const l of this.listeners) l(e);
  }

  onEvent(cb: (e: AdapterEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getActiveChat(): ChatRef | null {
    const main = q1(this.doc, this.cfg.main);
    if (!main) return null;
    const title = chatTitle(this.doc, this.cfg);
    const { chatJid } = parseMessages(main, this.cfg);
    const platformChatId = chatJid ?? (title ? `title:${title}` : null);
    if (!platformChatId) return null;
    return {
      platform: this.id,
      platformChatId,
      chatKey: this.chatKey(this.id, platformChatId),
      title: title ?? '',
      isGroup: platformChatId.endsWith('@g.us'),
    };
  }

  readVisibleMessages(): NormalizedMessage[] {
    const main = q1(this.doc, this.cfg.main);
    const chat = main ? this.getActiveChatKeyOnly(main) : null;
    if (!main || !chat) return [];
    return parseMessages(main, this.cfg).messages.map((m) => ({ ...m, chatKey: chat }));
  }

  private getActiveChatKeyOnly(main: Element): string | null {
    const { chatJid } = parseMessages(main, this.cfg);
    const title = chatTitle(this.doc, this.cfg);
    const id = chatJid ?? (title ? `title:${title}` : null);
    return id ? this.chatKey(this.id, id) : null;
  }

  readDraft(): string {
    const el = findCompose(this.doc, this.cfg);
    return el ? readDraft(el) : '';
  }

  async insertDraft(text: string, mode: 'replace' | 'append' = 'replace'): Promise<boolean> {
    const el = findCompose(this.doc, this.cfg);
    if (!el) return false;
    this.lastInsert = await insertDraft(el, text, mode, this.cfg.insertStrategies);
    return this.lastInsert.ok;
  }

  mountPoints() {
    const footer = findCompose(this.doc, this.cfg)?.closest('footer') ?? null;
    return { panelHost: q1(this.doc, this.cfg.main), buttonHost: footer as HTMLElement | null };
  }

  selfTest(): AdapterHealth {
    const main = q1(this.doc, this.cfg.main);
    const parsed = main ? parseMessages(main, this.cfg) : null;
    const checks = [
      { name: 'main_found', ok: !!main },
      { name: 'title_found', ok: !!chatTitle(this.doc, this.cfg) },
      { name: 'compose_found', ok: !!findCompose(this.doc, this.cfg) },
      { name: 'messages_parsed', ok: !!parsed && parsed.messages.length > 0, detail: parsed ? `${parsed.messages.length}/${parsed.rowsSeen} rows` : 'no main' },
      { name: 'chat_id_from_data_id', ok: !!parsed?.chatJid },
      { name: 'timestamps_parsed', ok: !!parsed && parsed.messages.some((m) => m.ts) },
    ];
    return { ok: checks.slice(0, 4).every((c) => c.ok), configVersion: this.cfg.version, checks };
  }
}
