import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from ..models.database import get_db

# Session duration: 30 days
SESSION_DAYS = 30

TIER_QUOTAS = {
    "free": 20,
    "pro": 200,
    "unlimited": 999999,
}

TIER_PERMISSIONS = {
    "free": ["basic_draft"],
    "pro": ["basic_draft", "batch_processing", "long_term_memory"],
    "unlimited": ["basic_draft", "batch_processing", "long_term_memory", "priority_support"],
}


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}{password}".encode()).hexdigest()
    return f"{salt}${h}"


def verify_password(password: str, password_hash: str) -> bool:
    salt, h = password_hash.split("$", 1)
    return hashlib.sha256(f"{salt}{password}".encode()).hexdigest() == h


def create_user(username: str, password: str, tier: str = "free") -> Optional[str]:
    db = get_db()
    try:
        user_id = secrets.token_hex(16)
        db.execute(
            "INSERT INTO users (user_id, username, password_hash, tier) VALUES (?, ?, ?, ?)",
            (user_id, username, hash_password(password), tier),
        )
        db.execute("INSERT INTO usage_quota (user_id) VALUES (?)", (user_id,))
        db.commit()
        return user_id
    except sqlite3.IntegrityError:
        return None
    finally:
        db.close()


def authenticate(username: str, password: str) -> Optional[str]:
    db = get_db()
    try:
        row = db.execute(
            "SELECT user_id, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            return None

        db.execute(
            "UPDATE users SET last_login = datetime('now') WHERE user_id = ?",
            (row["user_id"],),
        )
        db.commit()

        # Create persistent session
        token = secrets.token_hex(32)
        expires_at = (datetime.now() + timedelta(days=SESSION_DAYS)).isoformat()
        db.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, row["user_id"], expires_at),
        )
        db.commit()
        return token
    finally:
        db.close()


def get_user_from_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None

    db = get_db()
    try:
        # Find session and check expiry
        session = db.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token = ?",
            (token,),
        ).fetchone()

        if not session:
            return None

        # Check if expired
        if datetime.fromisoformat(session["expires_at"]) < datetime.now():
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            db.commit()
            return None

        row = db.execute(
            "SELECT user_id, username, tier FROM users WHERE user_id = ?",
            (session["user_id"],),
        ).fetchone()

        if not row:
            db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            db.commit()
            return None

        return {
            "user_id": row["user_id"],
            "username": row["username"],
            "tier": row["tier"],
        }
    finally:
        db.close()


def logout(token: str):
    db = get_db()
    try:
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
    finally:
        db.close()


def check_quota(user_id: str) -> Dict[str, Any]:
    db = get_db()
    try:
        row = db.execute(
            "SELECT tier FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        tier = row["tier"] if row else "free"
        max_drafts = TIER_QUOTAS.get(tier, 20)

        quota = db.execute(
            "SELECT draft_count_today, last_reset_date FROM usage_quota WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        today = datetime.now().strftime("%Y-%m-%d")
        if quota and quota["last_reset_date"] != today:
            db.execute(
                "UPDATE usage_quota SET draft_count_today = 0, last_reset_date = ? WHERE user_id = ?",
                (today, user_id),
            )
            db.commit()
            count = 0
        else:
            count = quota["draft_count_today"] if quota else 0

        return {
            "tier": tier,
            "used": count,
            "limit": max_drafts,
            "remaining": max(0, max_drafts - count),
        }
    finally:
        db.close()


def increment_quota(user_id: str):
    db = get_db()
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        db.execute(
            "UPDATE usage_quota SET draft_count_today = draft_count_today + 1, last_reset_date = ? WHERE user_id = ?",
            (today, user_id),
        )
        db.commit()
    finally:
        db.close()


def has_permission(user_id: str, permission: str) -> bool:
    db = get_db()
    try:
        row = db.execute(
            "SELECT tier FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        tier = row["tier"] if row else "free"
        return permission in TIER_PERMISSIONS.get(tier, [])
    finally:
        db.close()


def log_audit(user_id: str, action: str, resource: str = None, detail: str = None):
    db = get_db()
    try:
        db.execute(
            "INSERT INTO audit_log (user_id, action, resource, detail) VALUES (?, ?, ?, ?)",
            (user_id, action, resource, detail),
        )
        db.commit()
    finally:
        db.close()


def get_audit_logs(user_id: str, limit: int = 50) -> list:
    db = get_db()
    try:
        rows = db.execute(
            "SELECT action, resource, detail, timestamp FROM audit_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        db.close()
