import { defineContentScript } from 'wxt/utils/define-content-script';
import { makeChatKeyFn, parseCommand, type ParsedCommand } from '@wingman/core';
import { whatsappWeb } from '@wingman/platform-adapters';
const { DEFAULT_WA_CONFIG, WhatsAppWebAdapter, installCommandInterceptor } = whatsappWeb;
import { createPanel as createDebugPanel, type Panel as DebugPanel } from '../src/panel';
import { createOverlay } from '../src/ui/overlay';
import { Controller } from '../src/content/controller';
import { connectSuggest, copyText, decodeSecret, send } from '../src/content/runtime';
import { parseHotkey } from '../src/hotkeys';
import { STORAGE_KEYS } from '../src/messages';

export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  main() {
    let controller: Controller | null = null;
    let overlayApi: ReturnType<typeof createOverlay> | null = null;
    let debugPanel: DebugPanel | null = null;
    let commandMode = false;
    const queued: ParsedCommand[] = [];
    const dbg = (line: string) => debugPanel?.log(line);

    // Registered immediately so the capture-phase listener precedes WhatsApp's own.
    installCommandInterceptor(window, DEFAULT_WA_CONFIG, {
      onCommand: (raw) => {
        const cmd = parseCommand(raw);
        dbg(`command: ${JSON.stringify(cmd)}`);
        if (!cmd) return;
        if (controller) controller.runCommand(cmd);
        else queued.push(cmd);
      },
      onCommandModeChange: (active) => {
        commandMode = active;
        overlayApi?.set({ commandMode: active });
        debugPanel?.setCommandMode(active);
      },
      onClearFailed: () => dbg('clear failed (command stays in box, not sent)'),
    });

    window.addEventListener(
      'keydown',
      (e) => {
        const action = parseHotkey(e);
        if (!action || !controller) return;
        e.preventDefault();
        e.stopPropagation();
        if (action.type === 'toggle') controller.onToggle();
        else void controller.insertByIndex(action.n);
      },
      true,
    );

    const start = async () => {
      const secretReply = await send({ type: 'secret.get' });
      if (!secretReply.ok) throw new Error(secretReply.error.message);
      const adapter = new WhatsAppWebAdapter(
        window,
        makeChatKeyFn(decodeSecret(secretReply.data.secret)),
      );

      const persistChat = async () => {
        const chat = adapter.getActiveChat();
        if (!chat) return;
        await send({
          type: 'chat.upsert',
          chat: {
            chatKey: chat.chatKey,
            platform: chat.platform,
            title: chat.title,
            isGroup: chat.isGroup,
          },
        });
        const messages = adapter.readVisibleMessages();
        if (messages.length) await send({ type: 'messages.add', chatKey: chat.chatKey, messages });
      };

      const overlay = createOverlay(
        document,
        {
          onToggle: () => controller!.onToggle(),
          onMode: (m) => controller!.onMode(m),
          onTone: (t) => controller!.onTone(t),
          onTweak: (t) => controller!.onTweak(t),
          onRegenerate: () => controller!.onRegenerate(),
          onRetry: () => controller!.onRetry(),
          onSignIn: () => controller!.onSignIn(),
          onInsert: (id) => void controller!.onInsert(id),
          onInsertNext: (id) => void controller!.onInsertNext(id),
          onCopy: (id) => void controller!.onCopy(id),
        },
        () => adapter.mountPoints().buttonHost,
      );
      overlayApi = overlay;
      overlay.set({ commandMode });
      controller = new Controller({
        ui: overlay,
        insert: (text) => adapter.insertDraft(text, 'replace'),
        copy: copyText,
        connect: connectSuggest,
        getChatKey: () => adapter.getActiveChat()?.chatKey ?? null,
        syncChat: persistChat,
        signIn: () => void send({ type: 'auth.signIn' }),
      });

      adapter.onEvent((e) => {
        if (e.type === 'chat_switched') {
          dbg(`chat_switched: ${e.chat ? `${e.chat.title} ${e.chat.chatKey}` : 'none'}`);
          controller?.reset();
          if (e.chat) void persistChat();
        } else if (e.type === 'message_added') {
          dbg(`message_added: ${e.message.dir}/${e.message.kind} ${e.message.text.slice(0, 40)}`);
          void send({ type: 'messages.add', chatKey: e.chat.chatKey, messages: [e.message] });
        }
        debugPanel?.refresh();
      });
      await adapter.init();

      // Legacy debug panel: only when enabled from the options page.
      const applyDebug = (on: boolean) => {
        if (on && !debugPanel) {
          debugPanel = createDebugPanel(adapter);
          debugPanel.setCommandMode(commandMode);
        } else if (!on && debugPanel) {
          document.getElementById('wingman-spike-host')?.remove();
          debugPanel = null;
        }
      };
      try {
        const got = await chrome.storage.local.get(STORAGE_KEYS.debugPanel);
        applyDebug(got[STORAGE_KEYS.debugPanel] === true);
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && STORAGE_KEYS.debugPanel in changes)
            applyDebug(changes[STORAGE_KEYS.debugPanel]?.newValue === true);
        });
      } catch {
        /* storage unavailable */
      }

      for (const cmd of queued.splice(0)) controller.runCommand(cmd);
    };

    const run = () => void start().catch((err) => console.error('[wingman]', err));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  },
});
