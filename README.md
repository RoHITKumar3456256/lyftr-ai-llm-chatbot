# KeyFlow AI — Resilient Multi-Turn LLM Chatbot Gateway

KeyFlow AI is a high-reliability full-stack LLM gateway and chatbot application designed to preserve multi-turn conversation state, automatically fail over across an API key pool during provider errors, and serve repeated queries from a deterministic local cache with per-request token and latency telemetry.

Built for the **Lyftr AI Full-Stack Engineering Assignment**.

---

## 1. Overview & Architecture

KeyFlow AI implements a decoupled, resilient architecture composed of a React single-page client, a high-performance FastAPI gateway, a local deterministic caching engine, and an embedded SQLite persistence store.

```
┌────────────────────────────────────────────────────────┐
│              Client Layer (React + Vite)              │
│       • session_id generation per browser refresh      │
│       • High-contrast dark slate developer UI          │
│       • Strict data-testid contract alignment         │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP POST /chat
                            ▼
┌────────────────────────────────────────────────────────┐
│             FastAPI Validation & Gateway               │
│       • Payload verification (1-128 id, 1-4000 chars)  │
│       • Multi-turn state reconstruction from SQLite    │
│       • Dynamic system prompt injection               │
└───────────────────────────┬────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│   Deterministic Caching   │ │     Key Pool Failover     │
│   • SHA-256 prompt digest │ │   • Sequential rotation   │
│   • Instant cache returns │ │   • X-Simulate-Failure    │
│   • Zero token cost       │ │   • Atomic DB persistence │
└───────────────────────────┘ └───────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│             Persistence Layer (SQLite)                 │
│       • messages (session_id, role, content, meta)     │
│       • session_configs (session_id, system_prompt)    │
│       • Docker volume mounted at /data                 │
└────────────────────────────────────────────────────────┘
```

### Request Execution Flow
1. **Client Request**: Frontend generates a unique `session_id` on load and submits message + optional `system_prompt` override.
2. **Input Validation**: FastAPI enforces payload rules (`session_id` 1–128 chars, trimmed `message` 1–4000 chars) returning HTTP 422 for malformed requests.
3. **State Reconstruction**: Prior messages are fetched ordered by `id ASC` from SQLite to assemble: `[system_prompt, ...history, new_user_message]`.
4. **Cache & Gateway**: A SHA-256 digest is generated from the model and message array. If cached, the response and token counts return immediately as `LLM_CACHE`. Otherwise, the request is executed against `LLM_API_KEYS` in sequence.
5. **Atomic Persistence**: Successful turns are atomically written to SQLite. Failed requests (HTTP 422 or 503) never pollute session history.

---

## 2. Key Features & Implementation

### 2.1 Multi-Turn Conversation Memory
- The client only passes `session_id` and the current user message.
- Full context is reconstructed by the backend from SQLite per session.
- System prompts are persisted per session in `session_configs` and maintained across subsequent turns.

### 2.2 Key Pool & Seamless Failover
- Supports arbitrary key pools (`key_1`, `key_2`, ...) configured via the `LLM_API_KEYS` environment variable.
- On HTTP 429, quota limits, or 5xx provider failures, the gateway automatically falls back to the next available key.
- If all keys fail, an HTTP 503 `{"detail": "all providers unavailable"}` is returned cleanly without leaking stack traces or corrupting history.

### 2.3 Deterministic Response Caching
- Generates a deterministic hash from `(model, messages)`.
- Cache hits return with:
  - `resolution_source: "LLM_CACHE"`
  - `key_id: null`
  - `fallback_attempts: 0`
  - Stored token usage metrics.

### 2.4 Per-Request Telemetry UI
- Telemetry bar on every assistant response displaying:
  - `meta-source`: `LIVE_INFERENCE` (emerald badge) or `LLM_CACHE` (amber badge)
  - `meta-model`: Model identifier (e.g. `gemini/gemini-2.0-flash`)
  - `meta-latency`: Wall-clock latency in formatted integer milliseconds
  - `meta-input-tokens` / `meta-output-tokens`: Integer token counts
  - Active `key_id` and fallback count when applicable.

---

## 3. Getting Started & Local Docker Setup

### Prerequisites
- Docker & Docker Compose
- *Alternative for manual runs*: Python 3.11+ and Node.js 18+

### Quick Start with Docker & Makefile
Clone the repository and spin up both containers with a single command:

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Launch the application
make up
```

- **Frontend UI**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **Interactive API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)

To stop the containers:
```bash
make down
```

### Manual Local Development
**Backend**:
```bash
cd backend
python -m venv venv
# On Windows: .\venv\Scripts\activate | On Unix: source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend**:
```bash
cd frontend
npm install
npm run dev
```

---

