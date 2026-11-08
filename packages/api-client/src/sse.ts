export interface RawSseEvent {
  event: string;
  data: string;
}

/** Incremental SSE parser. Feed decoded text; yields complete events. */
export class SseParser {
  private buf = '';

  push(chunk: string): RawSseEvent[] {
    this.buf += chunk;
    // Normalise line endings; a trailing lone \r may be half of a \r\n, keep it buffered.
    let text = this.buf;
    let tail = '';
    if (text.endsWith('\r')) {
      tail = '\r';
      text = text.slice(0, -1);
    }
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const out: RawSseEvent[] = [];
    let idx: number;
    while ((idx = text.indexOf('\n\n')) !== -1) {
      const ev = parseBlock(text.slice(0, idx));
      if (ev) out.push(ev);
      text = text.slice(idx + 2);
    }
    this.buf = text + tail;
    return out;
  }

  /** Flush a final unterminated block at end of stream. */
  end(): RawSseEvent[] {
    const text = this.buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    this.buf = '';
    const ev = parseBlock(text);
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): RawSseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const c = line.indexOf(':');
    const field = c === -1 ? line : line.slice(0, c);
    let value = c === -1 ? '' : line.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}
