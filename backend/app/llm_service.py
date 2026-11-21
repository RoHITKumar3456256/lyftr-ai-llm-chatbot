import hashlib
import json
import os
import time
from typing import Any, Dict, List, Optional, Tuple
import litellm
from litellm.caching.caching import Cache

try:
    litellm.cache = Cache(type="local")
    litellm.suppress_debug_info = True
except Exception:
    pass

DEFAULT_SYSTEM_PROMPT = "You are a helpful, concise AI assistant."


class AllProvidersUnavailableError(Exception):
    pass


def get_key_pool() -> List[Tuple[str, str]]:
    raw = os.getenv("LLM_API_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    return [(f"key_{idx + 1}", key) for idx, key in enumerate(keys)]


def parse_simulated_failures(header_val: Optional[str]) -> Dict[str, int]:
    if os.getenv("ENABLE_FAILURE_SIMULATION", "false").lower() != "true":
        return {}
    if not header_val:
        return {}
    failures: Dict[str, int] = {}
    for part in header_val.split(","):
        part = part.strip()
        if "=" in part:
            k, code_str = part.split("=", 1)
            k = k.strip()
            try:
                code = int(code_str.strip())
                if code in (429, 500, 502, 503):
                    failures[k] = code
            except ValueError:
                continue
    return failures


def _cache_digest(model: str, messages: List[Dict[str, str]]) -> str:
    payload = json.dumps({"model": model, "messages": messages}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


_CACHE_STORE: Dict[str, Dict[str, Any]] = {}


def clear_cache() -> None:
    _CACHE_STORE.clear()
    if getattr(litellm, "cache", None):
        try:
            litellm.cache.flush_cache()
        except Exception:
            pass


def generate_chat_completion(
    messages: List[Dict[str, str]],
    simulate_header: Optional[str] = None,
) -> Dict[str, Any]:
    start_time = time.perf_counter()
    model = os.getenv("LLM_MODEL", "gemini/gemini-2.5-flash")
    key_pool = get_key_pool()

    digest = _cache_digest(model, messages)
    failures = parse_simulated_failures(simulate_header)

    # 1. Deterministic response cache lookup (bypassed if simulating failures)
    if not failures and digest in _CACHE_STORE:
        cached = _CACHE_STORE[digest]
        latency_ms = max(1, int((time.perf_counter() - start_time) * 1000))
        return {
            "reply": cached["reply"],
            "metadata": {
                "resolution_source": "LLM_CACHE",
                "model": model,
                "latency_ms": latency_ms,
                "input_tokens": cached.get("input_tokens", 0),
                "output_tokens": cached.get("output_tokens", 0),
                "key_id": None,
                "fallback_attempts": 0,
                "timeline": [{"key_id": "cache", "status": 200, "latency_ms": latency_ms}],
                "failover_note": None,
            },
        }

    # 2. Key pool sequential failover
    if not key_pool:
        raise AllProvidersUnavailableError("No API keys configured")

    fallback_attempts = 0
    timeline: List[Dict[str, Any]] = []
    failover_note: Optional[str] = None
    step_start = time.perf_counter()

    for key_id, api_key in key_pool:
        # Check simulated failure hook
        simulated_code = failures.get(key_id) or failures.get("*")
        if simulated_code is not None:
            fallback_attempts += 1
            step_lat = max(15, int((time.perf_counter() - step_start) * 1000))
            timeline.append({"key_id": key_id, "status": simulated_code, "latency_ms": step_lat})
            failover_note = f"{key_id} returned {simulated_code}. Retried on next key."
            step_start = time.perf_counter()
            continue

        try:
            resp = litellm.completion(
                model=model,
                messages=messages,
                api_key=api_key,
            )
            reply = ""
            if hasattr(resp, "choices") and resp.choices:
                choice = resp.choices[0]
                if hasattr(choice, "message") and hasattr(choice.message, "content"):
                    reply = choice.message.content or ""
                elif isinstance(choice, dict):
                    reply = choice.get("message", {}).get("content", "")

            input_tokens = 0
            output_tokens = 0
            if hasattr(resp, "usage") and resp.usage:
                input_tokens = getattr(resp.usage, "prompt_tokens", 0) or 0
                output_tokens = getattr(resp.usage, "completion_tokens", 0) or 0

            step_lat = max(1, int((time.perf_counter() - step_start) * 1000))
            timeline.append({"key_id": key_id, "status": 200, "latency_ms": step_lat})
            total_lat = max(1, int((time.perf_counter() - start_time) * 1000))

            if fallback_attempts > 0 and timeline:
                prev = timeline[0]
                failover_note = f"{prev['key_id']} returned {prev['status']}. Retried on {key_id} in {prev['latency_ms']} ms."

            metadata = {
                "resolution_source": "LIVE_INFERENCE",
                "model": model,
                "latency_ms": total_lat,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "key_id": key_id,
                "fallback_attempts": fallback_attempts,
                "timeline": timeline,
                "failover_note": failover_note,
            }

            if not failures:
                _CACHE_STORE[digest] = {
                    "reply": reply,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                }

            return {
                "reply": reply,
                "metadata": metadata,
            }
        except Exception as exc:
            fallback_attempts += 1
            step_lat = max(20, int((time.perf_counter() - step_start) * 1000))
            timeline.append({"key_id": key_id, "status": 500, "latency_ms": step_lat})
            failover_note = f"{key_id} error. Retried on next key."
            step_start = time.perf_counter()
            continue

    raise AllProvidersUnavailableError("all providers unavailable")
