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

FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()
DISCORD_WEBHOOK_URL = (os.getenv("DISCORD_WEBHOOK_URL") or "").strip()

POST_INTERVAL_SECONDS = int(os.getenv("POST_INTERVAL_SECONDS", "120"))
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
PORT = int(os.getenv("PORT", "10000"))

STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
    "used_selections": "basic,members,chain",
}

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def safe_member_rows(data: dict):
    """
    Torn v1: members is a dict keyed by torn_id -> member object
    Torn v2: members is usually a list of member objects (often includes 'id')
    This function supports both.
    """
    members = (data or {}).get("members")

    rows = []

    # v1 dict
    if isinstance(members, dict):
        for torn_id, m in members.items():
            rows.append({
                "torn_id": int(torn_id),
                "name": m.get("name"),
                "level": m.get("level"),
                "last_action": (m.get("last_action") or {}).get("relative"),
                "status": (m.get("status") or {}).get("description"),
            })
        return rows

    # v2 list
    if isinstance(members, list):
        for m in members:
            # v2 commonly uses "id" for the member id
            mid = m.get("id") or m.get("torn_id") or m.get("user_id")
            try:
                mid = int(mid) if mid is not None else None
            except Exception:
                mid = None

            # v2 sometimes nests last_action/status differently; handle best-effort
            last_action = m.get("last_action")
            if isinstance(last_action, dict):
                last_action = last_action.get("relative") or last_action.get("timestamp") or str(last_action)
            status = m.get("status")
            if isinstance(status, dict):
                status = status.get("description") or status.get("state") or str(status)

            rows.append({
                "torn_id": mid,
                "name": m.get("name"),
                "level": m.get("level"),
                "last_action": last_action if isinstance(last_action, str) else (str(last_action) if last_action is not None else None),
                "status": status if isinstance(status, str) else (str(status) if status is not None else None),
            })
        return rows

    return rows

def update_state_from_faction(data: dict):
    if isinstance(data, dict) and data.get("error"):
        STATE["updated_at"] = now_iso()
        STATE["last_error"] = data["error"]
        return

    basic = (data or {}).get("basic") or {}
    chain = (data or {}).get("chain") or {}

    STATE["faction"] = {
        "name": basic.get("name"),
        "tag": basic.get("tag"),
        "respect": basic.get("respect"),
    }

    rows = safe_member_rows(data or {})
    STATE["rows"] = rows

    STATE["chain"] = {
        "current": chain.get("current"),
        "max": chain.get("max"),
        "timeout": chain.get("timeout"),
        "cooldown": chain.get("cooldown"),
    }

    STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None}

    STATE["available_count"] = sum(
        1 for r in rows
        if "online" in ((r.get("status") or "")).lower()
    )

    STATE["updated_at"] = now_iso()
    STATE["last_error"] = None

async def send_webhook_message(content: str):
    if not DISCORD_WEBHOOK_URL:
        return
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await session.post(DISCORD_WEBHOOK_URL, json={"content": content})

def build_update_text() -> str:
    f = STATE.get("faction") or {}
    c = STATE.get("chain") or {}
    err = STATE.get("last_error")

    tag = f.get("tag")
    name = f.get("name") or "—"
    faction_label = f"[{tag}] {name}" if tag else name

    panel_url = (PUBLIC_BASE_URL.rstrip("/") + "/") if PUBLIC_BASE_URL else "Set PUBLIC_BASE_URL"

    if err:
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
        f"Members: {len(STATE.get('rows') or [])}\n"
        f"Online-ish: {STATE.get('available_count')}\n"
        f"Panel: {panel_url}\n"
        f"Updated: {STATE.get('updated_at') or '—'}"
    )

async def poll_loop():
    while True:
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

        # Throttled webhook post
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
                STATE["last_error"] = {"code": -3, "error": f"Webhook failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        await asyncio.sleep(POLL_INTERVAL_SECONDS)

def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()

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
      <div class="pill" id="avail">Online-ish: —</div>
      <div class="pill" id="count">Members: —</div>
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
  document.getElementById('avail').textContent = `Online-ish: ${s.available_count ?? '—'}`;
  document.getElementById('count').textContent = `Members: ${(s.rows || []).length}`;

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
