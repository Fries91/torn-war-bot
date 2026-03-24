import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "war_hub.db")
TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "45"))
DEFAULT_PAID_DAYS = int(os.getenv("DEFAULT_PAID_DAYS", "45"))
PAYMENT_PLAYER = str(os.getenv("PAYMENT_PLAYER", "Fries91")).strip() or "Fries91"
PAYMENT_KIND = str(os.getenv("PAYMENT_KIND", "xanax")).strip() or "xanax"
PAYMENT_XANAX_PER_MEMBER = int(os.getenv("PAYMENT_XANAX_PER_MEMBER", "3"))
PAYMENT_NOTIFY_USER_ID = str(os.getenv("PAYMENT_NOTIFY_USER_ID", "3679030")).strip() or "3679030"


def _utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now() -> str:
    return _utc_now_dt().isoformat()


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


def _parse_iso(value: str) -> Optional[datetime]:
    try:
        if not value:
            return None
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _future_iso(days: int) -> str:
    return (_utc_now_dt() + timedelta(days=int(days))).isoformat()


def _days_left_until(dt: Optional[datetime]) -> Optional[int]:
    if not dt:
        return None
    try:
        return int((dt - _utc_now_dt()).total_seconds() // 86400)
    except Exception:
        return None


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


def _faction_payment_text(enabled_member_count: int) -> str:
    total_amount = int(enabled_member_count or 0) * int(PAYMENT_XANAX_PER_MEMBER)
    return f"Send {total_amount} {PAYMENT_KIND} to {PAYMENT_PLAYER} [{PAYMENT_NOTIFY_USER_ID}]."


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
        CREATE TABLE IF NOT EXISTS faction_licenses (
            faction_id TEXT PRIMARY KEY,
            faction_name TEXT DEFAULT '',
            leader_user_id TEXT DEFAULT '',
            leader_name TEXT DEFAULT '',
            leader_api_key TEXT DEFAULT '',
            trial_started_at TEXT DEFAULT '',
            trial_expires_at TEXT DEFAULT '',
            paid_until_at TEXT DEFAULT '',
            payment_required INTEGER DEFAULT 0,
            status TEXT DEFAULT 'inactive',
            renewal_cost INTEGER DEFAULT 0,
            member_count INTEGER DEFAULT 0,
            enabled_member_count INTEGER DEFAULT 0,
            payment_per_member INTEGER DEFAULT 0,
            last_payment_amount INTEGER DEFAULT 0,
            last_payment_kind TEXT DEFAULT '',
            last_payment_note TEXT DEFAULT '',
            last_payment_at TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
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
            last_renewed_at TEXT DEFAULT '',
            cycle_locked INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, member_user_id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faction_payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            leader_user_id TEXT DEFAULT '',
            leader_name TEXT DEFAULT '',
            amount INTEGER DEFAULT 0,
            payment_kind TEXT DEFAULT 'xanax',
            note TEXT DEFAULT '',
            received_by TEXT DEFAULT '',
            received_at TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faction_exemptions (
            faction_id TEXT PRIMARY KEY,
            faction_name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            added_by_user_id TEXT DEFAULT '',
            added_by_name TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
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
        CREATE TABLE IF NOT EXISTS user_exemptions (
            user_id TEXT PRIMARY KEY,
            user_name TEXT DEFAULT '',
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            added_by_user_id TEXT DEFAULT '',
            added_by_name TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
        """
    )

    _ensure_column(cur, "faction_members", "activated_at", "activated_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_members", "last_renewed_at", "last_renewed_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_members", "cycle_locked", "cycle_locked INTEGER DEFAULT 0")
    _ensure_column(cur, "faction_licenses", "leader_api_key", "leader_api_key TEXT DEFAULT ''")

    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_faction_id ON users(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at_ts ON api_cache(expires_at_ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_faction_id ON faction_members(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_enabled ON faction_members(faction_id, enabled)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_payment_history_faction_id ON faction_payment_history(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_exemptions_name ON faction_exemptions(faction_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_exemptions_name ON user_exemptions(user_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_exemptions_faction_id ON user_exemptions(faction_id)")

    con.commit()
    con.close()


# -----------------------------
# users / sessions
# -----------------------------

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
    cur.execute(
        "INSERT INTO sessions (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        (token, _clean_text(user_id), now, now),
    )
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


# -----------------------------
# notifications / audit / cache
# -----------------------------

def add_notification(user_id: str, kind: str, text: str) -> Dict[str, Any]:
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO notifications (user_id, kind, text, seen, created_at) VALUES (?, ?, ?, 0, ?)",
        (_clean_text(user_id), _clean_text(kind), _clean_text(text), now),
    )
    row_id = cur.lastrowid
    con.commit()
    con.close()
    return {"id": row_id, "user_id": _clean_text(user_id), "kind": _clean_text(kind), "text": _clean_text(text), "seen": 0, "created_at": now}


def list_notifications(user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?",
        (_clean_text(user_id), int(limit or 50)),
    )
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
    cur.execute(
        "INSERT INTO audit_log (actor_user_id, actor_name, action, meta_json, created_at) VALUES (?, ?, ?, ?, ?)",
        (_clean_text(actor_user_id), _clean_text(actor_name), _clean_text(action), _clean_text(meta_json), _utc_now()),
    )
    con.commit()
    con.close()


def cache_get(cache_key: str):
    now_ts = int(_utc_now_dt().timestamp())
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT payload_text FROM api_cache WHERE cache_key = ? AND expires_at_ts > ? LIMIT 1",
        (_clean_text(cache_key), now_ts),
    )
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


# -----------------------------
# exemptions
# -----------------------------

def get_faction_exemption(faction_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_exemptions WHERE faction_id = ? LIMIT 1", (faction_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_user_exemption(user_id: str) -> Optional[Dict[str, Any]]:
    user_id = _clean_text(user_id)
    if not user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM user_exemptions WHERE user_id = ? LIMIT 1", (user_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def list_faction_exemptions(limit: int = 250) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_exemptions ORDER BY LOWER(COALESCE(NULLIF(faction_name, ''), faction_id)) ASC LIMIT ?", (int(limit),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def list_user_exemptions(limit: int = 250) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM user_exemptions ORDER BY LOWER(COALESCE(NULLIF(user_name, ''), user_id)) ASC LIMIT ?", (int(limit),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_faction_exemption(faction_id: str, faction_name: str = "", note: str = "", added_by_user_id: str = "", added_by_name: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {}
    ensure_faction_license_row(faction_id=faction_id, faction_name=faction_name)
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO faction_exemptions (faction_id, faction_name, note, added_by_user_id, added_by_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            note = excluded.note,
            added_by_user_id = excluded.added_by_user_id,
            added_by_name = excluded.added_by_name,
            updated_at = excluded.updated_at
        """,
        (faction_id, _clean_text(faction_name), _clean_text(note), _clean_text(added_by_user_id), _clean_text(added_by_name), now, now),
    )
    con.commit()
    con.close()
    recalc_faction_license(faction_id)
    add_audit_log(added_by_user_id, added_by_name, "faction_exemption_upserted", f"faction_id={faction_id}")
    return get_faction_exemption(faction_id) or {}


def delete_faction_exemption(faction_id: str):
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM faction_exemptions WHERE faction_id = ?", (faction_id,))
    con.commit()
    con.close()
    recalc_faction_license(faction_id)


def upsert_user_exemption(user_id: str, user_name: str = "", faction_id: str = "", faction_name: str = "", note: str = "", added_by_user_id: str = "", added_by_name: str = "") -> Dict[str, Any]:
    user_id = _clean_text(user_id)
    if not user_id:
        return {}
    user_row = get_user(user_id) or {}
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO user_exemptions (user_id, user_name, faction_id, faction_name, note, added_by_user_id, added_by_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            user_name = excluded.user_name,
            faction_id = excluded.faction_id,
            faction_name = excluded.faction_name,
            note = excluded.note,
            added_by_user_id = excluded.added_by_user_id,
            added_by_name = excluded.added_by_name,
            updated_at = excluded.updated_at
        """,
        (
            user_id,
            _clean_text(user_name) or _clean_text(user_row.get("name")),
            _clean_text(faction_id) or _clean_text(user_row.get("faction_id")),
            _clean_text(faction_name) or _clean_text(user_row.get("faction_name")),
            _clean_text(note),
            _clean_text(added_by_user_id),
            _clean_text(added_by_name),
            now,
            now,
        ),
    )
    con.commit()
    con.close()
    add_audit_log(added_by_user_id, added_by_name, "user_exemption_upserted", f"user_id={user_id}")
    return get_user_exemption(user_id) or {}


def delete_user_exemption(user_id: str):
    user_id = _clean_text(user_id)
    if not user_id:
        return
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM user_exemptions WHERE user_id = ?", (user_id,))
    con.commit()
    con.close()


# -----------------------------
# faction license / member access
# -----------------------------

def ensure_faction_license_row(faction_id: str, faction_name: str = "", leader_user_id: str = "", leader_name: str = "", leader_api_key: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {}
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO faction_licenses (
            faction_id, faction_name, leader_user_id, leader_name, leader_api_key,
            trial_started_at, trial_expires_at, paid_until_at, payment_required,
            status, renewal_cost, member_count, enabled_member_count, payment_per_member,
            last_payment_amount, last_payment_kind, last_payment_note, last_payment_at,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, '', '', '', 0, 'inactive', 0, 0, 0, ?, 0, '', '', '', ?, ?)
        ON CONFLICT(faction_id) DO UPDATE SET
            faction_name = CASE WHEN excluded.faction_name != '' THEN excluded.faction_name ELSE faction_licenses.faction_name END,
            leader_user_id = CASE WHEN excluded.leader_user_id != '' THEN excluded.leader_user_id ELSE faction_licenses.leader_user_id END,
            leader_name = CASE WHEN excluded.leader_name != '' THEN excluded.leader_name ELSE faction_licenses.leader_name END,
            leader_api_key = CASE WHEN excluded.leader_api_key != '' THEN excluded.leader_api_key ELSE faction_licenses.leader_api_key END,
            payment_per_member = excluded.payment_per_member,
            updated_at = excluded.updated_at
        """,
        (
            faction_id,
            _clean_text(faction_name),
            _clean_text(leader_user_id),
            _clean_text(leader_name),
            _clean_text(leader_api_key),
            int(PAYMENT_XANAX_PER_MEMBER),
            now,
            now,
        ),
    )
    con.commit()
    con.close()
    return get_faction_license_row(faction_id) or {}


def get_faction_license_row(faction_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM faction_licenses WHERE faction_id = ? LIMIT 1", (_clean_text(faction_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def start_faction_trial_if_needed(faction_id: str, faction_name: str = "", leader_user_id: str = "", leader_name: str = "", leader_api_key: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {}
    row = ensure_faction_license_row(faction_id, faction_name, leader_user_id, leader_name, leader_api_key)
    if row.get("trial_started_at"):
        if leader_user_id or leader_name or faction_name or leader_api_key:
            ensure_faction_license_row(faction_id, faction_name, leader_user_id, leader_name, leader_api_key)
        return compute_faction_license_status(faction_id)

    now = _utc_now()
    expires = _future_iso(TRIAL_DAYS)
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        UPDATE faction_licenses
        SET faction_name = ?, leader_user_id = ?, leader_name = ?, leader_api_key = ?,
            trial_started_at = ?, trial_expires_at = ?, status = 'trial', payment_required = 0, updated_at = ?
        WHERE faction_id = ?
        """,
        (_clean_text(faction_name), _clean_text(leader_user_id), _clean_text(leader_name), _clean_text(leader_api_key), now, expires, now, faction_id),
    )
    con.commit()
    con.close()
    add_audit_log(leader_user_id, leader_name, "faction_trial_started", f"faction_id={faction_id}")
    return compute_faction_license_status(faction_id)


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
    cur.execute(
        "SELECT * FROM faction_members WHERE faction_id = ? AND member_user_id = ? LIMIT 1",
        (faction_id, member_user_id),
    )
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_member_access_record(member_user_id: str) -> Optional[Dict[str, Any]]:
    member_user_id = _clean_text(member_user_id)
    if not member_user_id:
        return None
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM faction_members WHERE member_user_id = ? AND enabled = 1 ORDER BY id DESC LIMIT 1",
        (member_user_id,),
    )
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
        (
            faction_id,
            _clean_text(faction_name),
            _clean_text(leader_user_id),
            _clean_text(leader_name),
            member_user_id,
            _clean_text(member_name),
            _clean_text(member_api_key),
            _clean_text(position),
            1 if _safe_bool(enabled) else 0,
            now,
            now,
            now,
        ),
    )
    con.commit()
    con.close()
    recalc_faction_license(faction_id)
    return get_faction_member_access(faction_id, member_user_id) or {}


def set_faction_member_enabled(faction_id: str, member_user_id: str, enabled: int, changed_by_user_id: str = "", changed_by_name: str = "") -> Dict[str, Any]:
    row = get_faction_member_access(faction_id, member_user_id)
    if not row:
        raise ValueError("Faction member access row not found.")
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE faction_members SET enabled = ?, updated_at = ? WHERE faction_id = ? AND member_user_id = ?",
        (1 if _safe_bool(enabled) else 0, _utc_now(), _clean_text(faction_id), _clean_text(member_user_id)),
    )
    con.commit()
    con.close()
    recalc_faction_license(faction_id)
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
    recalc_faction_license(faction_id)


def calc_faction_renewal_cost(faction_id: str) -> int:
    members = list_faction_members(faction_id)
    enabled_count = len([m for m in members if _safe_bool(m.get("enabled"))])
    return enabled_count * int(PAYMENT_XANAX_PER_MEMBER)


def recalc_faction_license(faction_id: str) -> Dict[str, Any]:
    row = ensure_faction_license_row(faction_id)
    members = list_faction_members(faction_id)
    member_count = len(members)
    enabled_member_count = len([m for m in members if _safe_bool(m.get("enabled"))])
    renewal_cost = enabled_member_count * int(PAYMENT_XANAX_PER_MEMBER)

    now = _utc_now_dt()
    paid_until = _parse_iso(str(row.get("paid_until_at") or ""))
    trial_expires = _parse_iso(str(row.get("trial_expires_at") or ""))

    if get_faction_exemption(faction_id):
        status = "exempt"
        payment_required = 0
    elif paid_until and paid_until > now:
        status = "paid"
        payment_required = 0
    elif trial_expires and trial_expires > now:
        status = "trial"
        payment_required = 0
    elif row.get("trial_started_at"):
        status = "expired"
        payment_required = 1
    else:
        status = "inactive"
        payment_required = 0

    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        UPDATE faction_licenses
        SET member_count = ?, enabled_member_count = ?, renewal_cost = ?, payment_per_member = ?,
            status = ?, payment_required = ?, updated_at = ?
        WHERE faction_id = ?
        """,
        (member_count, enabled_member_count, renewal_cost, int(PAYMENT_XANAX_PER_MEMBER), status, payment_required, _utc_now(), _clean_text(faction_id)),
    )
    con.commit()
    con.close()
    return compute_faction_license_status(faction_id)


def compute_faction_license_status(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {}
    row = ensure_faction_license_row(faction_id)
    row = get_faction_license_row(faction_id) or row
    row = {**row}

    paid_until = _parse_iso(str(row.get("paid_until_at") or ""))
    trial_expires = _parse_iso(str(row.get("trial_expires_at") or ""))
    now = _utc_now_dt()
    is_faction_exempt = bool(get_faction_exemption(faction_id))
    is_user_exempt = bool(get_user_exemption(viewer_user_id)) if viewer_user_id else False

    member_row = get_faction_member_access(faction_id, viewer_user_id) if viewer_user_id else None
    viewer_member_enabled = _safe_bool((member_row or {}).get("enabled"))
    viewer_is_leader = _clean_text(row.get("leader_user_id")) == _clean_text(viewer_user_id)

    trial_active = False
    expired = False
    active = False
    days_left = None
    message = "Faction trial not started yet."
    status = _clean_text(row.get("status") or "inactive").lower()
    payment_required = bool(row.get("payment_required"))

    if is_faction_exempt:
        status = "exempt"
        payment_required = False
        active = True
        message = "Faction is exempt from payment and renewal."
    elif paid_until and paid_until > now:
        status = "paid"
        payment_required = False
        active = True
        days_left = _days_left_until(paid_until)
        message = f"Faction paid until {paid_until.isoformat()}."
    elif trial_expires and trial_expires > now:
        status = "trial"
        payment_required = False
        trial_active = True
        active = True
        days_left = _days_left_until(trial_expires)
        message = f"Faction trial active until {trial_expires.isoformat()}."
    elif row.get("trial_started_at"):
        status = "expired"
        payment_required = True
        expired = True
        message = "Faction payment is required to continue access."
    else:
        status = "inactive"
        payment_required = False
        message = "Faction trial not started yet."

    if is_user_exempt and not is_faction_exempt:
        message = "Player exemption active. Full script access is unlocked except Admin and leader-only tabs."

    return {
        **row,
        "faction_id": faction_id,
        "status": status,
        "active": active or is_user_exempt,
        "trial_active": trial_active,
        "expired": expired,
        "payment_required": bool(payment_required),
        "days_left": days_left,
        "message": message,
        "renewal_cost": calc_faction_renewal_cost(faction_id),
        "member_count": len(list_faction_members(faction_id)),
        "enabled_member_count": len([m for m in list_faction_members(faction_id) if _safe_bool(m.get("enabled"))]),
        "payment_per_member": int(PAYMENT_XANAX_PER_MEMBER),
        "payment_player": PAYMENT_PLAYER,
        "payment_kind": PAYMENT_KIND,
        "viewer_is_leader": viewer_is_leader,
        "viewer_member_enabled": viewer_member_enabled,
        "is_faction_exempt": is_faction_exempt,
        "is_user_exempt": is_user_exempt,
    }


def renew_faction_after_payment(faction_id: str, amount: int, payment_player: str = "", renewed_by: str = "", note: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    row = ensure_faction_license_row(faction_id)
    old_paid_until = _parse_iso(str(row.get("paid_until_at") or ""))
    start_dt = old_paid_until if old_paid_until and old_paid_until > _utc_now_dt() else _utc_now_dt()
    new_paid_until = (start_dt + timedelta(days=DEFAULT_PAID_DAYS)).isoformat()
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        UPDATE faction_licenses
        SET paid_until_at = ?, status = 'paid', payment_required = 0,
            last_payment_amount = ?, last_payment_kind = ?, last_payment_note = ?,
            last_payment_at = ?, updated_at = ?
        WHERE faction_id = ?
        """,
        (new_paid_until, _to_int(amount, 0), PAYMENT_KIND, _clean_text(note), now, now, faction_id),
    )
    cur.execute(
        """
        INSERT INTO faction_payment_history (
            faction_id, faction_name, leader_user_id, leader_name, amount,
            payment_kind, note, received_by, received_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            faction_id,
            _clean_text(row.get("faction_name")),
            _clean_text(row.get("leader_user_id")),
            _clean_text(row.get("leader_name")),
            _to_int(amount, 0),
            PAYMENT_KIND,
            _clean_text(note),
            _clean_text(renewed_by) or _clean_text(payment_player) or PAYMENT_PLAYER,
            now,
            now,
        ),
    )
    cur.execute(
        "UPDATE faction_members SET last_renewed_at = ?, updated_at = ? WHERE faction_id = ? AND enabled = 1",
        (now, now, faction_id),
    )
    con.commit()
    con.close()
    recalc_faction_license(faction_id)
    add_audit_log("", _clean_text(renewed_by), "faction_renewed", f"faction_id={faction_id} amount={_to_int(amount, 0)}")
    return get_faction_license_row(faction_id) or {}


def get_faction_payment_history(faction_id: str, limit: int = 25) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM faction_payment_history WHERE faction_id = ? ORDER BY id DESC LIMIT ?",
        (_clean_text(faction_id), int(limit or 25)),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def force_expire_faction_license(faction_id: str):
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return
    past = (_utc_now_dt() - timedelta(days=1)).isoformat()
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE faction_licenses SET paid_until_at = ?, trial_expires_at = CASE WHEN trial_expires_at = '' THEN '' ELSE ? END, status = 'expired', payment_required = 1, updated_at = ? WHERE faction_id = ?",
        (past, past, _utc_now(), faction_id),
    )
    con.commit()
    con.close()
    recalc_faction_license(faction_id)


def list_all_faction_licenses(limit: int = 250) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        SELECT *
        FROM faction_licenses
        ORDER BY
            CASE
                WHEN payment_required = 1 THEN 0
                WHEN status = 'trial' THEN 1
                WHEN status = 'paid' THEN 2
                ELSE 3
            END,
            LOWER(COALESCE(NULLIF(faction_name, ''), faction_id)) ASC
        LIMIT ?
        """,
        (int(limit or 250),),
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return [{**row, "license": compute_faction_license_status(str(row.get("faction_id") or ""))} for row in rows]


def get_owner_faction_dashboard(limit: int = 250) -> Dict[str, Any]:
    return {
        "payment_player": PAYMENT_PLAYER,
        "payment_per_member": PAYMENT_XANAX_PER_MEMBER,
        "payment_kind": PAYMENT_KIND,
        "factions": list_all_faction_licenses(limit=limit),
    }


def get_faction_admin_dashboard_summary() -> Dict[str, Any]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM faction_licenses")
    faction_licenses_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM faction_licenses WHERE status = 'trial'")
    trials_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM faction_licenses WHERE status = 'paid'")
    paid_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM faction_licenses WHERE payment_required = 1")
    payment_required_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COALESCE(SUM(enabled_member_count), 0) AS c FROM faction_licenses")
    enabled_members_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COALESCE(SUM(renewal_cost), 0) AS c FROM faction_licenses")
    projected_renewal_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM faction_members")
    stored_members_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM faction_exemptions")
    faction_exemptions_total = int((cur.fetchone() or {"c": 0})["c"])
    cur.execute("SELECT COUNT(*) AS c FROM user_exemptions")
    user_exemptions_total = int((cur.fetchone() or {"c": 0})["c"])
    con.close()
    return {
        "payment_player": PAYMENT_PLAYER,
        "payment_per_member": PAYMENT_XANAX_PER_MEMBER,
        "payment_kind": PAYMENT_KIND,
        "faction_licenses_total": faction_licenses_total,
        "trials_total": trials_total,
        "paid_total": paid_total,
        "payment_required_total": payment_required_total,
        "enabled_members_total": enabled_members_total,
        "stored_members_total": stored_members_total,
        "projected_renewal_total": projected_renewal_total,
        "faction_exemptions_total": faction_exemptions_total,
        "user_exemptions_total": user_exemptions_total,
    }
# -----------------------------
# faction shared notes
# -----------------------------

def get_faction_terms_summary(faction_id: str) -> Optional[Dict[str, Any]]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return None

    con = _con()
    cur = con.cursor()
    cur.execute(
        "SELECT * FROM faction_terms_summary WHERE faction_id = ? LIMIT 1",
        (faction_id,)
    )
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
            faction_id,
            faction_name,
            text,
            updated_by_user_id,
            updated_by_name,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            text = excluded.text,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_by_name = excluded.updated_by_name,
            updated_at = excluded.updated_at
        """,
        (
            faction_id,
            _clean_text(faction_name),
            str(text or ""),
            _clean_text(updated_by_user_id),
            _clean_text(updated_by_name),
            now,
            now,
        ),
    )
    con.commit()
    con.close()

    add_audit_log(
        _clean_text(updated_by_user_id),
        _clean_text(updated_by_name),
        "faction_terms_summary_saved",
        f"faction_id={faction_id}"
    )

    return get_faction_terms_summary(faction_id) or {}


def get_faction_license_for_member(member_user_id: str) -> Optional[Dict[str, Any]]:
    member = get_member_access_record(member_user_id)
    if not member:
        return None
    faction_id = _clean_text(member.get("faction_id"))
    if not faction_id:
        return None
    return compute_faction_license_status(faction_id, viewer_user_id=member_user_id)
