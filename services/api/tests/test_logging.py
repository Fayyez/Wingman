from app.logging import scrub_processor


def test_scrubs_top_level_and_nested() -> None:
    out = scrub_processor(
        None,
        "info",
        {
            "event": "x",
            "text": "hi",
            "meta": {"draft": "d", "ok": 1, "items": [{"content": "c", "n": 2}]},
            "messages": [{"body": "b"}],
        },
    )
    assert out["event"] == "x"
    assert out["text"] == "[scrubbed]"
    assert out["messages"] == "[scrubbed]"
    assert out["meta"]["draft"] == "[scrubbed]"
    assert out["meta"]["ok"] == 1
    assert out["meta"]["items"][0] == {"content": "[scrubbed]", "n": 2}


def test_scrubs_all_keys() -> None:
    keys = ["text", "messages", "draft", "directive", "memory", "content", "prompt", "body"]
    out = scrub_processor(None, "info", {k: "secret" for k in keys})
    assert all(v == "[scrubbed]" for v in out.values())
