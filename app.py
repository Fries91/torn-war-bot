# app.py ✅ COMPLETE (Online / Idle / Offline in their own sections)
# - /           : Panel (iframe-safe for torn.com)
# - /state      : JSON state (debug)
# - /health     : healthcheck
# - /api/availability : chain-sitter opt in/out (optional token)
#
# NOTES
# - Online/Idle/Offline are based on "minutes" since last action:
#   🟢 Online = 0–20, 🟡 Idle = 20–30, 🔴 Offline = 30+
# - Lists are sorted by most recent (lowest minutes) first.
# - Works under gunicorn: poll thread starts once (before_request boot).

import os
import time
import threading
import asyncio
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template_string
from dotenv import load_dotenv
import aiohttp

from db import (
    init_db,
    upsert_availability,
    get_availability_map,
)

from torn_api import get_faction_core, get_ranked_war

load_dotenv()

app = Flask(__name__)

# ===== ENV =====
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()  # yours = 666 (optional)
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "").split(",") if s.strip()]  # "1234,5678"

POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "20")

# ===== GLOBAL STATE =====
STATE = {
    "rows": [],
    "updated_at": None,
    "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
    "available_count": 0,
    "chain": {"current": 0, "max": 10, "timeout": 0, "cooldown": 0},
    "war": {"opponent": None, "start": None, "end": None, "target": None, "score": None},
    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
}

BOOTED = False
BOOT_LOCK = threading.Lock()

# ===== IFRAME-SAFE HEADERS =====
@app.after_request
def allow_iframe(resp):
    # Torn iframe compatibility
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors https://*.torn.com https://torn.com *"
    return resp


# ===== HELPERS =====
def now_iso():
    return datetime.now(timezone.utc).isoformat()

def classify_status(minutes: int) -> str:
    if minutes <= 20:
        return "online"
    if minutes <= 30:
        return "idle"
    return "offline"

def parse_last_action_minutes(member: dict) -> int:
    """
    Tries to read minutes from common Torn API shapes.
    Your torn_api.py likely already returns `minutes`. If so, we use it.
    """
    if "minutes" in member and member["minutes"] is not None:
        try:
            return int(member["minutes"])
        except Exception:
            return 999

    # Some Torn responses include last_action: { "relative": "x minutes ago", "timestamp": ... }
    la = member.get("last_action") or {}
    rel = (la.get("relative") or "").lower()
    # crude parse: "15 minutes ago"
    try:
        if "minute" in rel:
            return int(rel.split("minute")[0].strip())
        if "hour" in rel:
            h = int(rel.split("hour")[0].strip())
            return h * 60
        if "day" in rel:
            d = int(rel.split("day")[0].strip())
            return d * 1440
        if "just now" in rel:
            return 0
    except Exception:
        pass

    return 999

def is_chain_sitter(torn_id: str) -> bool:
    return torn_id in set(CHAIN_SITTER_IDS)

def token_ok(req) -> bool:
    # If AVAIL_TOKEN not set, allow without token
    if not AVAIL_TOKEN:
        return True
    t = (req.headers.get("X-Avail-Token") or req.args.get("token") or (req.json or {}).get("token") or "").strip()
    return t == AVAIL_TOKEN


