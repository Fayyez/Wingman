/** Pure DOM → NormalizedMessage parsing for WhatsApp Web. No side effects. */
import type { Direction, MessageKind, NormalizedMessage } from '@wingman/core';
import { matchesAny, q1, qAll, type WaSelectorConfig } from './config';

export interface ParsedDataId {
  fromMe: boolean;
  chatJid: string;
  msgId: string;
  participant?: string;
}

/** data-id looks like `false_923001234567@c.us_3EB0ABC` or `true_1203…@g.us_3EB0ABC_9230…@c.us`. */
export function parseDataId(dataId: string): ParsedDataId | null {
  const m = /^(true|false)_([^_]+@[a-z.]+)_([^_]+)(?:_(.+))?$/.exec(dataId);
  if (!m) return null;
  const [, fromMe, chatJid, msgId, participant] = m;
  return {
    fromMe: fromMe === 'true',
    chatJid: chatJid!,
    msgId: msgId!,
    ...(participant ? { participant } : {}),
  };
}

export interface PrePlain {
  time: string;
  date: string;
  sender: string;
  iso: string | null;
}

/** `[10:15 pm, 01/11/2026] Ayesha: ` → parts + best-effort ISO (local time, no tz). */
export function parsePrePlainText(v: string, dateOrder: 'dmy' | 'mdy' = 'dmy'): PrePlain | null {
  const m = /^\[([^,\]]+),\s*([^\]]+)\]\s*(.*?):\s*$/.exec(v.trim() + ' ');
  if (!m) return null;
  const time = m[1]!.trim();
  const date = m[2]!.trim();
  const sender = m[3]!.trim();
  return { time, date, sender, iso: toIso(time, date, dateOrder) };
}

function toIso(time: string, date: string, order: 'dmy' | 'mdy'): string | null {
  const d = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i.exec(time);
  if (!d || !t) return null;
  const [a, b, c] = [Number(d[1]), Number(d[2]), Number(d[3])];
  let year: number, month: number, day: number;
  if (a > 31) [year, month, day] = [a, b, c];
  else {
    if (order === 'mdy' && a <= 12) [month, day] = [a, b];
    else [day, month] = [a, b];
    year = c < 100 ? 2000 + c : c;
  }
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  const ap = t[3]?.toLowerCase();
  if (ap === 'p' && hour < 12) hour += 12;
  if (ap === 'a' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}:00`;
}

/** Text content with emoji <img alt> restored and <br> as newlines. */
export function extractText(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const e = n as Element;
      const tag = e.tagName.toLowerCase();
      if (tag === 'img') out += e.getAttribute('alt') ?? '';
      else if (tag === 'br') out += '\n';
      else e.childNodes.forEach(walk);
    }
  };
  walk(el);
  return out.replace(/\u00a0/g, ' ').trim();
}

/** Top-level message rows: [data-id] elements without a [data-id] ancestor inside main. */
export function messageRows(main: ParentNode, cfg: WaSelectorConfig): HTMLElement[] {
  return qAll(main, cfg.messageRow).filter((el) => {
    const parent = el.parentElement?.closest('[data-id]');
    return !parent || !(main as Element).contains?.(parent);
  });
}

function direction(row: HTMLElement, parsed: ParsedDataId | null, cfg: WaSelectorConfig): Direction | null {
  if (row.querySelector(`.${cfg.outgoingMarker.class}`) || row.classList.contains(cfg.outgoingMarker.class))
    return 'out';
  if (row.querySelector(`.${cfg.incomingMarker.class}`) || row.classList.contains(cfg.incomingMarker.class))
    return 'in';
  if (parsed) return parsed.fromMe ? 'out' : 'in';
  return null;
}

function hasIcon(row: Element, names: string[]): boolean {
  return names.some((n) => row.querySelector(`[data-icon="${n}"]`));
}

function messageText(row: HTMLElement, cfg: WaSelectorConfig): string {
  const copy = q1(row, cfg.copyable) ?? row;
  const spans = qAll(copy, cfg.textSpan).filter(
    (s) => !cfg.quoted.some((qs) => { try { return !!s.closest(qs); } catch { return false; } }),
  );
  const last = spans[spans.length - 1];
  return last ? extractText(last) : '';
}

export function detectKind(row: HTMLElement, text: string, cfg: WaSelectorConfig): MessageKind {
  if (hasIcon(row, cfg.kindIcons.deleted)) return 'deleted';
  if (hasIcon(row, cfg.kindIcons.voice)) return 'voice';
  if (hasIcon(row, cfg.kindIcons.gif)) return 'gif';
  if (hasIcon(row, cfg.kindIcons.video)) return 'video';
  if (qAll(row, cfg.imageSelector).length) return 'image';
  if (text) return 'text';
  if (row.querySelector('img') && !q1(row, cfg.copyable)) return 'sticker';
  return 'unknown';
}

export interface ParseResult {
  chatJid: string | null;
  messages: Omit<NormalizedMessage, 'chatKey'>[];
  rowsSeen: number;
  rowsSkipped: number;
}

export function parseMessages(main: ParentNode, cfg: WaSelectorConfig): ParseResult {
  const rows = messageRows(main, cfg);
  const messages: Omit<NormalizedMessage, 'chatKey'>[] = [];
  let chatJid: string | null = null;
  let skipped = 0;
  for (const row of rows) {
    const dataId = row.getAttribute('data-id') ?? '';
    const parsed = parseDataId(dataId);
    if (parsed && !chatJid) chatJid = parsed.chatJid;
    const dir = direction(row, parsed, cfg);
    if (!dir) {
      skipped++; // date separators, system notices, unread banners
      continue;
    }
    const pre = q1(row, cfg.copyable)?.getAttribute('data-pre-plain-text');
    const meta = pre ? parsePrePlainText(pre, cfg.dateOrder) : null;
    const text = messageText(row, cfg);
    messages.push({
      id: parsed?.msgId ?? dataId,
      dir,
      kind: detectKind(row, text, cfg),
      text,
      ts: meta?.iso ?? null,
      ...(meta?.sender ? { sender: meta.sender } : {}),
    });
  }
  return { chatJid, messages, rowsSeen: rows.length, rowsSkipped: skipped };
}

export function chatTitle(doc: ParentNode, cfg: WaSelectorConfig): string | null {
  const el = q1(doc, cfg.headerTitle);
  return el ? (el.getAttribute('title') || extractText(el)) || null : null;
}

export { matchesAny };
