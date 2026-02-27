# db.py (Postgres, shared between services)
import os
import asyncpg

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

async def _conn():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL missing")
    return await asyncpg.connect(DATABASE_URL)

async def init_db():
    conn = await _conn()
    try:
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS member_settings (
            discord_id BIGINT PRIMARY KEY,
            torn_id BIGINT,
            torn_name TEXT,
            timezone TEXT DEFAULT 'UTC',
            avail_start TEXT DEFAULT '18:00',
            avail_end   TEXT DEFAULT '23:59',
            enabled INT DEFAULT 1
        );
        """)
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS user_keys (
            torn_id BIGINT PRIMARY KEY,
            api_key TEXT NOT NULL
        );
        """)
        await conn.execute("""
        CREATE TABLE IF NOT EXISTS live_sheet_message (
            id INT PRIMARY KEY CHECK (id=1),
            channel_id BIGINT,
            message_id BIGINT
        );
        """)
    finally:
        await conn.close()

async def upsert_member(discord_id: int, torn_id: int, torn_name: str):
    conn = await _conn()
    try:
        await conn.execute("""
        INSERT INTO member_settings(discord_id, torn_id, torn_name)
        VALUES($1,$2,$3)
        ON CONFLICT(discord_id)
        DO UPDATE SET torn_id=EXCLUDED.torn_id, torn_name=EXCLUDED.torn_name;
        """, int(discord_id), int(torn_id), str(torn_name))
    finally:
        await conn.close()

async def set_timezone(discord_id: int, tz: str):
    conn = await _conn()
    try:
        await conn.execute("UPDATE member_settings SET timezone=$1 WHERE discord_id=$2", tz, int(discord_id))
    finally:
        await conn.close()

async def set_availability(discord_id: int, start_hhmm: str, end_hhmm: str):
    conn = await _conn()
    try:
        await conn.execute("""
        UPDATE member_settings SET avail_start=$1, avail_end=$2 WHERE discord_id=$3
        """, start_hhmm, end_hhmm, int(discord_id))
    finally:
        await conn.close()

async def set_enabled(discord_id: int, enabled: int):
    conn = await _conn()
    try:
        await conn.execute("UPDATE member_settings SET enabled=$1 WHERE discord_id=$2", int(enabled), int(discord_id))
    finally:
        await conn.close()

async def link_key(torn_id: int, api_key: str):
    conn = await _conn()
    try:
        await conn.execute("""
        INSERT INTO user_keys(torn_id, api_key)
        VALUES($1,$2)
        ON CONFLICT(torn_id) DO UPDATE SET api_key=EXCLUDED.api_key
        """, int(torn_id), api_key)
    finally:
        await conn.close()

async def unlink_key(torn_id: int):
    conn = await _conn()
    try:
        await conn.execute("DELETE FROM user_keys WHERE torn_id=$1", int(torn_id))
    finally:
        await conn.close()

async def get_all_settings():
    conn = await _conn()
    try:
        rows = await conn.fetch("SELECT * FROM member_settings")
        return [dict(r) for r in rows]
    finally:
        await conn.close()

async def get_key_for_torn_id(torn_id: int):
    conn = await _conn()
    try:
        row = await conn.fetchrow("SELECT api_key FROM user_keys WHERE torn_id=$1", int(torn_id))
        return row["api_key"] if row else None
    finally:
        await conn.close()

async def set_live_sheet_message(channel_id: int, message_id: int):
    conn = await _conn()
    try:
        await conn.execute("""
        INSERT INTO live_sheet_message (id, channel_id, message_id)
        VALUES (1, $1, $2)
        ON CONFLICT(id) DO UPDATE SET channel_id=EXCLUDED.channel_id, message_id=EXCLUDED.message_id
        """, int(channel_id), int(message_id))
    finally:
        await conn.close()

async def get_live_sheet_message():
    conn = await _conn()
    try:
        row = await conn.fetchrow("SELECT channel_id, message_id FROM live_sheet_message WHERE id=1")
        if not row:
            return None
        return {"channel_id": int(row["channel_id"]), "message_id": int(row["message_id"])}
    finally:
        await conn.close()
