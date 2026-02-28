import os
import time
import threading
import asyncio
from datetime import datetime

from flask import Flask, jsonify, Response, request
from dotenv import load_dotenv
import aiohttp

from db import (
    init_db, upsert_availability, get_availability_map,
    get_setting, set_setting,
    get_alert_state, set_alert_state
)
from torn_api import get_faction_core, get_ranked_war_best_effort

load_dotenv()

# ========= ENV =========
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()  # https://torn-war-bot.onrender.com
DISCORD_WEBHOOK_URL = (os.getenv("DISCORD_WEBHOOK_URL") or "").strip()

PORT = int(os.getenv("PORT", "10000"))

# Timing
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
POST_INTERVAL_SECONDS = int(os.getenv("POST_INTERVAL_SECONDS", "120"))

# Smart ping (>= N online-ish)
SMART_PING_MIN_ONLINE = int(os.getenv("SMART_PING_MIN_ONLINE", "5"))
SMART_PING_MENTION = (os.getenv("SMART_PING_MENTION") or "@here").strip()
SMART_PING_COOLDOWN_SECONDS = int(os.getenv("SMART_PING_COOLDOWN_SECONDS", "600"))

# Chain timeout alert (NOT threshold; time-based)
CHAIN_TIMEOUT_ALERT_SECONDS = int(os.getenv("CHAIN_TIMEOUT_ALERT_SECONDS", "600"))  # 10 mins
CHAIN_TIMEOUT_COOLDOWN_SECONDS = int(os.getenv("CHAIN_TIMEOUT_COOLDOWN_SECONDS", "600"))

# Ranked war alert cooldown
WAR_ALERT_COOLDOWN_SECONDS = int(os.getenv("WAR_ALERT_COOLDOWN_SECONDS", "600"))

# Simple shared secret to stop randoms posting availability
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()

def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def unix_now() -> int:
    return int(time.time())

STATE = {
    "rows": [],
    "available_rows": [],
    "unavailable_rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None, "active": None},
    "available_count": 0,        # online-ish count
    "opted_in_count": 0,         # availability true count
    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
}

# ========= Torn parsing helpers =========

def safe_member_rows(data: dict):
    """
    v2 members is usually a list.
    We normalize to rows with torn_id/name/level/last_action/status.
    """
    members = (data or {}).get("members")
    rows = []

    if isinstance(members, list):
        for m in members:
            mid = m.get("id") or m.get("torn_id") or m.get("user_id")
            try:
                mid = int(mid) if mid is not None else None
            except Exception:
                mid = None

            last_action = m.get("last_action")
            if isinstance(last_action, dict):
                last_action = last_action.get("relative") or str(last_action.get("timestamp") or "")

            status = m.get("status")
            if isinstance(status, dict):
                status = status.get("description") or status.get("state") or str(status)

            rows.append({
                "torn_id": mid,
                "name": m.get("name"),
                "level": m.get("level"),
                "last_action": last_action if isinstance(last_action, str) else (str(last_action) if last_action is not None else ""),
                "status": status if isinstance(status, str) else (str(status) if status is not None else ""),
            })
        return rows

    # fallback
    return rows

def parse_ranked_war(war_data: dict):
    """
    Best-effort: return a normalized war object or None.
    We try to find something that looks like an active ranked war.
    """
    if not isinstance(war_data, dict) or not war_data or war_data.get("error"):
        return None

    # Common pattern: { "rankedwars": {...} } OR direct list/dict.
    candidate = war_data.get("rankedwars", war_data)

    # If dict of wars:
    if isinstance(candidate, dict):
        for _, w in candidate.items():
            if isinstance(w, dict):
                return w

    # If list of wars:
    if isinstance(candidate, list) and candidate:
        if isinstance(candidate[0], dict):
            return candidate[0]

    return None

