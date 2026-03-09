import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "war_hub.db")
TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "45"))
DEFAULT_PAID_DAYS = int(os.getenv("DEFAULT_PAID_DAYS", "45"))
PAYMENT_PLAYER = os.getenv("PAYMENT_PLAYER", "Fries91")
PAYMENT_AMOUNT_XANAX = int(os.getenv("PAYMENT_AMOUNT_XANAX", "50"))


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
            created_at TEXT
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

    _ensure_column(cur, "med_deals", "creator_user_id", "creator_user_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "creator_name", "creator_name TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_id", "faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_name", "faction_name TEXT DEFAULT ''")

    _ensure_column(cur, "user_licenses", "last_payment_kind", "last_payment_kind TEXT DEFAULT ''")
    _ensure_column(cur, "user_licenses", "last_payment_note", "last_payment_note TEXT DEFAULT ''")
    _ensure_column(cur, "user_licenses", "last_payment_amount", "last_payment_amount INTEGER DEFAULT 0")

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_history_user_id ON payment_history(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_history_received_at ON payment_history(received_at)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_api_cache_expires_at_ts ON api_cache(expires_at_ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)")

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


def delete_session(token: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
    con.commit()
    con.close()


def delete_sessions_for_user(user_id: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
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
        0,
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
):
    if not war_id:
        return

    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO war_snapshots (
            war_id, faction_id, faction_name, enemy_faction_id, enemy_faction_name,
            score_us, score_them, target_score, lead, start_ts, end_ts, ts, status_text, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        war_id,
        faction_id,
        faction_name,
        enemy_faction_id,
        enemy_faction_name,
        int(score_us or 0),
        int(score_them or 0),
        int(target_score or 0),
        int(lead or 0),
        int(start_ts or 0),
        int(end_ts or 0),
        _utc_ts(),
        status_text,
        _utc_now(),
    ))

    cur.execute("""
        DELETE FROM war_snapshots
        WHERE id NOT IN (
            SELECT id FROM war_snapshots
            WHERE war_id = ?
            ORDER BY id DESC
            LIMIT 200
        )
        AND war_id = ?
    """, (war_id, war_id))

    con.commit()
    con.close()


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
    """, (war_id, int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def get_enemy_state_map(war_id: str) -> Dict[str, Dict[str, Any]]:
    if not war_id:
        return {}
    con = _con()
    cur = con.cursor()
    cur.execute("""
        SELECT * FROM enemy_states
        WHERE war_id = ?
    """, (war_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return {str(r["user_id"]): r for r in rows}


def upsert_enemy_state(
    war_id: str,
    user_id: str,
    name: str,
    online_state: str,
    hospital_seconds: int,
):
    if not war_id or not user_id:
        return

    now = _utc_now()
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO enemy_states (
            war_id, user_id, name, online_state, hospital_seconds, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, user_id) DO UPDATE SET
            name = excluded.name,
            online_state = excluded.online_state,
            hospital_seconds = excluded.hospital_seconds,
            updated_at = excluded.updated_at
    """, (
        war_id,
        user_id,
        name,
        online_state,
        int(hospital_seconds or 0),
        now,
    ))
    con.commit()
    con.close()


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
    """, (war_id,))
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
):
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
        war_id,
        target_id,
        target_name,
        assigned_to_user_id,
        assigned_to_name,
        assigned_by_user_id,
        assigned_by_name,
        priority or "normal",
        note,
        now,
        now,
    ))
    con.commit()
    con.close()


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
    """, (war_id,))
    rows = [dict(r) for r in cur.fetchall()]
    con.close()
    return rows


