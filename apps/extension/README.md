# @wingman/extension (M1 shell + UI)

Chrome MV3 extension (WXT, TypeScript) that overlays reply / topic / guide suggestions inside
WhatsApp Web. It only ever **inserts** text into the compose box; the user always presses send.

## Architecture

- `entrypoints/background.ts` (service worker, via `src/background/core.ts`): auth, the
  `DexieConversationStore` (extension origin, never the page origin), install secret, API calls and
  the SSE relay. Content script talks to it via typed messages (`src/messages.ts`) and a
  `chrome.runtime.Port` named `suggest`.
- `entrypoints/whatsapp.content.ts`: `//command` interceptor (registered at `document_start`),
  WhatsApp adapter, Shadow-DOM overlay (`src/ui`), controller (`src/content/controller.ts`).
- `entrypoints/popup`: sign-in state, dev login, sign out, API URL. `entrypoints/options`: debug
  panel toggle and "forget all local data".
- Tokens: access token in `chrome.storage.session`, refresh token in `chrome.storage.local`.
  Chat history lives only in the extension's IndexedDB. The only network target is the API origin.

## Dev setup

1. Start Postgres and the backend (fake LLM, no keys needed):

       docker compose -f infra/docker-compose.yml up -d postgres
       cd services/api && uv run alembic upgrade head
       APP_ENV=dev LLM_MODE=fake uv run uvicorn app.main:create_app --factory --port 8000

2. Build the extension (env vars are read at build time):

       WXT_API_URL=http://localhost:8000 WXT_DEV_LOGIN=true \
         pnpm --filter @wingman/extension build

   | Variable | Meaning |
   |---|---|
   | `WXT_API_URL` | API base URL (default `http://localhost:8000`). Also the only `host_permissions` origin. |
   | `WXT_DEV_LOGIN` | `true` enables email-only dev login in a production build (always on in `wxt` dev mode). |
   | `WXT_GOOGLE_CLIENT_ID` | Enables Google sign-in via `chrome.identity.launchWebAuthFlow` (adds the `identity` permission). Needs a web OAuth client whose redirect URI is `https://<extension-id>.chromiumapp.org/`. Not testable in CI. |

3. `chrome://extensions` -> Developer mode -> Load unpacked -> `apps/extension/.output/chrome-mv3`.
4. Click the toolbar icon, enter any email under "Dev login".
5. Open https://web.whatsapp.com/, open a chat, click the green **W** button (or `Alt+W`).

`pnpm --filter @wingman/extension dev` gives a live-reload build.

## Using it

- **W button / Alt+W**: toggle the side panel; opening it fetches fresh suggestions.
- **Alt+1..3**: insert card n. **Insert** replaces the compose text; cards with several lines insert
  the first line and offer "Insert next". **Copy** copies the text.
- Panel: Replies / Topics / Guide, tone chips, Regenerate, tweak chips (shorter, funnier, more
  flirty, more Urdu/Hindi, more English).
- **Commands**: type `//topic`, `//flirty`, `//fix <draft>`, `//? question`, ... and press Enter. The
  text is never sent (a "Wingman command" chip shows while typing one).
- Auto-suggest on incoming messages is off in M1.
- Debug panel (adapter self-test, event log): enable it on the options page.

## Tests

    pnpm --filter @wingman/extension typecheck
    pnpm --filter @wingman/extension lint
    pnpm --filter @wingman/extension test        # vitest: SW handlers, controller, cards, hotkeys
    pnpm --filter @wingman/extension build && pnpm --filter @wingman/extension test:e2e

`test:e2e` runs `tests/e2e-mock.mjs` (debug panel + command safety against the default build) and
`tests/e2e-suggest.mjs`, which starts the real backend on port 8099 (`uv run uvicorn`, fake LLM,
`wingman_test` database, must be migrated), builds the extension into `.output/e2e` with
`WXT_API_URL=http://localhost:8099 WXT_DEV_LOGIN=true`, drives Chromium against the mock WhatsApp page
(dev login, W button -> 3 cards, Insert does not send, Enter sends exactly the card text, `//topic`
sends nothing, hotkeys, signed-out prompt) and shuts the server down. Override with `E2E_API_PORT` /
`E2E_DATABASE_URL`.