def merge_availability(rows):
    """
    Adds:
      - opted_in (bool)
      - opted_updated_at
    """
    avail_map = get_availability_map()
    out = []
    for r in rows:
        tid = r.get("torn_id")
        a = avail_map.get(int(tid)) if tid is not None and str(tid).isdigit() else None
        r2 = dict(r)
        r2["opted_in"] = bool(a["available"]) if a else False
        r2["opted_updated_at"] = a["updated_at"] if a else None
        out.append(r2)
    return out

# ========= Discord webhook =========

async def send_webhook_message(content: str):
    if not DISCORD_WEBHOOK_URL:
        return
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await session.post(DISCORD_WEBHOOK_URL, json={"content": content})

def panel_url():
    return (PUBLIC_BASE_URL.rstrip("/") + "/") if PUBLIC_BASE_URL else "(set PUBLIC_BASE_URL)"

# ========= Alerts (throttled) =========

def should_fire(key: str, cooldown_seconds: int) -> bool:
    last = get_alert_state(key, "0")
    try:
        last_i = int(float(last))
    except Exception:
        last_i = 0
    return (unix_now() - last_i) >= cooldown_seconds

def mark_fired(key: str):
    set_alert_state(key, str(unix_now()))

def build_status_line():
    f = STATE.get("faction") or {}
    c = STATE.get("chain") or {}
    w = STATE.get("war") or {}
    tag = f.get("tag")
    name = f.get("name") or "—"
    faction_label = f"[{tag}] {name}" if tag else name
    return faction_label, c, w

# ========= Main poll loop =========

