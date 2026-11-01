/** Platform adapter contract (docs/03-system-design.md §2.2). */
import type { ChatRef, NormalizedMessage, PlatformId } from './model';

export interface AdapterCapabilities {
  readHistory: boolean;
  observeIncoming: boolean;
  insertDraft: boolean;
  interceptCommands: boolean;
  overlay: 'inline-panel' | 'bubble' | 'keyboard-strip' | 'none';
}

/** Selector/heuristic config delivered as data (remote-updatable, never code). */
export interface AdapterSelectorConfig {
  version: string;
  [key: string]: unknown;
}

export type AdapterEvent =
  | { type: 'chat_switched'; chat: ChatRef | null }
  | { type: 'message_added'; chat: ChatRef; message: NormalizedMessage }
  | { type: 'draft_changed'; text: string }
  | { type: 'command'; raw: string };

export interface AdapterHealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface AdapterHealth {
  ok: boolean;
  configVersion: string;
  checks: AdapterHealthCheck[];
}

export type InsertMode = 'replace' | 'append';

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly capabilities: AdapterCapabilities;
  init(config: AdapterSelectorConfig): Promise<void>;
  getActiveChat(): ChatRef | null;
  readVisibleMessages(): NormalizedMessage[];
  loadOlder?(maxMessages: number): Promise<NormalizedMessage[]>;
  onEvent(cb: (e: AdapterEvent) => void): () => void;
  readDraft(): string;
  insertDraft(text: string, mode: InsertMode): Promise<boolean>;
  mountPoints(): { panelHost: HTMLElement | null; buttonHost: HTMLElement | null };
  selfTest(): AdapterHealth;
}
