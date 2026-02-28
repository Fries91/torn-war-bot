import os
import time
import threading
import asyncio
from datetime import datetime

from flask import Flask, jsonify, Response
from dotenv import load_dotenv
import aiohttp

from db import init_db, set_setting, get_setting
from torn_api import get_faction_full

load_dotenv()

# ========= ENV =========
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()  # https://torn-war-bot.onrender.com
DISCORD_WEBHOOK_URL = (os.getenv("DISCORD_WEBHOOK_URL") or "").strip()

# Posting behavior
POST_INTERVAL_SECONDS = int(os.getenv("POST_INTERVAL_SECONDS", "120"))  # 2 min default
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))   # 30 sec default

PORT = int(os.getenv("PORT", "10000"))

# ========= SHARED STATE (what the web panel shows) =========
STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
}

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def safe_member_rows(faction_json: dict):
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
    return rows

def update_state_from_faction(data: dict):
    if isinstance(data, dict) and data.get("error"):
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

    war_obj = None
    if isinstance(rankedwars, dict) and rankedwars:
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

    STATE["available_count"] = sum(
        1 for r in STATE["rows"]
        if "online" in (r.get("status") or "").lower()
    )

    STATE["updated_at"] = now_iso()
    STATE["last_error"] = None

async def send_webhook_message(content: str):
    if not DISCORD_WEBHOOK_URL:
        return
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await session.post(
            DISCORD_WEBHOOK_URL,
            json={"content": content},
        )

def build_update_text() -> str:
    f = STATE.get("faction") or {}
    c = STATE.get("chain") or {}
    w = STATE.get("war") or {}
    err = STATE.get("last_error")

    tag = f.get("tag")
    name = f.get("name") or "—"
    faction_label = f"[{tag}] {name}" if tag else name

    panel_url = (PUBLIC_BASE_URL.rstrip("/") + "/") if PUBLIC_BASE_URL else "Set PUBLIC_BASE_URL"

    if err:
        # show Torn errors clearly (incorrect key etc.)
        return (
            "🛡️ **War-Bot Update (ERROR)**\n"
            f"Faction: {faction_label}\n"
            f"Error: `{err}`\n"
            f"Panel: {panel_url}\n"
            f"Updated: {STATE.get('updated_at') or '—'}"
        )

    return (
        "🛡️ **War-Bot Update**\n"
        f"Faction: {faction_label}\n"
        f"Chain: {c.get('current')}/{c.get('max')}\n"
        f"War: {w.get('opponent') or '—'}\n"
        f"Online-ish: {STATE.get('available_count')}\n"
        f"Panel: {panel_url}\n"
        f"Updated: {STATE.get('updated_at') or '—'}"
    )

async def poll_loop():
    """
    Poll Torn forever and occasionally post to Discord webhook.
    """
    while True:
        # Validate config
        if not FACTION_ID or not FACTION_API_KEY:
            STATE["last_error"] = {"code": -1, "error": "Missing FACTION_ID or FACTION_API_KEY"}
            STATE["updated_at"] = now_iso()
        else:
            try:
                data = await get_faction_full(FACTION_ID, FACTION_API_KEY)
                update_state_from_faction(data)
            except Exception as e:
                STATE["last_error"] = {"code": -2, "error": f"Torn request failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # Post throttled
        try:
            last_post = get_setting("LAST_POST_TS", "0")
            last_post_f = float(last_post) if last_post else 0.0
        except Exception:
            last_post_f = 0.0

        if DISCORD_WEBHOOK_URL and (time.time() - last_post_f) >= POST_INTERVAL_SECONDS:
            try:
                await send_webhook_message(build_update_text())
                set_setting("LAST_POST_TS", str(time.time()))
            except Exception as e:
                # Don’t crash poll loop if webhook errors
                STATE["last_error"] = {"code": -3, "error": f"Webhook failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        await asyncio.sleep(POLL_INTERVAL_SECONDS)

def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    t = threading.Thread(target=runner, daemon=True)
    t.start()

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

if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=PORT)
