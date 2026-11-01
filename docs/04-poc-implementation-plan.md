# 04 — POC Implementation Plan

Goal: a working **Chrome extension on WhatsApp Web** plus a **FastAPI backend** that deliver
style-matched Roman Urdu/Hindi–English suggestions with memory, controls, slash commands and feedback,
used by 10–30 alpha testers.

Assumed team: 1–2 full-stack devs plus 1 part-time native-speaker curator. Duration ≈ **7 weeks**.
(Adjust after owner answers HANDOFF open question #3.)

Task IDs (`M1-07`) are stable. Reference them in commits/PRs and in `HANDOFF.md`.

---

## 1. Milestones overview

| Milestone | Weeks | Outcome | Exit gate |
|---|---|---|---|
| **M0 Foundations & spikes** | 1 | Monorepo scaffold, CI; both big unknowns de-risked: WA Web DOM control and LLM quality in Roman Urdu/Hindi | Go/no-go memo in HANDOFF |
| **M1 Walking skeleton** | 2–3 | Open chat → click W → 3 suggestions from the real LLM → insert into compose box | E2E demo on a real WA account |
| **M2 Personalization & memory** | 3–4 | Style engine v1, post-processor, per-chat memory, controls, slash commands, auto mode | "Sounds like me" ≥ 3.5 in internal test |
| **M3 Examples, feedback, evals** | 5 | Example bank (300+), retrieval, explicit + implicit feedback, eval harness + model-tier bake-off | Eval report; tier recommendation to owner |
| **M4 Safety, privacy, alpha** | 6–7 | Safety layer, redaction, deletion, remote config + kill switch, observability, alpha rollout | POC success metrics measured (01 §7) |

---

## 2. Repository layout (created in M0)

```
Wingman/
├── apps/
│   └── extension/                 # WXT + React + Tailwind (MV3)
│       ├── entrypoints/
│       │   ├── whatsapp.content.tsx      # content script, matches https://web.whatsapp.com/*
│       │   ├── background.ts             # service worker: auth, API, SSE relay, config
│       │   ├── offscreen/                # extension-origin store host (if chosen in M0-03)
│       │   ├── popup/                    # sign-in, status, quick settings
│       │   └── options/                  # full settings, memory viewer, privacy controls
│       └── wxt.config.ts
├── packages/
│   ├── core/                      # model.ts, adapter.ts, context/, commands/, style-post/, feedback/, store/
│   ├── platform-adapters/         # whatsapp-web/ (selectors.default.json, adapter.ts, fixtures/)
│   ├── ui/                        # React components: Panel, Card, Chips, WButton, Onboarding
│   └── api-client/                # generated from services/api openapi.json
├── services/
│   └── api/                       # FastAPI (uv project)
│       ├── app/ (see 03 §3)
│       ├── tests/
│       ├── alembic/
│       └── pyproject.toml
├── data/
│   ├── taxonomy/scenarios.yaml
│   ├── lexicon/variants.yaml      # Roman Urdu/Hindi spelling variants
│   ├── examples/*.yaml            # seed example bank
│   └── eval/scenarios/*.yaml      # golden + red-team scenarios
├── infra/
│   ├── docker-compose.yml         # postgres(pgvector), redis, langfuse, api, worker
│   └── deploy/                    # Fly/Render/Cloud Run config
├── tools/                         # scripts: seed, eval runner wrappers, release
├── docs/
├── .github/workflows/             # ci-ts.yml, ci-py.yml, contract.yml, eval-smoke.yml
├── package.json  pnpm-workspace.yaml  turbo.json
├── Makefile                       # dev, test, gen-api, seed, eval
└── CLAUDE.md
```

---

## 3. Task breakdown

### M0 — Foundations & spikes (week 1)
| ID | Task | Done when |
|---|---|---|
| M0-01 | Scaffold monorepo (pnpm, turbo, uv), lint/format (eslint+prettier, ruff), tsconfig/mypy strict, Makefile | `make dev` boots api + extension in watch mode |
| M0-02 | Docker Compose: Postgres 16 + pgvector, Redis 7, Langfuse | `make up` healthy |
| M0-03 | **Spike: WA Web DOM.** In a throwaway content script: detect active chat + id, parse messages (dir, text, ts, kind), observe new ones, insert text into the compose box (paste-event vs execCommand), intercept `//` + Enter without sending, back-scroll load. Choose the extension-origin store host (offscreen doc vs SW). Save 10 sanitized DOM fixtures. | Written findings + selector list in `packages/platform-adapters/whatsapp-web/SPIKE.md`; 0 accidental sends in 50 tries |
| M0-04 | **Spike: LLM quality.** 30 hand-written scenarios (PK + IN, dry reply, flirty banter, left on read, exam stress, Eid…). Run a draft prompt on 2–3 providers/tiers. Native speaker rates naturalness and Roman-script quality blind. | Score table + chosen POC default route recorded in HANDOFF |
| M0-05 | Spike: embedding bake-off on 50 Roman Urdu/Hindi pairs (bge-m3 vs 1–2 APIs) | Model chosen (ADR-09) |
| M0-06 | CI: TS lint/test/build, Python lint/type/test, contract-drift job | Green on main |
| M0-07 | Go/no-go memo | HANDOFF updated |

### M1 — Walking skeleton (weeks 2–3)
| ID | Task | Done when |
|---|---|---|
| M1-01 | Backend app skeleton: settings (pydantic-settings), structlog with content scrubbing, error model, health route, Sentry | `/healthz` 200; logs show no bodies |
| M1-02 | DB models + Alembic: users, user_settings, refresh_tokens, chat_refs, suggestion_requests, suggestions, feedback_events | migrations up/down clean |
| M1-03 | Auth: `POST /v1/auth/google` (verify ID token), JWT access/refresh rotation, `GET /v1/me` | pytest coverage of the token flows |
| M1-04 | LLM Gateway v1: `LLMProvider` protocol, Anthropic + OpenAI adapters (native SDKs), `routes.yaml`, structured output, streaming, retries/fallback, token+cost accounting, Langfuse trace (redacted) | unit tests with recorded fixtures; live smoke test behind a flag |
| M1-05 | Prompt registry + `suggest/v1` templates (L1–L4 layering, §6 of design) | renders deterministically; snapshot tests |
| M1-06 | `POST /v1/suggest` SSE: orchestrator without retrieval/safety yet; incremental JSON → `card` events | curl shows streamed cards |
| M1-07 | OpenAPI → `packages/api-client` generation + SSE event types | `pnpm gen:api` clean |
| M1-08 | `packages/core`: model, adapter contract, ConversationStore (Dexie in extension origin, AES-GCM), context builder (window + token estimate) | vitest ≥ 80 % on core |
| M1-09 | WhatsApp Web adapter v1 from the M0-03 spike: active chat, read/observe, insert, self-test; selectors from bundled JSON | fixture tests (jsdom) green |
| M1-10 | Extension shell: WXT config, background SW (auth via `chrome.identity.launchWebAuthFlow`, API client, SSE relay via `chrome.runtime.Port`), popup sign-in | sign-in works end to end |
| M1-11 | UI v1: W button near compose, Shadow-DOM side panel, 3 cards, insert, copy, regenerate, loading/error states, dark/light matching WA theme | demo video |
| M1-12 | E2E demo on a real account (manual script in `docs/qa/manual-e2e.md`) | checklist passes |

### M2 — Personalization & memory (weeks 3–4)
| ID | Task | Done when |
|---|---|---|
| M2-01 | Lexicon `data/lexicon/variants.yaml` (≥ 300 common Roman Urdu/Hindi lemmas with variants) | reviewed by curator |
| M2-02 | Style feature extractor (Python) + `style_profiles` table + `POST /v1/style/samples` + arq job; style card via `style_analysis` route; exemplar selection | profile JSON for 3 test personas looks right |
| M2-03 | Style post-processor in TS (`core/style-post`) **and** Python mirror; shared golden test vectors (`data/eval/style_post_vectors.jsonl`) | both implementations pass the same vectors |
| M2-04 | Cold start: consented back-scroll import of the user's own messages (select chats) + quiz fallback | new user gets a profile in < 2 min |
| M2-05 | Chat-level style override (≥ 30 outgoing msgs) | request uses the override when present |
| M2-06 | Per-chat memory: `/v1/memory/refresh`, client refresh policy, `memory_delta` handling, memory viewer/editor in the panel | facts survive reloads; editable |
| M2-07 | Controls UI: tone/objective/length/language chips, stage selector per chat, tweak chips, directive input | all controls change output in evals |
| M2-08 | Slash commands: parser (`//`, `//flirty`, `//topic`, `//guide`, `//fix <draft>`, `//eng`, `//urdu`, `//? <question>`), capture-phase interception, "command" chip, hotkeys (`Alt+W`, `Alt+1..3`) | 0 sends of command text in 100-try test |
| M2-09 | Auto mode: debounce, active-chat-only precompute, cache by last message id, badge | precomputed cards appear < 300 ms on panel open |
| M2-10 | Rewrite mode (`mode=rewrite`) incl. "minimal edit" variant | works from `//fix` and the panel |

### M3 — Example bank, feedback, evals (week 5)
| ID | Task | Done when |
|---|---|---|
| M3-01 | Taxonomy `scenarios.yaml` + `examples` table + seed loader + embedding job | `make seed-examples` loads ≥ 300 approved examples |
| M3-02 | Curate seed examples (curator + LLM-drafted, human-approved), PK and IN cohorts, all tones | ≥ 300 approved, ≥ 5 per leaf tag for top 30 tags |
| M3-03 | Retrieval service (tag filter → hybrid score → MMR), injected into L4 | unit tests; eval shows ≥ no regression |
| M3-04 | Feedback capture: explicit (thumbs + reasons), implicit (inserted→sent match with edit distance, regenerate, reply-received), batch flush | events visible in DB with no content |
| M3-05 | Online preference updates (`user_preferences`, spelling-map updates from edits, user-tier examples from sent-verbatim) | preference shift visible after 10 feedback events in test |
| M3-06 | Eval harness: scenario schema, 100 scenarios incl. 20 red-team, deterministic scorers + LLM-judge, report generator, CI smoke subset | `make eval` produces a report |
| M3-07 | **Model-tier bake-off** for `suggest` (top tier at low effort vs. mid vs. small vs. alternative provider): quality vs. latency vs. cost | recommendation in HANDOFF for owner decision #1 |

### M4 — Safety, privacy, alpha (weeks 6–7)
| ID | Task | Done when |
|---|---|---|
| M4-01 | Safety service: boundary/minor/abuse/self-harm rules (EN + Roman Urdu/Hindi phrase lists), directive classifier, post-checks, guide-only responses | red-team set: 0 critical failures |
| M4-02 | Client redaction (phones, emails, IDs, addresses, links) + alias handling | unit tests on 50 PII strings |
| M4-03 | Privacy: consent screens, privacy policy draft, `DELETE /v1/me`, local wipe, "forget chat", data-donation toggle (off) | manual verification |
| M4-04 | Remote config: signed `/v1/config` (selectors, flags, kill switch), client verification + fallback | selector hot-fix demo without a new build |
| M4-05 | Adapter health telemetry + alert; PostHog product events (no content) | dashboard shows insert rate, latency, health |
| M4-06 | Rate limits + per-user daily quota; cost dashboard | quota enforced |
| M4-07 | Deploy: API + worker + managed PG/Redis in the chosen region; secrets; backups | staging + prod URLs |
| M4-08 | Package extension: unlisted Chrome Web Store item (or signed CRX for testers), listing privacy disclosures | testers install in 1 click |
| M4-09 | Alpha: onboard 10–30 testers, weekly survey ("sounds like me", usefulness), bug triage | 2 weeks of data |
| M4-10 | POC review: metrics vs. targets (01 §7), go/no-go for Instagram + Android | review doc in `docs/reviews/poc-review.md` |

---

## 4. Testing strategy

| Layer | Tooling | What |
|---|---|---|
| TS unit | vitest | core (context builder, commands, style-post, redaction), store with fake-indexeddb |
| Adapter | vitest + jsdom on **saved WA Web DOM fixtures** | parsing, direction, kinds, compose detection; a fixture refresh job whenever selectors change |
| Extension E2E | Playwright with the extension loaded against a **local mock WA page** built from fixtures | panel mounts, insert works, `//` never "sends" (mock records sends) |
| Real-WA smoke | manual checklist per release (automating real WA login is brittle and risky) | `docs/qa/manual-e2e.md` |
| Python unit/integration | pytest, testcontainers (Postgres+pgvector, Redis) | auth, orchestrator with a fake LLM provider, retrieval SQL, safety rules |
| Contract | OpenAPI drift check; schemathesis fuzz on `/v1/*` | |
| LLM quality | eval harness (smoke in CI, full nightly/manual) | naturalness, style match, safety |
| Parity | shared golden vectors for TS vs Python style-post | |

---

## 5. Local development

```bash
make up            # docker compose: postgres, redis, langfuse
make api           # uv run uvicorn app.main:app --reload
make worker        # uv run arq app.workers.WorkerSettings
pnpm dev           # WXT dev: opens Chrome with the extension loaded
make gen-api       # regenerate TS client from OpenAPI
make seed          # taxonomy + lexicon + examples
make eval ROUTE=suggest
```
Env: `.env` from `.env.example` (`DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_*`, `CONFIG_SIGNING_KEY`).

---

## 6. Definition of done (every task)
- Code + tests merged on the working branch; CI green.
- No conversation content in logs or analytics (reviewed).
- Docs updated if behaviour or contract changed; `HANDOFF.md` session log updated.

## 7. POC exit criteria (from `01-product-scope.md` §7)
Insert rate ≥ 35 %, thumbs-up ≥ 70 %, "sounds like me" ≥ 4.0, p50 ≤ 2.5 s, zero command leaks,
zero critical safety failures, adapter breakage detected within 1 h. Owner decision on the production LLM tier made.

## 8. Top POC risks to watch
1. WA Web editor insertion breaks after a WA update → paste-event + execCommand fallbacks; fixtures; remote selectors.
2. Suggestion quality plateaus below "sounds like me" → invest in the post-processor + user exemplars before prompt tweaking.
3. Latency from the PK/IN region → precompute, route tiering, streaming the first card.
4. Tester privacy concerns → transparent memory viewer, local-first messaging in onboarding.
