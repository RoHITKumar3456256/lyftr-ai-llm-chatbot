import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def get_db_path() -> str:
    db_url = os.getenv("DATABASE_URL", "sqlite:////data/app.db")
    if db_url.startswith("sqlite:////"):
        return "/" + db_url[len("sqlite:////"):]
    if db_url.startswith("sqlite:///"):
        return db_url[len("sqlite:///"):]
    return db_url


def get_connection() -> sqlite3.Connection:
    db_path = get_db_path()
    parent = os.path.dirname(db_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS session_configs (
                session_id TEXT PRIMARY KEY,
                system_prompt TEXT
            )
        """)
        conn.commit()
    finally:
        conn.close()


def set_session_system_prompt(session_id: str, system_prompt: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO session_configs (session_id, system_prompt) VALUES (?, ?) "
            "ON CONFLICT(session_id) DO UPDATE SET system_prompt=excluded.system_prompt",
            (session_id, system_prompt),
        )
        conn.commit()
    finally:
        conn.close()


def get_session_system_prompt(session_id: str) -> Optional[str]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT system_prompt FROM session_configs WHERE session_id = ?", (session_id,))
        row = cur.fetchone()
        if row and row["system_prompt"] is not None:
            return str(row["system_prompt"])
        return None
    finally:
        conn.close()


def save_message(session_id: str, role: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
    conn = get_connection()
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        meta_str = json.dumps(metadata) if metadata is not None else None
        conn.execute(
            "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, role, content, meta_str, now_iso),
        )
        conn.commit()
    finally:
        conn.close()


def get_session_messages(session_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT role, content, metadata FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        )
        rows = cur.fetchall()
        messages: List[Dict[str, Any]] = []
        for r in rows:
            item: Dict[str, Any] = {"role": r["role"], "content": r["content"]}
            if r["metadata"]:
                try:
                    item["metadata"] = json.loads(r["metadata"])
                except Exception:
                    item["metadata"] = r["metadata"]
            messages.append(item)
        return messages
    finally:
        conn.close()

