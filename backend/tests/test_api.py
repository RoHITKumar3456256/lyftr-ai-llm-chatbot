import os
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:///./test_app.db"
os.environ["LLM_API_KEYS"] = "fake_key_1,fake_key_2"
os.environ["ENABLE_FAILURE_SIMULATION"] = "true"

from app.main import app
from app.db import init_db
from app.llm_service import clear_cache

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_state():
    if os.path.exists("./test_app.db"):
        try:
            os.remove("./test_app.db")
        except OSError:
            pass
    init_db()
    clear_cache()
    yield
    if os.path.exists("./test_app.db"):
        try:
            os.remove("./test_app.db")
        except OSError:
            pass


def _mock_llm_response(text="Paris", prompt_tokens=25, completion_tokens=5):
    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock(message=MagicMock(content=text))]
    mock_resp.usage = MagicMock(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)
    return mock_resp


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "keys_configured": 2, "cache_enabled": True}


@patch("app.llm_service.litellm.completion")
def test_chat_cache_and_multi_turn(mock_comp):
    mock_comp.return_value = _mock_llm_response("The capital of France is Paris.", 42, 9)
    r1 = client.post("/chat", json={"session_id": "s-1", "message": "Capital of France?"})
    assert r1.status_code == 200
    assert r1.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"
    assert r1.json()["metadata"]["key_id"] == "key_1"
    assert r1.json()["metadata"]["input_tokens"] == 42
    assert r1.json()["metadata"]["output_tokens"] == 9

    # Identical first message in a new session must return LLM_CACHE
    r2 = client.post("/chat", json={"session_id": "s-2", "message": "Capital of France?"})
    assert r2.status_code == 200
    assert r2.json()["metadata"]["resolution_source"] == "LLM_CACHE"
    assert r2.json()["metadata"]["key_id"] is None
    assert r2.json()["metadata"]["fallback_attempts"] == 0
    assert r2.json()["reply"] == "The capital of France is Paris."
    assert r2.json()["metadata"]["input_tokens"] == 42
    assert r2.json()["metadata"]["output_tokens"] == 9

    # History check excludes system prompt
    hist = client.get("/sessions/s-1/messages")
    assert hist.status_code == 200
    assert len(hist.json()["messages"]) == 2
    assert hist.json()["messages"][0]["role"] == "user"
    assert hist.json()["messages"][1]["role"] == "assistant"


@patch("app.llm_service.litellm.completion")
def test_failover_simulation_429(mock_comp):
    mock_comp.return_value = _mock_llm_response("Recovered via key 2")
    r1 = client.post(
        "/chat",
        json={"session_id": "s-fail", "message": "Hello"},
        headers={"X-Simulate-Failure": "key_1=429"},
    )
    assert r1.status_code == 200
    assert r1.json()["metadata"]["key_id"] == "key_2"
    assert r1.json()["metadata"]["fallback_attempts"] == 1


@patch("app.llm_service.litellm.completion")
def test_failover_simulation_500(mock_comp):
    mock_comp.return_value = _mock_llm_response("Recovered from 500 via key 2")
    r1 = client.post(
        "/chat",
        json={"session_id": "s-fail-500", "message": "Hello server"},
        headers={"X-Simulate-Failure": "key_1=500"},
    )
    assert r1.status_code == 200
    assert r1.json()["metadata"]["key_id"] == "key_2"
    assert r1.json()["metadata"]["fallback_attempts"] == 1


def test_total_pool_failure_simulation():
    # Total failure simulation: *=429 returns 503
    r = client.post(
        "/chat",
        json={"session_id": "s-fail-all", "message": "Hello total fail"},
        headers={"X-Simulate-Failure": "*=429"},
    )
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}

    # Atomic persistence verification: failed requests must not pollute session history
    r_hist = client.get("/sessions/s-fail-all/messages")
    assert r_hist.status_code == 404
    assert r_hist.json() == {"detail": "session not found"}


def test_validation_errors():
    # Empty message
    r1 = client.post("/chat", json={"session_id": "s-val", "message": "   "})
    assert r1.status_code == 422

    # Message > 4000 characters
    long_msg = "a" * 4001
    r2 = client.post("/chat", json={"session_id": "s-val", "message": long_msg})
    assert r2.status_code == 422

    # Empty session_id
    r3 = client.post("/chat", json={"session_id": "", "message": "valid"})
    assert r3.status_code == 422


def test_session_not_found():
    res = client.get("/sessions/non_existent_session/messages")
    assert res.status_code == 404
    assert res.json() == {"detail": "session not found"}


@patch("app.llm_service.litellm.completion")
def test_system_prompt_persistence(mock_comp):
    mock_comp.return_value = _mock_llm_response("Custom prompt reply")
    # First turn sets system prompt
    r1 = client.post(
        "/chat",
        json={
            "session_id": "s-sys",
            "message": "Hello",
            "system_prompt": "You are a pirate.",
        },
    )
    assert r1.status_code == 200

    # Verify mock was called with pirate system prompt
    call_args = mock_comp.call_args[1]
    assert call_args["messages"][0] == {"role": "system", "content": "You are a pirate."}

    # Second turn without system prompt in body
    mock_comp.return_value = _mock_llm_response("Pirate second reply")
    r2 = client.post(
        "/chat",
        json={"session_id": "s-sys", "message": "Second message"},
    )
    assert r2.status_code == 200
    call_args2 = mock_comp.call_args[1]
    assert call_args2["messages"][0] == {"role": "system", "content": "You are a pirate."}


@patch("app.llm_service.litellm.completion")
def test_different_message_bypasses_cache(mock_comp):
    mock_comp.return_value = _mock_llm_response("First answer")
    r1 = client.post("/chat", json={"session_id": "s-diff-1", "message": "Question 1"})
    assert r1.status_code == 200
    assert r1.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"

    mock_comp.return_value = _mock_llm_response("Second answer")
    r2 = client.post("/chat", json={"session_id": "s-diff-2", "message": "Question 2"})
    assert r2.status_code == 200
    assert r2.json()["metadata"]["resolution_source"] == "LIVE_INFERENCE"
