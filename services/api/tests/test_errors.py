from httpx import AsyncClient


async def test_error_shape_not_found(client: AsyncClient) -> None:
    r = await client.get("/nope")
    assert r.status_code == 404
    body = r.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == "not_found"


async def test_validation_error_does_not_echo_body(client: AsyncClient) -> None:
    r = await client.post("/v1/auth/dev", json={"email": "super-secret-not-an-email"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error"
    assert "super-secret" not in r.text
