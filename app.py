# app.py ✅ COMPLETE (Members fixed + Enemy tracker if supported)
# - Robustly adapts to your torn_api function signatures using inspect.signature
# - Supports members returned as dict OR list
# - Enemy tracker only runs if get_faction_core supports faction_id

import os
import threading
import asyncio
import inspect
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template_string
from dotenv import load_dotenv
import aiohttp

from db import (
    init_db,
    upsert_availability,
    get_availability_map,
)

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
        "supported": True,
        "reason": None,
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
    if not isinstance(war, dict):
        return None
    for k in ("opponent_id", "enemy_id", "faction_id", "target_faction_id"):
        v = war.get(k)
        if v:
            return str(v)
    opp = war.get("opponent")
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


# ===== SIGNATURE-AWARE torn_api CALLS =====
def _sig_params(fn):
    try:
        return list(inspect.signature(fn).parameters.keys())
    except Exception:
        return []

async def call_get_faction_core(session, api_key: str, faction_id: str):
    """
    Supports common patterns:
    - get_faction_core(session, api_key, faction_id)
    - get_faction_core(api_key, faction_id)
    - get_faction_core(api_key)  (uses FACTION_ID inside torn_api)
    """
    params = _sig_params(get_faction_core)

    # If it expects a session-like first param
    if len(params) >= 3:
        return await get_faction_core(session, api_key, faction_id)

    if len(params) == 2:
        return await get_faction_core(api_key, faction_id)

    if len(params) == 1:
        return await get_faction_core(api_key)

    # Fallback (shouldn't happen)
    return await get_faction_core(api_key)

async def call_get_ranked_war_best(session, api_key: str, faction_id: str):
    params = _sig_params(get_ranked_war_best)
    if len(params) >= 3:
        return await get_ranked_war_best(session, api_key, faction_id)
    if len(params) == 2:
        return await get_ranked_war_best(api_key, faction_id)
    if len(params) == 1:
        return await get_ranked_war_best(api_key)
    return await get_ranked_war_best(api_key)

def enemy_supported_by_core() -> bool:
    """
    Enemy tracking needs a core function that can take a faction_id.
    If your get_faction_core only accepts (api_key), it can only fetch YOUR faction,
    so enemy faction fetch isn't possible with that function.
    """
    params = _sig_params(get_faction_core)
    return len(params) >= 2  # (api_key, faction_id) OR (session, api_key, faction_id)


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
      {% if enemy.supported == false %}
        Enemy tracking disabled: {{ enemy.reason }}
      {% elif enemy.faction.name %}
        {{ enemy.faction.tag or "" }} {{ enemy.faction.name }}
        · Updated: {{ enemy.updated_at or "—" }}
        · 🟢 {{ enemy.counts.online }} 🟡 {{ enemy.counts.idle }} 🔴 {{ enemy.counts.offline }} 🏥 {{ enemy.counts.hospital }}
      {% else %}
        Waiting for war opponent…
      {% endif %}
    </div>
  </div>

  {% if enemy.supported and enemy.faction.name %}
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
def _iter_members(members):
    """
    Supports:
    - dict keyed by id -> member dict
    - list of member dicts
    """
    if isinstance(members, dict):
        for mid, m in members.items():
            yield str(m.get("id") or mid), m
        return
    if isinstance(members, list):
        for m in members:
            mid = str(m.get("id") or "")
            yield mid, m
        return
    return

def normalize_faction_rows(faction: dict, avail_map=None):
    avail_map = avail_map or {}
    members = (faction or {}).get("members") or {}

    rows = []
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

    for mid, m in _iter_members(members):
        if not isinstance(m, dict):
            continue

        torn_id = str(m.get("id") or mid).strip() or str(mid).strip()
        name = m.get("name") or "—"

        minutes = parse_last_action_minutes(m)
        status = classify_status(minutes)

        hosp = bool((m.get("status") or {}).get("state") == "Hospital" or m.get("hospital"))
        hospital_until = (m.get("status") or {}).get("until") or m.get("hospital_until")

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
        "name": (faction or {}).get("name"),
        "tag": (faction or {}).get("tag"),
        "respect": (faction or {}).get("respect"),
    }

    chain = {"current": 0, "max": 10, "timeout": 0, "cooldown": 0}
    if isinstance((faction or {}).get("chain"), dict):
        ch = faction["chain"]
        chain = {
            "current": ch.get("current", 0),
            "max": ch.get("max", 10),
            "timeout": ch.get("timeout", 0),
            "cooldown": ch.get("cooldown", 0),
        }

    return rows, counts, available_count, header, chain

async def poll_once(session: aiohttp.ClientSession):
    avail_map = get_availability_map()

    faction = await call_get_faction_core(session, FACTION_API_KEY, FACTION_ID)
    war = await call_get_ranked_war_best(session, FACTION_API_KEY, FACTION_ID)

    rows, counts, available_count, header, chain = normalize_faction_rows(faction, avail_map=avail_map)

    # If members suddenly empty, surface a useful error (instead of silently showing nothing)
    if not rows:
        raise RuntimeError("Faction members empty. Check FACTION_ID/FACTION_API_KEY and torn_api get_faction_core response shape.")

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["chain"] = chain
    STATE["faction"] = header

    opponent_id = extract_opponent_id(war)

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

    # Enemy support check
    if not enemy_supported_by_core():
        STATE["enemy"]["supported"] = False
        STATE["enemy"]["reason"] = "torn_api.get_faction_core does not accept a faction_id in your version."
        STATE["enemy"]["faction"] = {"name": None, "tag": None, "respect": None, "id": None}
        STATE["enemy"]["rows"] = []
        STATE["enemy"]["counts"] = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
        STATE["enemy"]["updated_at"] = None
    else:
        STATE["enemy"]["supported"] = True
        STATE["enemy"]["reason"] = None

        if opponent_id:
            enemy_faction = await call_get_faction_core(session, FACTION_API_KEY, opponent_id)
            enemy_rows, enemy_counts, _, enemy_header, _ = normalize_faction_rows(enemy_faction, avail_map={})
            enemy_header["id"] = opponent_id

            STATE["enemy"] = {
                "supported": True,
                "reason": None,
                "faction": enemy_header,
                "rows": enemy_rows,
                "counts": enemy_counts,
                "updated_at": now_iso(),
            }
        else:
            STATE["enemy"] = {
                "supported": True,
                "reason": None,
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
    threading.Thread(target=runner, daemon=True).start()

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
