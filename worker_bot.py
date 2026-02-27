# worker_bot.py  ✅ Render Worker entrypoint (NO Playwright / NO screenshots)
import os
import asyncio
from datetime import datetime, time as dtime

import pytz
import aiohttp
import discord
from discord import app_commands
from discord.ext import tasks
from dotenv import load_dotenv

from db import (
    init_db, upsert_member, set_timezone, set_availability, set_enabled,
    link_key, unlink_key, get_all_settings, get_key_for_torn_id,
)
from torn_api import get_faction_overview, get_user_energy

load_dotenv()

# ===== ENV =====
DISCORD_TOKEN = (os.getenv("DISCORD_TOKEN") or "").strip()
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()

# Your WEB service URL (the Flask dashboard service)
WEB_BASE_URL = (os.getenv("WEB_BASE_URL") or os.getenv("PUBLIC_BASE_URL") or "").strip().rstrip("/")
WEB_SHARED_SECRET = (os.getenv("WEB_SHARED_SECRET") or "").strip()

REFRESH_INTERVAL = int(os.getenv("REFRESH_INTERVAL", "60"))

PING_THRESHOLD = int(os.getenv("PING_THRESHOLD", "5"))
PING_COOLDOWN_SECONDS = int(os.getenv("PING_COOLDOWN_SECONDS", "600"))

DEBUG = (os.getenv("DEBUG") or "").strip() == "1"

def env_int(name: str, default: int = 0) -> int:
    v = (os.getenv(name) or "").strip()
    return int(v) if v.isdigit() else default

ALERT_CHANNEL_ID = env_int("ALERT_CHANNEL_ID", 0)
ALERT_ROLE_ID = env_int("ALERT_ROLE_ID", 0)

DISABLE_DISCORD_POSTS = (os.getenv("DISABLE_DISCORD_POSTS") or "").strip() == "1"

STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
}

def parse_hhmm(s: str) -> dtime:
    hh, mm = s.split(":")
    return dtime(hour=int(hh), minute=int(mm))

def now_in_tz(tz_name: str) -> datetime:
    return datetime.now(pytz.timezone(tz_name))

def is_within_window(local_dt: datetime, start_str: str, end_str: str) -> bool:
    start_t = parse_hhmm(start_str)
    end_t = parse_hhmm(end_str)
    tnow = local_dt.time()
    if start_t <= end_t:
        return start_t <= tnow <= end_t
    return (tnow >= start_t) or (tnow <= end_t)

def status_is_online(desc: str) -> bool:
    s = (desc or "").lower()
    # Torn status description examples include "Online", "Idle", etc.
    return ("online" in s) or ("idle" in s)

def status_is_hospital(desc: str) -> bool:
    return "hospital" in (desc or "").lower()

async def push_state_to_web(session: aiohttp.ClientSession):
    if not WEB_BASE_URL or not WEB_SHARED_SECRET:
        if DEBUG:
            print("DEBUG: push skipped (missing WEB_BASE_URL or WEB_SHARED_SECRET)")
        return

    url = f"{WEB_BASE_URL}/api/push_state"
    try:
        async with session.post(
            url,
            json={
                "rows": STATE["rows"],
                "updated_at": STATE["updated_at"],
                "chain": STATE["chain"],
                "war": STATE["war"],
                "available_count": STATE["available_count"],
            },
            headers={"X-STATE-SECRET": WEB_SHARED_SECRET},
            timeout=aiohttp.ClientTimeout(total=20),
        ) as r:
            body = await r.text()  # consume body to avoid "Unclosed connector"
            if DEBUG:
                print(f"DEBUG: push -> {url} status={r.status} body={body[:200]}")
    except Exception as e:
        print("Push to web failed:", e)

class TornWarBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)
        self.http_session: aiohttp.ClientSession | None = None
        self.last_pinged_at_utc: float | None = None

    async def setup_hook(self):
        await init_db()

        # Sync slash commands
        try:
            await self.tree.sync()
            if DEBUG:
                print("DEBUG: slash commands synced")
        except Exception as e:
            print("Slash command sync failed:", e)

        timeout = aiohttp.ClientTimeout(total=45)
        self.http_session = aiohttp.ClientSession(timeout=timeout)

        refresh_loop.start()

    async def on_ready(self):
        if DEBUG:
            print(f"DEBUG: bot ready as {self.user} (guilds={len(self.guilds)})")

    async def close(self):
        try:
            if self.http_session:
                await self.http_session.close()
        finally:
            await super().close()

