import os
import asyncio
import threading
from datetime import datetime, time as dtime

import pytz
import aiohttp
import discord
from discord import app_commands
from discord.ext import tasks
from dotenv import load_dotenv

from db import (
    init_db, upsert_member, set_timezone, set_availability, set_enabled,
    link_key, unlink_key, get_all_settings, get_key_for_torn_id
)
from torn_api import get_faction_overview, get_user_energy
import web_panel

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
FACTION_ID = os.getenv("FACTION_ID")
FACTION_API_KEY = os.getenv("FACTION_API_KEY")

ALERT_CHANNEL_ID = int(os.getenv("ALERT_CHANNEL_ID", "0"))
ALERT_ROLE_ID = int(os.getenv("ALERT_ROLE_ID", "0"))

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")
WEB_HOST = "0.0.0.0"
WEB_PORT = int(os.getenv("PORT", os.getenv("WEB_PORT", "10000")))

PING_THRESHOLD = 5
PING_COOLDOWN_SECONDS = 600  # 10 min

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
    return (tnow >= start_t) or (tnow <= end_t)  # overnight window

def status_is_online(desc: str) -> bool:
    s = (desc or "").lower()
    return ("online" in s) or ("idle" in s)

def status_is_hospital(desc: str) -> bool:
    return "hospital" in (desc or "").lower()

class TornWarBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)
        self.http_session: aiohttp.ClientSession | None = None
        self.last_pinged_at_utc: float | None = None

    async def setup_hook(self):
        # ✅ async-safe initialization
        await init_db()
        await self.tree.sync()
        self.http_session = aiohttp.ClientSession()
        refresh_loop.start()

bot = TornWarBot()

# ---- Slash commands ----

@bot.tree.command(name="sheet", description="Get the PDA-friendly dashboard link.")
async def sheet_cmd(interaction: discord.Interaction):
    await interaction.response.send_message(f"Dashboard: {PUBLIC_BASE_URL}/", ephemeral=True)

@bot.tree.command(name="linkkey", description="Link your Torn API key so the bot can show YOUR energy.")
@app_commands.describe(torn_id="Your Torn ID", api_key="Your Torn API key (limited key recommended)")
async def linkkey_cmd(interaction: discord.Interaction, torn_id: int, api_key: str):
    await link_key(torn_id, api_key.strip())
    await upsert_member(interaction.user.id, torn_id, interaction.user.display_name)
    await interaction.response.send_message("✅ Linked. Your energy can now show on the dashboard.", ephemeral=True)

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
        await interaction.response.send_message("❌ Invalid timezone. Example: America/Toronto", ephemeral=True)
        return
    await set_timezone(interaction.user.id, tz)
    await interaction.response.send_message(f"✅ Timezone set to {tz}", ephemeral=True)

@bot.tree.command(name="availability", description="Set your daily availability window in YOUR local time (HH:MM).")
@app_commands.describe(start="Start HH:MM", end="End HH:MM")
async def availability_cmd(interaction: discord.Interaction, start: str, end: str):
    try:
        parse_hhmm(start); parse_hhmm(end)
    except Exception:
        await interaction.response.send_message("❌ Use HH:MM format, e.g. 18:00 23:30", ephemeral=True)
        return
    await set_availability(interaction.user.id, start, end)
    await interaction.response.send_message(f"✅ Availability set: {start} → {end}", ephemeral=True)

@bot.tree.command(name="opt", description="Opt in/out of being counted for 'available' pings.")
@app_commands.describe(enabled="true = opt-in, false = opt-out")
async def opt_cmd(interaction: discord.Interaction, enabled: bool):
    await set_enabled(interaction.user.id, 1 if enabled else 0)
    await interaction.response.send_message(f"✅ Enabled = {enabled}", ephemeral=True)

# ---- Background refresh loop ----

@tasks.loop(seconds=60)
async def refresh_loop():
    if not bot.http_session:
        return

    try:
        faction_data = await get_faction_overview(bot.http_session, FACTION_ID, FACTION_API_KEY)
    except Exception as e:
        print("Faction fetch failed:", e)
        return

    members = faction_data.get("members", {}) or {}

    # chain
    chain = faction_data.get("chain") or {}
    web_panel.STATE["chain"] = {
        "current": chain.get("current"),
        "max": chain.get("max"),
        "timeout": chain.get("timeout"),
        "cooldown": chain.get("cooldown"),
    }

    # next ranked war (soonest upcoming start)
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
    web_panel.STATE["war"] = war_state

    # settings
    settings = await get_all_settings()
    settings_by_torn = {s["torn_id"]: s for s in settings if s.get("torn_id")}

    rows = []
    available_count = 0

    for torn_id_str, m in members.items():
        torn_id = int(torn_id_str)
        name = m.get("name", f"#{torn_id}")
        status_desc = (m.get("status") or {}).get("description") or ""
        last_action_text = ((m.get("last_action") or {}).get("relative")) or ""

        hospitalized = status_is_hospital(status_desc)

        s = settings_by_torn.get(torn_id) or {}
        tz = s.get("timezone") or "UTC"
        enabled = (s.get("enabled", 1) == 1)
        avail_start = s.get("avail_start") or "18:00"
        avail_end = s.get("avail_end") or "23:59"

        # energy only if they linked key
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
        # ✅ no jail filter; ✅ hospital filter ON
        if enabled and (not hospitalized) and status_is_online(status_desc):
            try:
                local_dt = now_in_tz(tz)
                available_now = is_within_window(local_dt, avail_start, avail_end)
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

    web_panel.STATE["rows"] = sorted(rows, key=lambda r: (not r["available_now"], r["name"].lower()))
    web_panel.STATE["available_count"] = available_count
    web_panel.STATE["updated_at"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    # 5+ ping with cooldown
    if available_count >= PING_THRESHOLD and ALERT_CHANNEL_ID and ALERT_ROLE_ID:
        now = datetime.utcnow().timestamp()
        can_ping = (bot.last_pinged_at_utc is None) or ((now - bot.last_pinged_at_utc) >= PING_COOLDOWN_SECONDS)
        if can_ping:
            channel = bot.get_channel(ALERT_CHANNEL_ID)
            if channel:
                await channel.send(f"<@&{ALERT_ROLE_ID}> **{available_count} members available now** ✅  {PUBLIC_BASE_URL}/")
                bot.last_pinged_at_utc = now

def run_web():
    web_panel.app.run(host=WEB_HOST, port=WEB_PORT, debug=False, use_reloader=False)

async def main():
    # start web server in background thread
    threading.Thread(target=run_web, daemon=True).start()
    # start discord bot (this blocks until shutdown)
    await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
