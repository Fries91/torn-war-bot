import os
import threading
import asyncio
import sqlite3
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

# Med Deals storage (SQLite). If you already use a DB path in db.py, you can set MED_DEALS_DB_PATH to the same file.
MED_DEALS_DB_PATH = (os.getenv("MED_DEALS_DB_PATH") or "med_deals.db").strip()
MED_DEALS_LIMIT = int(os.getenv("MED_DEALS_LIMIT") or "25")

# Optional: allow admins to delete any deal (comma-separated torn IDs)
MED_DEALS_ADMIN_IDS = {s.strip() for s in (os.getenv("MED_DEALS_ADMIN_IDS") or "").split(",") if s.strip()}

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
    "med_deals": [],
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


# =========================
# 💊 MED DEALS (SQLite) — UPDATED FOR DROPDOWNS
# =========================
def _md_conn():
    return sqlite3.connect(MED_DEALS_DB_PATH, check_same_thread=False)

def _md_has_column(con, table: str, col: str) -> bool:
    cur = con.execute(f"PRAGMA table_info({table});")
    cols = [r[1] for r in cur.fetchall()]
    return col in cols

def init_med_deals_db():
    """
    Creates table if missing, then migrates older versions by adding new columns.
    Backwards compatible with old enemy_player_* fields.
    """
    con = _md_conn()
    try:
        con.execute("""
        CREATE TABLE IF NOT EXISTS med_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            reporter_id TEXT NOT NULL,
            reporter_name TEXT,

            -- War snapshot (optional)
            war_opponent_id TEXT,
            war_opponent_name TEXT,

            -- NEW: dropdown fields
            enemy_faction TEXT,
            member_id TEXT,
            member_name TEXT,
            proof TEXT,

            -- OLD (kept for compatibility)
            enemy_player_id TEXT,
            enemy_player_name TEXT,

            item TEXT NOT NULL,
            qty INTEGER NOT NULL DEFAULT 1,
            price INTEGER,
            notes TEXT
        );
        """)

        # Migrate older DB files that were created before the new columns existed
        for col, ddl in [
            ("enemy_faction", "ALTER TABLE med_deals ADD COLUMN enemy_faction TEXT;"),
            ("member_id", "ALTER TABLE med_deals ADD COLUMN member_id TEXT;"),
            ("member_name", "ALTER TABLE med_deals ADD COLUMN member_name TEXT;"),
            ("proof", "ALTER TABLE med_deals ADD COLUMN proof TEXT;"),
        ]:
            if not _md_has_column(con, "med_deals", col):
                try:
                    con.execute(ddl)
                except Exception:
                    # If SQLite version / weird state, ignore; table create above covers fresh installs.
                    pass

        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_created_at ON med_deals(created_at);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_reporter_id ON med_deals(reporter_id);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_enemy_faction ON med_deals(enemy_faction);")
        con.commit()
    finally:
        con.close()

def list_med_deals(limit=25):
    con = _md_conn()
    try:
        cur = con.execute("""
            SELECT
              id, created_at, reporter_id, reporter_name,
              war_opponent_id, war_opponent_name,
              enemy_faction, member_id, member_name, proof,
              enemy_player_id, enemy_player_name,
              item, qty, price, notes
            FROM med_deals
            ORDER BY id DESC
            LIMIT ?
        """, (int(limit),))
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r[0],
                "created_at": r[1],
                "reporter_id": r[2],
                "reporter_name": r[3],
                "war_opponent_id": r[4],
                "war_opponent_name": r[5],

                # NEW
                "enemy_faction": r[6],
                "member_id": r[7],
                "member_name": r[8],
                "proof": r[9],

                # OLD (compat)
                "enemy_player_id": r[10],
                "enemy_player_name": r[11],

                "item": r[12],
                "qty": r[13],
                "price": r[14],
                "notes": r[15],
            })
        return out
    finally:
        con.close()