bot = TornWarBot()

# ===== SLASH COMMANDS =====
@bot.tree.command(name="sheet", description="Get the dashboard link.")
async def sheet_cmd(interaction: discord.Interaction):
    # Always respond quickly to avoid "application did not respond"
    if not WEB_BASE_URL:
        await interaction.response.send_message("WEB_BASE_URL not set on worker.", ephemeral=True)
        return
    await interaction.response.send_message(f"Dashboard: {WEB_BASE_URL}/", ephemeral=True)

@bot.tree.command(name="linkkey", description="Link your Torn API key so the bot can show YOUR energy.")
@app_commands.describe(torn_id="Your Torn ID", api_key="Your Torn API key (limited key recommended)")
async def linkkey_cmd(interaction: discord.Interaction, torn_id: int, api_key: str):
    await link_key(torn_id, api_key.strip())
    await upsert_member(interaction.user.id, torn_id, interaction.user.display_name)
    await interaction.response.send_message("✅ Linked.", ephemeral=True)

@bot.tree.command(name="unlinkkey", description="Unlink your Torn API key.")
@app_commands.describe(torn_id="Your Torn ID")
async def unlinkkey_cmd(interaction: discord.Interaction, torn_id: int):
    await unlink_key(torn_id)
    await interaction.response.send_message("✅ Unlinked.", ephemeral=True)

@bot.tree.command(name="timezone", description="Set your timezone (example: America/Toronto).")
@app_commands.describe(tz="IANA timezone like America/Toronto, Europe/London, etc.")
async def timezone_cmd(interaction: discord.Interaction, tz: str):
    try:
        pytz.timezone(tz)
    except Exception:
        await interaction.response.send_message("❌ Invalid timezone.", ephemeral=True)
        return
    await set_timezone(interaction.user.id, tz)
    await interaction.response.send_message(f"✅ Timezone set: {tz}", ephemeral=True)

@bot.tree.command(name="availability", description="Set your availability window (YOUR local HH:MM).")
@app_commands.describe(start="Start HH:MM", end="End HH:MM")
async def availability_cmd(interaction: discord.Interaction, start: str, end: str):
    try:
        parse_hhmm(start); parse_hhmm(end)
    except Exception:
        await interaction.response.send_message("❌ Use HH:MM format.", ephemeral=True)
        return
    await set_availability(interaction.user.id, start, end)
    await interaction.response.send_message(f"✅ Availability set: {start} → {end}", ephemeral=True)

@bot.tree.command(name="opt", description="Opt in/out of being counted for availability.")
@app_commands.describe(enabled="true = opt-in, false = opt-out")
async def opt_cmd(interaction: discord.Interaction, enabled: bool):
    await set_enabled(interaction.user.id, 1 if enabled else 0)
    await interaction.response.send_message(f"✅ Enabled = {enabled}", ephemeral=True)

