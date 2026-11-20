import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from .db import (
    get_connection,
    get_session_messages,
    get_session_system_prompt,
    init_db,
    save_message,
    set_session_system_prompt,
)
from .llm_service import (
    DEFAULT_SYSTEM_PROMPT,
    AllProvidersUnavailableError,
    generate_chat_completion,
    get_key_pool,
)

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="KeyFlow AI — Lyftr Gateway", lifespan=lifespan)
# Ensure DB is initialized on module load
init_db()

allowed_origins_raw = os.getenv("ALLOWED_ORIGINS", "*")
allowed_origins = [o.strip() for o in allowed_origins_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


@app.exception_handler(AllProvidersUnavailableError)
async def providers_unavailable_handler(request: Request, exc: AllProvidersUnavailableError):
    return JSONResponse(status_code=503, content={"detail": "all providers unavailable"})


@app.exception_handler(Exception)
async def fallback_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return JSONResponse(status_code=503, content={"detail": "all providers unavailable"})


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=1, max_length=128)
    message: str
    system_prompt: Optional[str] = None

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v: str) -> str:
        s = v.strip()
        if not s or len(s) > 128:
            raise ValueError("session_id must be between 1 and 128 characters")
        return s

    @field_validator("message")
    @classmethod
    def validate_message(cls, v: str) -> str:
        s = v.strip()
        if not s or len(s) > 4000:
            raise ValueError("message must be between 1 and 4000 characters")
        return s


@app.get("/health")
def health():
    keys = get_key_pool()
    return {
        "status": "ok",
        "keys_configured": len(keys),
        "cache_enabled": True,
    }


@app.post("/chat")
def chat(
    request: ChatRequest,
    x_simulate_failure: Optional[str] = Header(None, alias="X-Simulate-Failure"),
):
    if request.system_prompt is not None and request.system_prompt.strip():
        set_session_system_prompt(request.session_id, request.system_prompt.strip())

    active_system_prompt = get_session_system_prompt(request.session_id) or DEFAULT_SYSTEM_PROMPT
    history = get_session_messages(request.session_id)

    prompt_messages: List[Dict[str, str]] = [
        {"role": "system", "content": active_system_prompt}
    ]
    for m in history:
        prompt_messages.append({"role": m["role"], "content": m["content"]})
    prompt_messages.append({"role": "user", "content": request.message.strip()})

    result = generate_chat_completion(prompt_messages, simulate_header=x_simulate_failure)

    # Atomic persistence: Only write to SQLite after a successful reply is obtained
    save_message(request.session_id, "user", request.message.strip())
    save_message(request.session_id, "assistant", result["reply"], result["metadata"])

    return {
        "session_id": request.session_id,
        "reply": result["reply"],
        "metadata": result["metadata"],
    }


@app.get("/sessions/{session_id}/messages")
def get_session_history(session_id: str):
    messages = get_session_messages(session_id)
    if not messages:
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT session_id FROM session_configs WHERE session_id = ?", (session_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="session not found")
        finally:
            conn.close()
    return {
        "session_id": session_id,
        "messages": messages,
    }
