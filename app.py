import os
import json
import time
import threading
import asyncio
from datetime import datetime

from flask import Flask, jsonify, request, Response
from dotenv import load_dotenv

import discord
from discord import app_commands
from discord.ext import tasks

from db import init_db, set_setting, get_setting
from torn_api import get_faction_full

load_dotenv()

# ========= ENV =========
DISCORD_TOKEN = (os.getenv("DISCORD_TOKEN") or "").strip()
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()  # e.g. https://your-service.onrender.com
PORT = int(os.getenv("PORT", "10000"))

# Where to post updates (optional auto posting)
DEFAULT_CHANNEL_ID = (os.getenv("WAR_CHANNEL_ID") or "").strip()

# ========= SHARED STATE (what the web panel shows) =========
STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
    "faction": {"name": None, "tag": None, "respect": None}
}

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def safe_member_rows(faction_json: dict):
    # Build simple rows: [name, level, last_action, status] – you can expand later
    members = faction_json.get("members") or {}
    rows = []
    for torn_id, m in members.items():
        name = m.get("name")
        level = m.get("level")
        last_action = (m.get("last_action") or {}).get("relative")
        status = (m.get("status") or {}).get("description")
        rows.append({
            "torn_id": int(torn_id),
            "name": name,
            "level": level,
            "last_action": last_action,
            "status": status
        })
    # Sort: online-ish first (rough: last_action contains "seconds/minutes" etc)
    return rows

def update_state_from_faction(data: dict):
    # Error bubble
    if isinstance(data, dict) and data.get("error"):
        # keep old state but track updated_at
        STATE["updated_at"] = now_iso()
        STATE["last_error"] = data["error"]
        return

    basic = data.get("basic") or {}
    chain = data.get("chain") or {}
    rankedwars = data.get("rankedwars") or {}

    STATE["faction"] = {
        "name": basic.get("name"),
        "tag": basic.get("tag"),
        "respect": basic.get("respect")
    }

    STATE["rows"] = safe_member_rows(data)

    STATE["chain"] = {
        "current": chain.get("current"),
        "max": chain.get("max"),
        "timeout": chain.get("timeout"),
        "cooldown": chain.get("cooldown"),
    }

    # rankedwars format changes; keep basic keys if present
    # If your war info isn't in rankedwars, we’ll adjust later.
    # Here we store the first active war if available.
    war_obj = None
    if isinstance(rankedwars, dict) and rankedwars:
        # sometimes dict of wars
        for _, w in rankedwars.items():
            war_obj = w
            break

    if war_obj:
        STATE["war"] = {
            "opponent": (war_obj.get("opponent") or {}).get("name"),
            "start": war_obj.get("start"),
            "end": war_obj.get("end"),
            "target": war_obj.get("target"),
        }
    else:
        STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None}

    # availability is for later (when you wire PDA script). For now show 0.
    STATE["available_count"] = sum(1 for r in STATE["rows"] if (r.get("status") or "").lower().find("online") != -1)

    STATE["updated_at"] = now_iso()
    STATE.pop("last_error", None)

# ========= FLASK WEB PANEL =========
app = Flask(__name__)

@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
    return resp

HTML = """<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>7DS War-Bot</title>
<style>
  body { font-family: Arial, sans-serif; margin: 12px; background:#0b0b0f; color:#fff; }
  .card { background:#151521; border:1px solid #2a2a3a; border-radius:12px; padding:12px; margin-bottom:10px; }
  .muted { opacity:0.75; font-size: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid #2a2a3a; font-size: 13px; }
  th { opacity:0.85; }
  .pill { display:inline-block; padding:2px 8px; border:1px solid #2a2a3a; border-radius:999px; font-size:12px; opacity:0.9; }
  .err { color:#ffb4b4; }
</style>
</head>
<body>
  <div class="card">
    <div id="title" style="font-weight:700; font-size:16px;">7DS War-Bot</div>
    <div class="muted" id="updated">Loading…</div>
    <div class="muted" id="err"></div>
  </div>

  <div class="card">
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <div class="pill" id="chain">Chain: —</div>
      <div class="pill" id="war">War: —</div>
      <div class="pill" id="avail">Online-ish: —</div>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:700; margin-bottom:8px;">Members</div>
    <div style="overflow:auto;">
      <table>
        <thead>
          <tr><th>Name</th><th>Lvl</th><th>Last action</th><th>Status</th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>

<script>
async function refresh(){
  const r = await fetch('/state');
  const s = await r.json();

  const f = s.faction || {};
  document.getElementById('title').textContent = (f.tag ? `[${f.tag}] ` : '') + (f.name || '7DS War-Bot');

  document.getElementById('updated').textContent = 'Updated: ' + (s.updated_at || '—');

  const err = s.last_error ? ('Error: ' + JSON.stringify(s.last_error)) : '';
  document.getElementById('err').textContent = err;
  document.getElementById('err').className = err ? 'muted err' : 'muted';

  const c = s.chain || {};
  document.getElementById('chain').textContent = `Chain: ${c.current ?? '—'}/${c.max ?? '—'}`;

  const w = s.war || {};
  document.getElementById('war').textContent = `War: ${w.opponent || '—'}`;

  document.getElementById('avail').textContent = `Online-ish: ${s.available_count ?? '—'}`;

  const tb = document.getElementById('rows');
  tb.innerHTML = '';
  (s.rows || []).slice(0, 200).forEach(x=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${x.name||''}</td><td>${x.level??''}</td><td>${x.last_action||''}</td><td>${x.status||''}</td>`;
    tb.appendChild(tr);
  });
}
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>
"""