# ===== HTML =====
HTML = """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚔ 7DS*: WRATH WAR PANEL</title>
  <style>
    body {
      background: #0b0b0b;
      color: #f2f2f2;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      margin: 0;
      padding: 10px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 10px;
    }
    .title {
      font-weight: 800;
      letter-spacing: 0.5px;
      font-size: 16px;
    }
    .meta {
      font-size: 12px;
      opacity: 0.8;
    }
    .pill {
      display: inline-block;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 12px;
      margin-left: 6px;
      white-space: nowrap;
    }
    h2 {
      margin: 14px 0 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-size: 14px;
      letter-spacing: 0.4px;
    }
    .member {
      padding: 8px 10px;
      margin: 6px 0;
      border-radius: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .left {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .name {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 68vw;
    }
    .sub {
      opacity: 0.75;
      font-size: 11px;
    }
    .right {
      opacity: 0.85;
      font-size: 12px;
      white-space: nowrap;
    }

    .online  { border-left: 4px solid #00ff66; }
    .idle    { border-left: 4px solid #ffd000; }
    .offline { border-left: 4px solid #ff3333; }
    .hospital{ border-left: 4px solid #b06cff; }

    .section-empty {
      opacity: 0.7;
      font-size: 12px;
      padding: 8px 2px;
    }

    .warbox {
      margin-top: 10px;
      padding: 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.07);
      font-size: 12px;
      line-height: 1.35;
    }
    .warrow {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin: 3px 0;
    }
    .label { opacity: 0.75; }
  </style>
</head>
<body>

  <div class="topbar">
    <div class="title">⚔ 7DS*: WRATH WAR PANEL</div>
    <div class="meta">
      Updated: {{ updated_at or "—" }}
      <span class="pill">🟢 {{ counts.online }}</span>
      <span class="pill">🟡 {{ counts.idle }}</span>
      <span class="pill">🔴 {{ counts.offline }}</span>
      <span class="pill">🏥 {{ counts.hospital }}</span>
      <span class="pill">✅ Avail: {{ available_count }}</span>
    </div>
  </div>

  {% if war.opponent or war.target or war.score %}
  <div class="warbox">
    <div class="warrow"><div class="label">Opponent</div><div>{{ war.opponent or "—" }}</div></div>
    <div class="warrow"><div class="label">Target</div><div>{{ war.target or "—" }}</div></div>
    <div class="warrow"><div class="label">Score</div><div>{{ war.score or "—" }}</div></div>
    <div class="warrow"><div class="label">Start</div><div>{{ war.start or "—" }}</div></div>
    <div class="warrow"><div class="label">End</div><div>{{ war.end or "—" }}</div></div>
  </div>
  {% endif %}

  <h2>🟢 ONLINE (0–20 mins)</h2>
  {% if online|length == 0 %}
    <div class="section-empty">No one online right now.</div>
  {% endif %}
  {% for row in online %}
    <div class="member online">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  <h2>🟡 IDLE (20–30 mins)</h2>
  {% if idle|length == 0 %}
    <div class="section-empty">No one idle right now.</div>
  {% endif %}
  {% for row in idle %}
    <div class="member idle">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  <h2>🔴 OFFLINE (30+ mins)</h2>
  {% if offline|length == 0 %}
    <div class="section-empty">No one offline (rare W).</div>
  {% endif %}
  {% for row in offline %}
    <div class="member offline">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  {% if hospital|length > 0 %}
  <h2>🏥 HOSPITAL</h2>
  {% for row in hospital %}
    <div class="member hospital">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="right">{{ row.hospital_until or "In hosp" }}</div>
    </div>
  {% endfor %}
  {% endif %}

</body>
</html>
"""


# ===== ROUTES =====
@app.route("/health")
def health():
    return "ok"

@app.route("/state")
def state():
    return jsonify(STATE)

@app.route("/")
def panel():
    rows = STATE.get("rows", []) or []

    online, idle, offline, hospital = [], [], [], [],

    # If your rows already contain hospital flags, we’ll separate those too
    hospital = []
    online = []
    idle = []
    offline = []

    for row in rows:
        if row.get("hospital"):
            hospital.append(row)
            continue

        mins = row.get("minutes", 999)
        try:
            mins = int(mins)
        except Exception:
            mins = 999
        row["minutes"] = mins

        st = row.get("status") or classify_status(mins)
        row["status"] = st

        if st == "online":
            online.append(row)
        elif st == "idle":
            idle.append(row)
        else:
            offline.append(row)

    online.sort(key=lambda x: x.get("minutes", 999))
    idle.sort(key=lambda x: x.get("minutes", 999))
    offline.sort(key=lambda x: x.get("minutes", 999))
    hospital.sort(key=lambda x: (x.get("hospital_until") or ""))

    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at"),
        counts=STATE.get("counts", {}),
        available_count=STATE.get("available_count", 0),
        war=STATE.get("war", {}),
        online=online,
        idle=idle,
        offline=offline,
        hospital=hospital,
    )


