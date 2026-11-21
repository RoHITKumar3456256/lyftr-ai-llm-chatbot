# KeyFlow AI — Resilient Multi-Turn LLM Chatbot Gateway
### *Lyftr AI Full-Stack Engineering Assignment Submission*

---

## 1. Live URLs
- **Frontend Live URL (Vercel)**: [https://lyftr-ai-llm-chatbot.vercel.app](https://lyftr-ai-llm-chatbot.vercel.app)
- **Frontend Alternative (GitHub Pages)**: [https://rohitkumar3456256.github.io/lyftr-ai-llm-chatbot/](https://rohitkumar3456256.github.io/lyftr-ai-llm-chatbot/)
- **Backend Live URL (Render)**: [https://lyftr-ai-llm-chatbot.onrender.com](https://lyftr-ai-llm-chatbot.onrender.com)
- **Swagger API Documentation**: [https://lyftr-ai-llm-chatbot.onrender.com/docs](https://lyftr-ai-llm-chatbot.onrender.com/docs)
- **Backend Health Check**: [https://lyftr-ai-llm-chatbot.onrender.com/health](https://lyftr-ai-llm-chatbot.onrender.com/health)
- **GitHub Repository**: [https://github.com/RoHITKumar3456256/lyftr-ai-llm-chatbot](https://github.com/RoHITKumar3456256/lyftr-ai-llm-chatbot)
- **Demo Video**: *(Link to 2–3 minute screen recording with voiceover)*

---

## 2. Run locally: with Docker and without

### Prerequisites
- Python 3.11+
- Node.js 18+ & npm
- Docker & Docker Compose *(Optional for containerized mode)*

### Option A: With Docker (Recommended)
Both backend and frontend can be spun up with a single command via the included `Makefile`:

```bash
# 1. Clone the repository
git clone https://github.com/RoHITKumar3456256/lyftr-ai-llm-chatbot.git
cd lyftr-ai-llm-chatbot

# 2. Configure environment variables
cp .env.example .env
# Edit .env and supply your LLM_API_KEYS (e.g. Gemini or OpenAI keys)

# 3. Spin up both containers
make up
```

- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **Interactive API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

To stop the services:
```bash
make down
```

### Option B: Without Docker (Manual Execution)

#### 1. Backend Setup
```bash
cd backend

# Create and activate virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run FastAPI backend server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. Frontend Setup
```bash
cd frontend

# Install npm dependencies
npm install

# Start Vite dev server
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

#### 3. Run Automated Tests
```bash
cd backend
python -m pytest -v
```

---

## 3. Design decisions: key fallback, caching, SQLite session storage

### Architecture Overview
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

### 1. Key Fallback & Provider Resilience
- **Sequential Pool Rotation**: Keys configured in `LLM_API_KEYS` are assigned sequential identifiers (`key_1`, `key_2`, ...).
- **Error Trapping**: When a key encounters HTTP 429 (Rate Limit), quota limits, or 5xx server errors, the gateway automatically catches the exception and falls back to the next key.
- **Fail-Safe 503**: If all keys in the pool are exhausted or unavailable, the backend cleanly returns HTTP 503 `{"detail": "all providers unavailable"}` without exposing internal stack traces or breaking the UI.
- **Atomic Persistence**: Database persistence only occurs **after** a successful response is received. Failed requests (HTTP 422 or 503) never pollute the session history.

### 2. Deterministic Caching Engine
- **Cache Digest**: Built using a SHA-256 hash over the tuple `(model, messages)`, where `messages` contains the active system prompt, historical turns, and current user message.
- **Deterministic Cache Hits**: Cache hits return:
  - `resolution_source: "LLM_CACHE"`
  - `key_id: null`
  - `fallback_attempts: 0`
  - Exact token usage saved from the initial generation.
- **Cache Invalidation & Isolation**: Different queries or modified history produce distinct hashes, guaranteeing cache correctness. Bypassed automatically when failover simulation is active to allow authentic key testing.

### 3. SQLite Session Storage
- **Zero External Dependencies**: Operates strictly on embedded SQLite (`DATABASE_URL=sqlite:////data/app.db`), persisted across restarts via Docker volume `/data`.
- **Automatic Schema Migration**: Auto-creates `messages` and `session_configs` tables and index `idx_messages_session_id` on startup via the FastAPI lifespan hook.
- **Context Reconstruction**: For each incoming request, prior conversation messages are queried ordered by `id ASC` to assemble:
  `[{"role": "system", ...}, ...history, {"role": "user", ...}]`.

---

## 4. Verification: how to see failover, cache hits and per-message token usage

### 1. Multi-Turn Conversation Memory
1. Send message: *"My favorite color is emerald green."*
2. Follow up in the same session: *"What is my favorite color?"*
3. **Result**: The assistant responds with *"Your favorite color is emerald green."*, confirming conversation state was reconstructed from SQLite.

### 2. Deterministic Cache Hit
1. In a new session (refresh browser), send the prompt: *"What is the speed of light?"*
   - Returns badge `LIVE_INFERENCE` (emerald), `key_id: key_1`.
2. Send the exact same prompt in another new session:
   - Returns badge `LLM_CACHE` (amber), `key_id: null`, `latency_ms: 1 ms`, and zero additional API token cost.

### 3. Failover Simulation (`X-Simulate-Failure`)
When `ENABLE_FAILURE_SIMULATION=true`, evaluate failover using curl or the header test box:

```bash
# Test single-key failover: key_1 fails with 429 -> succeeds on key_2
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: key_1=429" \
  -d '{"session_id": "test-fail-1", "message": "Test failover"}'
```
- **Response**: `200 OK`, `metadata.key_id: "key_2"`, `metadata.fallback_attempts: 1`.

```bash
# Test total key pool exhaustion: *=429 -> returns 503
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -H "X-Simulate-Failure: *=429" \
  -d '{"session_id": "test-fail-all", "message": "Test total exhaustion"}'
```
- **Response**: `503 Service Unavailable`, `{"detail": "all providers unavailable"}`.

### 4. Per-Message Token Tracking
- Under each assistant message, inspect `data-testid="meta-input-tokens"` and `data-testid="meta-output-tokens"`.
- Each request displays the input and output token count for that prompt only, never an accumulated total.

---

## 5. Setup Used: your editor and AI tools
- **Editor**: Google Antigravity IDE (VS Code Architecture)
- **Agent System**: Antigravity Full-Stack Agent with Python and Node tooling
- **Testing Runtime**: Python 3.12, Pytest 8.2, FastAPI TestClient / Starlette HTTPX
- **Frontend Stack**: Vite 5.4, React 18.3, Modern CSS3 Dark Slate Theme
- **Containerization**: Docker Compose v2, Multi-stage Slim Dockerfiles

---

## 6. Bonus features (if any): what you added beyond the requirements and why

1. **In-Browser Failover Simulation Box**:
   - *Why*: While evaluators can test `X-Simulate-Failure` via curl, we added an optional *Simulate Fail* input in the UI header. Evaluators can type `key_1=429` directly in the browser to visually observe live failover in real-time.
2. **Interactive Swagger & OpenAPI Documentation**:
   - *Why*: Hosted at `/docs` with detailed request/response schemas for interactive browser exploration.
3. **Resilient Inline Chat Error Cards**:
   - *Why*: Instead of clearing the user's message or showing a blank page on 422 or 503 errors, KeyFlow AI displays readable notification cards inline within the chat stream, preserving user context.
4. **Persistent System Prompt Configuration**:
   - *Why*: Added `session_configs` SQLite table so that custom system prompts set on the initial turn are retained throughout all subsequent multi-turn iterations in that session.
5. **Comprehensive Automated Pytest Suite**:
   - *Why*: 8 test cases covering health checks, multi-turn history, cache hits, simulated 429/500 failover, total pool exhaustion, input validation boundaries, and system prompt persistence.
