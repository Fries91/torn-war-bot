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
            avail_end TEXT DEFAULT '23:59',
            enabled INTEGER DEFAULT 1
        )
        """)
        await db.execute("""
        CREATE TABLE IF NOT EXISTS user_keys (
            torn_id INTEGER PRIMARY KEY,
            api_key TEXT NOT NULL
        )
        """)
        await db.commit()

async def link_key(torn_id, api_key):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
        INSERT INTO user_keys(torn_id, api_key)
        VALUES(?,?)
        ON CONFLICT(torn_id) DO UPDATE SET api_key=excluded.api_key
        """, (torn_id, api_key))
        await db.commit()

async def get_key(torn_id):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT api_key FROM user_keys WHERE torn_id=?", (torn_id,))
        row = await cur.fetchone()
        return row[0] if row else None
