import os
import asyncio
from datetime import datetime
import discord
import aiohttp
from discord.ext import tasks
from dotenv import load_dotenv
from db import (
    init_db, upsert_member, set_timezone, set_availability, set_enabled,
    link_key, unlink_key, get_all_settings, get_key_for_torn_id
)
from torn_api import get_faction_overview, get_user_energy
import web_panel

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
FACTION_ID = os.getenv("FACTION_ID")
FACTION_KEY = os.getenv("FACTION_API_KEY")
PORT = int(os.getenv("PORT", 10000))

intents = discord.Intents.default()
bot = discord.Client(intents=intents)
tree = discord.app_commands.CommandTree(bot)

@bot.event
async def on_ready():
    await init_db()
    await tree.sync()
    refresh.start()
    print("Bot ready")

@tree.command(name="linkkey")
async def linkkey(interaction: discord.Interaction, torn_id: int, api_key: str):
    await link_key(torn_id, api_key)
    await interaction.response.send_message("Key linked", ephemeral=True)

@tree.command(name="sheet")
async def sheet(interaction: discord.Interaction):
    await interaction.response.send_message(os.getenv("PUBLIC_BASE_URL"))

@tasks.loop(seconds=60)
async def refresh():
    async with aiohttp.ClientSession() as session:
        data = await get_faction_overview(session, FACTION_ID, FACTION_KEY)

        web_panel.STATE["updated_at"] = datetime.utcnow().isoformat()
        web_panel.STATE["chain"] = data.get("chain", {})
        web_panel.STATE["war"] = data.get("rankedwars", {})
        web_panel.STATE["rows"] = list(data.get("members", {}).values())

bot.loop.create_task(bot.start(TOKEN))

web_panel.app.run(host="0.0.0.0", port=PORT)
