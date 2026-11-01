# 02 — Technology Stack (ADR-style)

Status: Accepted for POC · Constraints from owner: TS clients, Python backend, local-first, provider-agnostic LLM, Chrome extension on WhatsApp Web.

## 1. Stack at a glance

```
┌──────────────────────────── Clients (TypeScript) ────────────────────────────┐
│ POC:   Chrome MV3 extension  — WXT · React 18 · Tailwind · Shadow DOM · Zustand │
│        local store: Dexie (IndexedDB) + WebCrypto AES-GCM                     │
│ Later: Mobile app shell — React Native (Expo, dev-client)                     │
│        Android native: Kotlin (IME keyboard, NotificationListener, A11y, bubble)│
│        iOS native: Swift (Keyboard extension, Share extension + Vision OCR)    │
│ Shared: packages/core (models, context builder, command parser, style post-   │
│         processor), packages/api-client (generated from OpenAPI)             │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ HTTPS · JWT · JSON + SSE streaming
┌──────────────────────────── Backend (Python 3.12) ───────────────────────────┐
│ FastAPI · Pydantic v2 · Uvicorn  │ arq workers (Redis)                       │
│ LLM Gateway (own, native SDKs: anthropic, openai, …) · Jinja2 prompt registry  │
│ SQLAlchemy 2 + Alembic · Postgres 16 + pgvector · Redis 7                    │
│ Langfuse (LLM traces, prompt versions, eval scores) · Sentry · structlog      │
└──────────────────────────────────────────────────────────────────────────────┘
Tooling: pnpm workspaces + Turborepo (TS) · uv (Python) · Docker Compose · GitHub Actions
Hosting (POC): single region close to PK/IN (Mumbai/ap-south-1 or Singapore) on a managed container
platform (Fly.io / Render / Cloud Run) + managed Postgres with pgvector (Neon/Supabase/RDS)
```

## 2. Decisions

### ADR-01 Extension framework: **WXT** (over Plasmo or hand-rolled Vite)
- **Why**: MV3-first, Vite-based, typed manifest, HMR for content scripts, one codebase builds for
  Chrome/Edge/Firefox/Safari (useful for the roadmap), actively maintained, framework-agnostic (React fine).
- **Alternatives**: Plasmo (slower maintenance pace, more magic); CRXJS + Vite (less batteries); raw webpack (toil).
- **Consequence**: content script + background service worker + options page all live in `apps/extension`.

### ADR-02 Overlay UI: **React + Tailwind inside a Shadow DOM root**
- WhatsApp Web's CSS must not leak into our panel, and ours must not leak into theirs. Shadow DOM
  isolates both ways. WXT's `createShadowRootUi` handles mounting.
- Zustand for state (tiny, no providers, works fine in content scripts).
- UI components go in `packages/ui` so React Native can reuse logic/hooks (not the DOM components themselves).

### ADR-03 Local-first store: **Dexie.js over IndexedDB, AES-GCM encryption of message text**
- Owner decision D2. Full per-chat history, summaries, facts and the feedback queue live on the device.
- Message `text` fields are encrypted with a per-install AES-GCM key (WebCrypto, non-extractable,
  stored in IndexedDB). This protects against casual inspection and disk dumps, **not** against
  malware in the same browser profile. Stated honestly in the privacy policy.
- Mobile later: SQLite (op-sqlite / expo-sqlite) with SQLCipher; keys in Keychain/Keystore. The
  `ConversationStore` interface in `packages/core` hides the backend.

### ADR-04 Backend: **Python 3.12 + FastAPI + Pydantic v2** (owner decision D1)
- Async-native, first-class SSE streaming, automatic **OpenAPI 3.1**, the best ML/NLP ecosystem
  (tokenizers, embeddings, eval tooling, future fine-tuning), and Pydantic schemas double as LLM
  structured-output schemas.
- Packaging: **uv** (fast, lockfile). Lint/format: ruff. Types: mypy (strict on `app/`). Tests: pytest + pytest-asyncio.

### ADR-05 Cross-language contract: **OpenAPI-generated TS types**
- Avoids the main cost of a TS+Python split (duplicated schemas). FastAPI emits `openapi.json`;
  `openapi-typescript` + `openapi-fetch` generate a typed client into `packages/api-client`.
- CI job fails if the generated client is out of date (`pnpm gen:api && git diff --exit-code`).
- SSE event payloads are declared as Pydantic models and exported via a `components.schemas` stub route,
  so they are typed on the client too.

### ADR-06 Database: **PostgreSQL 16 + pgvector**; cache/queue: **Redis 7**
- One database for relational data (users, settings, style profiles, feedback, experiments) **and** vector
  search over the example bank (HNSW index). At our scale (≤ millions of examples) a separate vector DB isn't justified.
