# app.py ✅ Render Web Service (Flask + background poll thread)
# Routes:
#   /        : simple landing (links to /lite)
#   /lite    : ✅ CSP-proof lite panel (meant to open in new tab from shield)
#   /state   : JSON state for UI + debugging
#   /health  : healthcheck
#   /api/availability : chain-sitter opt in/out (optional token)

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

# ✅ FIXED IMPORT (your torn_api.py has get_ranked_war_best_effort)
from torn_api import get_faction_core, get_ranked_war_best_effort as get_ranked_war_best

load_dotenv()

# ===== ENV =====
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()  # optional
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "25"))

# Chain sitter IDs (comma-separated Torn IDs), ex: "1234,5678"
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "1234").split(",") if s.strip()]
CHAIN_SITTER_SET = set(CHAIN_SITTER_IDS)

# Background image for /lite (put file in /static)
# Example: /static/wrath-bg.jpg
LITE_BG = (os.getenv("LITE_BG", "/static/wrath-bg.jpg") or "/static/wrath-bg.jpg").strip()

app = Flask(__name__, static_folder="static")

STATE = {
    "rows": [],
    "updated_at": None,
    "faction": {"name": None, "tag": None, "respect": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None, "score": None, "enemy_score": None},
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "available_count": 0,
    "last_error": None
}

BOOTED = False
POLL_THREAD = None


# ---------- Helpers ----------
def iso_now():
    return datetime.now(timezone.utc).isoformat()

def minutes_since(ts_iso):
    if not ts_iso:
        return None
    try:
        s = str(ts_iso).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int((datetime.now(timezone.utc) - dt).total_seconds() // 60)
    except Exception:
        return None

def status_from_last_action(mins):
    # Online=0-20, Idle=21-30, Offline=31+
    if mins is None:
        return "offline"
    if mins <= 20:
        return "online"
    if mins <= 30:
        return "idle"
    return "offline"

def require_chain_sitter(torn_id):
    return bool(torn_id) and str(torn_id) in CHAIN_SITTER_SET

def require_token_if_set(req):
    if not AVAIL_TOKEN:
        return True
    token = (req.headers.get("X-Token") or req.args.get("token") or "").strip()
    return token == AVAIL_TOKEN


# ---------- Headers ----------
@app.after_request
def headers(resp):
    """
    IMPORTANT:
    - /lite is opened in a new tab (NO iframe) => remove CSP/XFO entirely to avoid weird blocks.
    - other routes: allow torn.com to iframe if you ever decide to embed them.
    """
    if request.path.startswith("/lite"):
        resp.headers.pop("Content-Security-Policy", None)
        resp.headers.pop("X-Frame-Options", None)
        return resp

    resp.headers.pop("Content-Security-Policy", None)
    resp.headers["Content-Security-Policy"] = "frame-ancestors 'self' https://www.torn.com https://torn.com;"
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    return resp


# ---------- Polling ----------
async def poll_once():
    global STATE

    if not FACTION_ID or not FACTION_API_KEY:
        STATE["last_error"] = {"error": "Missing FACTION_ID or FACTION_API_KEY env var", "at": iso_now()}
        return

    avail_map = get_availability_map() or {}

    core = await get_faction_core(FACTION_ID, FACTION_API_KEY)
    war = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY)  # aliased from *_effort

    f_name = core.get("name")
    f_tag = core.get("tag")
    f_respect = core.get("respect")

    members = core.get("members", []) or []
    rows = []
    available_count = 0

    for m in members:
        torn_id = str(m.get("id") or "")
        name = m.get("name") or f"#{torn_id}"

        last_action_iso = None
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

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": mins,
            "status": status,     # online / idle / offline
            "available": is_available
        })

    # Sort: online (most recent first), then idle, then offline
    def sort_key(r):
        bucket = {"online": 0, "idle": 1, "offline": 2}.get(r["status"], 3)
        mins = r["minutes"] if isinstance(r["minutes"], int) else 999999
        return (bucket, mins)

    rows.sort(key=sort_key)

    w = war or {}
    war_obj = {
        "opponent": w.get("opponent"),
        "start": w.get("start"),
        "end": w.get("end"),
        "target": w.get("target"),
        "score": w.get("score"),
        "enemy_score": w.get("enemy_score"),
    }

    chain_obj = w.get("chain") or {}
    chain = {
        "current": chain_obj.get("current"),
        "max": chain_obj.get("max"),
        "timeout": chain_obj.get("timeout"),
        "cooldown": chain_obj.get("cooldown"),
    }

    STATE.update({
        "rows": rows,
        "updated_at": iso_now(),
        "faction": {"name": f_name, "tag": f_tag, "respect": f_respect},
        "war": war_obj,
        "chain": chain,
        "available_count": available_count,
        "last_error": None
    })


