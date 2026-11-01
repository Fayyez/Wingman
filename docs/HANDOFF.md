# Handoff / Progress Log

> Purpose: let any new session (human or AI) resume work after a context/token reset.
> Keep this file short and current. Update **Status**, **Next steps** and **Session log** before stopping.

## Status

| Phase | Deliverable | State |
|---|---|---|
| 1. Scope refinement | `docs/01-product-scope.md` | ✅ Done |
| 2. Stack selection | `docs/02-tech-stack.md` | ✅ Done |
| 3a. System design | `docs/03-system-design.md` | ✅ Done |
| 3b. POC implementation plan | `docs/04-poc-implementation-plan.md` | ✅ Done |
| 3c. POC → production roadmap | `docs/05-production-roadmap.md` | ✅ Done |
| 4. POC build — M0 | code | 🟡 Engineering done; **owner actions pending** (live WA checklist, API keys) |
| 5. POC build — M1 walking skeleton | code | 🟡 In progress — backend + client store done; API client, extension UI, E2E next |

## Decisions taken (by owner, 2026-11-01)

| # | Decision | Choice |
|---|---|---|
| D1 | Language split | **TypeScript clients + Python (FastAPI) backend** |
| D2 | Chat-history storage | **Local-first** — full history on device (encrypted); server gets a request-scoped window only |
| D3 | LLM provider | **Provider-agnostic** gateway with native-SDK adapters; routing per task via config |
| D4 | POC client | **Chrome (MV3) extension on WhatsApp Web** (desktop) |

Architect decisions (see `02-tech-stack.md` for rationale): WXT + React + Shadow DOM for the extension,
Dexie/IndexedDB local store, FastAPI + Postgres/pgvector + Redis + arq, OpenAPI → generated TS client,
Langfuse for LLM tracing/evals, pnpm + uv monorepo.

## Open questions for the owner

1. **LLM cost tier** — POC defaults to `claude-opus-5-5` at low effort as the quality baseline. Production
   unit economics for PK/IN pricing likely need a cheaper tier (see cost table in `02-tech-stack.md` §6).
   Owner to decide after the M3 eval.
2. **Pricing / market** — launch Pakistan first, India first, or both? Target price point?
3. **Team & timeline** — how many devs? The POC plan assumes 1–2 full-stack devs over ~7 weeks.
4. **Example-bank curation** — who are the native-speaker curators (PK Roman Urdu + IN Hinglish)?
5. **Content policy** — how flirty/explicit may suggestions get between consenting adults? (Default: flirty OK, explicit off.)
6. **Audience** — positioning says "young men", but should onboarding/tone stay gender-neutral so anyone can use it? (Recommended: yes.)
7. **Brand** — product name "Wingman" final? Chrome Web Store listing name/assets.

## M0 status (task IDs from `04-poc-implementation-plan.md`)

| ID | State | Where / notes |
|---|---|---|
| M0-01 scaffold | ✅ | pnpm+turbo workspace, `packages/core`, `packages/platform-adapters`, `apps/extension` (WXT), `services/api` (uv, FastAPI healthz, content-scrubbing logs), Makefile |
| M0-02 compose | ✅ | `infra/docker-compose.yml`: pgvector + redis verified healthy; langfuse service defined but never started |
| M0-03 WA DOM spike | 🟡 | Automated: parser, insert, `//` interception, sanitizer, 8 real-Chromium tests + extension E2E on mock, all passing. **Live check pending:** `packages/platform-adapters/src/whatsapp-web/SPIKE.md` (L1–L12) |
| M0-04 LLM quality spike | 🟡 | `tools/spikes/llm_quality/` + 30 scenarios in `data/eval/spike/scenarios.yaml`; dry-run OK. **Needs API keys** to run live, then native-speaker blind rating |
| M0-05 embedding bake-off | 🟡 | `tools/spikes/embeddings/` + 50 items; lexical baseline R@5 0.24. **Needs keys** (or bge-m3 download) |
| M0-06 CI | ✅ | `.github/workflows/ci-ts.yml` (incl. browser job), `ci-py.yml`. Not yet observed running on GitHub |
| M0-07 go/no-go | ⏳ | After live WA checklist + LLM spike ratings |

Notable finding: the clear-after-command fallback (`execCommand('delete')`) could desync a controlled
editor and **send hidden `//` text** if the user typed quickly. Fixed and covered by a regression
test. `execCommand` insertion is disabled by default until verified live (see SPIKE.md).

## M1 status

| ID | State | Where / notes |
|---|---|---|
| M1-01 skeleton | ✅ | `app/errors.py` (JSON errors), Sentry, scrubbing logs |
| M1-02 DB | ✅ | `app/db/models.py`, Alembic `20261101_0001`; tests use real Postgres (`wingman_test`) |
| M1-03 auth | ✅ | Google + dev login, EdDSA JWT (15 min), rotating refresh tokens w/ reuse detection, `/v1/me` |
| M1-04 gateway | ✅ | `app/llm/` routes.yaml, Anthropic/OpenAI/fake, fallback-before-first-token, breaker, cost |
| M1-05 prompts | ✅ | `app/prompts/suggest/v1/*.j2` (L1–L4 cache layering) |
| M1-06 /v1/suggest | ✅ | SSE; metadata-only persistence (test asserts no chat text in DB) |
| M1-07 api-client | ✅ | `packages/api-client` generated via `make gen-api`; typed SSE; compile-time contract vs core; `contract.yml` CI |
| M1-08 core store | ✅ | Dexie + AES-GCM store, redaction, request builder (92 TS tests) |
| M1-09 WA adapter | ✅ | from M0 (live verification still pending) |
| M1-10/11 extension shell + UI | ⏳ | in progress (subagent): SW owns auth+store+API, Shadow-DOM panel, hotkeys, commands |
| M1-12 E2E demo | ⏳ | automated on mock WA + manual on real WA |

Local dev without keys: `LLM_MODE=fake` (or no keys) makes the gateway use the deterministic fake provider.

## Next steps (when resuming)

Owner (blocking M0-07):
1. Run the live WhatsApp checklist in `SPIKE.md` and send back diagnostics + sanitized fixtures.
2. Put `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`) in `.env`, then run:
   `make spike-llm ARGS="run --targets anthropic:claude-opus-5-5:low,anthropic:claude-sonnet-5-5:low,anthropic:claude-haiku-5-5:low"`
   and have a native speaker fill `out/<stamp>/ratings.csv` (blind) → `make spike-llm ARGS="summarize --run <dir>"`.
3. Answer open questions 1, 3, 4.

Engineering (can proceed now): start **M1** (M1-01 … M1-07 backend first: DB models, auth, LLM gateway
reusing `tools/spikes/llm_quality/prompt_v0.py` as the seed for `prompts/suggest/v1`).

Working style: simpler, well-specified tasks are delegated to Sonnet subagents (medium effort) on
disjoint directories; the lead session reviews, runs all checks, and commits.

## Session log

- **2026-11-01** — Repo was empty. Gathered owner decisions D1–D4. Wrote all design docs (01–05),
  `CLAUDE.md`, this handoff. No code yet.
- **2026-11-01 (cont.)** — M0 engineering: scaffold, adapter spike + tests, extension spike panel,
  backend skeleton, infra, CI, LLM + embedding spike tooling and datasets. All local checks green:
  core 13 + adapters 7 unit tests, 8 browser tests, extension E2E, 3 Python tests. Docker daemon
  was started manually in the session (`dockerd`).
