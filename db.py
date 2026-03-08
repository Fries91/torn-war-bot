import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("DB_PATH", "war_hub.db")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utc_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


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

    _ensure_column(cur, "med_deals", "creator_user_id", "creator_user_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "creator_name", "creator_name TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_id", "faction_id TEXT DEFAULT ''")
    _ensure_column(cur, "med_deals", "faction_name", "faction_name TEXT DEFAULT ''")

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
    cur.execute("CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)")

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