# ===== MAIN LOOP =====
@tasks.loop(seconds=REFRESH_INTERVAL)
async def refresh_loop():
    if not bot.http_session:
        return

    # Torn fetch
    try:
        faction_data = await get_faction_overview(bot.http_session, FACTION_ID, FACTION_API_KEY)
    except Exception as e:
        print("Faction fetch failed:", e)
        return

    members = faction_data.get("members", {}) or {}
    if DEBUG:
        print("DEBUG: members_count =", len(members))

    chain = faction_data.get("chain") or {}
    STATE["chain"] = {
        "current": chain.get("current"),
        "max": chain.get("max"),
        "timeout": chain.get("timeout"),
        "cooldown": chain.get("cooldown"),
    }

    rankedwars = faction_data.get("rankedwars") or {}
    now_utc = int(datetime.utcnow().timestamp())
    next_rw = None
    for _, rw in rankedwars.items():
        war = (rw or {}).get("war") or {}
        start = war.get("start")
        if isinstance(start, int) and start > now_utc:
            if not next_rw:
                next_rw = rw
            else:
                cur_start = ((next_rw.get("war") or {}).get("start") or 10**18)
                if start < cur_start:
                    next_rw = rw

    war_state = {"opponent": None, "start": None, "end": None, "target": None}
    if next_rw:
        war = next_rw.get("war") or {}
        factions = next_rw.get("factions") or {}
        opp_name = None
        for fid, fobj in factions.items():
            if str(fid) != str(FACTION_ID):
                opp_name = (fobj or {}).get("name")
                break
        war_state = {
            "opponent": opp_name or "Unknown",
            "start": war.get("start"),
            "end": war.get("end"),
            "target": war.get("target"),
        }
    STATE["war"] = war_state

    settings = await get_all_settings()
    settings_by_torn = {s["torn_id"]: s for s in settings if s.get("torn_id")}

    rows = []
    available_count = 0

    for torn_id_str, m in members.items():
        try:
            torn_id = int(torn_id_str)
        except Exception:
            continue

        name = m.get("name", f"#{torn_id}")
        status_desc = (m.get("status") or {}).get("description") or ""
        last_action_text = ((m.get("last_action") or {}).get("relative")) or ""

        hospitalized = status_is_hospital(status_desc)

        s = settings_by_torn.get(torn_id) or {}
        tz = s.get("timezone") or "UTC"
        enabled = (s.get("enabled", 1) == 1)
        avail_start = s.get("avail_start") or "18:00"
        avail_end = s.get("avail_end") or "23:59"

        energy_text = "—"
        key = await get_key_for_torn_id(torn_id)
        if key:
            try:
                u = await get_user_energy(bot.http_session, torn_id, key)
                e = (u.get("energy") or {})
                cur = e.get("current")
                mx = e.get("maximum")
                if cur is not None and mx is not None:
                    energy_text = f"{cur}/{mx}"
            except Exception:
                energy_text = "key err"

        available_now = False
        if enabled and (not hospitalized) and status_is_online(status_desc):
            try:
                available_now = is_within_window(now_in_tz(tz), avail_start, avail_end)
            except Exception:
                available_now = False

        if available_now:
            available_count += 1

        rows.append({
            "torn_id": torn_id,
            "name": name,
            "status": status_desc,
            "hospitalized": hospitalized,
            "timezone": tz,
            "available_now": available_now,
            "energy_text": energy_text,
            "last_action_text": last_action_text,
        })

    STATE["rows"] = sorted(rows, key=lambda r: (not r["available_now"], (r["name"] or "").lower()))
    STATE["available_count"] = available_count
    STATE["updated_at"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    # push live state to web dashboard
    await push_state_to_web(bot.http_session)

    # optional: ping when threshold hit
    if DISABLE_DISCORD_POSTS:
        return
    if available_count >= PING_THRESHOLD and ALERT_CHANNEL_ID and ALERT_ROLE_ID:
        now = datetime.utcnow().timestamp()
        can_ping = (bot.last_pinged_at_utc is None) or ((now - bot.last_pinged_at_utc) >= PING_COOLDOWN_SECONDS)
        if can_ping:
            ch = bot.get_channel(ALERT_CHANNEL_ID)
            if ch:
                try:
                    await ch.send(f"<@&{ALERT_ROLE_ID}> **{available_count} members available now** ✅  {WEB_BASE_URL}/")
                    bot.last_pinged_at_utc = now
                except discord.HTTPException as e:
                    print("Ping send failed:", e)

async def main():
    if not DISCORD_TOKEN:
        raise RuntimeError("DISCORD_TOKEN missing")
    if not FACTION_ID:
        raise RuntimeError("FACTION_ID missing")
    if not FACTION_API_KEY:
        raise RuntimeError("FACTION_API_KEY missing")
    if not WEB_BASE_URL:
        raise RuntimeError("WEB_BASE_URL missing (must be your Web Service URL, e.g. https://torn-war-bot.onrender.com)")
    if not WEB_SHARED_SECRET:
        raise RuntimeError("WEB_SHARED_SECRET missing (must match your Web Service env)")

    if DEBUG:
        print("DEBUG: WEB_BASE_URL =", WEB_BASE_URL)
        print("DEBUG: REFRESH_INTERVAL =", REFRESH_INTERVAL)
        print("DEBUG: DISABLE_DISCORD_POSTS =", DISABLE_DISCORD_POSTS)

    await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