async def poll_loop():
    while True:
        # 1) Pull Torn data
        if not FACTION_ID or not FACTION_API_KEY:
            STATE["last_error"] = {"code": -1, "error": "Missing FACTION_ID or FACTION_API_KEY"}
            STATE["updated_at"] = now_iso()
        else:
            try:
                core = await get_faction_core(FACTION_ID, FACTION_API_KEY)
                if isinstance(core, dict) and core.get("error"):
                    STATE["last_error"] = core["error"]
                    STATE["updated_at"] = now_iso()
                else:
                    basic = (core or {}).get("basic") or {}
                    chain = (core or {}).get("chain") or {}

                    STATE["faction"] = {
                        "name": basic.get("name"),
                        "tag": basic.get("tag"),
                        "respect": basic.get("respect"),
                    }

                    rows = safe_member_rows(core or {})
                    rows = merge_availability(rows)

                    # Split
                    available_rows = [r for r in rows if r.get("opted_in")]
                    unavailable_rows = [r for r in rows if not r.get("opted_in")]

                    STATE["rows"] = rows
                    STATE["available_rows"] = available_rows
                    STATE["unavailable_rows"] = unavailable_rows

                    STATE["chain"] = {
                        "current": chain.get("current"),
                        "max": chain.get("max"),
                        "timeout": chain.get("timeout"),
                        "cooldown": chain.get("cooldown"),
                    }

                    # Online-ish count (based on status text)
                    STATE["available_count"] = sum(
                        1 for r in rows if "online" in (r.get("status") or "").lower()
                    )
                    STATE["opted_in_count"] = len(available_rows)

                    STATE["updated_at"] = now_iso()
                    STATE["last_error"] = None

                    # 2) Ranked war best-effort
                    war_data = await get_ranked_war_best_effort(FACTION_ID, FACTION_API_KEY)
                    w = parse_ranked_war(war_data)
                    if isinstance(w, dict):
                        # normalize opponent name if present
                        opp = None
                        if isinstance(w.get("opponent"), dict):
                            opp = w["opponent"].get("name")
                        opp = opp or w.get("opponent_name") or w.get("opponent") or None

                        STATE["war"] = {
                            "opponent": opp,
                            "start": w.get("start") or w.get("start_time"),
                            "end": w.get("end") or w.get("end_time"),
                            "target": w.get("target"),
                            "active": w.get("active") if "active" in w else None,
                        }
                    else:
                        STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None, "active": None}

            except Exception as e:
                STATE["last_error"] = {"code": -2, "error": f"Torn request failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # 3) Throttled status post
        try:
            last_post = get_setting("LAST_POST_TS", "0")
            last_post_f = float(last_post) if last_post else 0.0
        except Exception:
            last_post_f = 0.0

        if DISCORD_WEBHOOK_URL and (time.time() - last_post_f) >= POST_INTERVAL_SECONDS:
            faction_label, c, w = build_status_line()
            err = STATE.get("last_error")

            if err:
                text = (
                    "🛡️ **War-Bot (ERROR)**\n"
                    f"Faction: {faction_label}\n"
                    f"Error: `{err}`\n"
                    f"Panel: {panel_url()}\n"
                    f"Updated: {STATE.get('updated_at') or '—'}"
                )
            else:
                text = (
                    "🛡️ **War-Bot Update**\n"
                    f"Faction: {faction_label}\n"
                    f"Chain: {c.get('current')}/{c.get('max')}\n"
                    f"War: {w.get('opponent') or '—'}\n"
                    f"Opted-in: {STATE.get('opted_in_count')}\n"
                    f"Online-ish: {STATE.get('available_count')}\n"
                    f"Panel: {panel_url()}\n"
                    f"Updated: {STATE.get('updated_at') or '—'}"
                )

            try:
                await send_webhook_message(text)
                set_setting("LAST_POST_TS", str(time.time()))
            except Exception as e:
                STATE["last_error"] = {"code": -3, "error": f"Webhook failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # 4) Smart ping (>= N online-ish) — throttled
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                onlineish = int(STATE.get("available_count") or 0)
                if onlineish >= SMART_PING_MIN_ONLINE and should_fire("SMART_PING", SMART_PING_COOLDOWN_SECONDS):
                    faction_label, _, _ = build_status_line()
                    await send_webhook_message(
                        f"{SMART_PING_MENTION} 🟢 **Smart Ping**: {onlineish} members online-ish.\n"
                        f"Faction: {faction_label}\n"
                        f"Panel: {panel_url()}"
                    )
                    mark_fired("SMART_PING")
        except Exception:
            pass

        # 5) Chain timeout alert (time-based, not threshold) — throttled
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                timeout = STATE.get("chain", {}).get("timeout")
                # timeout sometimes int seconds remaining, or timestamp; we treat int-ish as seconds remaining
                if isinstance(timeout, (int, float)) and timeout > 0 and timeout <= CHAIN_TIMEOUT_ALERT_SECONDS:
                    if should_fire("CHAIN_TIMEOUT", CHAIN_TIMEOUT_COOLDOWN_SECONDS):
                        faction_label, c, _ = build_status_line()
                        await send_webhook_message(
                            f"⏳ **Chain Timeout Soon**: ~{int(timeout)}s remaining.\n"
                            f"Faction: {faction_label}\n"
                            f"Chain: {c.get('current')}/{c.get('max')}\n"
                            f"Panel: {panel_url()}"
                        )
                        mark_fired("CHAIN_TIMEOUT")
        except Exception:
            pass

        # 6) War alert if opponent appears / changes — throttled
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                opp = (STATE.get("war") or {}).get("opponent") or ""
                prev = get_alert_state("WAR_OPPONENT", "")
                if opp and opp != prev and should_fire("WAR_CHANGE", WAR_ALERT_COOLDOWN_SECONDS):
                    faction_label, _, _ = build_status_line()
                    await send_webhook_message(
                        f"⚔️ **Ranked War Update**: Opponent = **{opp}**\n"
                        f"Faction: {faction_label}\n"
                        f"Panel: {panel_url()}"
                    )
                    set_alert_state("WAR_OPPONENT", opp)
                    mark_fired("WAR_CHANGE")
        except Exception:
            pass

        await asyncio.sleep(POLL_INTERVAL_SECONDS)

def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()

# ========= Flask =========
app = Flask(__name__)

@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
    return resp

@app.get("/state")
def state():
    return jsonify(STATE)

@app.get("/health")
def health():
    return jsonify({"ok": True, "time": now_iso()})

# ---- Availability API (PDA/Tampermonkey posts here) ----
@app.post("/api/availability")
def api_availability():
    # Optional: require a token
    if AVAIL_TOKEN:
        tok = (request.headers.get("X-Avail-Token") or "").strip()
        if tok != AVAIL_TOKEN:
            return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    torn_id = data.get("torn_id")
    name = data.get("name") or ""
    available = bool(data.get("available"))
    if torn_id is None:
        return jsonify({"ok": False, "error": "missing torn_id"}), 400

    try:
        torn_id = int(torn_id)
    except Exception:
        return jsonify({"ok": False, "error": "invalid torn_id"}), 400

    upsert_availability(torn_id=torn_id, name=name[:64], available=available, updated_at=now_iso())
    return jsonify({"ok": True})

# ---- Panel HTML ----
HTML = """<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>7DS*: Wrath War-Bot</title>
<style>
  body { font-family: Arial, sans-serif; margin: 12px; background:#0b0b0f; color:#fff; }
  .card { background:#151521; border:1px solid #2a2a3a; border-radius:12px; padding:12px; margin-bottom:10px; }
  .muted { opacity:0.75; font-size: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid #2a2a3a; font-size: 13px; }
  th { opacity:0.85; }
  .pill { display:inline-block; padding:2px 10px; border:1px solid #2a2a3a; border-radius:999px; font-size:12px; opacity:0.95; }
  .err { color:#ffb4b4; }
  .gold { color:#ffd86a; }
  .grid { display:flex; gap:10px; flex-wrap:wrap; }
</style>
</head>
<body>
  <div class="card">
    <div id="title" style="font-weight:800; font-size:16px;">
      <span class="gold">7DS*: Wrath</span> War-Bot
    </div>
    <div class="muted" id="updated">Loading…</div>
    <div class="muted err" id="err"></div>
  </div>

  <div class="card">
    <div class="grid">
      <div class="pill" id="chain">Chain: —</div>
      <div class="pill" id="war">War: —</div>
      <div class="pill" id="online">Online-ish: —</div>
      <div class="pill" id="opted">Opted-in: —</div>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;" class="gold">Available (Opted-in)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Name</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_avail"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;">Not Available</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Name</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_unavail"></tbody>
      </table>
    </div>
  </div>

<script>
async function refresh(){
  const r = await fetch('/state');
  const s = await r.json();

  const f = s.faction || {};
  document.getElementById('title').innerHTML =
    `<span class="gold">${(f.tag ? '['+f.tag+'] ' : '') + (f.name || '7DS*: Wrath')}</span> War-Bot`;

  document.getElementById('updated').textContent = 'Updated: ' + (s.updated_at || '—');

  const err = s.last_error ? ('Error: ' + JSON.stringify(s.last_error)) : '';
  document.getElementById('err').textContent = err;

  const c = s.chain || {};
  document.getElementById('chain').textContent = `Chain: ${c.current ?? '—'}/${c.max ?? '—'}`;

  const w = s.war || {};
  document.getElementById('war').textContent = `War: ${w.opponent || '—'}`;

  document.getElementById('online').textContent = `Online-ish: ${s.available_count ?? '—'}`;
  document.getElementById('opted').textContent = `Opted-in: ${s.opted_in_count ?? '—'}`;

  const fill = (id, arr) => {
    const tb = document.getElementById(id);
    tb.innerHTML = '';
    (arr || []).slice(0, 250).forEach(x=>{
      const tr = document.createElement('tr');
      const opt = x.opted_in ? '✅' : '—';
      tr.innerHTML = `<td>${x.name||''}</td><td>${x.level??''}</td><td>${x.last_action||''}</td><td>${x.status||''}</td><td>${opt}</td>`;
      tb.appendChild(tr);
    });
  };

  fill('rows_avail', s.available_rows || []);
  fill('rows_unavail', s.unavailable_rows || []);
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

if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=PORT)
