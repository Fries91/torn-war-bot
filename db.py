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


def _utc_ts() -> int:
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


def _parse_iso(value: str) -> Optional[datetime]:
    try:
        if not value:
            return None
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _future_iso(days: int) -> str:
    return (_utc_now_dt() + timedelta(days=int(days))).isoformat()


def _days_left_until(dt: Optional[datetime]) -> Optional[int]:
    if not dt:
        return None
    try:
        delta = dt - _utc_now_dt()
        return int(delta.total_seconds() // 86400)
    except Exception:
        return None

def _faction_payment_text(enabled_member_count: int) -> str:
    total_amount = int(enabled_member_count or 0) * int(PAYMENT_XANAX_PER_MEMBER)
    return f"Send {total_amount} {PAYMENT_KIND} to {PAYMENT_PLAYER} [{PAYMENT_NOTIFY_USER_ID}]."

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
            created_at TEXT DEFAULT '',
            last_seen_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT DEFAULT '',
            last_seen_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS med_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            creator_user_id TEXT DEFAULT '',
            creator_name TEXT DEFAULT '',
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            buyer_name TEXT DEFAULT '',
            seller_name TEXT DEFAULT '',
            amount INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            target_id TEXT DEFAULT '',
            target_name TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS bounties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            target_id TEXT DEFAULT '',
            target_name TEXT DEFAULT '',
            reward_text TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kind TEXT DEFAULT '',
            text TEXT DEFAULT '',
            seen INTEGER DEFAULT 0,
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS war_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            war_id TEXT DEFAULT '',
            faction_id TEXT DEFAULT '',
            faction_name TEXT DEFAULT '',
            enemy_faction_id TEXT DEFAULT '',
            enemy_faction_name TEXT DEFAULT '',
            score_us INTEGER DEFAULT 0,
            score_them INTEGER DEFAULT 0,
            target_score INTEGER DEFAULT 0,
            lead INTEGER DEFAULT 0,
            start_ts INTEGER DEFAULT 0,
            end_ts INTEGER DEFAULT 0,
            ts INTEGER DEFAULT 0,
            status_text TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS enemy_states (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            war_id TEXT DEFAULT '',
            user_id TEXT DEFAULT '',
            name TEXT DEFAULT '',
            online_state TEXT DEFAULT '',
            hospital_seconds INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT '',
            UNIQUE(war_id, user_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS target_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            war_id TEXT DEFAULT '',
            target_id TEXT DEFAULT '',
            target_name TEXT DEFAULT '',
            assigned_to_user_id TEXT DEFAULT '',
            assigned_to_name TEXT DEFAULT '',
            assigned_by_user_id TEXT DEFAULT '',
            assigned_by_name TEXT DEFAULT '',
            priority TEXT DEFAULT 'normal',
            note TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            UNIQUE(war_id, target_id, assigned_to_user_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS war_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            war_id TEXT DEFAULT '',
            target_id TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_by_user_id TEXT DEFAULT '',
            created_by_name TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS war_terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            war_id TEXT DEFAULT '',
            terms_text TEXT DEFAULT '',
            updated_by_user_id TEXT DEFAULT '',
            updated_by_name TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            UNIQUE(war_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS dibs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            war_id TEXT DEFAULT '',
            target_id TEXT NOT NULL,
            target_name TEXT DEFAULT '',
            claimer_user_id TEXT DEFAULT '',
            claimer_name TEXT DEFAULT '',
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT DEFAULT '',
            key_name TEXT DEFAULT '',
            value_text TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            UNIQUE(user_id, key_name)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_licenses (
            user_id TEXT PRIMARY KEY,
            admin_key TEXT DEFAULT '',
            admin_key_active INTEGER DEFAULT 0,
            trial_started_at TEXT DEFAULT '',
            trial_expires_at TEXT DEFAULT '',
            paid_until_at TEXT DEFAULT '',
            payment_required INTEGER DEFAULT 0,
            status TEXT DEFAULT 'inactive',
            last_payment_amount INTEGER DEFAULT 0,
            last_payment_kind TEXT DEFAULT '',
            last_payment_note TEXT DEFAULT '',
            last_payment_at TEXT DEFAULT '',
            cleared_at TEXT DEFAULT '',
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            payment_kind TEXT DEFAULT 'xanax',
            amount INTEGER DEFAULT 0,
            note TEXT DEFAULT '',
            received_by TEXT DEFAULT '',
            received_at TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS api_cache (
            cache_key TEXT PRIMARY KEY,
            payload_text TEXT DEFAULT '',
            expires_at_ts INTEGER DEFAULT 0,
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT DEFAULT '',
            action TEXT DEFAULT '',
            detail TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    cur.execute("""
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
    """)

    cur.execute("""
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
            created_at TEXT DEFAULT '',
            updated_at TEXT DEFAULT '',
            UNIQUE(faction_id, member_user_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS faction_payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            faction_id TEXT NOT NULL,
            faction_name TEXT DEFAULT '',
            leader_user_id TEXT DEFAULT '',
            leader_name TEXT DEFAULT '',
            amount INTEGER DEFAULT 0,
            payment_kind TEXT DEFAULT 'cash',
            note TEXT DEFAULT '',
            received_by TEXT DEFAULT '',
            received_at TEXT DEFAULT '',
            created_at TEXT DEFAULT ''
        )
    """)

    _ensure_column(cur, "med_deals", "creator_user_id", "creator_user_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "creator_name", "creator_name TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_id", "faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_name", "faction_name TEXT DEFAULT ''")

    _ensure_column(cur, "user_licenses", "last_payment_kind", "last_payment_kind TEXT DEFAULT ''")
    _ensure_column(cur, "user_licenses", "last_payment_note", "last_payment_note TEXT DEFAULT ''")
    _ensure_column(cur, "user_licenses", "last_payment_amount", "last_payment_amount INTEGER DEFAULT 0")
    _ensure_column(cur, "faction_licenses", "warned_5_day_at", "warned_5_day_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_licenses", "warned_due_day_at", "warned_due_day_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_licenses", "last_due_notice_at", "last_due_notice_at TEXT DEFAULT ''")
    _ensure_column(cur, "faction_licenses", "last_due_notice_user_id", "last_due_notice_user_id TEXT DEFAULT ''")
    
    _ensure_column(cur, "faction_licenses", "leader_api_key", "leader_api_key TEXT DEFAULT ''")

    _ensure_column(cur, "faction_members", "faction_name", "faction_name TEXT DEFAULT ''")
    _ensure_column(cur, "faction_members", "leader_name", "leader_name TEXT DEFAULT ''")
    _ensure_column(cur, "faction_members", "position", "position TEXT DEFAULT ''")

    _ensure_column(cur, "users", "name", "name TEXT DEFAULT ''")
    _ensure_column(cur, "users", "api_key", "api_key TEXT DEFAULT ''")
    _ensure_column(cur, "users", "faction_id", "faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "users", "faction_name", "faction_name TEXT DEFAULT ''")
    _ensure_column(cur, "users", "available", "available INTEGER DEFAULT 1")
    _ensure_column(cur, "users", "chain_sitter", "chain_sitter INTEGER DEFAULT 0")
    _ensure_column(cur, "users", "created_at", "created_at TEXT DEFAULT ''")
    _ensure_column(cur, "users", "last_seen_at", "last_seen_at TEXT DEFAULT ''")

    cur.execute("""
        UPDATE med_deals
        SET creator_user_id = COALESCE(NULLIF(creator_user_id, ''), user_id)
    """)
    cur.execute("""
        UPDATE med_deals
        SET creator_name = COALESCE(NULLIF(creator_name, ''), buyer_name)
        WHERE COALESCE(NULLIF(creator_name, ''), '') = ''
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_faction_id ON users(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_war_snapshots_war_id ON war_snapshots(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_enemy_states_war_id ON enemy_states(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_target_assignments_war_id ON target_assignments(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_war_notes_war_id ON war_notes(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_war_terms_war_id ON war_terms(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dibs_faction_id ON dibs(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dibs_war_id ON dibs(war_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dibs_target_id ON dibs(target_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON payment_history(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_history_received_at ON payment_history(received_at)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at_ts ON api_cache(expires_at_ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_faction_id ON faction_members(faction_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_member_user_id ON faction_members(member_user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_members_enabled ON faction_members(faction_id, enabled)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_faction_payment_history_faction_id ON faction_payment_history(faction_id)")

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

    cols = set(_table_columns(cur, "users"))
    values = {
        "user_id": str(user_id or ""),
        "name": str(name or ""),
        "api_key": str(api_key or ""),
        "faction_id": str(faction_id or ""),
        "faction_name": str(faction_name or ""),
        "available": 1,
        "chain_sitter": 0,
        "created_at": now,
        "last_seen_at": now,
    }

    cur.execute("SELECT user_id FROM users WHERE user_id = ?", (values["user_id"],))
    existing = cur.fetchone()

    if existing:
        update_parts = []
        update_vals = []
        for key in ["name", "api_key", "faction_id", "faction_name", "last_seen_at"]:
            if key in cols:
                update_parts.append(f"{key} = ?")
                update_vals.append(values[key])

        update_vals.append(values["user_id"])
        cur.execute(
            f"UPDATE users SET {', '.join(update_parts)} WHERE user_id = ?",
            tuple(update_vals),
        )
    else:
        insert_cols = []
        insert_vals = []
        placeholders = []

        for key in [
            "user_id",
            "name",
            "api_key",
            "faction_id",
            "faction_name",
            "available",
            "chain_sitter",
            "created_at",
            "last_seen_at",
        ]:
            if key in cols:
                insert_cols.append(key)
                insert_vals.append(values[key])
                placeholders.append("?")

        cur.execute(
            f"INSERT INTO users ({', '.join(insert_cols)}) VALUES ({', '.join(placeholders)})",
            tuple(insert_vals),
        )

    con.commit()
    con.close()


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM users WHERE user_id = ?", (str(user_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_users_by_faction(faction_id: str) -> List[Dict[str, Any]]:
    if not faction_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM users
        WHERE faction_id = ?
        ORDER BY LOWER(name) ASC
    """, (str(faction_id),))
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
    """, (token, str(user_id), now, now))
    con.commit()
    con.close()
    return token


def get_session(token: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT * FROM sessions WHERE token = ?", (str(token),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def touch_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "UPDATE sessions SET last_seen_at = ? WHERE token = ?",
        (_utc_now(), str(token)),
    )
    con.commit()
    con.close()


def delete_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE token = ?", (str(token),))
    con.commit()
    con.close()


def delete_sessions_for_user(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (str(user_id),))
    con.commit()
    con.close()


def set_availability(user_id: str, available: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE users
        SET available = ?, last_seen_at = ?
        WHERE user_id = ?
    """, (1 if available else 0, _utc_now(), str(user_id)))
    con.commit()
    con.close()


def set_chain_sitter(user_id: str, enabled: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE users
        SET chain_sitter = ?, last_seen_at = ?
        WHERE user_id = ?
    """, (1 if enabled else 0, _utc_now(), str(user_id)))
    con.commit()
    con.close()


def add_med_deal(
    creator_user_id: str,
    creator_name: str,
    faction_id: str,
    faction_name: str,
    buyer_name: str,
    seller_name: str,
    notes: str,
) -> Dict[str, Any]:
    now = _utc_now()
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
        str(creator_user_id),
        str(creator_user_id),
        str(creator_name or ""),
        str(faction_id or ""),
        str(faction_name or ""),
        str(buyer_name or ""),
        str(seller_name or ""),
        0,
        str(notes or ""),
        now,
    ))
    deal_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM med_deals WHERE id = ?", (int(deal_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row) or {}


def list_med_deals(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM med_deals
        WHERE user_id = ?
        ORDER BY id DESC
    """, (str(user_id),))
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
    """, (str(faction_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows

def delete_med_deal(faction_id: str, deal_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        DELETE FROM med_deals
        WHERE faction_id = ? AND id = ?
    """, (str(faction_id), int(deal_id)))
    con.commit()
    con.close()


def add_dib(
    faction_id: str,
    faction_name: str,
    war_id: str,
    target_id: str,
    target_name: str,
    claimer_user_id: str,
    claimer_name: str,
    note: str = "",
) -> Dict[str, Any]:
    faction_id = str(faction_id or "").strip()
    faction_name = str(faction_name or "").strip()
    war_id = str(war_id or "").strip()
    target_id = str(target_id or "").strip()
    target_name = str(target_name or "").strip()
    claimer_user_id = str(claimer_user_id or "").strip()
    claimer_name = str(claimer_name or "").strip()
    note = str(note or "").strip()

    if not faction_id or not target_id:
        return {}

    now = _utc_now()
    con = _con()
    cur = con.cursor()

    cur.execute(
        """
        DELETE FROM dibs
        WHERE faction_id = ? AND war_id = ? AND target_id = ?
        """,
        (faction_id, war_id, target_id),
    )

    cur.execute(
        """
        INSERT INTO dibs (
            faction_id,
            faction_name,
            war_id,
            target_id,
            target_name,
            claimer_user_id,
            claimer_name,
            note,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            faction_id,
            faction_name,
            war_id,
            target_id,
            target_name,
            claimer_user_id,
            claimer_name,
            note,
            now,
        ),
    )
    row_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM dibs WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row) if row else {}


def list_dibs_for_faction(faction_id: str, war_id: str = "") -> List[Dict[str, Any]]:
    faction_id = str(faction_id or "").strip()
    war_id = str(war_id or "").strip()

    if not faction_id:
        return []

    con = _con()
    cur = con.cursor()

    if war_id:
        cur.execute(
            """
            SELECT *
            FROM dibs
            WHERE faction_id = ? AND war_id = ?
            ORDER BY id DESC
            """,
            (faction_id, war_id),
        )
    else:
        cur.execute(
            """
            SELECT *
            FROM dibs
            WHERE faction_id = ?
            ORDER BY id DESC
            """,
            (faction_id,),
        )

    rows = [_row_to_dict(r) for r in cur.fetchall()]
    con.close()
    return [r for r in rows if r]


def delete_dib(faction_id: str, dib_id: int) -> None:
    faction_id = str(faction_id or "").strip()
    dib_id = int(dib_id or 0)

    if not faction_id or dib_id <= 0:
        return

    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        DELETE FROM dibs
        WHERE faction_id = ? AND id = ?
        """,
        (faction_id, dib_id),
    )
    con.commit()
    con.close()


def add_target(user_id: str, target_id: str, target_name: str, notes: str) -> Dict[str, Any]:
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO targets (user_id, target_id, target_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (
        str(user_id),
        str(target_id or ""),
        str(target_name or ""),
        str(notes or ""),
        now,
    ))
    row_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM targets WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row) or {}


def list_targets(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM targets
        WHERE user_id = ?
        ORDER BY id DESC
    """, (str(user_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_target(user_id: str, target_row_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "DELETE FROM targets WHERE user_id = ? AND id = ?",
        (str(user_id), int(target_row_id)),
    )
    con.commit()
    con.close()


def add_bounty(user_id: str, target_id: str, target_name: str, reward_text: str) -> Dict[str, Any]:
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO bounties (user_id, target_id, target_name, reward_text, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (
        str(user_id),
        str(target_id or ""),
        str(target_name or ""),
        str(reward_text or ""),
        now,
    ))
    row_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM bounties WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row) or {}


def list_bounties(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM bounties
        WHERE user_id = ?
        ORDER BY id DESC
    """, (str(user_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def delete_bounty(user_id: str, bounty_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "DELETE FROM bounties WHERE user_id = ? AND id = ?",
        (str(user_id), int(bounty_id)),
    )
    con.commit()
    con.close()


def add_notification(user_id: str, kind: str, text: str) -> Dict[str, Any]:
    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO notifications (user_id, kind, text, seen, created_at)
        VALUES (?, ?, ?, 0, ?)
    """, (
        str(user_id),
        str(kind or ""),
        str(text or ""),
        now,
    ))
    row_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM notifications WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row) or {}


def list_notifications(user_id: str) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM notifications
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50
    """, (str(user_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def mark_notifications_seen(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("UPDATE notifications SET seen = 1 WHERE user_id = ?", (str(user_id),))
    con.commit()
    con.close()

def save_war_snapshot(
    war_id: str,
    faction_id: str,
    faction_name: str,
    enemy_faction_id: str,
    enemy_faction_name: str,
    score_us: int,
    score_them: int,
    target_score: int,
    lead: int,
    start_ts: int,
    end_ts: int,
    status_text: str,
) -> Optional[Dict[str, Any]]:
    if not war_id:
        return None

    now = _utc_now()
    ts = _utc_ts()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO war_snapshots (
            war_id,
            faction_id,
            faction_name,
            enemy_faction_id,
            enemy_faction_name,
            score_us,
            score_them,
            target_score,
            lead,
            start_ts,
            end_ts,
            ts,
            status_text,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        str(war_id),
        str(faction_id or ""),
        str(faction_name or ""),
        str(enemy_faction_id or ""),
        str(enemy_faction_name or ""),
        int(score_us or 0),
        int(score_them or 0),
        int(target_score or 0),
        int(lead or 0),
        int(start_ts or 0),
        int(end_ts or 0),
        ts,
        str(status_text or ""),
        now,
    ))
    row_id = cur.lastrowid

    cur.execute("""
        DELETE FROM war_snapshots
        WHERE id NOT IN (
            SELECT id
            FROM war_snapshots
            WHERE war_id = ?
            ORDER BY id DESC
            LIMIT 200
        )
        AND war_id = ?
    """, (str(war_id), str(war_id)))

    con.commit()
    cur.execute("SELECT * FROM war_snapshots WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def list_recent_war_snapshots(war_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    if not war_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM war_snapshots
        WHERE war_id = ?
        ORDER BY id DESC
        LIMIT ?
    """, (str(war_id), int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_enemy_state_map(war_id: str) -> Dict[str, Dict[str, Any]]:
    if not war_id:
        return {}

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM enemy_states
        WHERE war_id = ?
    """, (str(war_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return {str(r["user_id"]): r for r in rows}


def upsert_enemy_state(
    war_id: str,
    user_id: str,
    name: str,
    online_state: str,
    hospital_seconds: int,
) -> Optional[Dict[str, Any]]:
    if not war_id or not user_id:
        return None

    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO enemy_states (
            war_id,
            user_id,
            name,
            online_state,
            hospital_seconds,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, user_id) DO UPDATE SET
            name = excluded.name,
            online_state = excluded.online_state,
            hospital_seconds = excluded.hospital_seconds,
            updated_at = excluded.updated_at
    """, (
        str(war_id),
        str(user_id),
        str(name or ""),
        str(online_state or ""),
        int(hospital_seconds or 0),
        now,
    ))
    con.commit()

    cur.execute("""
        SELECT *
        FROM enemy_states
        WHERE war_id = ? AND user_id = ?
        LIMIT 1
    """, (str(war_id), str(user_id)))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def list_target_assignments_for_war(war_id: str) -> List[Dict[str, Any]]:
    if not war_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM target_assignments
        WHERE war_id = ?
        ORDER BY
            CASE
                WHEN priority = 'high' THEN 0
                WHEN priority = 'normal' THEN 1
                WHEN priority = 'low' THEN 2
                ELSE 3
            END,
            LOWER(target_name) ASC,
            id DESC
    """, (str(war_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_target_assignment(
    war_id: str,
    target_id: str,
    target_name: str,
    assigned_to_user_id: str,
    assigned_to_name: str,
    assigned_by_user_id: str,
    assigned_by_name: str,
    priority: str,
    note: str,
) -> Optional[Dict[str, Any]]:
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO target_assignments (
            war_id,
            target_id,
            target_name,
            assigned_to_user_id,
            assigned_to_name,
            assigned_by_user_id,
            assigned_by_name,
            priority,
            note,
            updated_at,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, target_id, assigned_to_user_id) DO UPDATE SET
            target_name = excluded.target_name,
            assigned_to_name = excluded.assigned_to_name,
            assigned_by_user_id = excluded.assigned_by_user_id,
            assigned_by_name = excluded.assigned_by_name,
            priority = excluded.priority,
            note = excluded.note,
            updated_at = excluded.updated_at
    """, (
        str(war_id),
        str(target_id),
        str(target_name or ""),
        str(assigned_to_user_id or ""),
        str(assigned_to_name or ""),
        str(assigned_by_user_id or ""),
        str(assigned_by_name or ""),
        str(priority or "normal"),
        str(note or ""),
        now,
        now,
    ))
    con.commit()

    cur.execute("""
        SELECT *
        FROM target_assignments
        WHERE war_id = ? AND target_id = ? AND assigned_to_user_id = ?
        LIMIT 1
    """, (
        str(war_id),
        str(target_id),
        str(assigned_to_user_id or ""),
    ))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def delete_target_assignment(assignment_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM target_assignments WHERE id = ?", (int(assignment_id),))
    con.commit()
    con.close()


def list_war_notes(war_id: str) -> List[Dict[str, Any]]:
    if not war_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM war_notes
        WHERE war_id = ?
        ORDER BY id DESC
        LIMIT 100
    """, (str(war_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_war_note(
    war_id: str,
    target_id: str,
    note: str,
    created_by_user_id: str,
    created_by_name: str,
) -> Optional[Dict[str, Any]]:
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO war_notes (
            war_id,
            target_id,
            note,
            created_by_user_id,
            created_by_name,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        str(war_id),
        str(target_id or ""),
        str(note or ""),
        str(created_by_user_id or ""),
        str(created_by_name or ""),
        now,
    ))
    row_id = cur.lastrowid
    con.commit()

    cur.execute("SELECT * FROM war_notes WHERE id = ?", (int(row_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def delete_war_note(note_id: int):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM war_notes WHERE id = ?", (int(note_id),))
    con.commit()
    con.close()


def get_war_terms(war_id: str) -> Optional[Dict[str, Any]]:
    if not war_id:
        return None

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM war_terms
        WHERE war_id = ?
        LIMIT 1
    """, (str(war_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_war_terms(
    war_id: str,
    terms_text: str,
    updated_by_user_id: str,
    updated_by_name: str,
) -> Optional[Dict[str, Any]]:
    if not war_id:
        return None

    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO war_terms (
            war_id,
            terms_text,
            updated_by_user_id,
            updated_by_name,
            updated_at,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id) DO UPDATE SET
            terms_text = excluded.terms_text,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_by_name = excluded.updated_by_name,
            updated_at = excluded.updated_at
    """, (
        str(war_id),
        str(terms_text or ""),
        str(updated_by_user_id or ""),
        str(updated_by_name or ""),
        now,
        now,
    ))
    con.commit()

    cur.execute("""
        SELECT *
        FROM war_terms
        WHERE war_id = ?
        LIMIT 1
    """, (str(war_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def delete_war_terms(war_id: str):
    if not war_id:
        return

    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM war_terms WHERE war_id = ?", (str(war_id),))
    con.commit()
    con.close()


def get_user_setting(user_id: str, key_name: str) -> Optional[str]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT value_text
        FROM user_settings
        WHERE user_id = ? AND key_name = ?
        LIMIT 1
    """, (str(user_id), str(key_name)))
    row = cur.fetchone()
    con.close()
    return str(row["value_text"]) if row else None


def set_user_setting(user_id: str, key_name: str, value_text: str):
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO user_settings (user_id, key_name, value_text, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, key_name) DO UPDATE SET
            value_text = excluded.value_text,
            updated_at = excluded.updated_at
    """, (
        str(user_id),
        str(key_name),
        str(value_text or ""),
        now,
        now,
    ))
    con.commit()
    con.close()


def add_audit_log(
    actor_user_id: str = "",
    actor_name: str = "",
    action: str = "",
    meta_json: Any = "",
    user_id: str = "",
    detail: str = "",
):
    final_user_id = str(actor_user_id or user_id or "")
    final_detail = str(detail or meta_json or "")
    if actor_name:
        final_detail = f"{actor_name}: {final_detail}" if final_detail else str(actor_name)

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO audit_log (user_id, action, detail, created_at)
        VALUES (?, ?, ?, ?)
    """, (
        final_user_id,
        str(action or ""),
        final_detail,
        _utc_now(),
    ))
    con.commit()
    con.close()


def list_audit_log(limit: int = 100) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM audit_log
        ORDER BY id DESC
        LIMIT ?
    """, (int(limit),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def cache_get(cache_key: str) -> Optional[str]:
    now_ts = _utc_ts()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT payload_text
        FROM api_cache
        WHERE cache_key = ? AND expires_at_ts > ?
        LIMIT 1
    """, (str(cache_key), now_ts))
    row = cur.fetchone()
    con.close()
    return str(row["payload_text"]) if row else None


def cache_set(cache_key: str, payload_text: str, ttl_seconds: int):
    now = _utc_now()
    expires_at_ts = _utc_ts() + max(1, int(ttl_seconds))

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO api_cache (cache_key, payload_text, expires_at_ts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            payload_text = excluded.payload_text,
            expires_at_ts = excluded.expires_at_ts,
            updated_at = excluded.updated_at
    """, (
        str(cache_key),
        str(payload_text or ""),
        expires_at_ts,
        now,
        now,
    ))
    con.commit()
    con.close()


def cache_delete(cache_key: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM api_cache WHERE cache_key = ?", (str(cache_key),))
    con.commit()
    con.close()


def cache_purge_expired() -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM api_cache WHERE expires_at_ts <= ?", (_utc_ts(),))
    purged = cur.rowcount if cur.rowcount is not None else 0
    con.commit()
    con.close()
    return int(purged)


# =========================
# LEGACY PERSONAL LICENSES
# =========================

def get_license(user_id: str) -> Optional[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM user_licenses
        WHERE user_id = ?
        LIMIT 1
    """, (str(user_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def ensure_license_row(user_id: str, admin_key: str = "") -> Dict[str, Any]:
    existing = get_license(user_id)
    if existing:
        if admin_key and not str(existing.get("admin_key") or "").strip():
            con = _con()
            cur = con.cursor()
            cur.execute("""
                UPDATE user_licenses
                SET admin_key = ?, updated_at = ?
                WHERE user_id = ?
            """, (str(admin_key), _utc_now(), str(user_id)))
            con.commit()
            con.close()
            existing = get_license(user_id)
        return existing or {}

    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO user_licenses (
            user_id,
            admin_key,
            admin_key_active,
            trial_started_at,
            trial_expires_at,
            paid_until_at,
            payment_required,
            status,
            last_payment_amount,
            last_payment_kind,
            last_payment_note,
            last_payment_at,
            cleared_at,
            created_at,
            updated_at
        )
        VALUES (?, ?, 0, '', '', '', 0, 'inactive', 0, '', '', '', '', ?, ?)
    """, (
        str(user_id),
        str(admin_key or ""),
        now,
        now,
    ))
    con.commit()
    con.close()
    return get_license(user_id) or {}


def start_trial_if_needed(user_id: str, admin_key: str = "") -> Dict[str, Any]:
    license_row = ensure_license_row(user_id, admin_key=admin_key)
    if license_row.get("trial_started_at") and license_row.get("trial_expires_at"):
        return compute_license_status(user_id)

    now = _utc_now()
    expires = _future_iso(TRIAL_DAYS)

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE user_licenses
        SET
            admin_key = CASE
                WHEN COALESCE(NULLIF(admin_key, ''), '') = '' THEN ?
                ELSE admin_key
            END,
            admin_key_active = 1,
            trial_started_at = ?,
            trial_expires_at = ?,
            payment_required = 0,
            status = 'trial',
            cleared_at = '',
            updated_at = ?
        WHERE user_id = ?
    """, (
        str(admin_key or ""),
        now,
        expires,
        now,
        str(user_id),
    ))
    con.commit()
    con.close()

    add_audit_log(user_id=user_id, action="trial_started", detail=f"trial_expires_at={expires}")
    return compute_license_status(user_id)


def set_license_admin_key(user_id: str, admin_key: str, active: int = 1):
    ensure_license_row(user_id, admin_key=admin_key)

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE user_licenses
        SET admin_key = ?, admin_key_active = ?, updated_at = ?
        WHERE user_id = ?
    """, (
        str(admin_key or ""),
        1 if active else 0,
        _utc_now(),
        str(user_id),
    ))
    con.commit()
    con.close()


def clear_license_admin_key(user_id: str, note: str = "trial_expired"):
    ensure_license_row(user_id)
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE user_licenses
        SET
            admin_key = '',
            admin_key_active = 0,
            payment_required = 1,
            status = 'expired',
            cleared_at = ?,
            updated_at = ?,
            last_payment_note = CASE
                WHEN COALESCE(NULLIF(last_payment_note, ''), '') = '' THEN ?
                ELSE last_payment_note
            END
        WHERE user_id = ?
    """, (now, now, str(note or ""), str(user_id)))
    con.commit()
    con.close()

    add_audit_log(user_id=user_id, action="license_cleared", detail=str(note or ""))


def mark_payment_received(
    user_id: str,
    amount: int = 50,
    payment_kind: str = "xanax",
    note: str = "",
    received_by: str = PAYMENT_PLAYER,
    extend_days: int = 45,
) -> Dict[str, Any]:
    ensure_license_row(user_id)

    now_dt = _utc_now_dt()
    current = get_license(user_id) or {}
    current_paid_until = _parse_iso(str(current.get("paid_until_at") or ""))
    base_dt = current_paid_until if current_paid_until and current_paid_until > now_dt else now_dt
    new_paid_until = (base_dt + timedelta(days=int(extend_days))).isoformat()
    now = now_dt.isoformat()

    con = _con()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO payment_history (
            user_id,
            payment_kind,
            amount,
            note,
            received_by,
            received_at,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        str(user_id),
        str(payment_kind or "xanax"),
        int(amount or 0),
        str(note or ""),
        str(received_by or PAYMENT_PLAYER),
        now,
        now,
    ))

    cur.execute("""
        UPDATE user_licenses
        SET
            payment_required = 0,
            status = 'paid',
            paid_until_at = ?,
            last_payment_amount = ?,
            last_payment_kind = ?,
            last_payment_note = ?,
            last_payment_at = ?,
            admin_key_active = CASE
                WHEN COALESCE(NULLIF(admin_key, ''), '') = '' THEN 0
                ELSE 1
            END,
            cleared_at = '',
            updated_at = ?
        WHERE user_id = ?
    """, (
        new_paid_until,
        int(amount or 0),
        str(payment_kind or "xanax"),
        str(note or ""),
        now,
        now,
        str(user_id),
    ))

    con.commit()
    con.close()

    add_audit_log(
        user_id=user_id,
        action="payment_received",
        detail=f"{int(amount or 0)} {payment_kind} by {received_by}",
    )
    return compute_license_status(user_id)


def get_payment_history(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM payment_history
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
    """, (str(user_id), int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def compute_license_status(user_id: str) -> Dict[str, Any]:
    row = ensure_license_row(user_id)
    now_dt = _utc_now_dt()

    trial_started_at = str(row.get("trial_started_at") or "")
    trial_expires_at = str(row.get("trial_expires_at") or "")
    paid_until_at = str(row.get("paid_until_at") or "")
    admin_key = str(row.get("admin_key") or "")
    admin_key_active = int(row.get("admin_key_active") or 0)
    raw_payment_required = int(row.get("payment_required") or 0)

    trial_expires_dt = _parse_iso(trial_expires_at)
    paid_until_dt = _parse_iso(paid_until_at)

    trial_active = False
    trial_expired = False
    paid_active = False
    active = False
    payment_required = False
    block_reason = ""
    status = "inactive"
    expires_at = ""
    days_left: Optional[int] = None
    message = ""

    if paid_until_dt and paid_until_dt > now_dt:
        paid_active = True
        active = True
        status = "paid"
        expires_at = paid_until_at
        days_left = _days_left_until(paid_until_dt)
        message = "Paid access active."
    elif trial_expires_dt and now_dt < trial_expires_dt:
        trial_active = True
        active = True
        status = "trial"
        expires_at = trial_expires_at
        days_left = _days_left_until(trial_expires_dt)
        message = "Trial active."
    elif trial_expires_dt and now_dt >= trial_expires_dt:
        trial_expired = True
        active = False
        payment_required = True
        status = "expired"
        expires_at = trial_expires_at
        days_left = _days_left_until(trial_expires_dt)
        block_reason = "trial_expired"
        message = f"Trial expired. Send payment to {PAYMENT_PLAYER} to continue access."
    else:
        active = False
        status = "inactive"
        payment_required = False
        message = "Trial has not started yet."

    if raw_payment_required:
        active = False
        payment_required = True
        if status != "paid":
            status = "expired" if trial_started_at else "inactive"
        if trial_started_at and not trial_active and not paid_active:
            trial_expired = True
        if not block_reason and trial_started_at:
            block_reason = "trial_expired"
        elif not block_reason:
            block_reason = "payment_required"
        message = f"Trial expired. Send payment to {PAYMENT_PLAYER} to continue access."

    if status == "expired" and (admin_key or admin_key_active):
        clear_license_admin_key(user_id, note="trial_expired")
        row = get_license(user_id) or row
        admin_key = str(row.get("admin_key") or "")
        admin_key_active = int(row.get("admin_key_active") or 0)

    return {
        "user_id": str(user_id),
        "active": active,
        "status": status,
        "trial_started_at": trial_started_at,
        "trial_expires_at": trial_expires_at,
        "expires_at": expires_at,
        "paid_until_at": paid_until_at,
        "trial_active": trial_active,
        "trial_expired": trial_expired,
        "paid_active": paid_active,
        "payment_required": payment_required,
        "blocked": (not active) or payment_required or trial_expired,
        "days_left": days_left,
        "block_reason": block_reason,
        "message": message,
        "admin_key_present": bool(admin_key),
        "admin_key_active": bool(admin_key_active),
        "last_payment_at": str(row.get("last_payment_at") or ""),
        "last_payment_amount": int(row.get("last_payment_amount") or 0),
        "last_payment_kind": str(row.get("last_payment_kind") or ""),
        "last_payment_note": str(row.get("last_payment_note") or ""),
        "cleared_at": str(row.get("cleared_at") or ""),
    }


def renew_after_payment(
    user_id: str,
    amount: int = 50,
    payment_kind: str = "xanax",
    note: str = "",
    received_by: str = PAYMENT_PLAYER,
    extend_days: int = 45,
) -> Dict[str, Any]:
    return mark_payment_received(
        user_id=user_id,
        amount=amount,
        payment_kind=payment_kind,
        note=note,
        received_by=received_by,
        extend_days=extend_days,
    )


def force_expire_license(user_id: str, clear_key: bool = True) -> Dict[str, Any]:
    ensure_license_row(user_id)
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE user_licenses
        SET
            trial_expires_at = CASE
                WHEN COALESCE(NULLIF(trial_expires_at, ''), '') = '' THEN ?
                ELSE trial_expires_at
            END,
            paid_until_at = '',
            payment_required = 1,
            status = 'expired',
            updated_at = ?
        WHERE user_id = ?
    """, (now, now, str(user_id)))
    con.commit()
    con.close()

    if clear_key:
        clear_license_admin_key(user_id, note="forced_expire")

    add_audit_log(user_id=user_id, action="license_expired", detail="forced_expire")
    return compute_license_status(user_id)


def list_all_licenses(limit: int = 250) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT
            u.user_id,
            u.name,
            u.faction_id,
            u.faction_name,
            l.status,
            l.trial_started_at,
            l.trial_expires_at,
            l.paid_until_at,
            l.payment_required,
            l.last_payment_amount,
            l.last_payment_kind,
            l.last_payment_at,
            l.updated_at
        FROM user_licenses l
        LEFT JOIN users u ON u.user_id = l.user_id
        ORDER BY
            CASE
                WHEN l.payment_required = 1 THEN 0
                WHEN l.status = 'trial' THEN 1
                WHEN l.status = 'paid' THEN 2
                ELSE 3
            END,
            COALESCE(u.name, l.user_id) ASC
        LIMIT ?
    """, (int(limit),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()

    out: List[Dict[str, Any]] = []
    for row in rows:
        user_id = str(row.get("user_id") or "")
        status = compute_license_status(user_id) if user_id else {}
        out.append({**row, "license": status})
    return out


def get_admin_dashboard_summary() -> Dict[str, Any]:
    con = _con()
    cur = con.cursor()

    cur.execute("SELECT COUNT(*) AS c FROM users")
    users_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM user_licenses")
    licenses_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM user_licenses WHERE status = 'trial'")
    trials_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM user_licenses WHERE status = 'paid'")
    paid_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM user_licenses WHERE payment_required = 1")
    payment_required_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM sessions")
    sessions_total = int((cur.fetchone() or {"c": 0})["c"])

    cur.execute("SELECT COUNT(*) AS c FROM faction_licenses")
    faction_licenses_total = int((cur.fetchone() or {"c": 0})["c"])

    con.close()

    return {
        "users_total": users_total,
        "licenses_total": licenses_total,
        "trials_total": trials_total,
        "paid_total": paid_total,
        "payment_required_total": payment_required_total,
        "sessions_total": sessions_total,
        "faction_licenses_total": faction_licenses_total,
    }

# =========================
# FACTION LICENSES
# =========================

def get_faction_license(faction_id: str) -> Optional[Dict[str, Any]]:
    if not faction_id:
        return None

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_licenses
        WHERE faction_id = ?
        LIMIT 1
    """, (str(faction_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def ensure_faction_license(
    faction_id: str,
    faction_name: str = "",
    leader_user_id: str = "",
    leader_name: str = "",
    leader_api_key: str = "",
) -> Dict[str, Any]:
    existing = get_faction_license(faction_id)
    if existing:
        con = _con()
        cur = con.cursor()
        cur.execute("""
            UPDATE faction_licenses
            SET
                faction_name = CASE WHEN ? != '' THEN ? ELSE faction_name END,
                leader_user_id = CASE WHEN ? != '' THEN ? ELSE leader_user_id END,
                leader_name = CASE WHEN ? != '' THEN ? ELSE leader_name END,
                leader_api_key = CASE WHEN ? != '' THEN ? ELSE leader_api_key END,
                payment_per_member = CASE WHEN payment_per_member <= 0 THEN ? ELSE payment_per_member END,
                updated_at = ?
            WHERE faction_id = ?
        """, (
            str(faction_name or ""), str(faction_name or ""),
            str(leader_user_id or ""), str(leader_user_id or ""),
            str(leader_name or ""), str(leader_name or ""),
            str(leader_api_key or ""), str(leader_api_key or ""),
            int(PAYMENT_XANAX_PER_MEMBER),
            _utc_now(),
            str(faction_id),
        ))
        con.commit()
        con.close()
        return get_faction_license(faction_id) or existing

    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO faction_licenses (
            faction_id,
            faction_name,
            leader_user_id,
            leader_name,
            leader_api_key,
            trial_started_at,
            trial_expires_at,
            paid_until_at,
            payment_required,
            status,
            renewal_cost,
            member_count,
            enabled_member_count,
            payment_per_member,
            last_payment_amount,
            last_payment_kind,
            last_payment_note,
            last_payment_at,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, '', '', '', 0, 'inactive', 0, 0, 0, ?, 0, '', '', '', ?, ?)
    """, (
        str(faction_id),
        str(faction_name or ""),
        str(leader_user_id or ""),
        str(leader_name or ""),
        str(leader_api_key or ""),
        int(PAYMENT_XANAX_PER_MEMBER),
        now,
        now,
    ))
    con.commit()
    con.close()
    return get_faction_license(faction_id) or {}


def ensure_faction_license_row(
    faction_id: str,
    faction_name: str = "",
    leader_user_id: str = "",
    leader_name: str = "",
    leader_api_key: str = "",
) -> Dict[str, Any]:
    return ensure_faction_license(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
        leader_api_key=leader_api_key,
    )


def list_faction_members(faction_id: str) -> List[Dict[str, Any]]:
    if not faction_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_members
        WHERE faction_id = ?
        ORDER BY enabled DESC, LOWER(member_name) ASC, id DESC
    """, (str(faction_id),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_faction_member(faction_id: str, member_user_id: str) -> Optional[Dict[str, Any]]:
    if not faction_id or not member_user_id:
        return None

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_members
        WHERE faction_id = ? AND member_user_id = ?
        LIMIT 1
    """, (str(faction_id), str(member_user_id)))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_faction_member_access(faction_id: str, member_user_id: str) -> Optional[Dict[str, Any]]:
    return get_faction_member(faction_id, member_user_id)


def add_or_update_faction_member(
    faction_id: str,
    leader_user_id: str,
    member_user_id: str,
    member_name: str,
    member_api_key: str,
    enabled: int = 1,
    faction_name: str = "",
    leader_name: str = "",
    position: str = "",
) -> Dict[str, Any]:
    now = _utc_now()

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO faction_members (
            faction_id,
            faction_name,
            leader_user_id,
            leader_name,
            member_user_id,
            member_name,
            member_api_key,
            position,
            enabled,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(faction_id, member_user_id) DO UPDATE SET
            faction_name = excluded.faction_name,
            leader_user_id = excluded.leader_user_id,
            leader_name = excluded.leader_name,
            member_name = excluded.member_name,
            member_api_key = excluded.member_api_key,
            position = excluded.position,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
    """, (
        str(faction_id),
        str(faction_name or ""),
        str(leader_user_id or ""),
        str(leader_name or ""),
        str(member_user_id),
        str(member_name or ""),
        str(member_api_key or ""),
        str(position or ""),
        1 if enabled else 0,
        now,
        now,
    ))
    con.commit()
    con.close()

    recalc_faction_license(faction_id)
    return get_faction_member(faction_id, member_user_id) or {}


def upsert_faction_member_access(
    faction_id: str,
    faction_name: str,
    leader_user_id: str,
    leader_name: str,
    member_user_id: str,
    member_name: str,
    member_api_key: str,
    enabled: int = 1,
    position: str = "",
) -> Dict[str, Any]:
    ensure_faction_license(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
    )
    return add_or_update_faction_member(
        faction_id=faction_id,
        leader_user_id=leader_user_id,
        member_user_id=member_user_id,
        member_name=member_name,
        member_api_key=member_api_key,
        enabled=enabled,
        faction_name=faction_name,
        leader_name=leader_name,
        position=position,
    )


def set_faction_member_enabled(
    faction_id: str,
    member_user_id: str,
    enabled: int,
    changed_by_user_id: str = "",
    changed_by_name: str = "",
):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE faction_members
        SET enabled = ?, updated_at = ?
        WHERE faction_id = ? AND member_user_id = ?
    """, (
        1 if enabled else 0,
        _utc_now(),
        str(faction_id),
        str(member_user_id),
    ))
    con.commit()
    con.close()

    recalc_faction_license(faction_id)

    if changed_by_user_id:
        add_audit_log(
            actor_user_id=str(changed_by_user_id),
            actor_name=str(changed_by_name or ""),
            action="faction_member_enabled_changed",
            meta_json=f"faction_id={faction_id} member_user_id={member_user_id} enabled={1 if enabled else 0}",
        )


def delete_faction_member(faction_id: str, member_user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        DELETE FROM faction_members
        WHERE faction_id = ? AND member_user_id = ?
    """, (str(faction_id), str(member_user_id)))
    con.commit()
    con.close()

    recalc_faction_license(faction_id)


def delete_faction_member_access(faction_id: str, member_user_id: str):
    delete_faction_member(faction_id, member_user_id)


def get_enabled_faction_member_count(faction_id: str) -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT COUNT(*) AS c
        FROM faction_members
        WHERE faction_id = ? AND enabled = 1
    """, (str(faction_id),))
    row = cur.fetchone()
    con.close()
    return int((row or {"c": 0})["c"])


def get_total_faction_member_count(faction_id: str) -> int:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT COUNT(*) AS c
        FROM faction_members
        WHERE faction_id = ?
    """, (str(faction_id),))
    row = cur.fetchone()
    con.close()
    return int((row or {"c": 0})["c"])


def calc_faction_renewal_cost(faction_id: str) -> int:
    enabled_count = get_enabled_faction_member_count(faction_id)
    return int(enabled_count * PAYMENT_XANAX_PER_MEMBER)


def recalc_faction_license(faction_id: str) -> Dict[str, Any]:
    row = ensure_faction_license(faction_id)
    member_count = get_total_faction_member_count(faction_id)
    enabled_member_count = get_enabled_faction_member_count(faction_id)
    renewal_cost = enabled_member_count * PAYMENT_XANAX_PER_MEMBER

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE faction_licenses
        SET
            member_count = ?,
            enabled_member_count = ?,
            renewal_cost = ?,
            payment_per_member = ?,
            updated_at = ?
        WHERE faction_id = ?
    """, (
        int(member_count),
        int(enabled_member_count),
        int(renewal_cost),
        int(PAYMENT_XANAX_PER_MEMBER),
        _utc_now(),
        str(faction_id),
    ))
    con.commit()
    con.close()
    return get_faction_license(faction_id) or row


def start_faction_trial_if_needed(
    faction_id: str,
    faction_name: str,
    leader_user_id: str,
    leader_name: str,
    leader_api_key: str = "",
) -> Dict[str, Any]:
    row = ensure_faction_license(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
        leader_api_key=leader_api_key,
    )
    if row.get("trial_started_at") and row.get("trial_expires_at"):
        return compute_faction_license_status(faction_id)

    now = _utc_now()
    expires = _future_iso(TRIAL_DAYS)

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE faction_licenses
        SET
            faction_name = ?,
            leader_user_id = ?,
            leader_name = ?,
            leader_api_key = CASE WHEN ? != '' THEN ? ELSE leader_api_key END,
            trial_started_at = ?,
            trial_expires_at = ?,
            payment_required = 0,
            status = 'trial',
            payment_per_member = ?,
            updated_at = ?
        WHERE faction_id = ?
    """, (
        str(faction_name or ""),
        str(leader_user_id or ""),
        str(leader_name or ""),
        str(leader_api_key or ""),
        str(leader_api_key or ""),
        now,
        expires,
        int(PAYMENT_XANAX_PER_MEMBER),
        now,
        str(faction_id),
    ))
    con.commit()
    con.close()

    recalc_faction_license(faction_id)
    add_audit_log(
        actor_user_id=str(leader_user_id or ""),
        actor_name=str(leader_name or ""),
        action="faction_trial_started",
        meta_json=f"faction_id={faction_id}",
    )
    return compute_faction_license_status(faction_id)


def compute_faction_license_status(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    row = ensure_faction_license(faction_id)
    row = recalc_faction_license(faction_id)

    now_dt = _utc_now_dt()

    trial_started_at = str(row.get("trial_started_at") or "")
    trial_expires_at = str(row.get("trial_expires_at") or "")
    paid_until_at = str(row.get("paid_until_at") or "")
    raw_payment_required = int(row.get("payment_required") or 0)
    renewal_cost = int(row.get("renewal_cost") or 0)
    member_count = int(row.get("member_count") or 0)
    enabled_member_count = int(row.get("enabled_member_count") or 0)
    payment_per_member = int(row.get("payment_per_member") or PAYMENT_XANAX_PER_MEMBER)

    trial_expires_dt = _parse_iso(trial_expires_at)
    paid_until_dt = _parse_iso(paid_until_at)

    trial_active = False
    trial_expired = False
    paid_active = False
    active = False
    payment_required = False
    block_reason = ""
    status = "inactive"
    expires_at = ""
    days_left: Optional[int] = None
    message = ""

    if paid_until_dt and paid_until_dt > now_dt:
        paid_active = True
        active = True
        status = "paid"
        expires_at = paid_until_at
        days_left = _days_left_until(paid_until_dt)
        message = "Faction paid access active."
    elif trial_expires_dt and now_dt < trial_expires_dt:
        trial_active = True
        active = True
        status = "trial"
        expires_at = trial_expires_at
        days_left = _days_left_until(trial_expires_dt)
        message = "Faction trial active."
    elif trial_expires_dt and now_dt >= trial_expires_dt:
        trial_expired = True
        active = False
        payment_required = True
        status = "expired"
        expires_at = trial_expires_at
        days_left = _days_left_until(trial_expires_dt)
        block_reason = "trial_expired"
        message = f"Faction payment required. Send {renewal_cost} Xanax to Fries91 [3679030]."
    else:
        active = False
        status = "inactive"
        payment_required = False
        message = "Faction trial not started yet."

    if raw_payment_required:
        active = False
        payment_required = True
        if status != "paid":
            status = "expired" if trial_started_at else "inactive"
        if trial_started_at and not trial_active and not paid_active:
            trial_expired = True
        if not block_reason and trial_started_at:
            block_reason = "trial_expired"
        elif not block_reason:
            block_reason = "payment_required"
        message = f"Faction payment required. Send {renewal_cost} Xanax to Fries91 [3679030]."

    member_row = get_faction_member(faction_id, viewer_user_id) if viewer_user_id else None
    viewer_is_leader = bool(
        viewer_user_id
        and str(row.get("leader_user_id") or "").strip()
        and str(row.get("leader_user_id") or "").strip() == str(viewer_user_id).strip()
    )

    return {
        "faction_id": str(faction_id),
        "faction_name": str(row.get("faction_name") or ""),
        "leader_user_id": str(row.get("leader_user_id") or ""),
        "leader_name": str(row.get("leader_name") or ""),
        "leader_api_key_present": bool(str(row.get("leader_api_key") or "").strip()),
        "viewer_user_id": str(viewer_user_id or ""),
        "viewer_is_leader": viewer_is_leader,
        "viewer_member_enabled": bool(int((member_row or {}).get("enabled") or 0)) if member_row else False,
        "active": active,
        "status": status,
        "trial_started_at": trial_started_at,
        "trial_expires_at": trial_expires_at,
        "expires_at": expires_at,
        "paid_until_at": paid_until_at,
        "trial_active": trial_active,
        "trial_expired": trial_expired,
        "paid_active": paid_active,
        "payment_required": payment_required,
        "blocked": (not active) or payment_required or trial_expired,
        "days_left": days_left,
        "block_reason": block_reason,
        "message": message,
        "member_count": member_count,
        "enabled_member_count": enabled_member_count,
        "payment_per_member": payment_per_member,
        "renewal_cost": renewal_cost,
        "next_payment_amount": renewal_cost,
        "last_payment_at": str(row.get("last_payment_at") or ""),
        "last_payment_amount": int(row.get("last_payment_amount") or 0),
        "last_payment_kind": str(row.get("last_payment_kind") or ""),
        "last_payment_note": str(row.get("last_payment_note") or ""),
    }


def process_faction_payment_warnings(faction_id: str) -> Dict[str, Any]:
    row = recalc_faction_license(faction_id)
    status = compute_faction_license_status(faction_id)
    if not row:
        return status

    leader_user_id = str(row.get("leader_user_id") or "").strip()
    enabled_member_count = int(row.get("enabled_member_count") or 0)
    days_left = status.get("days_left")
    payment_required = bool(status.get("payment_required"))
    warned_5_day_at = str(row.get("warned_5_day_at") or "")
    warned_due_day_at = str(row.get("warned_due_day_at") or "")
    last_due_notice_at = str(row.get("last_due_notice_at") or "")

    payment_text = _faction_payment_text(enabled_member_count)

    con = _con()
    cur = con.cursor()
    now = _utc_now()

    if isinstance(days_left, int) and days_left <= 5 and days_left >= 1 and not warned_5_day_at:
        if leader_user_id:
            add_notification(
                leader_user_id,
                "payment_warning",
                f"Renewal due in {days_left} day(s). {payment_text}"
            )
        cur.execute("""
            UPDATE faction_licenses
            SET warned_5_day_at = ?, updated_at = ?
            WHERE faction_id = ?
        """, (now, now, str(faction_id)))

    if isinstance(days_left, int) and days_left <= 0 and payment_required and not warned_due_day_at:
        if leader_user_id:
            add_notification(
                leader_user_id,
                "payment_due",
                f"Renewal is due now. {payment_text}"
            )
        cur.execute("""
            UPDATE faction_licenses
            SET warned_due_day_at = ?, updated_at = ?
            WHERE faction_id = ?
        """, (now, now, str(faction_id)))

    if payment_required and not last_due_notice_at:
        add_notification(
            PAYMENT_NOTIFY_USER_ID,
            "faction_payment_due",
            f"Faction {row.get('faction_name') or faction_id} requires payment. {payment_text}"
        )
        cur.execute("""
            UPDATE faction_licenses
            SET last_due_notice_at = ?, last_due_notice_user_id = ?, updated_at = ?
            WHERE faction_id = ?
        """, (now, PAYMENT_NOTIFY_USER_ID, now, str(faction_id)))

    con.commit()
    con.close()
    return compute_faction_license_status(faction_id)


def renew_faction_after_payment(
    faction_id: str,
    amount: int,
    payment_player: str = PAYMENT_PLAYER,
    renewed_by: str = "",
    payment_kind: str = PAYMENT_KIND,
    note: str = "",
    received_by: str = "",
    extend_days: int = DEFAULT_PAID_DAYS,
) -> Dict[str, Any]:
    row = ensure_faction_license(faction_id)
    row = recalc_faction_license(faction_id)

    now_dt = _utc_now_dt()
    current_paid_until = _parse_iso(str(row.get("paid_until_at") or ""))
    base_dt = current_paid_until if current_paid_until and current_paid_until > now_dt else now_dt
    new_paid_until = (base_dt + timedelta(days=int(extend_days))).isoformat()
    now = now_dt.isoformat()

    final_received_by = str(received_by or renewed_by or payment_player or PAYMENT_PLAYER)

    con = _con()
    cur = con.cursor()

    cur.execute("""
        INSERT INTO faction_payment_history (
            faction_id,
            faction_name,
            leader_user_id,
            leader_name,
            amount,
            payment_kind,
            note,
            received_by,
            received_at,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        str(faction_id),
        str(row.get("faction_name") or ""),
        str(row.get("leader_user_id") or ""),
        str(row.get("leader_name") or ""),
        int(amount or 0),
        str(payment_kind or PAYMENT_KIND),
        str(note or ""),
        final_received_by,
        now,
        now,
    ))

    cur.execute("""
        UPDATE faction_licenses
        SET
            paid_until_at = ?,
            payment_required = 0,
            status = 'paid',
            last_payment_amount = ?,
            last_payment_kind = ?,
            last_payment_note = ?,
            last_payment_at = ?,
            warned_5_day_at = '',
            warned_due_day_at = '',
            last_due_notice_at = '',
            last_due_notice_user_id = '',
            updated_at = ?
        WHERE faction_id = ?
    """, (
        new_paid_until,
        int(amount or 0),
        str(payment_kind or PAYMENT_KIND),
        str(note or ""),
        now,
        now,
        str(faction_id),
    ))

    con.commit()
    con.close()

    add_audit_log(
        actor_user_id=str(row.get("leader_user_id") or ""),
        actor_name=str(row.get("leader_name") or ""),
        action="faction_payment_received",
        meta_json=f"faction_id={faction_id} amount={int(amount or 0)} renewed_by={final_received_by}",
    )
    return compute_faction_license_status(faction_id)


def force_expire_faction_license(faction_id: str) -> Dict[str, Any]:
    ensure_faction_license(faction_id)
    recalc_faction_license(faction_id)

    con = _con()
    cur = con.cursor()
    cur.execute("""
        UPDATE faction_licenses
        SET
            paid_until_at = '',
            payment_required = 1,
            status = 'expired',
            updated_at = ?
        WHERE faction_id = ?
    """, (_utc_now(), str(faction_id)))
    con.commit()
    con.close()

    return compute_faction_license_status(faction_id)


def get_faction_payment_history(faction_id: str, limit: int = 25) -> List[Dict[str, Any]]:
    if not faction_id:
        return []

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_payment_history
        WHERE faction_id = ?
        ORDER BY id DESC
        LIMIT ?
    """, (str(faction_id), int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def list_all_faction_licenses(limit: int = 250) -> List[Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_licenses
        ORDER BY
            CASE
                WHEN payment_required = 1 THEN 0
                WHEN status = 'trial' THEN 1
                WHEN status = 'paid' THEN 2
                ELSE 3
            END,
            LOWER(faction_name) ASC
        LIMIT ?
    """, (int(limit),))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()

    out: List[Dict[str, Any]] = []
    for row in rows:
        faction_id = str(row.get("faction_id") or "")
        out.append({**row, "license": compute_faction_license_status(faction_id)})
    return out


def get_member_access_record(member_user_id: str) -> Optional[Dict[str, Any]]:
    if not member_user_id:
        return None

    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT *
        FROM faction_members
        WHERE member_user_id = ? AND enabled = 1
        ORDER BY id DESC
        LIMIT 1
    """, (str(member_user_id),))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def get_faction_license_for_member(member_user_id: str) -> Optional[Dict[str, Any]]:
    member = get_member_access_record(member_user_id)
    if not member:
        return None

    faction_id = str(member.get("faction_id") or "")
    if not faction_id:
        return None

    return compute_faction_license_status(faction_id, viewer_user_id=member_user_id)


def member_has_faction_access(member_user_id: str) -> bool:
    lic = get_faction_license_for_member(member_user_id)
    return bool(lic and lic.get("active"))


def get_owner_faction_dashboard(limit: int = 250) -> Dict[str, Any]:
    factions = list_all_faction_licenses(limit=limit)
    return {
        "payment_player": PAYMENT_PLAYER,
        "payment_per_member": PAYMENT_XANAX_PER_MEMBER,
        "payment_kind": PAYMENT_KIND,
        "factions": factions,
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
}
