# app.py  ✅ Single Render Web Service (Flask + background poll thread)
# - /        : Full panel (iframe-friendly if you still use it)
# - /lite    : ✅ CSP-proof “Lite” panel (open in new tab from shield) — 7 Deadly Sins: WRATH themed
# - /state   : JSON state for overlay + lite
# - /health  : simple healthcheck
# - /api/availability : opt in/out (chain-sitter only; optional token)

import os
import time
import threading
import asyncio
from datetime import datetime, timezone

from flask import Flask, jsonify, request, Response
from dotenv import load_dotenv

from db import (
    init_db, upsert_availability, get_availability_map,
    get_setting, set_setting,
    get_alert_state, set_alert_state
)
from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()

# ===== ENV =====
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()  # optional
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "25"))

# Chain sitter IDs (comma-separated Torn IDs), ex: "1234,5678"
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "1234").split(",") if s.strip()]

app = Flask(__name__)

# ===== Global state =====
STATE = {
    "rows": [],  # list of members with computed status
    "updated_at": None,

    "faction": {"name": None, "tag": None, "respect": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None, "score": None, "enemy_score": None},
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},

    "available_count": 0,
    "last_error": None
}

BOOTED = False
POLL_THREAD = None


# ===== Helpers =====
def iso_now():
    return datetime.now(timezone.utc).isoformat()

def minutes_since(ts_iso: str | None) -> int | None:
    """Return minutes since ISO timestamp; None if unknown."""
    if not ts_iso:
        return None
    try:
        # handle "Z"
        ts_iso = ts_iso.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int((datetime.now(timezone.utc) - dt).total_seconds() // 60)
    except Exception:
        return None

def status_from_last_action(mins: int | None) -> str:
    # Online=0-20, Idle=20-30, Offline=30+
    if mins is None:
        return "offline"
    if mins <= 20:
        return "online"
    if mins <= 30:
        return "idle"
    return "offline"

def require_chain_sitter(torn_id: str | None) -> bool:
    return bool(torn_id) and str(torn_id) in set(CHAIN_SITTER_IDS)

def require_token_if_set(req):
    if not AVAIL_TOKEN:
        return True
    token = (req.headers.get("X-Token") or req.args.get("token") or "").strip()
    return token == AVAIL_TOKEN


# ===== IFRAME / CSP headers (for / if you still embed) =====
@app.after_request
def allow_iframe(resp):
    # If you still iframe the full panel inside Torn, keep this.
    # Lite route is meant to be opened in a new tab, so iframe is not needed there.
    resp.headers.pop("Content-Security-Policy", None)
    resp.headers["Content-Security-Policy"] = "frame-ancestors 'self' https://www.torn.com https://torn.com;"
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    return resp


# ===== Poller =====
async def poll_once():
    """Fetch faction + war data, update STATE."""
    global STATE

    # availability map from db (torn_id -> bool)
    avail_map = get_availability_map() or {}

    # Pull faction core + members
    core = await get_faction_core(FACTION_ID, FACTION_API_KEY)

    # Pull ranked war (best-effort)
    war = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY)

    # Faction details
    faction_name = core.get("name")
    faction_tag = core.get("tag")
    faction_respect = core.get("respect")

    members = core.get("members", []) or []
    rows = []
    available_count = 0

    # Build member rows
    for m in members:
        torn_id = str(m.get("id") or "")
        name = m.get("name") or f"#{torn_id}"

        last_action_iso = None
        # Support multiple shapes
        la = m.get("last_action")
        if isinstance(la, dict):
            last_action_iso = la.get("timestamp_iso") or la.get("timestamp") or la.get("time") or la.get("date")
        elif isinstance(la, str):
            last_action_iso = la

        mins = minutes_since(last_action_iso)
        status = status_from_last_action(mins)

        is_available = bool(avail_map.get(torn_id, False))
        if is_available:
            available_count += 1

        # Optional: hospital timer if your API provides it (safe if missing)
        hosp = m.get("hospital") or {}
        hosp_until = None
        if isinstance(hosp, dict):
            hosp_until = hosp.get("until") or hosp.get("until_iso") or hosp.get("end")

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": mins,
            "status": status,     # online / idle / offline
            "available": is_available,
            "hospital_until": hosp_until
        })

    # Sort: Online first by most recent (lowest minutes), then idle, then offline
    def sort_key(r):
        bucket = {"online": 0, "idle": 1, "offline": 2}.get(r["status"], 3)
        mins = r["minutes"] if isinstance(r["minutes"], int) else 999999
        return (bucket, mins)

    rows.sort(key=sort_key)

    # War details (safe even if None)
    war_obj = {
        "opponent": war.get("opponent"),
        "start": war.get("start"),
        "end": war.get("end"),
        "target": war.get("target"),
        "score": war.get("score"),
        "enemy_score": war.get("enemy_score"),
    }

    # Chain (safe)
    chain_obj = war.get("chain") or {}
    chain = {
        "current": chain_obj.get("current"),
        "max": chain_obj.get("max"),
        "timeout": chain_obj.get("timeout"),
        "cooldown": chain_obj.get("cooldown"),
    }

    STATE.update({
        "rows": rows,
        "updated_at": iso_now(),
        "faction": {"name": faction_name, "tag": faction_tag, "respect": faction_respect},
        "war": war_obj,
        "chain": chain,
        "available_count": available_count,
        "last_error": None
    })


