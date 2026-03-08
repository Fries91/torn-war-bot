import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "war_hub.db")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_parent_dir(path: str):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _con():
    _ensure_parent_dir(DB_PATH)
    con = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con


def _row_to_dict(row) -> Optional[Dict[str, Any]]:
    return dict(row) if row else None


def _table_columns(cur, table_name: str) -> List[str]:
    cur.execute(f"PRAGMA table_info({table_name})")
    return [str(r["name"]) for r in cur.fetchall()]


def _ensure_column(cur, table_name: str, column_name: str, column_sql: str):
    cols = _table_columns(cur, table_name)
    if column_name not in cols:
        cur.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}")


def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            api_key TEXT NOT NULL,
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            available INTEGER DEFAULT 1,
            chain_sitter INTEGER DEFAULT 0,
            created_at TEXT,
            last_seen_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT,
            last_seen_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS med_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            buyer_name TEXT DEFAULT '',
            seller_name TEXT DEFAULT '',
            amount INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            target_id TEXT DEFAULT '',
            target_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bounties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            target_id TEXT DEFAULT '',
            target_name TEXT DEFAULT '',
            reward_text TEXT DEFAULT '',
            created_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kind TEXT DEFAULT '',
            text TEXT DEFAULT '',
            seen INTEGER DEFAULT 0,
            created_at TEXT
        )
    """)

    # Backfill / migration-safe columns for faction-wide med deals
    _ensure_column(cur, "med_deals", "creator_user_id", "creator_user_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "creator_name", "creator_name TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_id", "faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_name", "faction_name TEXT DEFAULT ''")

    # Copy old user_id values into creator_user_id where missing
    cur.execute("""
        UPDATE med_deals
        SET creator_user_id = COALESCE(NULLIF(creator_user_id, ''), user_id)
    """)
    cur.execute("""
        UPDATE med_deals
        SET creator_name = COALESCE(NULLIF(creator_name, ''), buyer_name)
        WHERE COALESCE(NULLIF(creator_name, ''), '') = ''
    """)

    con.commit()
    con.close()


def upsert_user(
    user_id: str,
    name: str,
    api_key: str,
    faction_id: str = "",
    faction_name: str = "",
):
    now = _utc_now()
    con = _con()
    cur = con.cursor()

    cur.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,))
    existing = cur.fetchone()

    if existing:
        cur.execute("""
            UPDATE users
            SET name = ?, api_key = ?, faction_id = ?, faction_name = ?, last_seen_at = ?
            WHERE user_id = ?
        """, (name, api_key, faction_id, faction_name, now, user_id))
    else:
        cur.execute("""
            INSERT INTO users (
                user_id, name, api_key, faction_id, faction_name,
                available, chain_sitter, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
        """, (user_id, name, api_key, faction_id, faction_name, now, now))

    con.commit()
    con.close()


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_users_by_faction(faction_id: str) -> List[Dict[str, Any]]:
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM users
        WHERE faction_id = ?
        ORDER BY LOWER(name) ASC
    """, (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_user_map_by_faction(faction_id: str) -> Dict[str, Dict[str, Any]]:
    rows = get_users_by_faction(faction_id)
    return {str(r["user_id"]): r for r in rows}


def create_session(user_id: str) -> str:
    token = secrets.token_hex(24)
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO sessions (token, user_id, created_at, last_seen_at)
        VALUES (?, ?, ?, ?)
    """, (token, user_id, now, now))
    con.commit()
    con.close()
    return token


def get_session(token: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM sessions WHERE token = ?", (token,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def touch_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE sessions SET last_seen_at = ? WHERE token = ?",
        (_utc_now(), token),
    )
    con.commit()
    con.close()


def set_availability(user_id: str, available: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE users
        SET available = ?, last_seen_at = ?
        WHERE user_id = ?
    """, (1 if available else 0, _utc_now(), user_id))
    con.commit()
    con.close()


def set_chain_sitter(user_id: str, enabled: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE users
        SET chain_sitter = ?, last_seen_at = ?
        WHERE user_id = ?
    """, (1 if enabled else 0, _utc_now(), user_id))
    con.commit()
    con.close()


def add_med_deal(
    creator_user_id: str,
    creator_name: str,
    faction_id: str,
    faction_name: str,
    buyer_name: str,
    seller_name: str,
    amount: int,
    notes: str,
):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO med_deals (
            user_id,
            creator_user_id,
            creator_name,
            faction_id,
            faction_name,
            buyer_name,
            seller_name,
            amount,
            notes,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        creator_user_id,
        creator_user_id,
        creator_name,
        faction_id,
        faction_name,
        buyer_name,
        seller_name,
        amount,
        notes,
        _utc_now(),
    ))
    con.commit()
    con.close()


def list_med_deals(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM med_deals
        WHERE user_id = ?
        ORDER BY id DESC
    """, (user_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def list_med_deals_for_faction(faction_id: str) -> List[Dict[str, Any]]:
    if not faction_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM med_deals
        WHERE faction_id = ?
        ORDER BY id DESC
    """, (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_med_deal(faction_id: str, deal_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        DELETE FROM med_deals
        WHERE faction_id = ? AND id = ?
    """, (faction_id, deal_id))
    con.commit()
    con.close()


def add_target(user_id: str, target_id: str, target_name: str, notes: str):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO targets (user_id, target_id, target_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, target_id, target_name, notes, _utc_now()))
    con.commit()
    con.close()


def list_targets(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM targets
        WHERE user_id = ?
        ORDER BY id DESC
    """, (user_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_target(user_id: str, target_row_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM targets WHERE user_id = ? AND id = ?", (user_id, target_row_id))
    con.commit()
    con.close()


def add_bounty(user_id: str, target_id: str, target_name: str, reward_text: str):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO bounties (user_id, target_id, target_name, reward_text, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (user_id, target_id, target_name, reward_text, _utc_now()))
    con.commit()
    con.close()


def list_bounties(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM bounties
        WHERE user_id = ?
        ORDER BY id DESC
    """, (user_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_bounty(user_id: str, bounty_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM bounties WHERE user_id = ? AND id = ?", (user_id, bounty_id))
    con.commit()
    con.close()


def add_notification(user_id: str, kind: str, text: str):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO notifications (user_id, kind, text, seen, created_at)
        VALUES (?, ?, ?, 0, ?)
    """, (user_id, kind, text, _utc_now()))
    con.commit()
    con.close()


def list_notifications(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50
    """, (user_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def mark_notifications_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE notifications SET seen = 1 WHERE user_id = ?", (user_id,))
    con.commit()
    con.close()