@app.get("/")
def home():
    return Response(HTML, mimetype="text/html")

@app.get("/state")
def state():
    return jsonify(STATE)

@app.get("/health")
def health():
    return jsonify({"ok": True, "time": now_iso()})

# ========= DISCORD BOT =========
intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

def channel_id_from_env_or_db():
    if DEFAULT_CHANNEL_ID:
        return DEFAULT_CHANNEL_ID
    return get_setting("WAR_CHANNEL_ID", "")

@tree.command(name="setchannel", description="Set the channel for auto war-bot posts (admin only).")
@app_commands.checks.has_permissions(administrator=True)
async def setchannel(interaction: discord.Interaction):
    set_setting("WAR_CHANNEL_ID", str(interaction.channel_id))
    await interaction.response.send_message(f"✅ War-Bot channel set to <#{interaction.channel_id}>", ephemeral=True)

@tree.command(name="panel", description="Get the War-Bot panel link.")
async def panel(interaction: discord.Interaction):
    if not PUBLIC_BASE_URL:
        await interaction.response.send_message("❌ PUBLIC_BASE_URL is not set in Render env.", ephemeral=True)
        return
    await interaction.response.send_message(f"🛡️ War-Bot Panel: {PUBLIC_BASE_URL}/", ephemeral=False)

@tree.command(name="status", description="Show current faction/chain/war snapshot.")
async def status(interaction: discord.Interaction):
    f = STATE.get("faction") or {}
    c = STATE.get("chain") or {}
    w = STATE.get("war") or {}
    err = STATE.get("last_error")

    msg = [
        f"**Faction:** {(f.get('tag') and f'[{f.get('tag')}] ') or ''}{f.get('name') or '—'}",
        f"**Chain:** {c.get('current')}/{c.get('max')}",
        f"**War:** {w.get('opponent') or '—'}",
        f"**Updated:** {STATE.get('updated_at') or '—'}",
    ]
    if err:
        msg.append(f"**Error:** `{json.dumps(err)}`")
    await interaction.response.send_message("\n".join(msg), ephemeral=False)

@client.event
async def on_ready():
    await tree.sync()
    print(f"✅ Discord logged in as {client.user} (commands synced)")

@tasks.loop(seconds=30)
async def poll_torn_and_post():
    if not FACTION_ID or not FACTION_API_KEY:
        STATE["last_error"] = {"code": -1, "error": "Missing FACTION_ID or FACTION_API_KEY"}
        STATE["updated_at"] = now_iso()
        return

    data = await get_faction_full(FACTION_ID, FACTION_API_KEY)
    update_state_from_faction(data)

    # Optional auto post: only if a channel was set
    chan_id = channel_id_from_env_or_db()
    if not chan_id:
        return

    try:
        channel = await client.fetch_channel(int(chan_id))
    except Exception:
        return

    # Throttle: post only every 2 minutes
    last_post = get_setting("LAST_POST_TS", "0")
    if time.time() - float(last_post) < 120:
        return

    f = STATE.get("faction") or {}
    c = STATE.get("chain") or {}
    w = STATE.get("war") or {}

    text = (
        f"🛡️ **War-Bot Update**\n"
        f"Faction: {(f.get('tag') and f'[{f.get('tag')}] ') or ''}{f.get('name') or '—'}\n"
        f"Chain: {c.get('current')}/{c.get('max')}\n"
        f"War: {w.get('opponent') or '—'}\n"
        f"Panel: {(PUBLIC_BASE_URL + '/') if PUBLIC_BASE_URL else 'Set PUBLIC_BASE_URL'}\n"
        f"Updated: {STATE.get('updated_at') or '—'}"
    )
    await channel.send(text)
    set_setting("LAST_POST_TS", str(time.time()))

@poll_torn_and_post.before_loop
async def before_poll():
    await client.wait_until_ready()

def run_discord():
    async def runner():
        poll_torn_and_post.start()
        await client.start(DISCORD_TOKEN)

    asyncio.run(runner())

if __name__ == "__main__":
    init_db()

    # Start Discord bot in a background thread
    t = threading.Thread(target=run_discord, daemon=True)
    t.start()

    # Run Flask web server (Render Web Service expects a port)
    app.run(host="0.0.0.0", port=PORT)