def poll_loop():
    """Runs in a background thread."""
    global STATE
    while True:
        try:
            asyncio.run(poll_once())
        except Exception as e:
            STATE["last_error"] = {"error": str(e), "at": iso_now()}
        time.sleep(POLL_SECONDS)


@app.before_request
def boot_once():
    global BOOTED, POLL_THREAD
    if BOOTED:
        return
    BOOTED = True
    init_db()
    POLL_THREAD = threading.Thread(target=poll_loop, daemon=True)
    POLL_THREAD.start()


# ===== Routes =====
@app.route("/health")
def health():
    return jsonify({"ok": True, "updated_at": STATE.get("updated_at"), "last_error": STATE.get("last_error")})

@app.route("/state")
def state():
    return jsonify(STATE)

@app.route("/api/availability", methods=["POST"])
def api_availability():
    # Body: {"torn_id":"1234","available":true}
    if not require_token_if_set(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    torn_id = str(data.get("torn_id") or "").strip()
    available = bool(data.get("available", False))

    if not require_chain_sitter(torn_id):
        return jsonify({"ok": False, "error": "not_chain_sitter"}), 403

    upsert_availability(torn_id, available)
    return jsonify({"ok": True, "torn_id": torn_id, "available": available})


@app.route("/")
def panel():
    # Keep your existing full panel if you want.
    # This is a simple fallback that points people to /lite.
    return Response(
        """
        <!doctype html>
        <html><head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>7DS*: Wrath War-Bot</title>
          <style>
            body{margin:0;background:#0b0b0b;color:#eee;font-family:Arial}
            .wrap{padding:16px}
            a{color:#ffcc66}
            .box{background:#151515;border:1px solid #331111;border-radius:12px;padding:14px}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="box">
              <h2 style="margin:0 0 10px 0;">🛡️ 7DS*: Wrath War-Bot</h2>
              <div>Use the Lite panel to avoid CSP/iframe issues:</div>
              <div style="margin-top:10px;"><a href="/lite">Open /lite</a></div>
            </div>
          </div>
        </body></html>
        """,
        mimetype="text/html"
    )


@app.route("/lite")
def lite():
    # ✅ “CSP-proof” panel: meant to be opened in a new tab (NOT iframed).
    return Response(
        """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>7DS*: Wrath — War-Bot (Lite)</title>
  <style>
    :root{
      --bg:#070607;
      --panel:#0f0c0d;
      --panel2:#120f10;
      --gold:#d7b35a;
      --ember:#ff3b30;
      --blood:#b31217;
      --ash:#b8b2b4;
      --line:#2b1416;
      --shadow: 0 12px 35px rgba(0,0,0,.55);
    }
    body{
      margin:0;
      background: radial-gradient(1200px 700px at 25% -10%, rgba(255,59,48,.18), transparent 55%),
                  radial-gradient(900px 600px at 110% 10%, rgba(215,179,90,.10), transparent 50%),
                  linear-gradient(180deg, #040304 0%, var(--bg) 100%);
      color:#f0ecec;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    .wrap{ padding:14px; max-width:980px; margin:0 auto; }
    .banner{
      position:relative;
      background: linear-gradient(180deg, rgba(179,18,23,.25), rgba(15,12,13,.85));
      border:1px solid var(--line);
      border-radius:16px;
      padding:14px 14px 12px 14px;
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .sigil{
      position:absolute; right:-22px; top:-22px;
      width:160px;height:160px;border-radius:999px;
      background: radial-gradient(circle at 35% 35%, rgba(215,179,90,.20), rgba(179,18,23,.12), transparent 70%);
      filter: blur(.2px);
      border:1px solid rgba(215,179,90,.15);
      transform: rotate(12deg);
    }
    .title{
      display:flex; align-items:center; gap:10px;
      letter-spacing:.5px;
    }
    .crest{
      width:34px;height:34px;border-radius:10px;
      background: linear-gradient(180deg, rgba(215,179,90,.20), rgba(179,18,23,.18));
      border:1px solid rgba(215,179,90,.25);
      display:grid; place-items:center;
      box-shadow: 0 10px 25px rgba(0,0,0,.45);
      font-weight:800; color:var(--gold);
    }
    h1{ margin:0; font-size:16px; color:var(--gold); }
    .sub{ margin-top:4px; font-size:12px; color:var(--ash); }

    .grid{ display:grid; grid-template-columns: 1fr; gap:10px; margin-top:12px; }
    @media (min-width: 820px){ .grid{ grid-template-columns: 1fr 1fr; } }

    .card{
      background: linear-gradient(180deg, rgba(18,15,16,.92), rgba(10,8,9,.92));
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px;
      box-shadow: var(--shadow);
    }
    .card h2{
      margin:0 0 8px 0;
      font-size:13px;
      color:#fff;
      display:flex; align-items:center; justify-content:space-between;
    }
    .pill{
      font-size:11px;
      padding:4px 8px;
      border-radius:999px;
      border:1px solid rgba(215,179,90,.22);
      color:var(--gold);
      background: rgba(215,179,90,.08);
    }

    .row{ display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-top:1px solid rgba(43,20,22,.7); }
    .row:first-of-type{ border-top:none; }
    .k{ color:var(--ash); font-size:12px;}
    .v{ color:#fff; font-size:12px; text-align:right; }

    .members{ margin-top:6px; display:flex; flex-direction:column; gap:8px; }
    .m{
      border:1px solid rgba(43,20,22,.75);
      background: rgba(7,6,7,.55);
      border-radius:14px;
      padding:9px 10px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }
    .left{ display:flex; align-items:center; gap:10px; min-width:0; }
    .dot{
      width:10px; height:10px; border-radius:999px;
      box-shadow: 0 0 0 3px rgba(255,255,255,.05);
      flex:0 0 auto;
    }
    .name{ font-size:13px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px; }
    .meta{ font-size:11px; color:var(--ash); }
    .right{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; }

    .online{ background:#2cff6f; }
    .idle{ background:#ffcc00; }
    .offline{ background:#ff4444; }

    .statusTxt{ font-size:11px; color:#fff; letter-spacing:.3px; }
    .statusTxt span{ color:var(--gold); }

    .footer{
      margin-top:10px;
      font-size:11px;
      color:rgba(184,178,180,.85);
      display:flex;
      justify-content:space-between;
      gap:10px;
    }
    .err{
      margin-top:10px;
      padding:10px;
      border-radius:14px;
      border:1px solid rgba(255,59,48,.35);
      background: rgba(255,59,48,.08);
      color:#ffd6d3;
      font-size:12px;
      white-space:pre-wrap;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <div class="sigil"></div>
      <div class="title">
        <div class="crest">7</div>
        <div>
          <h1>7DS*: Wrath — War-Bot (Lite)</h1>
          <div class="sub">“Wrath burns clean. Strike fast. Count true.”</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>⚔ Ranked War <span class="pill" id="updated">—</span></h2>
        <div class="row"><div class="k">Opponent</div><div class="v" id="opponent">—</div></div>
        <div class="row"><div class="k">Target</div><div class="v" id="target">—</div></div>
        <div class="row"><div class="k">Score</div><div class="v" id="score">—</div></div>
        <div class="row"><div class="k">Enemy</div><div class="v" id="enemy">—</div></div>
      </div>

      <div class="card">
        <h2>🜲 Presence <span class="pill" id="counts">—</span></h2>
        <div class="members" id="members"></div>
      </div>
    </div>

    <div id="err" class="err" style="display:none;"></div>

    <div class="footer">
      <div id="faction">—</div>
      <div>Auto-refresh: 15s</div>
    </div>
  </div>

  <script>
    function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

    async function loadState(){
      try{
        const res = await fetch("/state", {cache:"no-store"});
        const data = await res.json();

        // Updated pill
        document.getElementById("updated").textContent = data.updated_at ? "Updated" : "Waiting";

        // Faction footer
        const f = data.faction || {};
        document.getElementById("faction").textContent =
          (f.tag ? `[${f.tag}] ` : "") + (f.name || "Faction") + (f.respect ? ` • Respect ${f.respect}` : "");

        // War
        const w = data.war || {};
        document.getElementById("opponent").textContent = w.opponent ? esc(w.opponent) : "No active war";
        document.getElementById("target").textContent = (w.target ?? "—");
        document.getElementById("score").textContent = (w.score ?? "—");
        document.getElementById("enemy").textContent = (w.enemy_score ?? "—");

        // Members
        const rows = data.rows || [];
        let online=0, idle=0, offline=0;
        const wrap = document.getElementById("members");
        wrap.innerHTML = "";

        rows.forEach(r=>{
          const st = r.status || "offline";
          if(st==="online") online++;
          else if(st==="idle") idle++;
          else offline++;

          const mins = (typeof r.minutes === "number") ? `${r.minutes}m` : "—";
          const card = document.createElement("div");
          card.className = "m";
          card.innerHTML = `
            <div class="left">
              <div class="dot ${st}"></div>
              <div style="min-width:0;">
                <div class="name">${esc(r.name)}</div>
                <div class="meta">Last action: ${mins} • ID: ${esc(r.id)}</div>
              </div>
            </div>
            <div class="right">
              <div class="statusTxt">${st.toUpperCase()}</div>
              <div class="statusTxt"><span>${st==="online"?"0–20m":(st==="idle"?"20–30m":"30m+")}</span></div>
            </div>
          `;
          wrap.appendChild(card);
        });

        document.getElementById("counts").textContent = `🟢 ${online}  🟡 ${idle}  🔴 ${offline}`;

        // Error
        const errBox = document.getElementById("err");
        if(data.last_error){
          errBox.style.display = "block";
          errBox.textContent = "Last error:\\n" + JSON.stringify(data.last_error, null, 2);
        } else {
          errBox.style.display = "none";
        }

      }catch(e){
        const errBox = document.getElementById("err");
        errBox.style.display = "block";
        errBox.textContent = "Failed to load /state\\n" + (e?.message || e);
      }
    }

    loadState();
    setInterval(loadState, 15000);
  </script>
</body>
</html>
        """,
        mimetype="text/html"
    )


if __name__ == "__main__":
    # Local dev only (Render uses gunicorn)
    init_db()
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
