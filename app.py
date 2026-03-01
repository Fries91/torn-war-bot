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

FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()

AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()   # yours = 666
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "25"))

# Chain sitter IDs (comma-separated), ex: "1234,5678"
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "1234").split(",") if s.strip()]
CHAIN_SITTER_SET = set(CHAIN_SITTER_IDS)

app = Flask(__name__)

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


@app.after_request
def headers(resp):
    # We are NOT iframing anything anymore, but keeping this harmless.
    resp.headers.pop("Content-Security-Policy", None)
    resp.headers.pop("X-Frame-Options", None)
    return resp


async def poll_once():
    global STATE

    if not FACTION_ID or not FACTION_API_KEY:
        STATE["last_error"] = {"error": "Missing FACTION_ID or FACTION_API_KEY env var", "at": iso_now()}
        return

    avail_map = get_availability_map() or {}

    core = await get_faction_core(FACTION_ID, FACTION_API_KEY)
    war_norm = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY) or {}

    f_name = core.get("name")
    f_tag = core.get("tag")
    f_respect = core.get("respect")

    members = core.get("members") or []
    members_iter = members.values() if isinstance(members, dict) else members

    rows = []
    available_count = 0

    for m in members_iter:
        torn_id = str(m.get("id") or m.get("torn_id") or "")
        name = m.get("name") or f"#{torn_id}"

        la = m.get("last_action")
        mins = None
        if isinstance(la, dict):
            secs = la.get("seconds")
            if isinstance(secs, (int, float)):
                mins = int(secs / 60)
            else:
                last_action_iso = la.get("timestamp_iso") or la.get("timestamp") or la.get("time") or la.get("date")
                mins = minutes_since(last_action_iso)
        elif isinstance(la, str):
            mins = minutes_since(la)

        status = status_from_last_action(mins)

        db_rec = avail_map.get(int(torn_id)) if torn_id.isdigit() else None
        is_available = bool(db_rec and db_rec.get("available"))
        if is_available:
            available_count += 1

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": mins,
            "status": status,
            "available": is_available
        })

    # Sort: online first, then idle, then offline — most recent on top
    def sort_key(r):
        bucket = {"online": 0, "idle": 1, "offline": 2}.get(r["status"], 3)
        mins2 = r["minutes"] if isinstance(r["minutes"], int) else 999999
        return (bucket, mins2)

    rows.sort(key=sort_key)

    war_obj = {
        "opponent": war_norm.get("opponent"),
        "start": war_norm.get("start"),
        "end": war_norm.get("end"),
        "target": war_norm.get("target"),
        "score": war_norm.get("score"),
        "enemy_score": war_norm.get("enemy_score"),
    }

    chain_obj = war_norm.get("chain") or {}
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


@app.route("/health")
def health():
    return jsonify({"ok": True, "updated_at": STATE.get("updated_at"), "last_error": STATE.get("last_error")})


@app.route("/state")
def state():
    return jsonify(STATE)


@app.route("/api/availability", methods=["POST"])
def api_availability():
    """
    POST JSON: {"torn_id":"1234","available":true,"name":"PopZ"}
    - requires token if AVAIL_TOKEN set (yours=666)
    - only allows chain sitters (CHAIN_SITTER_IDS env)
    """
    if not require_token_if_set(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    torn_id = str(data.get("torn_id") or "").strip()
    available = bool(data.get("available", False))
    name = str(data.get("name") or "").strip()

    if not torn_id.isdigit():
        return jsonify({"ok": False, "error": "invalid_torn_id"}), 400

    if not require_chain_sitter(torn_id):
        return jsonify({"ok": False, "error": "not_chain_sitter"}), 403

    if not name:
        existing = (get_availability_map() or {}).get(int(torn_id))
        name = (existing or {}).get("name") or f"#{torn_id}"

    upsert_availability(int(torn_id), name, available, iso_now())
    return jsonify({"ok": True, "torn_id": torn_id, "available": available, "name": name})


@app.route("/")
def home():
    # Minimal landing
    return Response(
        """
        <!doctype html>
        <html><head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>7DS*: Wrath War-Bot</title>
          <style>
            body{margin:0;background:#0a0708;color:#eee;font-family:Arial}
            .wrap{padding:16px;max-width:820px;margin:0 auto}
            .box{background:#151112;border:1px solid #3a1518;border-radius:14px;padding:14px}
            a{color:#ffcc66}
            code{color:#ffcc66}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="box">
              <h2 style="margin:0 0 10px 0;">🛡️ 7DS*: Wrath War-Bot</h2>
              <div>This service powers the in-game overlay. Endpoints:</div>
              <ul>
                <li><code>/health</code></li>
                <li><code>/state</code></li>
                <li><code>/api/availability</code></li>
              </ul>
            </div>
          </div>
        </body></html>
        """,
        mimetype="text/html"
    )


if __name__ == "__main__":
    init_db()
    threading.Thread(target=poll_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
