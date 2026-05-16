import sqlite3
import os

_data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
os.makedirs(_data_dir, exist_ok=True)
DB_PATH = os.getenv("DB_PATH", os.path.join(_data_dir, "users.db"))


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _column_exists(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def _table_exists(conn, table):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchall()
    return len(rows) > 0


def init_db():
    conn = get_db()

    # --- users ---
    if not _table_exists(conn, "users"):
        conn.execute("""
            CREATE TABLE users (
                user_id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                tier TEXT NOT NULL DEFAULT 'free',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_login TEXT
            )
        """)

    # --- sessions ---
    if not _table_exists(conn, "sessions"):
        conn.execute("""
            CREATE TABLE sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)

    # --- audit_log ---
    if not _table_exists(conn, "audit_log"):
        conn.execute("""
            CREATE TABLE audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                action TEXT NOT NULL,
                resource TEXT,
                detail TEXT,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)

    # --- usage_quota ---
    if not _table_exists(conn, "usage_quota"):
        conn.execute("""
            CREATE TABLE usage_quota (
                user_id TEXT PRIMARY KEY,
                draft_count_today INTEGER NOT NULL DEFAULT 0,
                last_reset_date TEXT NOT NULL DEFAULT (date('now')),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)

    # --- user_records ---
    if not _table_exists(conn, "user_records"):
        conn.execute("""
            CREATE TABLE user_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                record_type TEXT NOT NULL DEFAULT 'draft',
                email_content TEXT,
                draft TEXT,
                additional_context TEXT,
                token_usage TEXT,
                model_tier TEXT,
                model_name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)
    # Ensure model_name column exists (migration)
    if _table_exists(conn, "user_records") and not _column_exists(conn, "user_records", "model_name"):
        conn.execute("ALTER TABLE user_records ADD COLUMN model_name TEXT")

    conn.commit()
    conn.close()


MAX_USER_RECORDS = 100


def save_user_record(user_id, record_type, email_content, draft, additional_context=None, token_usage=None, model_tier=None, model_name=None):
    conn = get_db()
    import json
    conn.execute(
        "INSERT INTO user_records (user_id, record_type, email_content, draft, additional_context, token_usage, model_tier, model_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, record_type, email_content, draft, additional_context, json.dumps(token_usage) if token_usage else None, model_tier, model_name)
    )
    # Keep only the latest MAX_USER_RECORDS per user
    conn.execute(
        "DELETE FROM user_records WHERE user_id = ? AND id NOT IN (SELECT id FROM user_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)",
        (user_id, user_id, MAX_USER_RECORDS)
    )
    conn.commit()
    conn.close()


def get_user_records(user_id, limit=100, offset=0):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM user_records WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (user_id, limit, offset)
    ).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) as cnt FROM user_records WHERE user_id = ?", (user_id,)
    ).fetchone()["cnt"]
    conn.close()
    import json
    results = []
    for r in rows:
        d = dict(r)
        if d.get("token_usage"):
            try: d["token_usage"] = json.loads(d["token_usage"])
            except: pass
        results.append(d)
    return {"records": results, "total": total}


def get_user_record(user_id, record_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM user_records WHERE id = ? AND user_id = ?", (record_id, user_id)
    ).fetchone()
    conn.close()
    if not row:
        return None
    import json
    d = dict(row)
    if d.get("token_usage"):
        try: d["token_usage"] = json.loads(d["token_usage"])
        except: pass
    return d


def delete_user_record(user_id, record_id):
    conn = get_db()
    conn.execute("DELETE FROM user_records WHERE id = ? AND user_id = ?", (record_id, user_id))
    conn.commit()
    conn.close()


def clear_user_records(user_id):
    conn = get_db()
    conn.execute("DELETE FROM user_records WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
