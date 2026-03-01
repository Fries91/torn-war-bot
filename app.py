# app.py ✅ COMPLETE (Your faction + Enemy faction tracker UNDER yours)
# Fix: uses get_ranked_war_best (matches your torn_api.py)
#
# - /           : Panel (iframe-safe for torn.com) with TWO trackers:
#                 1) Your faction sections (Online/Idle/Offline/Hospital)
#                 2) Enemy faction sections (Online/Idle/Offline/Hospital) under yours
# - /state      : JSON state (debug)
# - /health     : healthcheck
# - /api/availability : chain-sitter opt in/out (optional token)
#
# STATUS RULES (minutes since last action)
# 🟢 Online = 0–20 mins
# 🟡 Idle   = 20–30 mins
# 🔴 Offline= 30+ mins
#
# ENV
# - FACTION_ID, FACTION_API_KEY required
# - AVAIL_TOKEN optional (yours = 666)
# - CHAIN_SITTER_IDS optional: "1234,5678"
# - POLL_SECONDS optional: "20"

import os
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

# ✅ IMPORTANT: your file has get_ranked_war_best
from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()

app = Flask(__name__)

# ===== ENV =====
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()

AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()  # optional (yours = 666)
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "").split(",") if s.strip()]
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "20")

# ===== GLOBAL STATE =====
STATE = {
    "rows": [],
    "updated_at": None,
    "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
    "available_count": 0,
    "chain": {"current": 0, "max": 10, "timeout": 0, "cooldown": 0},
    "war": {"opponent": None, "opponent_id": None, "start": None, "end": None, "target": None, "score": None},
    "faction": {"name": None, "tag": None, "respect": None},
    "enemy": {
        "faction": {"name": None, "tag": None, "respect": None, "id": None},
        "rows": [],
        "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
        "updated_at": None
    },
    "last_error": None,
}

BOOTED = False
BOOT_LOCK = threading.Lock()

# ===== IFRAME-SAFE HEADERS =====
@app.after_request
def allow_iframe(resp):
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
    # Prefer already computed minutes if your wrapper includes it
    if "minutes" in member and member["minutes"] is not None:
        try:
            return int(member["minutes"])
        except Exception:
            return 999

    la = member.get("last_action") or {}
    rel = (la.get("relative") or "").lower()
    try:
        if "just now" in rel:
            return 0
        if "minute" in rel:
            return int(rel.split("minute")[0].strip())
        if "hour" in rel:
            h = int(rel.split("hour")[0].strip())
            return h * 60
        if "day" in rel:
            d = int(rel.split("day")[0].strip())
            return d * 1440
    except Exception:
        pass
    return 999

def is_chain_sitter(torn_id: str) -> bool:
    return torn_id in set(CHAIN_SITTER_IDS)

def token_ok(req) -> bool:
    if not AVAIL_TOKEN:
        return True
    data = req.get_json(silent=True) or {}
    t = (req.headers.get("X-Avail-Token") or req.args.get("token") or data.get("token") or "").strip()
    return t == AVAIL_TOKEN

def extract_opponent_id(war: dict):
    """
    Tries multiple shapes because wrappers differ.
    Returns string or None.
    """
    if not isinstance(war, dict):
        return None

    # common guesses
    for k in ("opponent_id", "enemy_id", "faction_id", "target_faction_id"):
        v = war.get(k)
        if v:
            return str(v)

    opp = war.get("opponent")
    # opponent might be dict: {"id": "...", "name": "..."}
    if isinstance(opp, dict) and opp.get("id"):
        return str(opp.get("id"))

    factions = war.get("factions")
    if isinstance(factions, dict):
        keys = [str(x) for x in factions.keys()]
        if FACTION_ID and str(FACTION_ID) in keys and len(keys) >= 2:
            for fid in keys:
                if fid != str(FACTION_ID):
                    return fid

    return None

def split_sections(rows):
    online, idle, offline, hospital = [], [], [], []
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

    return {"online": online, "idle": idle, "offline": offline, "hospital": hospital}