- Redis: rate limiting, short-lived suggestion cache, arq job queue, remote-config cache.
- Migrations: Alembic. ORM: SQLAlchemy 2.0 async.

### ADR-07 Background jobs: **arq** (asyncio + Redis)
- Jobs: style-profile recompute, example-bank embedding, nightly feedback aggregation, eval runs.
- Lighter than Celery and shares the async codebase. Swap to Celery/Temporal only if workflows get complex.

### ADR-08 LLM access: **in-house LLM Gateway with native provider SDKs** (owner decision D3)
- A thin internal package (`app/llm`) with one interface:
  ```python
  class LLMProvider(Protocol):
      async def generate(self, req: LLMRequest) -> LLMResult: ...          # structured output
      def stream(self, req: LLMRequest) -> AsyncIterator[LLMEvent]: ...
  ```
  Adapters: `AnthropicProvider` (official `anthropic` SDK), `OpenAIProvider` (official `openai` SDK),
  optional `GeminiProvider` / `SelfHostedProvider` (vLLM, OpenAI-compatible endpoint, for a future fine-tuned model).
- **Why not LiteLLM?** It lags provider-specific features we depend on: prompt-cache breakpoints,
  native structured outputs, refusal/fallback semantics, effort controls. A ~400-line gateway
  over native SDKs keeps these first-class. LiteLLM is fine for quick experiments in notebooks.
- **Routing table in config** (`llm_routes.yaml`), per task, with ordered fallbacks across providers:
  ```yaml
  suggest:        { primary: anthropic:claude-opus-5-5, effort: low,    fallback: [openai:<model>] }
  rewrite:        { primary: anthropic:claude-opus-5-5, effort: low }
  memory_refresh: { primary: anthropic:claude-opus-5-5, effort: low }
  style_analysis: { primary: anthropic:claude-opus-5-5, effort: medium }
  safety_classify:{ primary: anthropic:claude-opus-5-5, effort: low }
  judge_eval:     { primary: anthropic:claude-opus-5-5, effort: medium }
  ```
  Model choice for each route is decided by the eval harness (ADR-12), not by code changes.
- Gateway duties: retries/timeouts, cross-provider fallback, structured-output normalization
  (Anthropic `output_config.format` / OpenAI `response_format` JSON-schema), prompt-cache
  breakpoint placement, token/cost accounting, refusal handling (`stop_reason == "refusal"` →
  route fallback; on Claude also the server-side `fallbacks: "default"` beta), Langfuse tracing with redaction.
- Provider notes that shape the prompt design:
  - Current Claude models removed `temperature`/`top_p` and assistant prefill. **Diversity across the 3
    suggestions comes from the prompt + schema** (each card must use a different `approach`), not from sampling params.
  - Use structured outputs for the response shape (no prefill tricks).
  - Prompt caching is prefix-based. Order prompt blocks from most stable to least stable (design §6.1).

### ADR-09 Embeddings: **provider-agnostic, multilingual**; retrieval is **tag-first, vector-second**
- Roman Urdu/Hindi is transliterated text that embedding models handle unevenly. So retrieval
  **filters by scenario tags + locale + tone first** (precise, cheap), then ranks by vector similarity.
- Candidates for the M0 bake-off: `BAAI/bge-m3` (self-hostable, multilingual), Voyage multilingual,
  OpenAI `text-embedding-3-small`. Store `embedding_model` with each vector so the model can be swapped and re-embedded.

### ADR-10 Auth: **Google OAuth (via `chrome.identity`) → backend-issued JWT**
- POC: one-click Google sign-in in the extension. The backend verifies the Google ID token and issues
  a short-lived access JWT (15 min) + refresh token (30 d, rotating, stored hashed).
- Production adds **phone OTP** (very common in PK/IN) and Apple sign-in (required on iOS if Google is offered).

### ADR-11 Observability
- **structlog** JSON logs with a content-scrubbing processor (message text is never logged).
- **Sentry** for the extension and backend (with `beforeSend` scrubbing).
- **Langfuse** (self-hosted) for LLM traces, prompt versions, latency/cost, eval scores. Inputs are
  stored only as redacted/hashed form unless the user opted into data donation.
- Product analytics: **PostHog** (self-host or EU cloud), events only, no content.

### ADR-12 Quality: **eval harness as a first-class component**
- `data/eval/` golden scenarios (YAML: context, controls, persona style, expected qualities).
- Scorers: deterministic (length, emoji count, style-feature distance, forbidden "AI-tells" like
  em-dashes and "I hope this message finds you well"), LLM-as-judge rubric (naturalness, style
  match, relevance, safety, cultural fit), and periodic human native-speaker review.
- Runs in CI on any change under `prompts/` or `llm_routes.yaml`; the result is posted as a report.

