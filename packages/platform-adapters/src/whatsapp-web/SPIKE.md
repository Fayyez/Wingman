# M0-03 Spike: WhatsApp Web DOM control

Status: **automated part done (mock + real Chromium); live-account validation pending (owner)**.

## What is already proven (automated, `pnpm --filter @wingman/platform-adapters test` / `test:browser`)

Against `tests/browser/mock-wa.html`, a mock of WA's compose behaviour: a *controlled* editor like
Lexical that ignores direct DOM writes and sends on Enter / send-button click.

| Capability | Result |
|---|---|
| Parse rows: direction, kind (text/voice/image/deleted/sticker), text incl. emoji `<img alt>` and line breaks, skip quoted message + date separators | ✅ (jsdom, synthetic fixture) |
| Timestamp + sender from `data-pre-plain-text` (dmy/mdy, 12h/24h) | ✅ |
| Chat id from `data-id` JID; hashed `chatKey` (no phone number leaves the device) | ✅ |
| `message_added` only for new rows; `chat_switched` on change | ✅ |
| Direct `textContent` writes do **not** reach a controlled editor | ✅ (confirms we must use events) |
| `insertDraft` replace/append via synthetic `paste` event | ✅ strategy `paste` |
| `//cmd` + Enter intercepted, cleared, never sent — 50/50 mixed commands | ✅ |
| `//cmd` + send-button click intercepted | ✅ |
| Fast typing right after a command never sends hidden text | ✅ (regression for a real bug found and fixed, below) |
| Normal messages unaffected | ✅ |
| Built extension loads in Chromium and intercepts on a routed `https://web.whatsapp.com/` mock | ✅ (`apps/extension` `test:e2e`) |

### Bug found and fixed during the spike
`execCommand('delete')` (the old clear fallback) mutates the DOM **without** a `beforeinput`
event. A controlled editor then keeps the text in its model while the DOM looks empty. If the
user starts typing before the fallback fires, the next Enter sends hidden `//` text. Fix: clear
only through `beforeinput`. If clearing fails, leave the command visible, since the interceptor still blocks it.
`execCommand` insertion is now **off by default** (`insertStrategies: ["paste"]` in config) and
needs live verification before it is enabled.

## Still unverified (needs a live WhatsApp Web session)
Every selector in `selectors.default.json` is from public knowledge of WA's DOM (`"verified": false`).
Key assumptions:
1. Message rows carry `data-id="{true|false}_{jid}_{msgId}[_{participant}]"`.
2. `.message-in` / `.message-out` classes mark direction.
3. `.copyable-text[data-pre-plain-text]` holds `[time, date] Sender: `; text lives in `span.selectable-text`.
4. Compose is `footer div[contenteditable=true][role=textbox]` and accepts a synthetic `paste`.
5. Our window capture-phase keydown runs **before** WA's handler (content script at `document_start`).
6. `data-icon` names for voice/video/deleted/gif.

## Live validation checklist (owner, ~20 minutes, use a test chat with a friend)
1. `pnpm install && pnpm --filter @wingman/extension build`
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/.output/chrome-mv3`
3. Open https://web.whatsapp.com, open a 1:1 chat. A small **Wingman (spike)** panel appears bottom-left.
4. Check each item and note pass/fail:

| # | Step | Pass if |
|---|---|---|
| L1 | Look at **Self-test** | all ✓ (main, title, compose, messages_parsed, chat_id_from_data_id, timestamps_parsed) |
| L2 | Compare the last 8 messages in the panel with the chat | direction, text, emojis correct; voice/photo/deleted show right kind |
| L3 | Switch to another chat and back | `chat_switched` logged with the right title; chatKey stable for the same chat |
| L4 | Ask the friend to send a message | one `message_added` per new message, none for old ones |
| L5 | Click **Insert test text** | text appears in the box, **nothing is sent**; then press Enter yourself → it sends exactly that text |
| L6 | Type `//flirty`, press Enter | **not sent**; box clears; log shows the parsed command; chip shows while typing |
| L7 | Type `//topic`, click WA's send button | not sent |
| L8 | Type `//` then immediately type a normal message and send | only the normal message is sent |
| L9 | Repeat L6 twenty times quickly with different commands | 0 sends |
| L10 | Group chat: open one | `isGroup` true in log title/key line; messages parsed with sender |
| L11 | Scroll up to load older messages | panel still parses; no errors in DevTools console |
| L12 | Click **Download sanitized fixture** on 3 different chats (incl. one with voice/photo/reply) | files download; open one and confirm no names/numbers/text |

5. Send back: the **Copy diagnostics** JSON, pass/fail per row, and the sanitized fixtures
   (commit them to `src/whatsapp-web/fixtures/real-*.html`). If something fails, open DevTools
   on the failing element and note its attributes. Selector fixes go in `selectors.default.json`
   (and later the remote config), not code.

**If L6–L9 fail at all, the slash-command feature stays disabled** (flag) until fixed. The panel, button
and hotkeys don't depend on it.