## 4. API Reference & Contract Specifications

### `GET /health`
Returns gateway health, number of configured API keys, and cache state.
- **Status**: `200 OK`
- **Response**:
```json
{
  "status": "ok",
  "keys_configured": 2,
  "cache_enabled": true
}
```

### `POST /chat`
Submits a user prompt, reconstructs conversation history, resolves via cache or LLM failover, and persists state.
- **Headers**:
  - `Content-Type: application/json`
  - `X-Simulate-Failure: key_1=429` *(Optional testing hook)*
- **Body**:
```json
{
  "session_id": "s-alpha-123",
  "message": "What is the capital of France?",
  "system_prompt": "You are a concise geography assistant."
}
```
- **Response (200 OK)**:
```json
{
  "session_id": "s-alpha-123",
  "reply": "The capital of France is Paris.",
  "metadata": {
    "resolution_source": "LIVE_INFERENCE",
    "model": "gemini/gemini-2.0-flash",
    "latency_ms": 782,
    "input_tokens": 28,
    "output_tokens": 8,
    "key_id": "key_1",
    "fallback_attempts": 0
  }
}
```
- **Error Codes**:
  - `422 Unprocessable Entity`: Validation failure (empty message, message > 4000 characters, empty session ID).
  - `503 Service Unavailable`: All keys exhausted or unavailable: `{"detail": "all providers unavailable"}`.

### `GET /sessions/{session_id}/messages`
Retrieves chronologically ordered messages (oldest first) excluding system prompts.
- **Status**: `200 OK` or `404 Not Found` (`{"detail": "session not found"}`)
- **Response**:
```json
{
  "session_id": "s-alpha-123",
  "messages": [
    {
      "role": "user",
      "content": "What is the capital of France?"
    },
    {
      "role": "assistant",
      "content": "The capital of France is Paris.",
      "metadata": {
        "resolution_source": "LIVE_INFERENCE",
        "model": "gemini/gemini-2.0-flash",
        "latency_ms": 782,
        "input_tokens": 28,
        "output_tokens": 8,
        "key_id": "key_1",
        "fallback_attempts": 0
      }
    }
  ]
}
```

---

## 5. Testing & Failure Simulation

### Running Automated Test Suite
A complete pytest suite covering health checks, multi-turn history, cache hits, simulated failover, atomic persistence, and validation error boundaries is provided in `backend/tests/test_api.py`.

```bash
# Using Makefile
make test

# Or directly with pytest
cd backend
pytest -v
```

### Deterministic Failure Simulation (`X-Simulate-Failure`)
When `ENABLE_FAILURE_SIMULATION=true`, client requests can pass the `X-Simulate-Failure` header to test single-key and total-pool failover deterministically:

1. **Single-Key Failover to Key 2**:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: key_1=429" \
  -d '{"session_id": "sim-1", "message": "Testing failover"}'
```
*Result*: Succeeds with `200 OK`, `metadata.key_id: "key_2"`, and `metadata.fallback_attempts: 1`.

2. **Total Pool Exhaustion**:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: *=429" \
  -d '{"session_id": "sim-fail", "message": "Testing total outage"}'
```
*Result*: Returns `503 Service Unavailable` with `{"detail": "all providers unavailable"}` without persisting any messages to SQLite.

---

## 6. Deployment & Telemetry

### Deployment Blueprint
- **Backend**: Deploy on any containerized or Python PaaS (e.g. Render, Railway, AWS ECS). Set environment variables:
  - `DATABASE_URL=sqlite:////data/app.db`
  - `LLM_API_KEYS=key1,key2`
  - `ENABLE_FAILURE_SIMULATION=true`
  - `ALLOWED_ORIGINS=*`
- **Frontend**: Deploy on static hosting (e.g. Vercel, Netlify, Cloudflare Pages) with build argument / environment variable:
  - `VITE_API_URL=https://your-backend-url.onrender.com`

### Frontend Test Contract Alignment
The React client strictly satisfies all mandatory `data-testid` attributes:
| `data-testid` | Element | Content / Behavior |
|---|---|---|
| `chat-input` | `<textarea>` | User input; clears immediately on submission |
| `send-button` | `<button>` | Submits message; Enter triggers submit |
| `assistant-message` | `<div>` | Container wrapping response and metadata |
| `meta-source` | `<span>` | `LIVE_INFERENCE` or `LLM_CACHE` |
| `meta-model` | `<span>` | Model identifier string |
| `meta-latency` | `<span>` | Millisecond latency string (e.g. `812 ms`) |
| `meta-input-tokens` | `<strong>` | Prompt token count integer |
| `meta-output-tokens` | `<strong>` | Completion token count integer |
| `system-prompt-input` | `<input>` | Header input for session system prompt |

