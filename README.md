# Wingman

An in-chat conversation co-pilot for WhatsApp and Instagram. Wingman suggests **1–3 human-sounding
replies, topic ideas or "what to do next" tips** that match *your* texting style, in Roman Urdu/Hindi +
English. It is built for young Pakistani and Indian texters in the talking stage.

> Status: **design complete, POC not started.** See [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Design documents
| # | Doc | What's inside |
|---|---|---|
| 1 | [Product scope](docs/01-product-scope.md) | Refined scope, personas, features, controls, POC vs prod, metrics, risks |
| 2 | [Tech stack](docs/02-tech-stack.md) | ADRs: WXT extension, FastAPI, Postgres+pgvector, provider-agnostic LLM gateway, mobile choices, cost model |
| 3 | [System design](docs/03-system-design.md) | Architecture, adapters, data model, API, suggestion pipeline, prompts, style engine, memory, example bank, feedback, safety, privacy |
| 4 | [POC implementation plan](docs/04-poc-implementation-plan.md) | 7-week milestones M0–M4 with task IDs, repo layout, testing, exit criteria |
| 5 | [Production roadmap](docs/05-production-roadmap.md) | Instagram, Android, iOS, more platforms, sync, scale, ML, monetization, compliance |

## Architecture in one picture
```
WhatsApp Web ─▶ Chrome extension (TS) ──HTTPS/SSE──▶ FastAPI (Python) ──▶ LLM gateway ─▶ Anthropic / OpenAI / self-hosted
                 │ adapter · overlay UI                │ style · retrieval · safety · feedback
                 └ local encrypted chat history        └ Postgres + pgvector · Redis
```
