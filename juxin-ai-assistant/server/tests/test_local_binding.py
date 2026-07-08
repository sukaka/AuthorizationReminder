import base64
import hashlib
import hmac
import json
import time

from fastapi.testclient import TestClient


AUDIENCE = "juxin-ai-assistant-local"
TEST_SECRET = "local-binding-test-secret-32-bytes!!"


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _signed_token(payload: dict[str, str | int]) -> str:
    header = _encode(json.dumps(
        {"alg": "HS256", "typ": "JWT"},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8"))
    body = _encode(json.dumps(
        payload,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8"))
    signing_input = f"{header}.{body}"
    signature = _encode(hmac.new(
        TEST_SECRET.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest())
    return f"{signing_input}.{signature}"


def test_authenticated_session_issues_verifiable_local_binding_token(
    client: TestClient,
) -> None:
    # Given: an authenticated AI assistant session.
    session_response = client.get("/api/ai/session")

    # When: native verifies the returned token without forwarding a cookie.
    token = session_response.json()["local_binding_token"]
    encoded_claims = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(
        encoded_claims + ("=" * (-len(encoded_claims) % 4))
    ))
    verify_response = client.post(
        "/api/ai/local-binding/verify",
        json={"token": token},
    )

    # Then: only the stable unified user id crosses the native boundary.
    assert verify_response.status_code == 200
    assert verify_response.json() == {"user_id": "dev"}
    assert set(claims) == {"sub", "aud", "iat", "exp"}
    assert claims["aud"] == AUDIENCE
    assert 0 < claims["exp"] - claims["iat"] <= 120
    assert "juxin_auth_token" not in token
    assert TEST_SECRET not in token


def test_local_binding_verify_rejects_expired_and_wrong_audience_uniformly(
    client: TestClient,
) -> None:
    # Given: correctly signed tokens that are unusable for different reasons.
    now = int(time.time())
    tokens = [
        _signed_token({"sub": "dev", "aud": AUDIENCE, "iat": now - 120, "exp": now - 60}),
        _signed_token({"sub": "dev", "aud": "other-app", "iat": now, "exp": now + 60}),
    ]

    # When: native submits either invalid token.
    responses = [
        client.post("/api/ai/local-binding/verify", json={"token": token})
        for token in tokens
    ]

    # Then: both failures are indistinguishable and reveal no token details.
    assert [response.status_code for response in responses] == [401, 401]
    assert responses[0].json() == responses[1].json() == {
        "detail": "LOCAL_BINDING_TOKEN_INVALID"
    }


def test_local_binding_verify_rejects_tampering_without_cookie(
    client: TestClient,
) -> None:
    # Given: a token whose signature no longer matches its body.
    now = int(time.time())
    token = _signed_token({"sub": "dev", "aud": AUDIENCE, "iat": now, "exp": now + 60})
    signing_input, signature = token.rsplit(".", 1)
    replacement = "A" if signature[0] != "A" else "B"
    tampered = f"{signing_input}.{replacement}{signature[1:]}"

    # When: it is verified without any authenticated browser state.
    response = client.post(
        "/api/ai/local-binding/verify",
        json={"token": tampered},
    )

    # Then: verification fails with the same stable public error.
    assert response.status_code == 401
    assert response.json() == {"detail": "LOCAL_BINDING_TOKEN_INVALID"}


def test_local_binding_verify_hides_request_parse_failures(
    client: TestClient,
) -> None:
    # Given/When: callers omit the token or send malformed JSON.
    responses = [
        client.post("/api/ai/local-binding/verify", json={}),
        client.post(
            "/api/ai/local-binding/verify",
            content=b"{",
            headers={"content-type": "application/json"},
        ),
    ]

    # Then: boundary parsing reveals no schema or decoder details.
    assert [response.status_code for response in responses] == [401, 401]
    assert responses[0].json() == responses[1].json() == {
        "detail": "LOCAL_BINDING_TOKEN_INVALID"
    }
