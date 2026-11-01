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
| 4. POC build — M0 spikes | code | ⏳ Not started (awaiting owner go-ahead + open questions) |

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

## Next steps (when resuming)

1. Owner answers open questions above (at least 1, 3, 4).
2. Start **M0** in `docs/04-poc-implementation-plan.md`: monorepo scaffold, WhatsApp Web DOM spike,
   LLM quality spike on 30 scenarios.
3. Record results of each spike in this file's session log.

## Session log

- **2026-11-01** — Repo was empty. Gathered owner decisions D1–D4. Wrote all design docs (01–05),
  `CLAUDE.md`, this handoff. No code yet.