@app.route("/api/availability", methods=["POST"])
def api_availability():
    """
    Body: { "id": "1234", "available": true/false, "token": "666" }  (token optional if AVAIL_TOKEN unset)
    Or send header: X-Avail-Token: 666
    """
    if not token_ok(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(force=True, silent=True) or {}
    torn_id = str(data.get("id") or "").strip()
    available = bool(data.get("available", False))

    if not torn_id:
        return jsonify({"ok": False, "error": "missing id"}), 400

    # chain sitter restriction (if CHAIN_SITTER_IDS is set)
    if CHAIN_SITTER_IDS and (not is_chain_sitter(torn_id)):
        return jsonify({"ok": False, "error": "not chain sitter"}), 403

    upsert_availability(torn_id, available)
    return jsonify({"ok": True, "id": torn_id, "available": available})


# ===== POLLER =====
async def poll_once(session: aiohttp.ClientSession):
    """
    Pulls faction core + war info.
    Normalizes members to rows: {id,name,minutes,status,hospital,hospital_until,available}
    """
    # availability map from DB
    avail_map = get_availability_map()  # { "1234": True/False, ... }

    faction = await get_faction_core(session, FACTION_API_KEY, FACTION_ID)
    war = await get_ranked_war(session, FACTION_API_KEY, FACTION_ID)

    members = faction.get("members") or {}
    rows = []

    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

    # Members might be dict keyed by id
    for mid, m in members.items():
        torn_id = str(m.get("id") or mid)
        name = m.get("name") or "—"

        minutes = parse_last_action_minutes(m)
        status = classify_status(minutes)

        hosp = bool(m.get("status", {}).get("state") == "Hospital" or m.get("hospital"))
        hospital_until = m.get("status", {}).get("until") or m.get("hospital_until")

        available = bool(avail_map.get(torn_id, False))
        if available:
            available_count += 1

        if hosp:
            counts["hospital"] += 1
        else:
            counts[status] += 1

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": minutes,
            "status": status,
            "hospital": hosp,
            "hospital_until": hospital_until,
            "available": available,
        })

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["updated_at"] = now_iso()

    # chain info if your wrapper provides it
    if "chain" in faction and isinstance(faction["chain"], dict):
        STATE["chain"] = {
            "current": faction["chain"].get("current", 0),
            "max": faction["chain"].get("max", 10),
            "timeout": faction["chain"].get("timeout", 0),
            "cooldown": faction["chain"].get("cooldown", 0),
        }

    # faction header bits
    STATE["faction"] = {
        "name": faction.get("name"),
        "tag": faction.get("tag"),
        "respect": faction.get("respect"),
    }

    # war info (best-effort)
    if isinstance(war, dict):
        STATE["war"] = {
            "opponent": war.get("opponent"),
            "start": war.get("start"),
            "end": war.get("end"),
            "target": war.get("target"),
            "score": war.get("score"),
        }

    STATE["last_error"] = None


async def poll_loop():
    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        while True:
            try:
                await poll_once(session)
            except Exception as e:
                STATE["last_error"] = {"error": str(e)}
                STATE["updated_at"] = now_iso()
            await asyncio.sleep(POLL_SECONDS)


def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    t = threading.Thread(target=runner, daemon=True)
    t.start()


@app.before_request
def boot_once():
    global BOOTED
    if BOOTED:
        return
    with BOOT_LOCK:
        if BOOTED:
            return
        init_db()
        start_poll_thread()
        BOOTED = True


# Local run (Render uses gunicorn)
if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT") or "10000"))
