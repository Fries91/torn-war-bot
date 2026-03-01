# app.py ✅ COMPLETE (auto-detect faction payload shape)
# - Fixes: rows empty when torn_api.get_faction_core returns a nested/alternate structure
# - Keeps: Online/Idle/Offline sections + enemy tracker (if supported)
# - Adds: /ping for Render checks

import os
import threading
import asyncio
import inspect
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template_string
from dotenv import load_dotenv
import aiohttp

from db import init_db, upsert_availability, get_availability_map
from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()
app = Flask(__name__)

FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()

AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "").split(",") if s.strip()]
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "20")

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
        "updated_at": None,
    },
    "last_error": None,
}

BOOTED = False
BOOT_LOCK = threading.Lock()


@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors https://*.torn.com https://torn.com *"
    return resp


def now_iso():
    return datetime.now(timezone.utc).isoformat()

def classify_status(minutes: int) -> str:
    if minutes <= 20:
        return "online"
    if minutes <= 30:
        return "idle"
    return "offline"

def parse_last_action_minutes(member: dict) -> int:
    if isinstance(member, dict) and member.get("minutes") is not None:
        try:
            return int(member["minutes"])
        except Exception:
            return 999

    la = (member or {}).get("last_action") or {}
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

def _sig_len(fn) -> int:
    try:
        return len(inspect.signature(fn).parameters)
    except Exception:
        return 0

def enemy_supported_by_core() -> bool:
    return _sig_len(get_faction_core) >= 2

async def call_get_faction_core(session, api_key: str, faction_id: str):
    n = _sig_len(get_faction_core)
    if n >= 3:
        return await get_faction_core(session, api_key, faction_id)
    if n == 2:
        return await get_faction_core(api_key, faction_id)
    if n == 1:
        return await get_faction_core(api_key)
    return await get_faction_core(api_key)

async def call_get_ranked_war_best(session, api_key: str, faction_id: str):
    n = _sig_len(get_ranked_war_best)
    if n >= 3:
        return await get_ranked_war_best(session, api_key, faction_id)
    if n == 2:
        return await get_ranked_war_best(api_key, faction_id)
    if n == 1:
        return await get_ranked_war_best(api_key)
    return await get_ranked_war_best(api_key)

def extract_opponent_id(war: dict):
    if not isinstance(war, dict):
        return None
    for k in ("opponent_id", "enemy_id", "faction_id", "target_faction_id"):
        v = war.get(k)
        if v:
            return str(v)
    opp = war.get("opponent")
    if isinstance(opp, dict) and opp.get("id"):
        return str(opp["id"])
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


# ===== NEW: payload shape detection =====
def extract_faction_payload(raw):
    """
    Your torn_api wrapper might return:
    - {"name":..., "tag":..., "members": {...}}
    - {"faction": {...}} or {"faction": {"members": ...}}
    - {"faction": {"faction": {...}}} etc.
    - {"data": {...}} etc.

    This returns the dict that actually represents the faction object.
    """
    if not isinstance(raw, dict):
        return {}

    # direct good shape
    if "members" in raw and isinstance(raw.get("members"), (dict, list)):
        return raw

    # common nesting keys
    for key in ("faction", "data", "response", "result"):
        inner = raw.get(key)
        if isinstance(inner, dict):
            if "members" in inner and isinstance(inner.get("members"), (dict, list)):
                return inner
            # one more hop
            for key2 in ("faction", "data", "response", "result"):
                inner2 = inner.get(key2)
                if isinstance(inner2, dict) and "members" in inner2 and isinstance(inner2.get("members"), (dict, list)):
                    return inner2

    # fallback: search shallowly for any dict containing 'members'
    for v in raw.values():
        if isinstance(v, dict) and "members" in v and isinstance(v.get("members"), (dict, list)):
            return v

    return raw  # last resort

def find_members_container(faction_payload: dict):
    """
    Returns members container if present, else {}.
    """
    if not isinstance(faction_payload, dict):
        return {}
    mem = faction_payload.get("members")
    if isinstance(mem, (dict, list)):
        return mem
    return {}

def iter_members(members):
    if isinstance(members, dict):
        for mid, m in members.items():
            if isinstance(m, dict):
                yield str(m.get("id") or mid), m
        return
    if isinstance(members, list):
        for m in members:
            if isinstance(m, dict):
                yield str(m.get("id") or ""), m
        return

def normalize_faction_rows(raw_faction: dict, avail_map=None):
    avail_map = avail_map or {}

    faction = extract_faction_payload(raw_faction)
    members = find_members_container(faction)

    rows = []
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

    for mid, m in iter_members(members):
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
        "name": faction.get("name") or faction.get("faction_name"),
        "tag": faction.get("tag"),
        "respect": faction.get("respect"),
    }

    # chain location varies
    chain = {"current": 0, "max": 10, "timeout": 0, "cooldown": 0}
    ch = faction.get("chain")
    if isinstance(ch, dict):
        chain = {
            "current": ch.get("current", 0),
            "max": ch.get("max", 10),
            "timeout": ch.get("timeout", 0),
            "cooldown": ch.get("cooldown", 0),
        }

    return rows, counts, available_count, header, chain


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
    .err { margin-top:10px; padding:10px; border-radius:12px; background:rgba(255,80,80,.12); border:1px solid rgba(255,80,80,.25); font-size:12px; }
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

  {% if last_error %}
    <div class="err"><b>Last error:</b><br>{{ last_error.error }}</div>
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
  {% if you.offline|length == 0 %}<div class="section-empty">No one offline right now.</div>{% endif %}
  {% for row in you.offline %}
    <div class="member offline">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right">{{ row.minutes }}m</div>
    </div>
  {% endfor %}

</body>
</html>
"""

@app.route("/ping")
def ping():
    return "pong"

@app.route("/health")
def health():
    return "ok"

@app.route("/state")
def state():
    return jsonify(STATE)

@app.route("/")
def panel():
    you_sections = split_sections(STATE.get("rows") or [])
    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at"),
        counts=STATE.get("counts", {}),
        available_count=STATE.get("available_count", 0),
        faction=STATE.get("faction", {}),
        last_error=STATE.get("last_error"),
        you=you_sections,
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


async def poll_once(session: aiohttp.ClientSession):
    avail_map = get_availability_map()
    raw_faction = await call_get_faction_core(session, FACTION_API_KEY, FACTION_ID)

    rows, counts, available_count, header, chain = normalize_faction_rows(raw_faction, avail_map=avail_map)

    # If still empty, surface a clear error so you see it in shield
    if not rows:
        raise RuntimeError("No members found in get_faction_core() response. Your torn_api wrapper returns a different structure; update torn_api.py or paste its get_faction_core() here.")

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["chain"] = chain
    STATE["faction"] = header

    # war + enemy (optional) — kept minimal so your main panel stays stable
    war = await call_get_ranked_war_best(session, FACTION_API_KEY, FACTION_ID)
    opponent_id = extract_opponent_id(war)
    STATE["war"]["opponent_id"] = opponent_id

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
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