def add_med_deal(payload: dict):
    """
    Accepts NEW payload:
      enemy_faction, member_id, member_name, proof
    Also accepts OLD payload:
      enemy_player_id, enemy_player_name
    """
    created_at = now_iso()
    reporter_id = str(payload.get("reporter_id") or "").strip()
    reporter_name = (payload.get("reporter_name") or "").strip()

    war_opponent_id = str(payload.get("war_opponent_id") or "").strip() or None
    war_opponent_name = (payload.get("war_opponent_name") or "").strip() or None

    # NEW dropdown fields
    enemy_faction = (payload.get("enemy_faction") or "").strip() or None
    member_id = str(payload.get("member_id") or "").strip() or None
    member_name = (payload.get("member_name") or "").strip() or None
    proof = (payload.get("proof") or "").strip() or None

    # OLD fields (still allowed)
    enemy_player_id = str(payload.get("enemy_player_id") or "").strip() or None
    enemy_player_name = (payload.get("enemy_player_name") or "").strip() or None

    item = (payload.get("item") or "").strip()
    qty = payload.get("qty", 1)
    price = payload.get("price", None)
    notes = (payload.get("notes") or "").strip() or None

    if not reporter_id:
        raise ValueError("missing reporter_id")

    # Require enemy_faction + member_id for the dropdown version
    # BUT if someone uses old fields, allow as fallback.
    if not enemy_faction and not (enemy_player_id or enemy_player_name):
        raise ValueError("missing enemy_faction (or old enemy_player fields)")
    if not member_id and not member_name:
        # allow legacy deals without member dropdown
        member_id = None
        member_name = None

    if not item:
        raise ValueError("missing item")

    try:
        qty = int(qty)
    except Exception:
        qty = 1
    if qty <= 0:
        qty = 1

    if price is not None and price != "":
        try:
            price = int(price)
        except Exception:
            price = None
    else:
        price = None

    con = _md_conn()
    try:
        cur = con.execute("""
            INSERT INTO med_deals (
                created_at, reporter_id, reporter_name,
                war_opponent_id, war_opponent_name,
                enemy_faction, member_id, member_name, proof,
                enemy_player_id, enemy_player_name,
                item, qty, price, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            created_at, reporter_id, reporter_name,
            war_opponent_id, war_opponent_name,
            enemy_faction, member_id, member_name, proof,
            enemy_player_id, enemy_player_name,
            item, qty, price, notes
        ))
        con.commit()
        return cur.lastrowid
    finally:
        con.close()

def delete_med_deal(deal_id: int, requester_id: str):
    requester_id = str(requester_id or "").strip()
    if not requester_id:
        raise ValueError("missing requester_id")

    con = _md_conn()
    try:
        cur = con.execute("SELECT reporter_id FROM med_deals WHERE id = ?", (int(deal_id),))
        row = cur.fetchone()
        if not row:
            return False, "not found"
        reporter_id = str(row[0])

        # allow delete if owner or admin
        if requester_id != reporter_id and requester_id not in MED_DEALS_ADMIN_IDS:
            return False, "forbidden"

        con.execute("DELETE FROM med_deals WHERE id = ?", (int(deal_id),))
        con.commit()
        return True, "deleted"
    finally:
        con.close()


# ✅ WRATH THEME PANEL (your HTML left mostly as-is; Med Deals shows new fields too)
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
      --line: rgba(255,255,255,0);
      --cardBorder: rgba(255,255,255,.05);
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
    * { color: inherit !important; }

    .sigil{ height:10px; border-radius:999px; background: linear-gradient(90deg, transparent, rgba(255,42,42,.55), rgba(255,122,24,.45), transparent) !important;
      opacity:.9; margin-bottom:10px; position:relative; overflow:hidden; border:1px solid transparent !important; box-shadow: var(--glowRed); }
    .sigil:after{ content:""; position:absolute; top:-40px; left:-60%; width:40%; height:120px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent);
      transform: rotate(18deg); animation: sweep 5.8s linear infinite; opacity:.5; }
    @keyframes sweep{ 0%{ left:-60%; } 100%{ left:140%; } }

    .topbar { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .title { font-weight: 950; letter-spacing: 1.1px; font-size: 16px; color: var(--gold) !important; text-transform: uppercase; text-shadow: var(--glowEmber); }
    .meta { font-size:12px; opacity:.96; display:flex; align-items:center; gap:8px; flex-wrap:wrap; color: var(--text) !important; }

    .pill { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px;
      background: linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.04)) !important;
      border:1px solid rgba(255,255,255,.05) !important;
      font-size:12px; white-space:nowrap; color: var(--text) !important; }

    .divider { margin:14px 0; height:1px; background: transparent !important; }

    .section-title { font-weight: 950; letter-spacing: 1.0px; margin-top: 10px; margin-bottom: 6px;
      display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
      color: var(--gold) !important; text-shadow: var(--glowEmber); }
    .section-title .small { font-size:12px; opacity:.9; font-weight:700; color: var(--text) !important; text-shadow:none; }

    h2 { margin:12px 0 6px; padding-bottom:6px; border-bottom:1px solid transparent !important;
      font-size:13px; letter-spacing:.7px; color: var(--text) !important;
      text-transform: uppercase; opacity: .95; }

    .member { padding:9px 10px; margin:6px 0; border-radius:12px; display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:13px;
      background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02)) !important;
      border:1px solid var(--cardBorder) !important; color: var(--text) !important; box-shadow: 0 10px 20px rgba(0,0,0,.22); position: relative; overflow: hidden; }
    .member:after{ content:""; position:absolute; inset:-1px;
      background: radial-gradient(260px 60px at 10% 0%, rgba(255,122,24,.10), transparent 65%),
                  radial-gradient(220px 55px at 90% 0%, rgba(255,42,42,.10), transparent 70%);
      pointer-events:none; opacity:.8; }

    .left { display:flex; flex-direction:column; gap:2px; min-width:0; position:relative; z-index:1; }
    .name { font-weight:900; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:52vw; color: var(--text) !important; }
    .sub { opacity:.82; font-size:11px; color: var(--text) !important; }

    .rightWrap{ display:flex; align-items:center; justify-content:flex-end; gap:8px; white-space:nowrap; position:relative; z-index:2; }
    .right { opacity:.96; font-size:12px; white-space:nowrap; color: var(--text) !important; }

    .abtn{ display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:12px;
      border:1px solid rgba(255,255,255,.12) !important;
      background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03)) !important;
      font-size:12px; font-weight:950; color: var(--text) !important; text-decoration:none !important;
      box-shadow: 0 10px 18px rgba(0,0,0,.24); cursor:pointer; }
    .abtn:active{ transform: translateY(1px); }
    .abtn.attack{ border-color: rgba(255,122,24,.45) !important;
      background: linear-gradient(180deg, rgba(255,122,24,.22), rgba(255,42,42,.10)) !important; box-shadow: var(--glowEmber); }
    .abtn.bounty{ border-color: rgba(255,42,42,.40) !important;
      background: linear-gradient(180deg, rgba(255,42,42,.20), rgba(255,122,24,.10)) !important; box-shadow: var(--glowRed); }

    .online{ border-left:4px solid var(--green) !important; }
    .idle{ border-left:4px solid var(--yellow) !important; }
    .offline{ border-left:4px solid var(--red) !important; box-shadow: var(--glowRed); }
    .hospital{ border-left:4px solid var(--violet) !important; }

    .hospTimer{ font-weight: 900; letter-spacing: .4px; text-shadow: var(--glowEmber); }
    .section-empty { opacity:.85; font-size:12px; padding:8px 2px; color: var(--text) !important; }

    .err { margin-top:10px; padding:10px; border-radius:12px; background: var(--dangerBg) !important;
      border:1px solid rgba(255,80,80,.25) !important; font-size:12px; white-space:pre-wrap; color: var(--text) !important; box-shadow: var(--glowRed); }

    .warbox { margin-top:10px; padding:10px; border-radius:14px;
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03)) !important;
      border:1px solid rgba(255,255,255,.05) !important; font-size:12px; line-height:1.35; color: var(--text) !important; box-shadow: var(--glowEmber); }
    .warrow { display:flex; justify-content:space-between; gap:10px; margin:3px 0; }
    .label { opacity:.8; color: var(--muted) !important; }

    .collapsible { border-radius: 14px; border: 1px solid rgba(255,255,255,.05) !important;
      background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)) !important;
      box-shadow: 0 10px 20px rgba(0,0,0,.22); overflow: hidden; margin: 10px 0; }
    .collapsible-summary { list-style: none; display: flex; align-items: center; justify-content: space-between;
      gap: 10px; cursor: pointer; padding: 10px 12px; font-weight: 950; letter-spacing: .7px; text-transform: uppercase; user-select: none; }
    .collapsible-summary::-webkit-details-marker { display: none; }
    .collapsible-summary:after { content: "▾"; opacity: .9; margin-left: 8px; }
    .collapsible[open] .collapsible-summary:after { content: "▴"; }
    .collapsible-body { padding: 0 10px 10px; }

    .dealCard{
      padding:10px; margin:6px 0; border-radius:14px;
      border:1px solid rgba(255,255,255,.08) !important;
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02)) !important;
      box-shadow: 0 10px 20px rgba(0,0,0,.20);
      font-size:12px;
    }
    .dealRow{ display:flex; justify-content:space-between; gap:10px; margin:4px 0; }
    .dealLabel{ opacity:.75; }
    .dealStrong{ font-weight:950; text-align:right; }
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

  <details class="collapsible" open>
    <summary class="collapsible-summary">
      <span>💊 MED DEALS</span>
      <span class="pill">{{ med_deals|length }}</span>
    </summary>
    <div class="collapsible-body">
      {% if med_deals|length == 0 %}
        <div class="section-empty">No deals logged yet.</div>
      {% endif %}

      {% for d in med_deals %}
        <div class="dealCard">
          <div class="dealRow"><div class="dealLabel">When</div><div class="dealStrong">{{ d.created_at }}</div></div>
          <div class="dealRow"><div class="dealLabel">Reporter</div><div class="dealStrong">{{ d.reporter_name or d.reporter_id }}</div></div>

          {% if d.enemy_faction %}
            <div class="dealRow"><div class="dealLabel">Enemy Faction</div><div class="dealStrong">{{ d.enemy_faction }}</div></div>
          {% elif d.war_opponent_name or d.war_opponent_id %}
            <div class="dealRow"><div class="dealLabel">Enemy Faction</div><div class="dealStrong">{{ d.war_opponent_name or "—" }}{% if d.war_opponent_id %} ({{ d.war_opponent_id }}){% endif %}</div></div>
          {% endif %}

          {% if d.member_name or d.member_id %}
            <div class="dealRow"><div class="dealLabel">Member</div><div class="dealStrong">{{ d.member_name or "—" }}{% if d.member_id %} ({{ d.member_id }}){% endif %}</div></div>
          {% endif %}

          {% if d.enemy_player_name or d.enemy_player_id %}
            <div class="dealRow"><div class="dealLabel">Enemy Player</div><div class="dealStrong">{{ d.enemy_player_name or "—" }}{% if d.enemy_player_id %} ({{ d.enemy_player_id }}){% endif %}</div></div>
          {% endif %}

          <div class="dealRow"><div class="dealLabel">Item</div><div class="dealStrong">{{ d.item }} ×{{ d.qty }}</div></div>
          {% if d.price is not none %}
            <div class="dealRow"><div class="dealLabel">Price</div><div class="dealStrong">${{ d.price }}</div></div>
          {% endif %}
          {% if d.proof %}
            <div class="dealRow"><div class="dealLabel">Proof</div><div class="dealStrong">{{ d.proof }}</div></div>
          {% endif %}
          {% if d.notes %}
            <div class="dealRow"><div class="dealLabel">Notes</div><div class="dealStrong">{{ d.notes }}</div></div>
          {% endif %}
        </div>
      {% endfor %}

      <div class="section-empty" style="margin-top:8px;">
        Deals are posted from the overlay via <code>/api/med_deals</code>.
      </div>
    </div>
  </details>

  <div class="divider"></div>

  <div class="section-title">
    <div>🛡️ YOUR FACTION</div>
    <div class="small">{{ faction.tag or "" }} {{ faction.name or "" }}</div>
  </div>

  <h2>🟢 ONLINE (0–20 mins)</h2>
  {% if you.online|length == 0 %}<div class="section-empty">No one online right now.</div>{% endif %}
  {% for row in you.online %}
    <div class="member online">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="rightWrap">
        <div class="right">{{ row.minutes }}m</div>
        <a class="abtn bounty" target="_blank" rel="noopener noreferrer"
           href="https://www.torn.com/bounties.php?step=add&userID={{ row.id }}">🎯 Bounty</a>
      </div>
    </div>
  {% endfor %}

  <h2>🟡 IDLE (20–30 mins)</h2>
  {% if you.idle|length == 0 %}<div class="section-empty">No one idle right now.</div>{% endif %}
  {% for row in you.idle %}
    <div class="member idle">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="rightWrap">
        <div class="right">{{ row.minutes }}m</div>
        <a class="abtn bounty" target="_blank" rel="noopener noreferrer"
           href="https://www.torn.com/bounties.php?step=add&userID={{ row.id }}">🎯 Bounty</a>
      </div>
    </div>
  {% endfor %}

  <h2>🏥 HOSPITAL</h2>
  {% if you.hospital|length == 0 %}<div class="section-empty">No one in hospital right now.</div>{% endif %}
  {% for row in you.hospital %}
    <div class="member hospital">
      <div class="left">
        <div class="name">{{ row.name }}</div>
        <div class="sub">ID: {{ row.id }}</div>
      </div>
      <div class="rightWrap">
        <div class="right"><span class="hospTimer" data-until="{{ row.hospital_until or '' }}">—</span></div>
        <a class="abtn bounty" target="_blank" rel="noopener noreferrer"
           href="https://www.torn.com/bounties.php?step=add&userID={{ row.id }}">🎯 Bounty</a>
      </div>
    </div>
  {% endfor %}

  <details class="collapsible">
    <summary class="collapsible-summary">
      <span>🔴 OFFLINE (30+ mins)</span>
      <span class="pill">{{ you.offline|length }}</span>
    </summary>

    <div class="collapsible-body">
      {% if you.offline|length == 0 %}<div class="section-empty">No one offline right now.</div>{% endif %}
      {% for row in you.offline %}
        <div class="member offline">
          <div class="left">
            <div class="name">{{ row.name }}</div>
            <div class="sub">ID: {{ row.id }}</div>
          </div>
          <div class="rightWrap">
            <div class="right">{{ row.minutes }}m</div>
            <a class="abtn bounty" target="_blank" rel="noopener noreferrer"
               href="https://www.torn.com/bounties.php?step=add&userID={{ row.id }}">🎯 Bounty</a>
          </div>
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
        <div class="left">
          <div class="name">{{ row.name }}</div>
          <div class="sub">ID: {{ row.id }}</div>
        </div>
        <div class="rightWrap">
          <div class="right">{{ row.minutes }}m</div>
          <a class="abtn attack" target="_blank" rel="noopener noreferrer"
             href="https://www.torn.com/loader.php?sid=attack&user2ID={{ row.id }}">⚔️ Attack</a>
        </div>
      </div>
    {% endfor %}
  {% endif %}

  <script>
  (function () {
    function parseUntil(raw) {
      if (!raw) return null;
      if (typeof raw === 'number') return raw * 1000;
      const s = String(raw).trim();
      if (!s) return null;
      if (/^\\d+$/.test(s)) return parseInt(s, 10) * 1000;
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
        if (!untilMs) { el.textContent = "—"; return; }
        const left = untilMs - now;
        el.textContent = fmt(left);
        el.style.opacity = (left <= 0) ? "0.85" : "1";
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
        med_deals=STATE.get("med_deals") or [],
    )


@app.route("/api/availability", methods=["POST"])
def api_availability():
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


# 💊 MED DEALS API
@app.route("/api/med_deals", methods=["GET"])
def api_med_deals_list():
    try:
        return jsonify({"ok": True, "deals": list_med_deals(MED_DEALS_LIMIT)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/med_deals", methods=["POST"])
def api_med_deals_add():
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        data = request.get_json(force=True, silent=True) or {}

        # Fill current war opponent info from STATE (snapshot)
        war = STATE.get("war") or {}
        data.setdefault("war_opponent_id", war.get("opponent_id"))
        data.setdefault("war_opponent_name", war.get("opponent"))

        new_id = add_med_deal(data)

        # refresh snapshot for /state
        STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": True, "id": new_id})

    except ValueError as ve:
        return jsonify({"ok": False, "error": str(ve)}), 400
    except Exception as e:
        STATE["last_error"] = {"error": f"MED DEALS ADD ERROR: {e}"}
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/med_deals/<int:deal_id>", methods=["DELETE"])
def api_med_deals_delete(deal_id: int):
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        requester_id = (
            request.headers.get("X-Requester-Id")
            or request.args.get("requester_id")
            or (request.get_json(silent=True) or {}).get("requester_id")
            or ""
        )
        ok, msg = delete_med_deal(deal_id, requester_id=str(requester_id).strip())
        if not ok:
            code = 404 if msg == "not found" else 403
            return jsonify({"ok": False, "error": msg}), code

        STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": True, "id": deal_id})

    except ValueError as ve:
        return jsonify({"ok": False, "error": str(ve)}), 400
    except Exception as e:
        STATE["last_error"] = {"error": f"MED DEALS DELETE ERROR: {e}"}
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

    # refresh Med Deals snapshot (so overlay gets it via /state)
    STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)

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
            init_med_deals_db()
            start_poll_thread()
            BOOTED = True
        except Exception as e:
            STATE["last_error"] = {"error": f"BOOT ERROR: {e}"}
            STATE["updated_at"] = now_iso()
            BOOTED = True


if __name__ == "__main__":
    init_db()
    init_med_deals_db()
    start_poll_thread()
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
