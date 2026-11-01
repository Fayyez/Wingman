# @wingman/extension (M0-03 spike)

Debug-only Chrome extension that validates the WhatsApp Web adapter on a real session.

## Build and load

    pnpm install
    pnpm --filter @wingman/extension build

Then open `chrome://extensions`, enable Developer mode, click "Load unpacked" and select
`apps/extension/.output/chrome-mv3`. Open https://web.whatsapp.com/ (the content script runs at
`document_start`). Use `pnpm --filter @wingman/extension dev` for a live-reload dev build.

## The panel (bottom-left, collapsible)

- Config version and `verified` flag
- Self-test checks (pass/fail with detail)
- Active chat title and chatKey
- Last 8 parsed messages (direction, kind, timestamp, text truncated to 60 chars)
- Last insert strategy, and a scrolling event log (50 lines)
- A chip "Wingman command, Enter won't send" while the draft starts with `//`
- Buttons: Self-test, Insert test text, Download sanitized fixture (`wa-fixture-<timestamp>.html`),
  Copy diagnostics (JSON, no message text)

## Safety

The extension never sends messages (it only inserts draft text; you press send) and makes no
network requests. Message text is shown locally only; the only persisted value is the random
install secret in `chrome.storage.local`.

## E2E smoke (mock page)

    pnpm --filter @wingman/extension build && pnpm --filter @wingman/extension test:e2e