def poll_loop():
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


# ---------- Routes ----------
@app.route("/health")
def health():
    return jsonify({"ok": True, "updated_at": STATE.get("updated_at"), "last_error": STATE.get("last_error")})

@app.route("/state")
def state():
    return jsonify(STATE)

@app.route("/api/availability", methods=["POST"])
def api_availability():
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
def home():
    return Response(
        """
        <!doctype html>
        <html><head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>7DS*: Wrath War-Bot</title>
          <style>
            body{margin:0;background:#0a0708;color:#eee;font-family:Arial}
            .wrap{padding:16px;max-width:760px;margin:0 auto}
            .box{background:#151112;border:1px solid #3a1518;border-radius:14px;padding:14px}
            a{color:#ffcc66}
            code{color:#ffcc66}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="box">
              <h2 style="margin:0 0 10px 0;">🛡️ 7DS*: Wrath War-Bot</h2>
              <div>Open the CSP-proof panel:</div>
              <div style="margin-top:10px;"><a href="/lite">/lite</a></div>
              <div style="margin-top:10px; font-size:12px; opacity:.85;">
                Put your background image at <code>static/wrath-bg.jpg</code> (or set env <code>LITE_BG</code>)
              </div>
            </div>
          </div>
        </body></html>
        """,
        mimetype="text/html"
    )

