import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "warbot.db")

def init_db():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        k TEXT PRIMARY KEY,
        v TEXT
    )
    """)
    con.commit()
    con.close()

def set_setting(k: str, v: str):
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))
    con.commit()
    con.close()

def get_setting(k: str, default: str = "") -> str:
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("SELECT v FROM settings WHERE k=?", (k,))
    row = cur.fetchone()
    con.close()
    return row[0] if row else default
