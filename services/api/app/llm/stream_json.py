"""Incremental extraction of completed sub-objects from a streaming JSON document, so the
orchestrator can emit `analysis` and each `cards[i]` as soon as they are complete."""

from __future__ import annotations

import json
from typing import Any


class SuggestStreamParser:
    """Feed text chunks of a top-level JSON object; get ("analysis", obj) and ("card", obj)
    events as soon as those values close. String/escape aware; tolerant to any chunking."""

    def __init__(self) -> None:
        self.buf = ""
        self.pos = 0
        self.stack: list[str] = []
        self.in_str = False
        self.esc = False
        self.str_start = 0
        self.last_str = ""
        self.top_key: str | None = None
        self.start = 0

    def feed(self, chunk: str) -> list[tuple[str, dict[str, Any]]]:
        self.buf += chunk
        events: list[tuple[str, dict[str, Any]]] = []
        buf = self.buf
        for i in range(self.pos, len(buf)):
            c = buf[i]
            if self.in_str:
                if self.esc:
                    self.esc = False
                elif c == "\\":
                    self.esc = True
                elif c == '"':
                    self.in_str = False
                    self.last_str = buf[self.str_start + 1 : i]
                continue
            if c == '"':
                self.in_str = True
                self.str_start = i
            elif c == ":" and len(self.stack) == 1:
                self.top_key = self.last_str
            elif c in "{[":
                self.stack.append(c)
                depth = len(self.stack)
                if c == "{" and (
                    (depth == 2 and self.top_key == "analysis")
                    or (depth == 3 and self.top_key == "cards" and self.stack[1] == "[")
                ):
                    self.start = i
            elif c in "}]":
                depth = len(self.stack)
                if c == "}" and depth == 2 and self.top_key == "analysis":
                    events.append(("analysis", json.loads(buf[self.start : i + 1])))
                elif c == "}" and depth == 3 and self.top_key == "cards":
                    events.append(("card", json.loads(buf[self.start : i + 1])))
                if self.stack:
                    self.stack.pop()
        self.pos = len(buf)
        return events

    def document(self) -> dict[str, Any]:
        result: dict[str, Any] = json.loads(self.buf)
        return result