@app.route("/lite")
def lite():
    # ✅ Uses your background image from /static (LITE_BG)
    return Response(f"""
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>7DS*: Wrath — War-Bot (Lite)</title>
  <style>
    :root {{
      --gold:#d7b35a;
      --ember:#ff3b30;
      --line: rgba(255,60,50,.28);
      --glass: rgba(0,0,0,.62);
    }}
    body {{
      margin:0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color:#fff;
      background:
        linear-gradient(rgba(0,0,0,.78), rgba(0,0,0,.86)),
        url('{LITE_BG}') center center / cover no-repeat fixed;
    }}
    .wrap {{ max-width: 980px; margin: 0 auto; padding: 14px; }}
    .banner {{
      background: linear-gradient(180deg, rgba(255,59,48,.20), rgba(0,0,0,.55));
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px 14px;
      box-shadow: 0 12px 35px rgba(0,0,0,.55);
    }}
    .title {{ display:flex; align-items:center; gap:10px; }}
    .crest {{
      width:36px;height:36px;border-radius:12px;
      display:grid;place-items:center;
      border:1px solid rgba(215,179,90,.28);
      background: radial-gradient(circle at 30% 30%, rgba(215,179,90,.18), rgba(255,59,48,.12), rgba(0,0,0,.6));
      color:var(--gold);
      font-weight:900;
      box-shadow: 0 0 22px rgba(255,59,48,.25);
    }}
    h1 {{ margin:0; font-size:16px; color: var(--gold); letter-spacing:.6px; }}
    .sub {{ margin-top:4px; font-size:12px; opacity:.85; }}

    .grid {{ display:grid; grid-template-columns: 1fr; gap:10px; margin-top:12px; }}
    @media (min-width: 820px) {{ .grid {{ grid-template-columns: 1fr 1fr; }} }}

    .card {{
      background: var(--glass);
      border:1px solid var(--line);
      border-radius:16px;
      padding:12px;
      backdrop-filter: blur(6px);
      box-shadow: 0 12px 35px rgba(0,0,0,.55);
    }}
    .card h2 {{
      margin:0 0 8px 0;
      font-size:13px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    }}
    .pill {{
      font-size:11px;
      padding:4px 8px;
      border-radius:999px;
      border:1px solid rgba(215,179,90,.22);
      color:var(--gold);
      background: rgba(215,179,90,.08);
    }}

    .row {{ display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-top:1px solid rgba(255,255,255,.08); }}
    .row:first-of-type {{ border-top:none; }}
    .k {{ opacity:.85; font-size:12px; }}
    .v {{ font-size:12px; text-align:right; }}

    .members {{ display:flex; flex-direction:column; gap:8px; margin-top:6px; }}
    .m {{
      background: rgba(0,0,0,.45);
      border:1px solid rgba(255,60,50,.18);
      border-radius:14px;
      padding:9px 10px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
    }}
    .left {{ display:flex; align-items:center; gap:10px; min-width:0; }}
    .dot {{ width:10px; height:10px; border-radius:999px; box-shadow: 0 0 0 3px rgba(255,255,255,.05); flex:0 0 auto; }}
    .dot.online {{ background:#2cff6f; }}
    .dot.idle {{ background:#ffcc00; }}
    .dot.offline {{ background:#ff4444; }}

    .name {{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 280px; }}
    .meta {{ font-size:11px; opacity:.85; }}

    .footer {{
      margin-top:10px;
      font-size:11px;
      opacity:.85;
      display:flex;
      justify-content:space-between;
      gap:10px;
    }}
    .err {{
      margin-top:10px;
      padding:10px;
      border-radius:14px;
      border:1px solid rgba(255,59,48,.35);
      background: rgba(255,59,48,.08);
      color:#ffd6d3;
      font-size:12px;
      white-space:pre-wrap;
      display:none;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="banner">
      <div class="title">
        <div class="crest">7</div>
        <div>
          <h1>7DS*: Wrath — War-Bot (Lite)</h1>
          <div class="sub">Open in a new tab from the shield (no iframe = no CSP errors).</div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>⚔ War Status <span class="pill" id="updated">—</span></h2>
        <div class="row"><div class="k">Opponent</div><div class="v" id="opponent">—</div></div>
        <div class="row"><div class="k">Target</div><div class="v" id="target">—</div></div>
        <div class="row"><div class="k">Your Score</div><div class="v" id="score">—</div></div>
        <div class="row"><div class="k">Enemy Score</div><div class="v" id="enemy">—</div></div>
      </div>

      <div class="card">
        <h2>🟢 Online / 🟡 Idle / 🔴 Offline <span class="pill" id="counts">—</span></h2>
        <div class="members" id="members"></div>
      </div>
    </div>

    <div id="err" class="err"></div>

    <div class="footer">
      <div id="faction">—</div>
      <div>Auto-refresh: 15s</div>
    </div>
  </div>

<script>
  function esc(s) {{
    return (s ?? "").toString().replace(/[&<>"']/g, m => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[m]));
  }}

  async function loadState() {{
    try {{
      const res = await fetch("/state", {{ cache: "no-store" }});
      const data = await res.json();

      document.getElementById("updated").textContent = data.updated_at ? "Updated" : "Waiting";

      const f = data.faction || {{}};
      document.getElementById("faction").textContent =
        (f.tag ? `[${{esc(f.tag)}}] ` : "") + (f.name ? esc(f.name) : "Faction") + (f.respect ? ` • Respect ${{f.respect}}` : "");

      const w = data.war || {{}};
      document.getElementById("opponent").textContent = w.opponent ? esc(w.opponent) : "No active war";
      document.getElementById("target").textContent = (w.target ?? "—");
      document.getElementById("score").textContent = (w.score ?? "—");
      document.getElementById("enemy").textContent = (w.enemy_score ?? "—");

      const rows = data.rows || [];
      let online=0, idle=0, offline=0;

      const wrap = document.getElementById("members");
      wrap.innerHTML = "";

      rows.forEach(r => {{
        const st = r.status || "offline";
        if (st === "online") online++;
        else if (st === "idle") idle++;
        else offline++;

        const mins = (typeof r.minutes === "number") ? `${{r.minutes}}m` : "—";

        const el = document.createElement("div");
        el.className = "m";
        el.innerHTML = `
          <div class="left">
            <div class="dot ${{st}}"></div>
            <div style="min-width:0;">
              <div class="name">${{esc(r.name)}}</div>
              <div class="meta">Last action: ${{mins}} • ID: ${{esc(r.id)}}</div>
            </div>
          </div>
          <div class="meta" style="text-align:right;">
            ${{st.toUpperCase()}}<br>
            <span style="color:var(--gold);">
              ${{st==="online"?"0–20m":(st==="idle"?"21–30m":"31m+")}}
            </span>
          </div>
        `;
        wrap.appendChild(el);
      }});

      document.getElementById("counts").textContent = `🟢 ${{online}}  🟡 ${{idle}}  🔴 ${{offline}}`;

      const errBox = document.getElementById("err");
      if (data.last_error) {{
        errBox.style.display = "block";
        errBox.textContent = "Last error:\\n" + JSON.stringify(data.last_error, null, 2);
      }} else {{
        errBox.style.display = "none";
      }}
    }} catch (e) {{
      const errBox = document.getElementById("err");
      errBox.style.display = "block";
      errBox.textContent = "Failed to load /state\\n" + (e?.message || e);
    }}
  }}

  loadState();
  setInterval(loadState, 15000);
</script>

</body>
</html>
""", mimetype="text/html")


if __name__ == "__main__":
    init_db()
    threading.Thread(target=poll_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
