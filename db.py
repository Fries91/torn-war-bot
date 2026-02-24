import aiosqlite

DB_PATH = "torn_war.db"

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        CREATE TABLE IF NOT EXISTS member_settings (
            discord_id INTEGER PRIMARY KEY,
            torn_id INTEGER,
            torn_name TEXT,
            timezone TEXT DEFAULT 'UTC',
            avail_start TEXT DEFAULT '18:00',
            avail_end   TEXT DEFAULT '23:59',
            enabled INTEGER DEFAULT 1
        )
        """)
        await db.execute("""
        CREATE TABLE IF NOT EXISTS user_keys (
            torn_id INTEGER PRIMARY KEY,
            api_key TEXT NOT NULL
        )
        """)
        # Store the one live Discord message we keep editing
        await db.execute("""
        CREATE TABLE IF NOT EXISTS live_sheet_message (
            id INTEGER PRIMARY KEY CHECK (id=1),
            channel_id INTEGER,
            message_id INTEGER
        )
        """)
        await db.commit()

async def upsert_member(discord_id: int, torn_id: int, torn_name: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        INSERT INTO member_settings(discord_id, torn_id, torn_name)
        VALUES(?,?,?)
        ON CONFLICT(discord_id)
        DO UPDATE SET torn_id=excluded.torn_id, torn_name=excluded.torn_name
        """, (discord_id, torn_id, torn_name))
        await db.commit()

async def set_timezone(discord_id: int, tz: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE member_settings SET timezone=? WHERE discord_id=?", (tz, discord_id))
        await db.commit()

async def set_availability(discord_id: int, start_hhmm: str, end_hhmm: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE member_settings SET avail_start=?, avail_end=? WHERE discord_id=?",
            (start_hhmm, end_hhmm, discord_id)
        )
        await db.commit()

async def set_enabled(discord_id: int, enabled: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE member_settings SET enabled=? WHERE discord_id=?", (enabled, discord_id))
        await db.commit()

async def link_key(torn_id: int, api_key: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        INSERT INTO user_keys(torn_id, api_key)
        VALUES(?,?)
        ON CONFLICT(torn_id) DO UPDATE SET api_key=excluded.api_key
        """, (torn_id, api_key))
        await db.commit()

async def unlink_key(torn_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM user_keys WHERE torn_id=?", (torn_id,))
        await db.commit()

async def get_all_settings():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM member_settings")
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

async def get_key_for_torn_id(torn_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT api_key FROM user_keys WHERE torn_id=?", (torn_id,))
        row = await cur.fetchone()
        return row[0] if row else None

# Compatibility alias (prevents old builds from crashing)
async def get_key(torn_id: int):
    return await get_key_for_torn_id(torn_id)

async def set_live_sheet_message(channel_id: int, message_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        INSERT INTO live_sheet_message (id, channel_id, message_id)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id, message_id=excluded.message_id
        """, (channel_id, message_id))
        await db.commit()

async def get_live_sheet_message():
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT channel_id, message_id FROM live_sheet_message WHERE id=1")
        row = await cur.fetchone()
        if not row:
            return None
        return {"channel_id": row[0], "message_id": row[1]}
