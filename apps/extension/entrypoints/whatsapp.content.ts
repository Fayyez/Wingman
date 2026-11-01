import { defineContentScript } from 'wxt/utils/define-content-script';
import { makeChatKeyFn, parseCommand } from '@wingman/core';
import { whatsappWeb } from '@wingman/platform-adapters';
const { DEFAULT_WA_CONFIG, WhatsAppWebAdapter, installCommandInterceptor } = whatsappWeb;
import { createPanel } from '../src/panel';

async function getSecret(): Promise<Uint8Array> {
  const KEY = 'installSecret';
  const got = await chrome.storage.local.get(KEY);
  const existing = got[KEY];
  if (typeof existing === 'string') {
    const bin = atob(existing);
    if (bin.length === 32) return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  await chrome.storage.local.set({ [KEY]: btoa(String.fromCharCode(...bytes)) });
  return bytes;
}

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    // Panel state is created lazily once the DOM exists; early events are buffered.
    const pending: Array<(p: ReturnType<typeof createPanel>) => void> = [];
    let panel: ReturnType<typeof createPanel> | null = null;
    const withPanel = (fn: (p: ReturnType<typeof createPanel>) => void) =>
      panel ? fn(panel) : pending.push(fn);

    // Registered immediately so the capture-phase listener precedes WhatsApp's own.
    installCommandInterceptor(window, DEFAULT_WA_CONFIG, {
      onCommand: (raw) => withPanel((p) => p.log(`command: ${JSON.stringify(parseCommand(raw))}`)),
      onCommandModeChange: (active) => withPanel((p) => p.setCommandMode(active)),
      onClearFailed: () => withPanel((p) => p.log('clear failed (command stays in box, not sent)')),
    });

    const start = async () => {
      const secret = await getSecret();
      const adapter = new WhatsAppWebAdapter(window, makeChatKeyFn(secret));
      panel = createPanel(adapter);
      for (const fn of pending.splice(0)) fn(panel);
      adapter.onEvent((e) => {
        if (e.type === 'chat_switched')
          panel?.log(`chat_switched: ${e.chat ? `${e.chat.title} ${e.chat.chatKey}` : 'none'}`);
        else if (e.type === 'message_added')
          panel?.log(
            `message_added: ${e.message.dir}/${e.message.kind} ${e.message.text.slice(0, 40)}`,
          );
        panel?.refresh();
      });
      await adapter.init();
      panel.refresh();
    };

    const run = () => void start().catch((err) => console.error('[wingman-spike]', err));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  },
});
