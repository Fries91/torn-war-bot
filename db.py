import os
import sqlite3
from typing import Dict, Any

DB_PATH = os.getenv("DB_PATH", "warbot.db")

def _con():
    # check_same_thread=False prevents thread errors under gunicorn --threads
    return sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)

def init_db():
    con = _con()
    cur = con.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        k TEXT PRIMARY KEY,
        v TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS member_availability (
        torn_id INTEGER PRIMARY KEY,
        name TEXT,
        available INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS alert_state (
        k TEXT PRIMARY KEY,
        v TEXT
    )
    """)

    con.commit()
    con.close()

def set_setting(k: str, v: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO settings(k,v) VALUES(?,?) "
        "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (k, v)
    )
    con.commit()
    con.close()

def get_setting(k: str, default: str = "") -> str:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT v FROM settings WHERE k=?", (k,))
    row = cur.fetchone()
    con.close()
    return row[0] if row else default

def set_alert_state(k: str, v: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        "INSERT INTO alert_state(k,v) VALUES(?,?) "
        "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (k, v)
    )
    con.commit()
    con.close()

def get_alert_state(k: str, default: str = "") -> str:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT v FROM alert_state WHERE k=?", (k,))
    row = cur.fetchone()
    con.close()
    return row[0] if row else default


# ✅ COMPAT: app.py calls upsert_availability(torn_id, available)
def upsert_availability(torn_id: str, available: bool):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO member_availability(torn_id, name, available, updated_at)
        VALUES(?, ?, ?, datetime('now'))
        ON CONFLICT(torn_id) DO UPDATE SET
          available=excluded.available,
          updated_at=excluded.updated_at
        """,
        (int(torn_id), None, 1 if available else 0)
    )
    con.commit()
    con.close()


# ✅ COMPAT: app.py expects {"1234": True, ...}
def get_availability_map() -> Dict[str, bool]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT torn_id, available FROM member_availability")
    rows = cur.fetchall()
    con.close()
    return {str(torn_id): bool(available) for (torn_id, available) in rows}


# (Optional) keep your old detailed map if you still want it elsewhere
def get_availability_map_full() -> Dict[int, Dict[str, Any]]:
    con = _con()
    cur = con.cursor()
    cur.execute("SELECT torn_id, name, available, updated_at FROM member_availability")
    rows = cur.fetchall()
    con.close()
    out: Dict[int, Dict[str, Any]] = {}
    for torn_id, name, available, updated_at in rows:
        out[int(torn_id)] = {
            "torn_id": int(torn_id),
            "name": name,
            "available": bool(available),
            "updated_at": updated_at,
        }
    return out
