"""Contract for POST /v1/suggest (docs/03 §4.1–4.2). These models drive the OpenAPI document
and the generated TypeScript client."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Tone = Literal["chill", "playful", "flirty", "sweet", "sincere", "funny", "apologetic", "confident"]
Objective = Literal[
    "keep_going",
    "build_rapport",
    "deepen",
    "flirt_up",
    "ask_out",
    "recover",
    "slow_down",
    "end_gracefully",
]
Stage = Literal["just_matched", "talking", "close", "dating", "friend"]
Mode = Literal["auto", "reply", "topic", "guide", "rewrite"]
Trigger = Literal["incoming_message", "button", "command", "tweak", "regenerate"]
Tweak = Literal[
    "shorter",
    "longer",
    "funnier",
    "more_flirty",
    "less_flirty",
    "more_urdu_hindi",
    "more_english",
    "more_casual",
    "more_sincere",
]
MessageKind = Literal[
    "text",
    "image",
    "video",
    "voice",
    "sticker",
    "gif",
    "link",
    "deleted",
    "system",
    "story_reply",
    "reel_share",
    "unknown",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatInfo(_Strict):
    key: str = Field(min_length=8, max_length=64, description="HMAC chat key from the client")
    platform: str = Field(max_length=32)
    stage: Stage | None = None
    their_alias: str = Field(default="them", max_length=40, description="First name or alias")
    is_group: bool = False


class Controls(_Strict):
    tone: Tone | None = None
    objective: Objective | None = None
    length: Literal["one_liner", "short", "normal"] | None = None
    language: Literal["auto", "more_urdu_hindi", "more_english"] | None = None
    count: int = Field(default=3, ge=1, le=3)


class Memory(_Strict):
    summary: str = Field(default="", max_length=2000)
    facts: list[str] = Field(default_factory=list, max_length=20)
    covered_until: str | None = None


class ChatMessage(_Strict):
    dir: Literal["in", "out"]
    kind: MessageKind = "text"
    text: str = Field(default="", max_length=4000)
    ts: str | None = None


class ClientInfo(_Strict):
    app: str = Field(max_length=16)
    version: str = Field(max_length=32)
    style_profile_version: int | None = None


class SuggestRequest(_Strict):
    """Request body for POST /v1/suggest. Messages must already be redacted by the client."""

    request_id: UUID
    chat: ChatInfo
    mode: Mode = "auto"
    trigger: Trigger = "button"
    controls: Controls = Field(default_factory=Controls)
    directive: str | None = Field(default=None, max_length=500)
    draft: str | None = Field(default=None, max_length=2000)
    avoid: list[str] = Field(default_factory=list, max_length=9)
    tweak: Tweak | None = None
    memory: Memory = Field(default_factory=Memory)
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    client: ClientInfo


# ---- model output (validated after generation) ----
class Analysis(BaseModel):
    their_mood: str
    energy: Literal["low", "medium", "high"]
    interest: Literal["low", "medium", "high", "unclear"]
    hooks: list[str] = Field(default_factory=list)
    recommended_move: str
    boundary_signal: bool = False
    minor_signal: bool = False


class Card(BaseModel):
    kind: Literal["reply", "topic"]
    approach: str
    text: str = Field(min_length=1, max_length=600)
    why: str | None = None


class SuggestOutput(BaseModel):
    analysis: Analysis
    cards: list[Card]
    guide: str | None = None
    memory_facts: list[str] = Field(default_factory=list)


# Portable JSON-Schema subset accepted by every provider's strict mode (no numeric bounds);
# counts/lengths are enforced by the Pydantic models above.
OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["analysis", "cards", "guide", "memory_facts"],
    "properties": {
        "analysis": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "their_mood",
                "energy",
                "interest",
                "hooks",
                "recommended_move",
                "boundary_signal",
                "minor_signal",
            ],
            "properties": {
                "their_mood": {
                    "type": "string",
                    "enum": [
                        "happy",
                        "excited",
                        "neutral",
                        "tired",
                        "stressed",
                        "sad",
                        "annoyed",
                        "flirty",
                        "distant",
                        "busy",
                    ],
                },
                "energy": {"type": "string", "enum": ["low", "medium", "high"]},
                "interest": {"type": "string", "enum": ["low", "medium", "high", "unclear"]},
                "hooks": {"type": "array", "items": {"type": "string"}},
                "recommended_move": {"type": "string"},
                "boundary_signal": {"type": "boolean"},
                "minor_signal": {"type": "boolean"},
            },
        },
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "approach", "text", "why"],
                "properties": {
                    "kind": {"type": "string", "enum": ["reply", "topic"]},
                    "approach": {"type": "string"},
                    "text": {"type": "string"},
                    "why": {"type": "string"},
                },
            },
        },
        "guide": {"type": ["string", "null"]},
        "memory_facts": {"type": "array", "items": {"type": "string"}},
    },
}


# ---- SSE events (text/event-stream). Event name = the `event:` field. ----
class MetaEvent(BaseModel):
    request_id: UUID
    prompt_version: str


class AnalysisEvent(BaseModel):
    their_mood: str
    energy: str
    interest: str
    hooks: list[str]
    recommended_move: str
    boundary_signal: bool


class CardEvent(BaseModel):
    id: UUID
    rank: int
    kind: Literal["reply", "topic"]
    approach: str
    text: str
    why: str | None = None


class GuideEvent(BaseModel):
    text: str


class MemoryEvent(BaseModel):
    facts_add: list[str]


class DoneEvent(BaseModel):
    latency_ms: int
    first_card_ms: int | None
    cards: int


class ErrorEvent(BaseModel):
    code: Literal["llm_unavailable", "bad_output", "safety_block", "internal"]
    message: str


SSE_EVENT_MODELS: dict[str, type[BaseModel]] = {
    "meta": MetaEvent,
    "analysis": AnalysisEvent,
    "card": CardEvent,
    "guide": GuideEvent,
    "memory": MemoryEvent,
    "done": DoneEvent,
    "error": ErrorEvent,
}
