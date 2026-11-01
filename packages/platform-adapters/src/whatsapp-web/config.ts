import type { AdapterSelectorConfig } from '@wingman/core';
import defaults from './selectors.default.json';

export interface WaSelectorConfig extends AdapterSelectorConfig {
  verified: boolean;
  main: string[];
  headerTitle: string[];
  messageRow: string[];
  incomingMarker: { class: string; dataIdPrefix: string };
  outgoingMarker: { class: string; dataIdPrefix: string };
  copyable: string[];
  textSpan: string[];
  quoted: string[];
  compose: string[];
  sendButton: string[];
  kindIcons: Record<'voice' | 'video' | 'deleted' | 'gif', string[]>;
  imageSelector: string[];
  dateOrder: 'dmy' | 'mdy';
  insertStrategies: ('paste' | 'execCommand')[];
}

export const DEFAULT_WA_CONFIG = defaults as WaSelectorConfig;

/** First match across an ordered list of fallback selectors. Invalid selectors are skipped. */
export function q1(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const s of selectors) {
    try {
      const el = root.querySelector<HTMLElement>(s);
      if (el) return el;
    } catch {
      /* invalid selector from remote config: ignore */
    }
  }
  return null;
}

/** All matches for the first selector in the list that matches anything. */
export function qAll(root: ParentNode, selectors: string[]): HTMLElement[] {
  for (const s of selectors) {
    try {
      const els = Array.from(root.querySelectorAll<HTMLElement>(s));
      if (els.length) return els;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function matchesAny(el: Element, selectors: string[]): boolean {
  return selectors.some((s) => {
    try {
      return el.matches(s);
    } catch {
      return false;
    }
  });
}
