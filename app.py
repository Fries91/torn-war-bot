import os
import threading
import asyncio
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template_string
from dotenv import load_dotenv

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
    "war": {"opponent": None, "opponent_id": None, "start": None, "end": None, "target": None, "score": None, "enemy_score": None},
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
    t = (
        req.headers.get("X-Avail-Token")
        or req.headers.get("X-Token")
        or req.args.get("token")
        or data.get("token")
        or ""
    ).strip()
    return t == AVAIL_TOKEN


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


def normalize_faction_rows(v2_payload: dict, avail_map=None):
    avail_map = avail_map or {}
    v2_payload = v2_payload or {}

    basic = v2_payload.get("basic") or {}
    members = v2_payload.get("members") or {}
    chain = v2_payload.get("chain") or {}

    rows = []
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

    if isinstance(members, dict):
        items = members.items()
    elif isinstance(members, list):
        items = [(str(m.get("id") or ""), m) for m in members if isinstance(m, dict)]
    else:
        items = []

    for mid, m in items:
        if not isinstance(m, dict):
            continue

        torn_id = str(m.get("id") or mid).strip() or str(mid).strip()
        name = m.get("name") or "—"

        minutes = parse_last_action_minutes(m)
        status = classify_status(minutes)

        st = m.get("status") or {}
        hosp = bool(st.get("state") == "Hospital" or m.get("hospital"))
        hospital_until = st.get("until") or m.get("hospital_until")

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

    header = {"name": basic.get("name"), "tag": basic.get("tag"), "respect": basic.get("respect")}
    chain_out = {
        "current": chain.get("current") or 0,
        "max": chain.get("max") or 10,
        "timeout": chain.get("timeout") or 0,
        "cooldown": chain.get("cooldown") or 0,
    }

    return rows, counts, available_count, header, chain_out


