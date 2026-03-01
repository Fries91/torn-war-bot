import os
import time
import threading
import asyncio
from datetime import datetime, timezone

from flask import Flask, jsonify, request, Response
from dotenv import load_dotenv

from db import init_db, upsert_availability, get_availability_map
from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()

FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()   # 666
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "25"))

app = Flask(__name__)

STATE = {
    "rows": [],
    "updated_at": None,
    "faction": {"name": None, "tag": None, "respect": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None, "score": None, "enemy_score": None},
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "available_count": 0,
    "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
    "last_error": None
}

BOOTED = False
POLL_THREAD = None


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def status_from_last_action(mins):
    # Online=0-20, Idle=21-30, Offline=31+
    if mins is None:
        return "offline"
    if mins <= 20:
        return "online"
    if mins <= 30:
        return "idle"
    return "offline"


def require_token_if_set(req):
    if not AVAIL_TOKEN:
        return True
    token = (req.headers.get("X-Token") or req.args.get("token") or "").strip()
    return token == AVAIL_TOKEN


@app.after_request
def headers(resp):
    resp.headers.pop("Content-Security-Policy", None)
    resp.headers.pop("X-Frame-Options", None)
    return resp


def _read_minutes_from_member(m: dict):
    """
    Supports multiple Torn shapes:
    - last_action: {seconds: 123}
    - last_action: {timestamp_iso: "..."} etc
    """
    la = m.get("last_action")

    # common v2: last_action.seconds
    if isinstance(la, dict):
        secs = la.get("seconds")
        if isinstance(secs, (int, float)):
            return int(secs // 60)

        # fallback: try parsing ISO-ish
        iso = la.get("timestamp_iso") or la.get("timestamp") or la.get("time") or la.get("date")
        if isinstance(iso, str):
            try:
                s = iso.replace("Z", "+00:00")
                dt = datetime.fromisoformat(s)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return int((datetime.now(timezone.utc) - dt).total_seconds() // 60)
            except Exception:
                return None

    # sometimes last_action is directly a string
    if isinstance(la, str):
        try:
            s = la.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int((datetime.now(timezone.utc) - dt).total_seconds() // 60)
        except Exception:
            return None

    return None


def _read_hospital(m: dict):
    """
    v2 members often have:
      status: {state: "Hospital", until: <unix> or "timestamp" ...}
    We'll store hospital boolean + until (best effort).
    """
    st = m.get("status")
    hospital = False
    until = None

    if isinstance(st, dict):
        state = (st.get("state") or st.get("status") or "").lower()
        if "hospital" in state:
            hospital = True
        # "until" may be unix seconds or string; keep raw
        until = st.get("until") or st.get("timestamp") or st.get("time") or st.get("date")

    # sometimes status is string
    if isinstance(st, str):
        if "hospital" in st.lower():
            hospital = True

    return hospital, until


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

    members = core.get("members") or {}
    members_iter = members.values() if isinstance(members, dict) else members

    rows = []
    available_count = 0
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}

    for m in members_iter:
        torn_id = str(m.get("id") or m.get("torn_id") or "")
        name = m.get("name") or f"#{torn_id}"

        mins = _read_minutes_from_member(m)
        base_status = status_from_last_action(mins)

        hospital, hospital_until = _read_hospital(m)
        final_status = "hospital" if hospital else base_status

        if final_status == "hospital":
            counts["hospital"] += 1
        elif final_status == "online":
            counts["online"] += 1
        elif final_status == "idle":
            counts["idle"] += 1
        else:
            counts["offline"] += 1

        db_rec = avail_map.get(int(torn_id)) if torn_id.isdigit() else None
        is_available = bool(db_rec and db_rec.get("available"))
        if is_available:
            available_count += 1

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": mins,
            "status": final_status,          # online / idle / offline / hospital
            "hospital": hospital,
            "hospital_until": hospital_until,
            "available": is_available
        })

    # Sort: hospital first, then online, idle, offline; most recent action near top
    def sort_key(r):
        bucket = {"hospital": 0, "online": 1, "idle": 2, "offline": 3}.get(r["status"], 9)
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
        "counts": counts,
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
    # token protected, anyone can opt
    if not require_token_if_set(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    torn_id = str(data.get("torn_id") or "").strip()
    available = bool(data.get("available", False))
    name = str(data.get("name") or "").strip()

    if not torn_id.isdigit():
        return jsonify({"ok": False, "error": "invalid_torn_id"}), 400

    if not name:
        existing = (get_availability_map() or {}).get(int(torn_id))
        name = (existing or {}).get("name") or f"#{torn_id}"

    upsert_availability(int(torn_id), name, available, iso_now())
    return jsonify({"ok": True, "torn_id": torn_id, "available": available, "name": name})


@app.route("/")
def home():
    return Response(
        "<h3 style='font-family:Arial'>7DS*: Wrath War-Bot OK</h3><div>/state • /health • /api/availability</div>",
        mimetype="text/html"
    )


if __name__ == "__main__":
    init_db()
    threading.Thread(target=poll_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")))
