/** Multi-part card insertion: a card containing newlines is sent as several messages. */

/** Split on line breaks into non-empty trimmed parts. */
export function splitParts(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Tracks which part of a (possibly multi-part) card is to be inserted next.
 * Single-part cards are inserted whole (internal spacing untouched).
 */
export class InsertQueue {
  private readonly parts: string[];
  private idx = 0;

  constructor(text: string) {
    const parts = splitParts(text);
    this.parts = parts.length ? parts : [text];
  }

  /** The next part to insert, or null when exhausted. */
  next(): string | null {
    if (this.idx >= this.parts.length) return null;
    return this.parts[this.idx++] ?? null;
  }

  get remaining(): number {
    return this.parts.length - this.idx;
  }

  get started(): boolean {
    return this.idx > 0;
  }
}
