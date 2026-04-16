import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "war_hub.db")


def _utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now() -> str:
    return _utc_now_dt().isoformat()


def _utc_now_ts() -> int:
    return int(_utc_now_dt().timestamp())


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


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return int(default)
        return int(value)
    except Exception:
        return int(default)


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return _clean_text(value).lower() in {"1", "true", "yes", "y", "on", "enabled"}


def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            name TEXT DEFAULT '',
            api_key TEXT NOT NULL,
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            last_seen_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT DEFAULT '',
            last_seen_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kind TEXT DEFAULT '',
            text TEXT DEFAULT '',
            seen INTEGER DEFAULT 0,
            created_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS api_cache (
            cache_key TEXT PRIMARY KEY,
            payload_text TEXT DEFAULT '',
            expires_at_ts INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_user_id TEXT DEFAULT '',
            actor_name TEXT DEFAULT '',
            action TEXT DEFAULT '',
            meta_json TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faction_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            leader_user_id TEXT DEFAULT '',
            leader_name TEXT DEFAULT '',
            member_user_id TEXT DEFAULT '',
            member_name TEXT DEFAULT '',
            member_api_key TEXT DEFAULT '',
            position TEXT DEFAULT '',
            enabled INTEGER DEFAULT 1,
            activated_at TEXT DEFAULT '',
            cycle_locked INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, member_user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faction_terms_summary (
            faction_id TEXT PRIMARY KEY,
            faction_name TEXT DEFAULT '',
            text TEXT DEFAULT '',
            updated_by_user_id TEXT DEFAULT '',
            updated_by_name TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS hospital_dibs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            enemy_faction_id TEXT DEFAULT '',
            enemy_faction_name TEXT DEFAULT '',
            enemy_user_id TEXT NOT NULL,
            enemy_name TEXT DEFAULT '',
            dibbed_by_user_id TEXT DEFAULT '',
            dibbed_by_name TEXT DEFAULT '',
            dibbed_at TEXT DEFAULT '',
            in_hospital INTEGER DEFAULT 0,
            hospital_until_ts INTEGER DEFAULT 0,
            last_seen_in_hospital_at TEXT DEFAULT '',
            left_hospital_at TEXT DEFAULT '',
            dibs_lock_until_ts INTEGER DEFAULT 0,
            overview_remove_after_ts INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, enemy_user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id TEXT NOT NULL,
            owner_name TEXT DEFAULT '',
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            target_user_id TEXT NOT NULL,
            target_name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(owner_user_id, faction_id, target_user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chain_statuses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            user_id TEXT NOT NULL,
            user_name TEXT DEFAULT '',
            available INTEGER DEFAULT 0,
            sitter_enabled INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS med_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            user_id TEXT NOT NULL,
            user_name TEXT DEFAULT '',
            enemy_user_id TEXT NOT NULL,
            enemy_name TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS enemy_stat_predictions (
            faction_id TEXT NOT NULL,
            enemy_faction_id TEXT DEFAULT '',
            enemy_user_id TEXT NOT NULL,
            enemy_name TEXT DEFAULT '',
            predicted_total_stats INTEGER DEFAULT 0,
            predicted_total_stats_m REAL DEFAULT 0,
            confidence TEXT DEFAULT '',
            source TEXT DEFAULT '',
            summary TEXT DEFAULT '',
            raw_json TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            PRIMARY KEY (faction_id, enemy_user_id)
        )
        """
    )

    _ensure_column(cur, "faction_members", "activated_at", "activated_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_members", "cycle_locked", "cycle_locked INTEGER DEFAULT 0")
    _ensure_column(cur, "hospital_dibs", "faction_name", "faction_name TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "enemy_faction_id", "enemy_faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "enemy_faction_name", "enemy_faction_name TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "enemy_name", "enemy_name TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "dibbed_by_user_id", "dibbed_by_user_id TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "dibbed_by_name", "dibbed_by_name TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "dibbed_at", "dibbed_at TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "in_hospital", "in_hospital INTEGER DEFAULT 0")
    _ensure_column(cur, "hospital_dibs", "hospital_until_ts", "hospital_until_ts INTEGER DEFAULT 0")
    _ensure_column(cur, "hospital_dibs", "last_seen_in_hospital_at", "last_seen_in_hospital_at TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "left_hospital_at", "left_hospital_at TEXT DEFAULT ''")
    _ensure_column(cur, "hospital_dibs", "dibs_lock_until_ts", "dibs_lock_until_ts INTEGER DEFAULT 0")
    _ensure_column(cur, "hospital_dibs", "overview_remove_after_ts", "overview_remove_after_ts INTEGER DEFAULT 0")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_enemy_stat_predictions_enemy_faction_id ON enemy_stat_predictions(enemy_faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_faction_id ON users(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at_ts ON api_cache(expires_at_ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_faction_id ON faction_members(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_enabled ON faction_members(faction_id, enabled)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_hospital_dibs_faction_id ON hospital_dibs(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_hospital_dibs_enemy_faction_id ON hospital_dibs(enemy_faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_hospital_dibs_in_hospital ON hospital_dibs(faction_id, in_hospital)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_targets_owner_user_id ON user_targets(owner_user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_targets_owner_faction ON user_targets(owner_user_id, faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_targets_target_user_id ON user_targets(target_user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chain_statuses_faction_id ON chain_statuses(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chain_statuses_user_id ON chain_statuses(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_faction_id ON med_deals(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_user_id ON med_deals(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_enemy_user_id ON med_deals(enemy_user_id)")

    con.commit()
    con.close()


# users / sessions

def upsert_user(user_id: str, name: str, api_key: str, faction_id: str = "", faction_name: str = ""):
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO users (user_id, name, api_key, faction_id, faction_name, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            name = excluded.name,
            api_key = excluded.api_key,
            faction_id = excluded.faction_id,
            faction_name = excluded.faction_name,
            last_seen_at = excluded.last_seen_at
        """,
        (_clean_text(user_id), _clean_text(name), _clean_text(api_key), _clean_text(faction_id), _clean_text(faction_name), now, now),
    )
    con.commit()
    con.close()


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE user_id = ?", (_clean_text(user_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_users_by_faction(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE faction_id = ? ORDER BY LOWER(name) ASC", (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_user_map_by_faction(faction_id: str) -> Dict[str, Dict[str, Any]]:
    return {str(r.get("user_id") or ""): r for r in get_users_by_faction(faction_id)}


def create_session(user_id: str) -> Dict[str, Any]:
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)", (token, _clean_text(user_id), now, now))
    con.commit()
    con.close()
    return {"token": token, "user_id": _clean_text(user_id), "created_at": now, "last_seen_at": now}


def get_session(token: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM sessions WHERE token = ?", (_clean_text(token),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def touch_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE sessions SET last_seen_at = ? WHERE token = ?", (_utc_now(), _clean_text(token)))
    con.commit()
    con.close()


def delete_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE token = ?", (_clean_text(token),))
    con.commit()
    con.close()


def delete_sessions_for_user(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (_clean_text(user_id),))
    con.commit()
    con.close()


# notifications / audit / cache

def add_notification(user_id: str, kind: str, text: str) -> Dict[str, Any]:
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("INSERT INTO notifications (user_id, kind, text, seen, created_at) VALUES (?, ?, ?, 0, ?)", (_clean_text(user_id), _clean_text(kind), _clean_text(text), now))
    row_id = cur.lastrowid
    con.commit()
    con.close()
    return {"id": row_id, "user_id": _clean_text(user_id), "kind": _clean_text(kind), "text": _clean_text(text), "seen": 0, "created_at": now}


def list_notifications(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?", (_clean_text(user_id), int(limit or 50)))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def mark_notifications_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE notifications SET seen = 1 WHERE user_id = ?", (_clean_text(user_id),))
    con.commit()
    con.close()


def add_audit_log(actor_user_id: str = "", actor_name: str = "", action: str = "", meta_json: str = ""):
    con = _con()
    cur = con.cursor()
    cur.execute("INSERT INTO audit_log (actor_user_id, actor_name, action, meta_json, created_at) VALUES (?, ?, ?, ?, ?)", (_clean_text(actor_user_id), _clean_text(actor_name), _clean_text(action), _clean_text(meta_json), _utc_now()))
    con.commit()
    con.close()


def cache_get(cache_key: str):
    now_ts = int(_utc_now_dt().timestamp())
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT payload_text FROM api_cache WHERE cache_key = ? AND expires_at_ts > ? LIMIT 1", (_clean_text(cache_key), now_ts))
    row = cur.fetchone()
    con.close()
    return str(row["payload_text"]) if row else None


def cache_set(cache_key: str, payload_text: str, ttl_seconds: int):
    now = _utc_now()
    expires_at = int(_utc_now_dt().timestamp()) + int(max(0, ttl_seconds or 0))
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO api_cache (cache_key, payload_text, expires_at_ts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            payload_text = excluded.payload_text,
            expires_at_ts = excluded.expires_at_ts,
            updated_at = excluded.updated_at
        """,
        (_clean_text(cache_key), str(payload_text or ""), expires_at, now, now),
    )
    con.commit()
    con.close()


# faction member access

def list_faction_members(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_members WHERE faction_id = ? ORDER BY LOWER(member_name) ASC, member_user_id ASC", (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_faction_member_access(faction_id: str, member_user_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    member_user_id = _clean_text(member_user_id)
    if not faction_id or not member_user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_members WHERE faction_id = ? AND member_user_id = ? LIMIT 1", (faction_id, member_user_id))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_member_access_record(member_user_id: str) -> Optional[Dict[str, Any]]:
    member_user_id = _clean_text(member_user_id)
    if not member_user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_members WHERE member_user_id = ? AND enabled = 1 ORDER BY id DESC LIMIT 1", (member_user_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_faction_member_access(
    faction_id: str,
    faction_name: str = "",
    leader_user_id: str = "",
    leader_name: str = "",
    member_user_id: str = "",
    member_name: str = "",
    member_api_key: str = "",
    enabled: int = 1,
    position: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    member_user_id = _clean_text(member_user_id)
    if not faction_id:
        raise ValueError("Missing faction_id.")
    if not member_user_id:
        raise ValueError("Missing member_user_id.")
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO faction_members (
            faction_id, faction_name, leader_user_id, leader_name,
            member_user_id, member_name, member_api_key, position,
            enabled, activated_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, member_user_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            leader_user_id = excluded.leader_user_id,
            leader_name = excluded.leader_name,
            member_name = CASE WHEN excluded.member_name != '' THEN excluded.member_name ELSE faction_members.member_name END,
            member_api_key = CASE WHEN excluded.member_api_key != '' THEN excluded.member_api_key ELSE faction_members.member_api_key END,
            position = CASE WHEN excluded.position != '' THEN excluded.position ELSE faction_members.position END,
            enabled = excluded.enabled,
            activated_at = CASE WHEN faction_members.activated_at = '' THEN excluded.activated_at ELSE faction_members.activated_at END,
            updated_at = excluded.updated_at
        """,
        (faction_id, _clean_text(faction_name), _clean_text(leader_user_id), _clean_text(leader_name), member_user_id, _clean_text(member_name), _clean_text(member_api_key), _clean_text(position), 1 if _safe_bool(enabled) else 0, now, now, now),
    )
    con.commit()
    con.close()
    return get_faction_member_access(faction_id, member_user_id) or {}


def set_faction_member_enabled(faction_id: str, member_user_id: str, enabled: int, changed_by_user_id: str = "", changed_by_name: str = "") -> Dict[str, Any]:
    row = get_faction_member_access(faction_id, member_user_id)
    if not row:
        raise ValueError("Faction member access row not found.")
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE faction_members SET enabled = ?, updated_at = ? WHERE faction_id = ? AND member_user_id = ?", (1 if _safe_bool(enabled) else 0, _utc_now(), _clean_text(faction_id), _clean_text(member_user_id)))
    con.commit()
    con.close()
    add_audit_log(changed_by_user_id, changed_by_name, "faction_member_enabled_changed", f"faction_id={faction_id} member_user_id={member_user_id} enabled={1 if _safe_bool(enabled) else 0}")
    return get_faction_member_access(faction_id, member_user_id) or {}


def delete_faction_member_access(faction_id: str, member_user_id: str):
    row = get_faction_member_access(faction_id, member_user_id)
    if not row:
        raise ValueError("Faction member access row not found.")
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM faction_members WHERE faction_id = ? AND member_user_id = ?", (_clean_text(faction_id), _clean_text(member_user_id)))
    con.commit()
    con.close()


# faction shared notes

def get_faction_terms_summary(faction_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_terms_summary WHERE faction_id = ? LIMIT 1", (faction_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_faction_terms_summary(
    faction_id: str,
    faction_name: str = "",
    text: str = "",
    updated_by_user_id: str = "",
    updated_by_name: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {}
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO faction_terms_summary (
            faction_id, faction_name, text, updated_by_user_id, updated_by_name, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            text = excluded.text,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_by_name = excluded.updated_by_name,
            updated_at = excluded.updated_at
        """,
        (faction_id, _clean_text(faction_name), str(text or ""), _clean_text(updated_by_user_id), _clean_text(updated_by_name), now, now),
    )
    con.commit()
    con.close()
    add_audit_log(_clean_text(updated_by_user_id), _clean_text(updated_by_name), "faction_terms_summary_saved", f"faction_id={faction_id}")
    return get_faction_terms_summary(faction_id) or {}


def delete_faction_terms_summary(faction_id: str):
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM faction_terms_summary WHERE faction_id = ?", (faction_id,))
    con.commit()
    con.close()


# personal user targets

def list_user_targets(user_id: str, faction_id: str = "") -> List[Dict[str, Any]]:
    user_id = _clean_text(user_id)
    faction_id = _clean_text(faction_id)
    if not user_id:
        return []
    con = _con()
    cur = con.cursor()
    if faction_id:
        cur.execute(
            """
            SELECT *
            FROM user_targets
            WHERE owner_user_id = ? AND faction_id = ?
            ORDER BY LOWER(COALESCE(NULLIF(target_name, ''), target_user_id)) ASC, id ASC
            """,
            (user_id, faction_id),
        )
    else:
        cur.execute(
            """
            SELECT *
            FROM user_targets
            WHERE owner_user_id = ?
            ORDER BY LOWER(COALESCE(NULLIF(target_name, ''), target_user_id)) ASC, id ASC
            """,
            (user_id,),
        )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_user_target(
    owner_user_id: str,
    owner_name: str = "",
    faction_id: str = "",
    faction_name: str = "",
    target_user_id: str = "",
    target_name: str = "",
    note: str = "",
) -> Dict[str, Any]:
    owner_user_id = _clean_text(owner_user_id)
    faction_id = _clean_text(faction_id)
    target_user_id = _clean_text(target_user_id)
    if not owner_user_id:
        raise ValueError("Missing owner_user_id.")
    if not target_user_id:
        raise ValueError("Missing target_user_id.")
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO user_targets (
            owner_user_id, owner_name, faction_id, faction_name,
            target_user_id, target_name, note, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_user_id, faction_id, target_user_id) DO UPDATE SET
            owner_name = excluded.owner_name,
            faction_name = excluded.faction_name,
            target_name = excluded.target_name,
            note = excluded.note,
            updated_at = excluded.updated_at
        """,
        (owner_user_id, _clean_text(owner_name), faction_id, _clean_text(faction_name), target_user_id, _clean_text(target_name), str(note or ""), now, now),
    )
    con.commit()
    con.close()
    add_audit_log(owner_user_id, _clean_text(owner_name), "user_target_upserted", f"faction_id={faction_id};target_user_id={target_user_id}")
    for item in list_user_targets(owner_user_id, faction_id=faction_id):
        if _clean_text(item.get("target_user_id")) == target_user_id:
            return item
    return {}


def delete_user_target(owner_user_id: str, target_user_id: str, faction_id: str = ""):
    owner_user_id = _clean_text(owner_user_id)
    target_user_id = _clean_text(target_user_id)
    faction_id = _clean_text(faction_id)
    if not owner_user_id or not target_user_id:
        return
    con = _con()
    cur = con.cursor()
    if faction_id:
        cur.execute("DELETE FROM user_targets WHERE owner_user_id = ? AND faction_id = ? AND target_user_id = ?", (owner_user_id, faction_id, target_user_id))
    else:
        cur.execute("DELETE FROM user_targets WHERE owner_user_id = ? AND target_user_id = ?", (owner_user_id, target_user_id))
    con.commit()
    con.close()
    add_audit_log(owner_user_id, "", "user_target_deleted", f"faction_id={faction_id};target_user_id={target_user_id}")


# chain / med deals

def get_chain_status(faction_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    user_id = _clean_text(user_id)
    if not faction_id or not user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM chain_statuses WHERE faction_id = ? AND user_id = ? LIMIT 1", (faction_id, user_id))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_chain_status(faction_id: str, faction_name: str = "", user_id: str = "", user_name: str = "", available: Optional[bool] = None, sitter_enabled: Optional[bool] = None) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    user_id = _clean_text(user_id)
    if not faction_id or not user_id:
        return {}
    existing = get_chain_status(faction_id, user_id) or {}
    now = _utc_now()
    available_val = _safe_bool(existing.get("available")) if available is None else bool(available)
    sitter_val = _safe_bool(existing.get("sitter_enabled")) if sitter_enabled is None else bool(sitter_enabled)
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO chain_statuses (faction_id, faction_name, user_id, user_name, available, sitter_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, user_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            user_name = excluded.user_name,
            available = excluded.available,
            sitter_enabled = excluded.sitter_enabled,
            updated_at = excluded.updated_at
        """,
        (faction_id, _clean_text(faction_name), user_id, _clean_text(user_name), 1 if available_val else 0, 1 if sitter_val else 0, now, now),
    )
    con.commit()
    con.close()
    return get_chain_status(faction_id, user_id) or {}


def list_chain_statuses(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM chain_statuses WHERE faction_id = ? ORDER BY LOWER(COALESCE(NULLIF(user_name, ''), user_id)) ASC", (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_med_deal(faction_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    user_id = _clean_text(user_id)
    if not faction_id or not user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM med_deals WHERE faction_id = ? AND user_id = ? LIMIT 1", (faction_id, user_id))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_med_deal(faction_id: str, faction_name: str = "", user_id: str = "", user_name: str = "", enemy_user_id: str = "", enemy_name: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    user_id = _clean_text(user_id)
    enemy_user_id = _clean_text(enemy_user_id)
    if not faction_id or not user_id or not enemy_user_id:
        return {}
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO med_deals (faction_id, faction_name, user_id, user_name, enemy_user_id, enemy_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, user_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            user_name = excluded.user_name,
            enemy_user_id = excluded.enemy_user_id,
            enemy_name = excluded.enemy_name,
            updated_at = excluded.updated_at
        """,
        (faction_id, _clean_text(faction_name), user_id, _clean_text(user_name), enemy_user_id, _clean_text(enemy_name), now, now),
    )
    con.commit()
    con.close()
    return get_med_deal(faction_id, user_id) or {}


def list_med_deals(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM med_deals WHERE faction_id = ? ORDER BY LOWER(COALESCE(NULLIF(user_name, ''), user_id)) ASC", (faction_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_med_deal(faction_id: str, user_id: str = "", enemy_user_id: str = ""):
    faction_id = _clean_text(faction_id)
    user_id = _clean_text(user_id)
    enemy_user_id = _clean_text(enemy_user_id)
    if not faction_id:
        return
    con = _con()
    cur = con.cursor()
    if user_id and enemy_user_id:
        cur.execute("DELETE FROM med_deals WHERE faction_id = ? AND user_id = ? AND enemy_user_id = ?", (faction_id, user_id, enemy_user_id))
    elif user_id:
        cur.execute("DELETE FROM med_deals WHERE faction_id = ? AND user_id = ?", (faction_id, user_id))
    elif enemy_user_id:
        cur.execute("DELETE FROM med_deals WHERE faction_id = ? AND enemy_user_id = ?", (faction_id, enemy_user_id))
    else:
        con.close()
        return
    con.commit()
    con.close()


# hospital dibs

def _hospital_dibs_cleanup_for_faction(faction_id: str):
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return
    now_ts = _utc_now_ts()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        DELETE FROM hospital_dibs
        WHERE faction_id = ?
          AND in_hospital = 0
          AND overview_remove_after_ts > 0
          AND overview_remove_after_ts <= ?
        """,
        (faction_id, now_ts),
    )
    con.commit()
    con.close()


def get_hospital_dib(faction_id: str, enemy_user_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    enemy_user_id = _clean_text(enemy_user_id)
    if not faction_id or not enemy_user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM hospital_dibs WHERE faction_id = ? AND enemy_user_id = ? LIMIT 1", (faction_id, enemy_user_id))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def list_hospital_dibs(faction_id: str, include_recent: bool = False) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    _hospital_dibs_cleanup_for_faction(faction_id)
    now_ts = _utc_now_ts()
    con = _con()
    cur = con.cursor()
    if include_recent:
        cur.execute(
            """
            SELECT *
            FROM hospital_dibs
            WHERE faction_id = ?
              AND (in_hospital = 1 OR overview_remove_after_ts > ?)
            ORDER BY
                CASE WHEN in_hospital = 1 THEN 0 ELSE 1 END,
                LOWER(enemy_name),
                enemy_user_id
            """,
            (faction_id, now_ts),
        )
    else:
        cur.execute("SELECT * FROM hospital_dibs WHERE faction_id = ? AND in_hospital = 1 ORDER BY LOWER(enemy_name), enemy_user_id", (faction_id,))
    rows = [_row_to_dict(r) or {} for r in cur.fetchall()]
    con.close()
    return rows


def sync_hospital_dibs_snapshot(
    faction_id: str,
    faction_name: str = "",
    enemy_faction_id: str = "",
    enemy_faction_name: str = "",
    members: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []

    now = _utc_now()
    now_ts = _utc_now_ts()
    members = list(members or [])
    current_ids = set()

    con = _con()
    cur = con.cursor()

    for member in members:
        enemy_user_id = _clean_text(member.get("user_id"))
        if not enemy_user_id:
            continue
        current_ids.add(enemy_user_id)
        enemy_name = _clean_text(member.get("name"))
        hospital_until_ts = _to_int(member.get("hospital_until_ts"), 0)

        cur.execute(
            """
            INSERT INTO hospital_dibs (
                faction_id, faction_name, enemy_faction_id, enemy_faction_name, enemy_user_id, enemy_name,
                dibbed_by_user_id, dibbed_by_name, dibbed_at, in_hospital, hospital_until_ts,
                last_seen_in_hospital_at, left_hospital_at, dibs_lock_until_ts, overview_remove_after_ts,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, '', '', '', 1, ?, ?, '', 0, 0, ?, ?)
            ON CONFLICT(faction_id, enemy_user_id) DO UPDATE SET
                faction_name = excluded.faction_name,
                enemy_faction_id = excluded.enemy_faction_id,
                enemy_faction_name = excluded.enemy_faction_name,
                enemy_name = excluded.enemy_name,
                in_hospital = 1,
                hospital_until_ts = CASE
                    WHEN excluded.hospital_until_ts > 0 THEN excluded.hospital_until_ts
                    ELSE hospital_dibs.hospital_until_ts
                END,
                last_seen_in_hospital_at = excluded.last_seen_in_hospital_at,
                updated_at = excluded.updated_at
            """,
            (faction_id, _clean_text(faction_name), _clean_text(enemy_faction_id), _clean_text(enemy_faction_name), enemy_user_id, enemy_name, hospital_until_ts, now, now, now),
        )

    cur.execute("SELECT enemy_user_id, dibbed_by_user_id, left_hospital_at FROM hospital_dibs WHERE faction_id = ? AND in_hospital = 1", (faction_id,))
    for row in cur.fetchall():
        enemy_user_id = _clean_text(row["enemy_user_id"])
        if enemy_user_id in current_ids:
            continue
        dibbed_by_user_id = _clean_text(row["dibbed_by_user_id"])
        cur.execute(
            """
            UPDATE hospital_dibs
            SET in_hospital = 0,
                left_hospital_at = CASE WHEN COALESCE(left_hospital_at, '') = '' THEN ? ELSE left_hospital_at END,
                dibs_lock_until_ts = CASE WHEN ? != '' THEN ? ELSE dibs_lock_until_ts END,
                overview_remove_after_ts = CASE WHEN ? != '' THEN ? ELSE overview_remove_after_ts END,
                updated_at = ?
            WHERE faction_id = ? AND enemy_user_id = ?
            """,
            (now, dibbed_by_user_id, now_ts + 30, dibbed_by_user_id, now_ts + 45, now, faction_id, enemy_user_id),
        )

    con.commit()
    con.close()
    _hospital_dibs_cleanup_for_faction(faction_id)
    return list_hospital_dibs(faction_id, include_recent=True)


def claim_hospital_dib(
    faction_id: str,
    enemy_user_id: str,
    dibbed_by_user_id: str,
    dibbed_by_name: str,
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    enemy_user_id = _clean_text(enemy_user_id)
    dibbed_by_user_id = _clean_text(dibbed_by_user_id)
    dibbed_by_name = _clean_text(dibbed_by_name)
    if not faction_id or not enemy_user_id or not dibbed_by_user_id:
        return {"ok": False, "error": "Missing dibs details."}

    _hospital_dibs_cleanup_for_faction(faction_id)
    now = _utc_now()
    now_ts = _utc_now_ts()

    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM hospital_dibs WHERE faction_id = ? AND enemy_user_id = ? LIMIT 1", (faction_id, enemy_user_id))
    row = _row_to_dict(cur.fetchone())

    if not row:
        con.close()
        return {"ok": False, "error": "Enemy not found in hospital list."}
    if not _safe_bool(row.get("in_hospital")):
        con.close()
        return {"ok": False, "error": "Enemy is not currently in hospital."}

    existing_dibbed_by_user_id = _clean_text(row.get("dibbed_by_user_id"))
    dibs_lock_until_ts = _to_int(row.get("dibs_lock_until_ts"), 0)
    if existing_dibbed_by_user_id and existing_dibbed_by_user_id != dibbed_by_user_id and dibs_lock_until_ts > now_ts:
        con.close()
        return {"ok": False, "error": "This enemy is temporarily dibbed by someone else."}

    cur.execute(
        """
        UPDATE hospital_dibs
        SET dibbed_by_user_id = ?,
            dibbed_by_name = ?,
            dibbed_at = ?,
            dibs_lock_until_ts = 0,
            overview_remove_after_ts = 0,
            updated_at = ?
        WHERE faction_id = ? AND enemy_user_id = ?
        """,
        (dibbed_by_user_id, dibbed_by_name, now, now, faction_id, enemy_user_id),
    )
    con.commit()
    con.close()

    item = get_hospital_dib(faction_id, enemy_user_id) or {}
    add_audit_log(dibbed_by_user_id, dibbed_by_name, "hospital_dib_claimed", f"faction_id={faction_id};enemy_user_id={enemy_user_id}")
    return {"ok": True, "item": item}


def list_overview_dibs(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    _hospital_dibs_cleanup_for_faction(faction_id)
    now_ts = _utc_now_ts()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT *
        FROM hospital_dibs
        WHERE faction_id = ?
          AND dibbed_by_user_id != ''
          AND (in_hospital = 1 OR overview_remove_after_ts > ?)
        ORDER BY
            CASE WHEN in_hospital = 1 THEN 0 ELSE 1 END,
            LOWER(enemy_name),
            enemy_user_id
        """,
        (faction_id, now_ts),
    )
    rows = [_row_to_dict(r) or {} for r in cur.fetchall()]
    con.close()
    return rows


# enemy stat predictions

def get_enemy_stat_prediction(faction_id: str, enemy_user_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    enemy_user_id = _clean_text(enemy_user_id)
    if not faction_id or not enemy_user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT *
        FROM enemy_stat_predictions
        WHERE faction_id = ? AND enemy_user_id = ?
        LIMIT 1
        """,
        (faction_id, enemy_user_id),
    )
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def list_enemy_stat_predictions(faction_id: str) -> List[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return []
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT *
        FROM enemy_stat_predictions
        WHERE faction_id = ?
        ORDER BY LOWER(COALESCE(NULLIF(enemy_name, ''), enemy_user_id)) ASC
        """,
        (faction_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_enemy_stat_prediction(
    faction_id: str,
    enemy_faction_id: str = "",
    enemy_user_id: str = "",
    enemy_name: str = "",
    predicted_total_stats: int = 0,
    predicted_total_stats_m: float = 0.0,
    confidence: str = "",
    source: str = "",
    summary: str = "",
    raw_json: Any = None,
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    enemy_user_id = _clean_text(enemy_user_id)
    if not faction_id or not enemy_user_id:
        return {}
    now = _utc_now()
    raw_json_text = json.dumps(raw_json or {}, ensure_ascii=False)
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO enemy_stat_predictions (
            faction_id, enemy_faction_id, enemy_user_id, enemy_name,
            predicted_total_stats, predicted_total_stats_m, confidence, source, summary, raw_json,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, enemy_user_id) DO UPDATE SET
            enemy_faction_id = excluded.enemy_faction_id,
            enemy_name = excluded.enemy_name,
            predicted_total_stats = excluded.predicted_total_stats,
            predicted_total_stats_m = excluded.predicted_total_stats_m,
            confidence = excluded.confidence,
            source = excluded.source,
            summary = excluded.summary,
            raw_json = excluded.raw_json,
            updated_at = excluded.updated_at
        """,
        (
            faction_id,
            _clean_text(enemy_faction_id),
            enemy_user_id,
            _clean_text(enemy_name),
            _to_int(predicted_total_stats, 0),
            float(predicted_total_stats_m or 0.0),
            _clean_text(confidence),
            _clean_text(source),
            _clean_text(summary),
            raw_json_text,
            now,
            now,
        ),
    )
    con.commit()
    con.close()
    return get_enemy_stat_prediction(faction_id, enemy_user_id) or {}