# ===== HTML =====
HTML = """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚔ 7DS*: WRATH WAR PANEL</title>
  <style>
    body { background:#0b0b0b; color:#f2f2f2; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; margin:0; padding:10px; }
    .topbar { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .title { font-weight:900; letter-spacing:.6px; font-size:16px; }
    .meta { font-size:12px; opacity:.85; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); font-size:12px; margin-left:6px; white-space:nowrap; }
    .divider { margin:14px 0; height:1px; background:rgba(255,255,255,.10); }
    .section-title { font-weight:900; letter-spacing:.6px; margin-top:8px; margin-bottom:6px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .section-title .small { font-size:12px; opacity:.8; font-weight:600; }
    h2 { margin:12px 0 6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,.08); font-size:14px; letter-spacing:.4px; }
    .member { padding:8px 10px; margin:6px 0; border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:13px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); }
    .left { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .name { font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:68vw; }
    .sub { opacity:.75; font-size:11px; }
    .right { opacity:.9; font-size:12px; white-space:nowrap; }
    .online{ border-left:4px solid #00ff66; } .idle{ border-left:4px solid #ffd000; } .offline{ border-left:4px solid #ff3333; } .hospital{ border-left:4px solid #b06cff; }
    .section-empty { opacity:.7; font-size:12px; padding:8px 2px; }
    .warbox { margin-top:10px; padding:10px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); font-size:12px; line-height:1.35; }
    .warrow { display:flex; justify-content:space-between; gap:10px; margin:3px 0; }
    .label { opacity:.75; }
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
    <div class="warrow"><div class="label">Opponent ID</div><div>{{ war.opponent_id or "—" }}</div></div>
    <div class="warrow"><div class="label">Target</div><div>{{ war.target or "—" }}</div></div>
    <div class="warrow"><div class="label">Score</div><div>{{ war.score or "—" }}</div></div>
    <div class="warrow"><div class="label">Start</div><div>{{ war.start or "—" }}</div></div>
    <div class="warrow"><div class="label">End</div><div>{{ war.end or "—" }}</div></div>
  </div>
  {% endif %}

  <div class="section-title">
    <div>🛡️ YOUR FACTION</div>
    <div class="small">{{ faction.tag or "" }} {{ faction.name or "" }}</div>
  </div>

  <h2>🟢 ONLINE (0–20 mins)</h2>
  {% if you.online|length == 0 %}<div class="section-empty">No one online right now.</div>{% endif %}
  {% for row in you.online %}
    <div class="member online">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  <h2>🟡 IDLE (20–30 mins)</h2>
  {% if you.idle|length == 0 %}<div class="section-empty">No one idle right now.</div>{% endif %}
  {% for row in you.idle %}
    <div class="member idle">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  <h2>🔴 OFFLINE (30+ mins)</h2>
  {% if you.offline|length == 0 %}<div class="section-empty">No one offline (rare W).</div>{% endif %}
  {% for row in you.offline %}
    <div class="member offline">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

  {% if you.hospital|length > 0 %}
  <h2>🏥 HOSPITAL</h2>
  {% for row in you.hospital %}
    <div class="member hospital">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right">{{ row.hospital_until or "In hosp" }}</div>
    </div>
  {% endfor %}
  {% endif %}

  <div class="divider"></div>

  <div class="section-title">
    <div>🎯 ENEMY FACTION (LIVE)</div>
    <div class="small">
      {% if enemy.faction.name %}
        {{ enemy.faction.tag or "" }} {{ enemy.faction.name }}
        · Updated: {{ enemy.updated_at or "—" }}
        · 🟢 {{ enemy.counts.online }} 🟡 {{ enemy.counts.idle }} 🔴 {{ enemy.counts.offline }} 🏥 {{ enemy.counts.hospital }}
      {% else %}
        Waiting for war opponent…
      {% endif %}
    </div>
  </div>

  {% if enemy.faction.name %}
    <h2>🟢 ONLINE (0–20 mins)</h2>
    {% if them.online|length == 0 %}<div class="section-empty">No enemy online right now.</div>{% endif %}
    {% for row in them.online %}
      <div class="member online">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.minutes }}m</div>
      </div>
    {% endfor %}

    <h2>🟡 IDLE (20–30 mins)</h2>
    {% if them.idle|length == 0 %}<div class="section-empty">No enemy idle right now.</div>{% endif %}
    {% for row in them.idle %}
      <div class="member idle">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.minutes }}m</div>
      </div>
    {% endfor %}

    <h2>🔴 OFFLINE (30+ mins)</h2>
    {% if them.offline|length == 0 %}<div class="section-empty">No enemy offline list (all active?)</div>{% endif %}
    {% for row in them.offline %}
      <div class="member offline">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.minutes }}m</div>
      </div>
    {% endfor %}

    {% if them.hospital|length > 0 %}
    <h2>🏥 HOSPITAL</h2>
    {% for row in them.hospital %}
      <div class="member hospital">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.hospital_until or "In hosp" }}</div>
      </div>
    {% endfor %}
    {% endif %}
  {% else %}
    <div class="section-empty">
      Enemy tracker will appear automatically once Ranked War opponent is detected.
    </div>
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
    you_sections = split_sections(STATE.get("rows") or [])
    enemy_state = STATE.get("enemy") or {}
    them_sections = split_sections(enemy_state.get("rows") or [])

    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at"),
        counts=STATE.get("counts", {}),
        available_count=STATE.get("available_count", 0),
        war=STATE.get("war", {}),
        faction=STATE.get("faction", {}),
        you=you_sections,
        enemy=enemy_state,
        them=them_sections,
    )


@app.route("/api/availability", methods=["POST"])
def api_availability():
    if not token_ok(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(force=True, silent=True) or {}
    torn_id = str(data.get("id") or "").strip()
    available = bool(data.get("available", False))

    if not torn_id:
        return jsonify({"ok": False, "error": "missing id"}), 400

    if CHAIN_SITTER_IDS and (not is_chain_sitter(torn_id)):
        return jsonify({"ok": False, "error": "not chain sitter"}), 403

    upsert_availability(torn_id, available)
    return jsonify({"ok": True, "id": torn_id, "available": available})


# ===== POLLER =====
def normalize_faction_rows(faction: dict, avail_map=None):
    avail_map = avail_map or {}
    members = faction.get("members") or {}

    rows = []
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

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

    header = {
        "name": faction.get("name"),
        "tag": faction.get("tag"),
        "respect": faction.get("respect"),
    }

    chain = {"current": 0, "max": 10, "timeout": 0, "cooldown": 0}
    if "chain" in faction and isinstance(faction["chain"], dict):
        chain = {
            "current": faction["chain"].get("current", 0),
            "max": faction["chain"].get("max", 10),
            "timeout": faction["chain"].get("timeout", 0),
            "cooldown": faction["chain"].get("cooldown", 0),
        }

    return rows, counts, available_count, header, chain


async def poll_once(session: aiohttp.ClientSession):
    avail_map = get_availability_map()

    # YOUR faction + war (✅ best function name)
    faction = await get_faction_core(session, FACTION_API_KEY, FACTION_ID)
    war = await get_ranked_war_best(session, FACTION_API_KEY, FACTION_ID)

    rows, counts, available_count, header, chain = normalize_faction_rows(faction, avail_map=avail_map)
    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["chain"] = chain
    STATE["faction"] = header

    opponent_id = extract_opponent_id(war)

    # store war info (best-effort, won't crash if keys differ)
    if isinstance(war, dict):
        STATE["war"] = {
            "opponent": war.get("opponent"),
            "opponent_id": opponent_id,
            "start": war.get("start"),
            "end": war.get("end"),
            "target": war.get("target"),
            "score": war.get("score"),
        }
    else:
        STATE["war"] = {"opponent": None, "opponent_id": opponent_id, "start": None, "end": None, "target": None, "score": None}

    # ENEMY
    if opponent_id:
        enemy_faction = await get_faction_core(session, FACTION_API_KEY, opponent_id)
        enemy_rows, enemy_counts, _, enemy_header, _ = normalize_faction_rows(enemy_faction, avail_map={})
        enemy_header["id"] = opponent_id

        STATE["enemy"] = {
            "faction": enemy_header,
            "rows": enemy_rows,
            "counts": enemy_counts,
            "updated_at": now_iso(),
        }
    else:
        STATE["enemy"] = {
            "faction": {"name": None, "tag": None, "respect": None, "id": None},
            "rows": [],
            "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
            "updated_at": None,
        }

    STATE["updated_at"] = now_iso()
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


if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT") or "10000"))
