# 01 — Product Scope (Refined)

Status: Draft v1 · Owner decisions D1–D4 applied (see `HANDOFF.md`)

## 1. Product statement

**Wingman** is an in-chat conversation co-pilot. While you text on WhatsApp or Instagram, it reads the
conversation you have open and offers **1–3 ready-to-send replies, topic ideas, or a short "what to do
next" tip**. The suggestions sound like you: same Roman Urdu/Hindi–English mix, spellings, slang, emoji
habits and message length.

It is built for South Asian (Pakistani/Indian) young adults who text in code-mixed Roman script
("haha acha so tum bhi chai lover ho? 😄") and want help keeping conversations natural and engaging,
especially in the **talking stage**.

### Positioning principles
1. **Assist, never impersonate.** Wingman never sends anything. The user inserts, edits and sends.
2. **Sound human, sound like *you*.** Anything that reads like a chatbot ("Hey there! 😊 How's your day
   going?") counts as a failure.
3. **Read the room.** Suggestions follow the other person's mood, energy and interest, and the user's
   chosen tone and goal.
4. **Healthy by design.** No manipulation scripts. Respect "no". Steer toward genuine connection.
5. **Private by default.** Chat history stays on the user's device.

## 2. Target users

| Persona | Description | Key needs |
|---|---|---|
| **P1 "Talking-stage Ali/Arjun"** (primary) | 18–28, PK/IN, university or early career, texts in Roman Urdu/Hindi + English, talking to a potential partner met via Instagram, friends or dating apps | Keep the convo from dying, avoid dry replies, know when to ask her out, recover from awkward moments |
| **P2 "Overthinker"** | Any gender, anxious about how they come across | Sanity-check a draft ("is this too much?"), rewrite in a better tone |
| **P3 "Socially busy"** (later) | Wants help across friends and family chats (Eid wishes, condolences, catching up) | Quick, appropriate, culturally aware replies |

The product copy can target P1, but onboarding, tone and the safety model stay **gender-neutral**
(open question #6 in HANDOFF).

## 3. Jobs to be done → features

| # | Job | Feature | Req. ref |
|---|---|---|---|
| J1 | "They replied. What do I say?" | **Reply suggestions** (1–3, different approaches) | core |
| J2 | "The convo is dying / dry replies" | **Topic ideas** with an opener line for each, drawn from chat history + culture (cricket, chai, exams, Coke Studio, Eid, Diwali, food, travel…) | core |
| J3 | "What should I *do* now?" | **Next-move guide**: one or two lines of strategy ("She's replying short. Give it space and text tomorrow evening with something about her exam") | core |
| J4 | "Make it more flirty / shorter / in English" | **Controls**: tone, objective, length, language mix; quick tweak buttons; free-text directive | R3 |
| J5 | "Sound like me" | **Style engine**: learns the user's texting style globally and per chat | R1 |
| J6 | "Remember what we talked about" | **Per-chat memory**: local message history + rolling summary + key facts (her exam date, favourite food, inside jokes) | R2 |
| J7 | "Fix my draft" | **Rewrite mode**: improve the user's own draft without losing their voice | R3/R5 |
| J8 | "This suggestion sucks / this was perfect" | **Feedback**: thumbs, reason chips, plus implicit signals (inserted, edited, sent, got a reply) | R3 |
| J9 | "Don't leave the chat" | **In-chat overlay**: panel next to the chat, a button by the compose box, slash commands typed in the compose box, hotkeys | R4/R5 |
| J10 | "Use it everywhere" | **Platform adapters**: WhatsApp Web (POC), then Instagram Web, Android, iOS, others | R4/R6 |
| J11 | "Human-sounding examples" | **Example bank**: curated, tagged by scenario, at three levels (global / locale cohort / user) | R7 |

### Controls vocabulary (v1)
- **Tone**: `chill` · `playful` · `flirty` · `sweet` · `sincere/deep` · `funny` · `apologetic` · `confident`
- **Objective**: `keep_going` · `build_rapport` · `deepen` · `flirt_up` · `ask_out` · `recover` (after awkward/left on read) · `slow_down` · `end_gracefully`
- **Length**: `one_liner` · `short` · `normal`
- **Language mix**: `auto` (mirror the user and chat) · `more_urdu_hindi` · `more_english`
- **Relationship stage** (per chat, user-set or inferred): `just_matched` · `talking` · `close` · `dating` · `friend`

### Output types (per suggestion card)
```
kind: reply | topic | guide
text: "haha acha toh exam ke baad treat pakki? 😄"   # ready to send (reply/topic)
approach: "playful callback"                          # why this one is different
note: optional one-line rationale (shown on hover)
```
A response normally has **3 reply cards**, or **2 replies + 1 topic**, plus an optional **guide** line and
an optional **vibe read** (their estimated interest/mood as a soft signal, never a "score" of a person).

## 4. Interaction model (inside the chat)

| Mode | Trigger | Behaviour |
|---|---|---|
| **Auto** | New incoming message, after a 1.5 s debounce for message bursts | Suggestions are pre-computed silently; a subtle badge on the W button signals they're ready. Never pops up uninvited. |
| **On demand** | Click the **W** button / `Alt+W` | Opens the panel with fresh suggestions |
| **Slash command** | Type in the WhatsApp compose box, e.g. `//flirty`, `//topic`, `//ask out`, `//fix <draft>`, `//eng`, `//? she left me on read` | Extension intercepts Enter, clears the box, runs the command. Never sends the command text. |
| **Insert** | Click a card / `Alt+1..3` | Puts the text into the compose box. The user can edit, then presses Enter to send. |
| **Tweak** | Chips on the panel: *shorter · funnier · more flirty · more Urdu · more English · regenerate* | Regenerates with a delta instruction |

## 5. Scope by stage

### 5.1 POC (this phase)
- **Platform**: Desktop Chrome-family browsers (Chrome, Edge, Brave) on **web.whatsapp.com**, 1:1 chats only.
- **Content**: text messages. Media, voice notes, stickers and deleted messages appear as placeholders (`[photo]`, `[voice note 0:12]`).
- **Features**: J1–J9 complete. J10 = WhatsApp Web adapter only, built behind the generic adapter interface. J11 = global bank (~300–500 curated examples) + user-level bank (accepted suggestions).
- **Accounts**: Google sign-in, 18+ self-attestation, English UI.
- **Users**: internal alpha, 10–30 testers. Unlisted Chrome Web Store item or unpacked extension.
- **Languages**: Roman Urdu, Roman Hindi, English, mixed. Urdu Nastaliq and Devanagari scripts are passed through but not optimised.

### 5.2 Explicit non-goals for the POC
Instagram, mobile apps, group chats, auto-send of any kind, voice-note transcription, image/story
understanding, cross-device sync, payments, admin dashboard (scripts instead), languages beyond the
ones above, native WhatsApp Desktop app (we target WhatsApp Web only).

### 5.3 Production (future, see `05-production-roadmap.md`)
Instagram Web → Android (keyboard + notification listener + optional accessibility overlay) → iOS
(keyboard + share-screenshot) → Telegram/Messenger/dating apps. Adds E2E-encrypted sync, subscriptions
(local payment rails), voice-note/image understanding, cost-optimised and fine-tuned models.

## 6. Requirements → how scope covers them

| Req | Coverage | Notes |
|---|---|---|
| R1 Texting-style conformity | Style engine: deterministic feature profile + LLM style card + user exemplars + **post-processor** that rewrites spellings, casing and punctuation to the user's habits. Global profile plus per-chat overrides. | Cold start: import the user's own sent messages from open chats (with consent) or a 6-question "which would you send?" quiz. |
| R2 Per-chat history | Local encrypted message store per chat + rolling summary + key facts. Server stays stateless about chat content. | History starts when the extension sees the chat (plus a back-scroll import of up to ~200 messages). |
| R3 Adaptation + feedback | Controls, tweak chips, directives; explicit + implicit feedback; per-user preference learning; global offline improvement loop | See design §8 |
| R4 Overlay, multi-platform | Shadow-DOM overlay in WhatsApp Web; `PlatformAdapter` interface keeps the core platform-neutral | Instagram is the next adapter |
| R5 Interact in the same chat | Slash commands in the compose box, W button, hotkeys, inline insert | |
| R6 Desktop → Android → iOS | Shared TS core + identical backend API; mobile adapters produce the same normalized model | Mobile constraints in roadmap |
| R7 Human-like, example DB | Tagged example bank at 3 levels, retrieval-augmented prompts, "anti-bot" style rules, eval rubric for naturalness | |

## 7. Success metrics

| Metric | Definition | POC target | Prod target |
|---|---|---|---|
| **Insert rate** | Suggestion sets where ≥1 card was inserted ÷ sets viewed | ≥ 35 % | ≥ 45 % |
| **Verbatim-ish send** | Inserted text sent with normalized edit distance ≤ 0.2 | ≥ 50 % of inserts | ≥ 65 % |
| **Thumbs-up ratio** | 👍 ÷ (👍+👎) | ≥ 70 % | ≥ 80 % |
| **"Sounds like me"** | Tester survey, 1–5 | ≥ 4.0 | ≥ 4.3 |
| **Conversation continuation** | Other party replied within 24 h after a Wingman-assisted message | baseline only | ↑ vs. baseline |
| **Latency** | Panel-open → first card visible (precomputed or streamed) | p50 ≤ 2.5 s, p95 ≤ 5 s | p50 ≤ 1.2 s |
| **Safety** | Policy-violating suggestions in red-team set | 0 critical | 0 critical |
| **Command leak** | Slash-command text accidentally sent | 0 | 0 |
| **Adapter health** | Sessions where the adapter self-test fails | detected within 1 h | auto-fixed via remote config < 24 h |

## 8. Key risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Meta ToS / platform hostility.** No official API exists for personal WhatsApp/IG DMs; DOM reading is a grey area | Account warnings, extension takedown | Read-only DOM in the user's own session; **no automation, no auto-send, no scraping beyond the open chat**; human-paced; easy kill switch via remote config; legal review before public launch |
| **DOM changes** break the adapter | Feature outage | Semantic selectors (aria/role/data attributes), remote-updatable selector config (data, not code), self-tests + telemetry, saved DOM fixtures in CI |
| **"Sounds like AI"** | Core value fails | Style post-processor, anti-bot rules, example bank, naturalness evals with native speakers, edit-distance metric |
| **Roman Urdu/Hindi quality** of LLMs (spelling variation, slang) | Poor suggestions | Model bake-off in M0; curated examples; user spelling map; locale cohorts |
| **Privacy of the other party** | Legal/ethical exposure | Local-first storage, request-scoped processing, PII redaction, no server logs of content, opt-in data donation only |
| **Misuse** (manipulation, harassment, minors) | Harm, reputational damage | Safety service (pre/post checks), refusal + alternative, minor-signal detection, respect-"no" guide mode |
| **LLM unit cost** vs. PK/IN price points | Unprofitable | Prompt caching, precompute only on demand, tiered model routing, later fine-tuned small model |
| **Chrome Web Store review** (user-data policy) | Listing rejected | Clear privacy policy, Limited Use disclosure, minimal permissions (`https://web.whatsapp.com/*` only) |
| **Mobile platform limits** (iOS can't read other apps, Play restricts Accessibility) | Mobile parity gap | Designed-in alternative capture paths (keyboard, notifications, share/OCR), see roadmap |

## 9. Assumptions
- Users are 18+ and use WhatsApp Web on desktop at least some of the time (true for students and office workers). Mobile is where most texting happens, so the POC validates **suggestion quality and the style engine**; mobile delivers reach.
- LLM API access from PK/IN-adjacent regions has acceptable latency (~1–2 s). To be validated in M0.
- A small team of native speakers can curate 300–500 seed examples within two weeks.
