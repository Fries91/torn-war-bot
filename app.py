# app.py
# Web Service + Gunicorn safe
# Torn iframe safe
# Background poll thread safe

import os
import time
import threading
import asyncio
import re
from datetime import datetime

from flask import Flask, jsonify, Response, request
from dotenv import load_dotenv
import aiohttp

from db import (
    init_db, upsert_availability, get_availability_map,
    get_setting, set_setting,
    get_alert_state, set_alert_state
)
from torn_api import get_faction_core, get_ranked_war_best_effort

load_dotenv()

# ================== ENV ==================
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PORT = int(os.getenv("PORT", "10000"))
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()
CHAIN_SITTER_IDS_RAW = (os.getenv("CHAIN_SITTER_IDS") or "1234").strip()


# ================== HELPERS ==================
def _parse_id_set(csv: str) -> set[int]:
    out = set()
    for part in (csv or "").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.add(int(part))
        except Exception:
            pass
    return out


CHAIN_SITTER_IDS = _parse_id_set(CHAIN_SITTER_IDS_RAW)


def is_chain_sitter(torn_id: int) -> bool:
    return torn_id in CHAIN_SITTER_IDS


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


def unix_now():
    return int(time.time())


# ================== STATE ==================
STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {},
    "war": {},
    "online_count": 0,
    "idle_count": 0,
    "offline_count": 0,
    "available_count": 0,
    "opted_in_count": 0,
    "faction": {},
    "last_error": None,
}


# ================== POLL LOOP ==================
async def poll_loop():
    while True:
        try:
            core = await get_faction_core(FACTION_ID, FACTION_API_KEY)

            basic = (core or {}).get("basic") or {}
            chain = (core or {}).get("chain") or {}

            STATE["faction"] = {
                "name": basic.get("name"),
                "tag": basic.get("tag"),
                "respect": basic.get("respect"),
            }

            rows = (core or {}).get("members") or {}
            STATE["rows"] = list(rows.values()) if isinstance(rows, dict) else rows

            STATE["chain"] = {
                "current": chain.get("current"),
                "max": chain.get("max"),
                "timeout": chain.get("timeout"),
                "cooldown": chain.get("cooldown"),
            }

            war_data = await get_ranked_war_best_effort(FACTION_ID, FACTION_API_KEY)
            STATE["war"] = war_data or {}

            STATE["updated_at"] = now_iso()
            STATE["last_error"] = None

        except Exception as e:
            STATE["last_error"] = {"error": str(e)}
            STATE["updated_at"] = now_iso()

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start_poll_thread():
    loop = asyncio.new_event_loop()
    threading.Thread(
        target=lambda: loop.run_until_complete(poll_loop()),
        daemon=True
    ).start()


# ================== FLASK ==================
app = Flask(__name__)


# Torn iframe fix (CRITICAL)
@app.after_request
def allow_iframe(resp):
    # Remove ALL X-Frame-Options variants
    for h in ["X-Frame-Options", "x-frame-options"]:
        resp.headers.pop(h, None)

    # Allow Torn embedding
    resp.headers["Content-Security-Policy"] = (
        "frame-ancestors 'self' "
        "https://torn.com "
        "https://www.torn.com "
        "https://*.torn.com;"
    )

    # Helps some proxies
    resp.headers["X-Frame-Options"] = "ALLOWALL"

    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/state")
def state():
    return jsonify(STATE)


@app.get("/health")
def health():
    return jsonify({"ok": True, "time": now_iso()})


@app.post("/api/availability")
def api_availability():
    if AVAIL_TOKEN:
        tok = (request.headers.get("X-Avail-Token") or "").strip()
        if tok != AVAIL_TOKEN:
            return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    torn_id = data.get("torn_id")
    available = bool(data.get("available"))

    if torn_id is None:
        return jsonify({"ok": False, "error": "missing torn_id"}), 400

    try:
        torn_id = int(torn_id)
    except Exception:
        return jsonify({"ok": False, "error": "invalid torn_id"}), 400

    if not is_chain_sitter(torn_id):
        return jsonify({"ok": False, "error": "not_chain_sitter"}), 403

    upsert_availability(
        torn_id=torn_id,
        name=data.get("name", ""),
        available=available,
        updated_at=now_iso()
    )

    return jsonify({"ok": True})


# ================== HTML ==================
HTML = "<h1 style='color:white;background:black;padding:20px;'>7DS*: Wrath War-Bot Live</h1>"


@app.get("/")
def home():
    return Response(HTML, mimetype="text/html")


# ================== STARTUP ==================
init_db()
start_poll_thread()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
