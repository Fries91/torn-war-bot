import os
import sqlite3
from typing import Optional, Dict, Any, List

DB_PATH = os.getenv("DB_PATH", "warbot.db")

def _con():
    return sqlite3.connect(DB_PATH)

def init_db():
    con = _con()
    cur = con.cursor()

    # settings kv
    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        k TEXT PRIMARY KEY,
        v TEXT
    )
    """)

    # member availability + last update
    cur.execute("""
    CREATE TABLE IF NOT EXISTS member_availability (
        torn_id INTEGER PRIMARY KEY,
        name TEXT,
        available INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
    )
    """)

    # throttle alerts (avoid spam)
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

def upsert_availability(torn_id: int, name: str, available: bool, updated_at: str):
    con = _con()
    cur = con.cursor()
    cur.execute(
        """
        INSERT INTO member_availability(torn_id, name, available, updated_at)
        VALUES(?,?,?,?)
        ON CONFLICT(torn_id) DO UPDATE SET
          name=excluded.name,
          available=excluded.available,
          updated_at=excluded.updated_at
        """,
        (torn_id, name, 1 if available else 0, updated_at)
    )
    con.commit()
    con.close()

def get_availability_map() -> Dict[int, Dict[str, Any]]:
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