def upsert_war_note(
    war_id: str,
    target_id: str,
    note: str,
    created_by_user_id: str,
    created_by_name: str,
):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO war_notes (
            war_id, target_id, note, created_by_user_id, created_by_name, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        war_id,
        target_id,
        note,
        created_by_user_id,
        created_by_name,
        _utc_now(),
    ))
    con.commit()
    con.close()


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
    """, (war_id,))
    row = cur.fetchone()
    con.close()
    return _row_to_dict(row)


def upsert_war_terms(
    war_id: str,
    terms_text: str,
    updated_by_user_id: str,
    updated_by_name: str,
):
    if not war_id:
        return

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
        war_id,
        terms_text,
        updated_by_user_id,
        updated_by_name,
        now,
        now,
    ))
    con.commit()
    con.close()


def delete_war_terms(war_id: str):
    if not war_id:
        return
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM war_terms WHERE war_id = ?", (war_id,))
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
    """, (user_id, key_name))
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
        user_id,
        key_name,
        value_text,
        now,
        now,
    ))
    con.commit()
    con.close()


def add_audit_log(user_id: str, action: str, detail: str = ""):
    con = _con()
    cur = con.cursor()
    cur.execute("""
        INSERT INTO audit_log (user_id, action, detail, created_at)
        VALUES (?, ?, ?, ?)
    """, (str(user_id or ""), str(action or ""), str(detail or ""), _utc_now()))
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
    """, (str(cache_key), str(payload_text), expires_at_ts, now, now))
    con.commit()
    con.close()


def cache_delete(cache_key: str):
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM api_cache WHERE cache_key = ?", (str(cache_key),))
    con.commit()
    con.close()


def cache_purge_expired():
    con = _con()
    cur = con.cursor()
    cur.execute("DELETE FROM api_cache WHERE expires_at_ts <= ?", (_utc_ts(),))
    con.commit()
    con.close()


# =========================
# LICENSE / TRIAL / PAYMENT
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
            """, (admin_key, _utc_now(), str(user_id)))
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
        admin_key or "",
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
        admin_key or "",
        now,
        expires,
        now,
        str(user_id),
    ))
    con.commit()
    con.close()
    add_audit_log(user_id, "trial_started", f"trial_expires_at={expires}")
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
        admin_key or "",
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
    """, (now, now, note, str(user_id)))
    con.commit()
    con.close()
    add_audit_log(user_id, "license_cleared", note)


def mark_payment_received(
    user_id: str,
    amount: int = 50,
    payment_kind: str = "xanax",
    note: str = "",
    received_by: str = PAYMENT_PLAYER,
    extend_days: int = DEFAULT_PAID_DAYS,
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
        payment_kind or "xanax",
        int(amount or 0),
        note or "",
        received_by or PAYMENT_PLAYER,
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
        payment_kind or "xanax",
        note or "",
        now,
        now,
        str(user_id),
    ))

    con.commit()
    con.close()
    add_audit_log(user_id, "payment_received", f"{amount} {payment_kind} by {received_by}")
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


def has_active_paid_access(user_id: str) -> bool:
    row = get_license(user_id)
    if not row:
        return False
    paid_until = _parse_iso(str(row.get("paid_until_at") or ""))
    return bool(paid_until and paid_until > _utc_now_dt())


def is_trial_expired(user_id: str) -> bool:
    row = get_license(user_id)
    if not row:
        return False
    trial_expires_at = _parse_iso(str(row.get("trial_expires_at") or ""))
    if not trial_expires_at:
        return False
    return _utc_now_dt() >= trial_expires_at


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
        message = f"Trial expired. Send {PAYMENT_AMOUNT_XANAX} Xanax to {PAYMENT_PLAYER} to continue access."
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
        message = f"Trial expired. Send {PAYMENT_AMOUNT_XANAX} Xanax to {PAYMENT_PLAYER} to continue access."

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
    extend_days: int = DEFAULT_PAID_DAYS,
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

    add_audit_log(user_id, "license_expired", "forced_expire")
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

    con.close()

    return {
        "users_total": users_total,
        "licenses_total": licenses_total,
        "trials_total": trials_total,
        "paid_total": paid_total,
        "payment_required_total": payment_required_total,
        "sessions_total": sessions_total,
    }
