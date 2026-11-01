/**
 * Produce a privacy-safe DOM fixture from a live WhatsApp Web page, for adapter tests.
 * Keeps structure, tags, classes, roles, data-icon/data-testid; scrubs every text node,
 * names, phone numbers, image sources and free-text attributes.
 */
const KEEP_ATTRS = new Set(['class', 'role', 'data-icon', 'data-testid', 'data-tab', 'contenteditable', 'dir', 'tabindex', 'type']);
const SAFE_LABELS = /^(send|voice message|emoji|attach|type a message|message list|menu|search|quoted message|back|close|more|reply|forward|delete|copy|star|react|chat list)$/i;

function scrubText(s: string): string {
  // Preserve length class and whitespace, replace letters/digits.
  return s.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '0');
}

function scrubDataId(v: string): string {
  return v.replace(/\d/g, '0').replace(/_([A-F0-9]{6,})/gi, (_m, id: string) => '_' + 'A'.repeat(Math.min(id.length, 12)));
}

export function sanitizeFixture(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  const walker = clone.ownerDocument.createTreeWalker(clone, 0x1 | 0x4); // elements + text
  const nodes: Node[] = [clone];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (n.nodeType === 3) {
      n.nodeValue = scrubText(n.nodeValue ?? '');
      continue;
    }
    const el = n as Element;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (name === 'data-id') el.setAttribute(name, scrubDataId(attr.value));
      else if (name === 'data-pre-plain-text') el.setAttribute(name, attr.value.replace(/\]\s*(.*?):\s*$/, '] Contact: ').replace(/\d/g, (d) => d));
      else if (name === 'aria-label') { if (!SAFE_LABELS.test(attr.value.trim())) el.setAttribute(name, '[label]'); }
      else if (name === 'title') el.setAttribute(name, '[title]');
      else if (name === 'alt') { if (!/^\p{Extended_Pictographic}/u.test(attr.value)) el.setAttribute(name, '[alt]'); }
      else if (name === 'src' || name === 'srcset' || name === 'href') el.setAttribute(name, name === 'src' && attr.value.startsWith('blob:') ? 'blob:fixture' : '');
      else if (name === 'id') { if (/\d/.test(attr.value)) el.removeAttribute(name); }
      else if (name === 'style') el.removeAttribute(name);
      else if (!KEEP_ATTRS.has(name) && !name.startsWith('aria-')) el.removeAttribute(name);
    }
  }
  return clone.outerHTML;
}