HTML = r"""
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚔ 7DS*: WRATH WAR PANEL</title>
  <style>
    :root{
      --bg0:#070607;
      --bg1:#0d0a0c;
      --text:#f4f2f3;
      --muted:rgba(244,242,243,.74);

      --ember:#ff7a18;
      --blood:#ff2a2a;
      --gold:#ffd24a;
      --violet:#b06cff;

      --line:rgba(255,255,255,.10);
      --cardBorder:rgba(255,255,255,.07);

      --green:#00ff66;
      --yellow:#ffd000;
      --red:#ff3333;

      --dangerBg:rgba(255,80,80,.12);
      --dangerBorder:rgba(255,80,80,.25);

      --glowRed: 0 0 14px rgba(255,42,42,.25), 0 0 26px rgba(255,42,42,.14);
      --glowEmber: 0 0 14px rgba(255,122,24,.22), 0 0 28px rgba(255,122,24,.12);
    }

    html, body {
      background: radial-gradient(1200px 700px at 18% 10%, rgba(255,42,42,.10), transparent 55%),
                  radial-gradient(900px 600px at 82% 0%, rgba(255,122,24,.08), transparent 60%),
                  linear-gradient(180deg, var(--bg0), var(--bg1)) !important;
      color: var(--text) !important;
      font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif !important;
      margin: 0 !important;
      padding: 10px !important;
      -webkit-text-size-adjust: 100%;
    }

    /* prevent external CSS forcing black text */
    * { color: inherit !important; }

    .sigil{
      height:10px;
      border-radius:999px;
      background: linear-gradient(90deg, transparent, rgba(255,42,42,.55), rgba(255,122,24,.45), transparent) !important;
      opacity:.9;
      margin-bottom:10px;
      position:relative;
      overflow:hidden;
      border:1px solid rgba(255,255,255,.06) !important;
      box-shadow: var(--glowRed);
    }
    .sigil:after{
      content:"";
      position:absolute;
      top:-40px; left:-60%;
      width:40%;
      height:120px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent);
      transform: rotate(18deg);
      animation: sweep 5.8s linear infinite;
      opacity:.5;
    }
    @keyframes sweep{
      0%{ left:-60%; }
      100%{ left:140%; }
    }

    .topbar { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .title {
      font-weight: 950;
      letter-spacing: 1.1px;
      font-size: 16px;
      color: var(--gold) !important;
      text-transform: uppercase;
      text-shadow: var(--glowEmber);
    }
    .meta { font-size:12px; opacity:.96; display:flex; align-items:center; gap:8px; flex-wrap:wrap; color: var(--text) !important; }

    .pill {
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:6px 10px;
      border-radius:999px;
      background: linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.04)) !important;
      border:1px solid rgba(255,255,255,.10) !important;
      font-size:12px;
      white-space:nowrap;
      color: var(--text) !important;
    }

    .divider { margin:14px 0; height:1px; background: var(--line) !important; }

    .section-title {
      font-weight: 950;
      letter-spacing: 1.0px;
      margin-top: 10px;
      margin-bottom: 6px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      flex-wrap:wrap;
      color: var(--gold) !important;
      text-shadow: var(--glowEmber);
    }
    .section-title .small { font-size:12px; opacity:.9; font-weight:700; color: var(--text) !important; text-shadow:none; }

    h2 {
      margin:12px 0 6px;
      padding-bottom:6px;
      border-bottom:1px solid rgba(255,255,255,.10) !important;
      font-size:13px;
      letter-spacing:.7px;
      color: var(--text) !important;
      text-transform: uppercase;
      opacity: .95;
    }

    .member {
      padding:9px 10px;
      margin:6px 0;
      border-radius:12px;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
      font-size:13px;
      background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)) !important;
      border:1px solid var(--cardBorder) !important;
      color: var(--text) !important;
      box-shadow: 0 10px 20px rgba(0,0,0,.22);
      position: relative;
      overflow: hidden;
    }
    .member:after{
      content:"";
      position:absolute;
      inset:-1px;
      background:
        radial-gradient(260px 60px at 10% 0%, rgba(255,122,24,.10), transparent 65%),
        radial-gradient(220px 55px at 90% 0%, rgba(255,42,42,.10), transparent 70%);
      pointer-events:none;
      opacity:.8;
    }

    .left { display:flex; flex-direction:column; gap:2px; min-width:0; position:relative; z-index:1; }
    .name { font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:68vw; color: var(--text) !important; }
    .sub { opacity:.82; font-size:11px; color: var(--text) !important; }
    .right { opacity:.96; font-size:12px; white-space:nowrap; color: var(--text) !important; position:relative; z-index:1; }

    .online{ border-left:4px solid var(--green) !important; }
    .idle{ border-left:4px solid var(--yellow) !important; }
    .offline{ border-left:4px solid var(--red) !important; box-shadow: var(--glowRed); }
    .hospital{ border-left:4px solid var(--violet) !important; }

    .hospTimer{
      font-weight: 900;
      letter-spacing: .4px;
      text-shadow: var(--glowEmber);
    }

    .section-empty { opacity:.85; font-size:12px; padding:8px 2px; color: var(--text) !important; }

    .err {
      margin-top:10px;
      padding:10px;
      border-radius:12px;
      background: var(--dangerBg) !important;
      border:1px solid var(--dangerBorder) !important;
      font-size:12px;
      white-space:pre-wrap;
      color: var(--text) !important;
      box-shadow: var(--glowRed);
    }

    .warbox {
      margin-top:10px;
      padding:10px;
      border-radius:14px;
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03)) !important;
      border:1px solid rgba(255,255,255,.10) !important;
      font-size:12px;
      line-height:1.35;
      color: var(--text) !important;
      box-shadow: var(--glowEmber);
    }

    .warrow { display:flex; justify-content:space-between; gap:10px; margin:3px 0; }
    .label { opacity:.8; color: var(--muted) !important; }

    /* ✅ Collapsible sections (OFFLINE) */
    .collapsible {
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.10) !important;
      background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)) !important;
      box-shadow: 0 10px 20px rgba(0,0,0,.22);
      overflow: hidden;
      margin: 10px 0;
    }
    .collapsible-summary {
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      cursor: pointer;
      padding: 10px 12px;
      font-weight: 950;
      letter-spacing: .7px;
      text-transform: uppercase;
      color: var(--text) !important;
      user-select: none;
    }
    .collapsible-summary::-webkit-details-marker { display: none; }
    .collapsible-summary:after {
      content: "▾";
      opacity: .9;
      margin-left: 8px;
    }
    .collapsible[open] .collapsible-summary:after { content: "▴"; }
    .collapsible-body { padding: 0 10px 10px; }

    @media (max-width: 520px){
      .name{ max-width: 58vw; }
    }
  </style>
</head>
<body>

  <div class="sigil"></div>

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

  {% if war.opponent or war.target or war.score is not none %}
  <div class="warbox">
    <div class="warrow"><div class="label">Opponent</div><div>{{ war.opponent or "—" }}</div></div>
    <div class="warrow"><div class="label">Opponent ID</div><div>{{ war.opponent_id or "—" }}</div></div>
    <div class="warrow"><div class="label">Our Score</div><div>{{ war.score if war.score is not none else "—" }}</div></div>
    <div class="warrow"><div class="label">Enemy Score</div><div>{{ war.enemy_score if war.enemy_score is not none else "—" }}</div></div>
    <div class="warrow"><div class="label">Target</div><div>{{ war.target if war.target is not none else "—" }}</div></div>
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

  <h2>🏥 HOSPITAL</h2>
  {% if you.hospital|length == 0 %}<div class="section-empty">No one in hospital right now.</div>{% endif %}
  {% for row in you.hospital %}
    <div class="member hospital">
      <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
      <div class="right"><span class="hospTimer" data-until="{{ row.hospital_until or '' }}">—</span></div>
    </div>
  {% endfor %}

  <!-- ✅ OFFLINE COLLAPSIBLE -->
  <details class="collapsible">
    <summary class="collapsible-summary">
      <span>🔴 OFFLINE (30+ mins)</span>
      <span class="pill">{{ you.offline|length }}</span>
    </summary>

    <div class="collapsible-body">
      {% if you.offline|length == 0 %}<div class="section-empty">No one offline right now.</div>{% endif %}
      {% for row in you.offline %}
        <div class="member offline">
          <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
          <div class="right">{{ row.minutes }}m</div>
        </div>
      {% endfor %}
    </div>
  </details>

  <div class="divider"></div>

  <div class="section-title">
    <div>🎯 ENEMY FACTION</div>
    <div class="small">
      {% if enemy.faction.name %}
        {{ enemy.faction.tag or "" }} {{ enemy.faction.name }} (ID: {{ enemy.faction.id }})
        · 🟢 {{ enemy.counts.online }} 🟡 {{ enemy.counts.idle }} 🔴 {{ enemy.counts.offline }} 🏥 {{ enemy.counts.hospital }}
      {% else %}
        Waiting for opponent id…
      {% endif %}
    </div>
  </div>

  {% if enemy.faction.name %}
    <h2>🟢 ENEMY ONLINE (0–20 mins)</h2>
    {% if them.online|length == 0 %}<div class="section-empty">No enemy online right now.</div>{% endif %}
    {% for row in them.online %}
      <div class="member online">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.minutes }}m</div>
      </div>
    {% endfor %}

    <h2>🟡 ENEMY IDLE (20–30 mins)</h2>
    {% if them.idle|length == 0 %}<div class="section-empty">No enemy idle right now.</div>{% endif %}
    {% for row in them.idle %}
      <div class="member idle">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right">{{ row.minutes }}m</div>
      </div>
    {% endfor %}

    <h2>🏥 ENEMY HOSPITAL</h2>
    {% if them.hospital|length == 0 %}<div class="section-empty">No enemy in hospital right now.</div>{% endif %}
    {% for row in them.hospital %}
      <div class="member hospital">
        <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
        <div class="right"><span class="hospTimer" data-until="{{ row.hospital_until or '' }}">—</span></div>
      </div>
    {% endfor %}

    <!-- ✅ ENEMY OFFLINE COLLAPSIBLE -->
    <details class="collapsible">
      <summary class="collapsible-summary">
        <span>🔴 ENEMY OFFLINE (30+ mins)</span>
        <span class="pill">{{ them.offline|length }}</span>
      </summary>

      <div class="collapsible-body">
        {% if them.offline|length == 0 %}<div class="section-empty">No enemy offline right now.</div>{% endif %}
        {% for row in them.offline %}
          <div class="member offline">
            <div class="left"><div class="name">{{ row.name }}</div><div class="sub">ID: {{ row.id }}</div></div>
            <div class="right">{{ row.minutes }}m</div>
          </div>
        {% endfor %}
      </div>
    </details>
  {% endif %}

  <script>
  (function () {
    function parseUntil(raw) {
      if (!raw) return null;
      if (typeof raw === 'number') return raw * 1000;
      const s = String(raw).trim();
      if (!s) return null;
      if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
      const ms = Date.parse(s);
      if (!isNaN(ms)) return ms;
      return null;
    }

    function fmt(msLeft) {
      if (msLeft <= 0) return "OUT";
      const totalSec = Math.floor(msLeft / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      return `${m}m ${s}s`;
    }

    function tick() {
      const now = Date.now();
      document.querySelectorAll(".hospTimer").forEach(el => {
        const raw = el.getAttribute("data-until") || "";
        const untilMs = parseUntil(raw);

        if (!untilMs) {
          el.textContent = "—";
          return;
        }

        const left = untilMs - now;
        el.textContent = fmt(left);

        if (left <= 0) {
          el.style.opacity = "0.85";
          el.style.fontWeight = "900";
        } else if (left < 5 * 60 * 1000) {
          el.style.fontWeight = "950";
        } else {
          el.style.fontWeight = "900";
        }
      });
    }

    tick();
    setInterval(tick, 1000);
  })();
  </script>

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
    them_sections = split_sections((STATE.get("enemy") or {}).get("rows") or [])
    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at"),
        counts=STATE.get("counts", {}),
        available_count=STATE.get("available_count", 0),
        war=STATE.get("war", {}),
        faction=STATE.get("faction", {}),
        enemy=STATE.get("enemy", {}),
        last_error=STATE.get("last_error"),
        you=you_sections,
        them=them_sections,
    )


@app.route("/api/availability", methods=["POST"])
def api_availability():
    # Always return JSON (avoid HTML 500 pages in Tampermonkey)
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        data = request.get_json(force=True, silent=True) or {}
        torn_id = str(data.get("torn_id") or data.get("id") or "").strip()
        available = bool(data.get("available", False))

        if not torn_id:
            return jsonify({"ok": False, "error": "missing id"}), 400

        if CHAIN_SITTER_IDS and (not is_chain_sitter(torn_id)):
            return jsonify({"ok": False, "error": "not chain sitter"}), 403

        upsert_availability(torn_id, available)
        return jsonify({"ok": True, "id": torn_id, "available": available})

    except Exception as e:
        STATE["last_error"] = {"error": f"OPT API ERROR: {e}"}
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": False, "error": str(e)}), 500


async def poll_once():
    if not FACTION_ID or not FACTION_API_KEY:
        raise RuntimeError("Missing FACTION_ID or FACTION_API_KEY env vars.")

    avail_map = get_availability_map()

    our_payload = await get_faction_core(FACTION_ID, FACTION_API_KEY)
    if isinstance(our_payload, dict) and our_payload.get("error"):
        raise RuntimeError(f"Torn API error (core): {our_payload.get('error')}")

    rows, counts, available_count, header, chain = normalize_faction_rows(our_payload, avail_map=avail_map)

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["faction"] = header
    STATE["chain"] = chain

    war = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY)
    if isinstance(war, dict) and war.get("error"):
        war = {}

    STATE["war"] = {
        "opponent": war.get("opponent"),
        "opponent_id": war.get("opponent_id"),
        "start": war.get("start"),
        "end": war.get("end"),
        "target": war.get("target"),
        "score": war.get("score"),
        "enemy_score": war.get("enemy_score"),
    }

    opp_id = war.get("opponent_id")
    if opp_id:
        enemy_payload = await get_faction_core(str(opp_id), FACTION_API_KEY)
        if isinstance(enemy_payload, dict) and enemy_payload.get("error"):
            STATE["enemy"] = {
                "supported": True,
                "reason": f"Enemy fetch error: {enemy_payload.get('error')}",
                "faction": {"name": None, "tag": None, "respect": None, "id": str(opp_id)},
                "rows": [],
                "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
                "updated_at": now_iso(),
            }
        else:
            erows, ecounts, _, eheader, _ = normalize_faction_rows(enemy_payload, avail_map={})
            eheader["id"] = str(opp_id)
            STATE["enemy"] = {
                "supported": True,
                "reason": None,
                "faction": eheader,
                "rows": erows,
                "counts": ecounts,
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
    while True:
        try:
            await poll_once()
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

    if request.path in ("/health", "/ping"):
        return

    if BOOTED:
        return
    with BOOT_LOCK:
        if BOOTED:
            return
        try:
            init_db()
            start_poll_thread()
            BOOTED = True
        except Exception as e:
            STATE["last_error"] = {"error": f"BOOT ERROR: {e}"}
            STATE["updated_at"] = now_iso()
            BOOTED = True


if __name__ == "__main__":
    init_db()
    start_poll_thread()
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