### ADR-13 Monorepo: **pnpm workspaces + Turborepo** (TS) alongside **uv** (Python)
- Single repo (this one) keeps the contract, prompts, data and clients in sync. Layout in `04-poc-implementation-plan.md` §2.

### ADR-14 Mobile (future, decided now so the POC doesn't block it)
- **React Native (Expo with custom dev client + config plugins)** for the app shell: onboarding,
  settings, chat history viewer, paywall. It reuses `packages/core` and `packages/api-client` unchanged.
- **Native modules where the OS requires them**, because these can't be JS:
  - Android (Kotlin): `InputMethodService` keyboard with a suggestion strip; `NotificationListenerService`
    to capture incoming messages; optional `AccessibilityService` + overlay bubble (policy-sensitive, see roadmap).
  - iOS (Swift): Custom Keyboard Extension (needs Full Access for network); Share Extension with Vision OCR for screenshots; App Group shared storage.
- Keyboard extensions have tight memory limits, so the keyboard UI is native (Kotlin/Swift) and talks
  to the API directly, while sharing **schemas and prompt behaviour** (all server-side), not UI code.

### ADR-15 Hosting & region
- POC: Docker image on a managed container platform in **Mumbai (ap-south-1) or Singapore**, managed
  Postgres with pgvector, managed Redis. Latency is dominated by the LLM call, so the region choice is mostly about data residency.
- Production: AWS (ECS Fargate or EKS) or GCP (Cloud Run) in Mumbai, with IaC (Terraform). India's
  DPDP Act allows cross-border transfer except to notified countries. Keep PK and IN user data in-region
  where feasible and review before launch.

## 3. Rejected alternatives (summary)

| Option | Why not (for now) |
|---|---|
| Electron wrapper for WhatsApp/IG | Heavier. Counts as a third-party client. Users must abandon their browser. Reconsider only for a native-desktop UX later. |
| WhatsApp Business / Cloud API | Only for business numbers, not personal chats |
| Instagram Messaging API | Only for business/creator accounts with page linkage; can't read personal DMs |
| Unofficial WA libs (Baileys, whatsapp-web.js) | Automation on a separate session → high ban risk, ToS violation, server holds raw chats |
| Node/NestJS backend | Rejected by owner decision D1 (Python preferred for the ML roadmap) |
| Dedicated vector DB (Pinecone/Qdrant) | pgvector is enough at our scale; one less system |
| LangChain/LlamaIndex | Abstraction overhead for a single well-defined pipeline; hurts control over caching and streaming |
| Flutter for mobile | Would split the client stack away from TS; RN reuses `packages/core` |

## 4. Versions (pin at scaffold time)
Node 22 LTS · pnpm 9 · TypeScript 5.x · WXT latest stable · React 18/19 · Python 3.12 · FastAPI latest ·
Pydantic 2.x · SQLAlchemy 2.x · Postgres 16 · pgvector ≥ 0.7 · Redis 7.

## 5. Security baseline
TLS everywhere. JWT (EdDSA) with rotating refresh tokens. Per-user rate limits (Redis token bucket).
Extension permissions limited to `storage`, `identity` and host permission `https://web.whatsapp.com/*`.
CSP without remote code (MV3 rule): remote config is **JSON data only**. Secrets in the platform secret
manager. Dependabot + `pip-audit`/`pnpm audit` in CI.

## 6. LLM cost model and the open tier decision

List prices as of Oct 2026 (USD per 1M tokens; verify before budgeting). Per-request assumption for `/suggest`:
~4.0k input tokens (~2.5k of them cache-hits: system prompt + style block), ~150 output tokens per
card × 3 + ~150 analysis ≈ 600 output tokens incl. light thinking at low effort.

| Model (route candidate) | In / Out / Cache-read | ≈ $ per suggestion request | 30 req/day/user → $/user/month |
|---|---|---|---|
| `claude-opus-5-5` (POC default, quality ceiling) | $4 / $20 / $0.20 | ~$0.018 | ~$16 |
| `claude-sonnet-5-5` | $2 / $10 / $0.20 | ~$0.009 | ~$8 |
| `claude-haiku-5-5` | $0.10 / $0.50 / — | ~$0.0006 | ~$0.55 |
| Other providers' small models / self-hosted fine-tune | varies | evaluate | evaluate |

**Implication.** Consumer price points in PK/IN (roughly PKR 500–1,500 or INR 150–400 per month)
can't carry the top tier at heavy usage. The POC uses the most capable model at low effort as the
**quality baseline**. The owner decides the production tier after the M3 eval compares tiers on the
golden set (open question #1). The gateway makes this a config change. Other levers: only precompute
for the *active* chat, cache aggressively, cap free-tier requests, distil into a fine-tuned small model later.
