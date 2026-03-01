# app.py  ✅ Single Render service (Flask + background poll thread)
# - /           : Panel (iframe-safe for torn.com)
# - /state      : JSON state (for debugging / overlay)
# - /health     : simple healthcheck
# - /api/availability : chain-sitter opt in/out (protected optional token)
# - /api/view   : toggle between ours/enemy (ours|enemy)
#
# FIXES:
# ✅ Torn iframe: remove X-Frame-Options + CSP frame-ancestors
# ✅ Gunicorn/Web Service: poll thread starts under gunicorn (before_request boot)
# ✅ Panel: 2 columns (OK vs Hospital) + hospital timer sorted (lowest top, highest bottom)
# ✅ NEW: 🎯 Bounty button per member (opens Torn bounty add page)
# ✅ NEW: Toggle view (Our faction vs Enemy faction from ranked war opponent)

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

# ===== ENV =====
FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()
PUBLIC_BASE_URL = (os.getenv("PUBLIC_BASE_URL") or "").strip()
DISCORD_WEBHOOK_URL = (os.getenv("DISCORD_WEBHOOK_URL") or "").strip()

PORT = int(os.getenv("PORT", "10000"))

POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "30"))
POST_INTERVAL_SECONDS = int(os.getenv("POST_INTERVAL_SECONDS", "120"))

SMART_PING_MIN_ONLINE = int(os.getenv("SMART_PING_MIN_ONLINE", "5"))
SMART_PING_MENTION = (os.getenv("SMART_PING_MENTION") or "@here").strip()
SMART_PING_COOLDOWN_SECONDS = int(os.getenv("SMART_PING_COOLDOWN_SECONDS", "600"))

CHAIN_TIMEOUT_ALERT_SECONDS = int(os.getenv("CHAIN_TIMEOUT_ALERT_SECONDS", "600"))
CHAIN_TIMEOUT_COOLDOWN_SECONDS = int(os.getenv("CHAIN_TIMEOUT_COOLDOWN_SECONDS", "600"))

WAR_ALERT_COOLDOWN_SECONDS = int(os.getenv("WAR_ALERT_COOLDOWN_SECONDS", "600"))

# Optional: protect availability endpoint
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()

# Chain sitters allowlist (ONLY these Torn IDs can opt in/out)
CHAIN_SITTER_IDS_RAW = (os.getenv("CHAIN_SITTER_IDS") or "1234").strip()


# ===== helpers =====
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


def unix_now() -> int:
    return int(time.time())


def panel_url():
    return (PUBLIC_BASE_URL.rstrip("/") + "/") if PUBLIC_BASE_URL else "(set PUBLIC_BASE_URL)"


async def send_webhook_message(content: str):
    if not DISCORD_WEBHOOK_URL:
        return
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        await session.post(DISCORD_WEBHOOK_URL, json={"content": content})


def should_fire(key: str, cooldown_seconds: int) -> bool:
    last = get_alert_state(key, "0")
    try:
        last_i = int(float(last))
    except Exception:
        last_i = 0
    return (unix_now() - last_i) >= cooldown_seconds


def mark_fired(key: str):
    set_alert_state(key, str(unix_now()))


def faction_label():
    f = STATE.get("faction") or {}
    tag = f.get("tag")
    name = f.get("name") or "—"
    return f"[{tag}] {name}" if tag else name


# ========= LAST ACTION -> minutes + bucket =========
_RE_LAST_ACTION = re.compile(r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago", re.I)


def last_action_minutes(last_action_text: str) -> int:
    s = (last_action_text or "").strip().lower()
    if not s:
        return 10**9
    if "just now" in s or s == "now":
        return 0

    m = _RE_LAST_ACTION.search(s)
    if not m:
        return 10**9

    qty = int(m.group(1))
    unit = m.group(2).lower()

    if unit == "second":
        return 0
    if unit == "minute":
        return qty
    if unit == "hour":
        return qty * 60
    if unit == "day":
        return qty * 1440
    if unit == "week":
        return qty * 10080
    if unit == "month":
        return qty * 43200
    if unit == "year":
        return qty * 525600

    return 10**9


def last_action_bucket_from_minutes(minutes: int) -> str:
    if minutes <= 20:
        return "online"
    if 20 < minutes <= 30:
        return "idle"
    return "offline"


# ========= Torn parsing =========
def safe_member_rows(data: dict):
    members = (data or {}).get("members")
    rows = []

    def _add(m, uid_hint=None):
        if not isinstance(m, dict):
            return
        mid = m.get("id") or m.get("torn_id") or m.get("user_id") or uid_hint
        try:
            mid = int(mid) if mid is not None else None
        except Exception:
            mid = None

        last_action = m.get("last_action")
        if isinstance(last_action, dict):
            last_action = last_action.get("relative") or str(last_action.get("timestamp") or "")

        status = m.get("status")
        if isinstance(status, dict):
            status = status.get("description") or status.get("state") or str(status)

        rows.append(
            {
                "torn_id": mid,
                "name": m.get("name"),
                "level": m.get("level"),
                "last_action": last_action if isinstance(last_action, str) else (str(last_action) if last_action is not None else ""),
                "status": status if isinstance(status, str) else (str(status) if status is not None else ""),
            }
        )

    if isinstance(members, list):
        for m in members:
            _add(m)
    elif isinstance(members, dict):
        for uid, m in members.items():
            _add(m, uid_hint=uid)

    return rows


def merge_availability(rows):
    avail_map = get_availability_map()
    out = []
    for r in rows:
        tid = r.get("torn_id")
        a = avail_map.get(int(tid)) if tid is not None and str(tid).isdigit() else None

        r2 = dict(r)

        chain_sitter = False
        if tid is not None and str(tid).isdigit():
            chain_sitter = is_chain_sitter(int(tid))

        r2["is_chain_sitter"] = chain_sitter
        r2["opted_in"] = (bool(a["available"]) if a else False) if chain_sitter else False
        r2["opted_updated_at"] = (a["updated_at"] if a else None) if chain_sitter else None

        mins = last_action_minutes(r2.get("last_action") or "")
        r2["last_action_minutes"] = mins
        r2["activity_bucket"] = last_action_bucket_from_minutes(mins)

        out.append(r2)
    return out


def parse_ranked_war_entry(war_data: dict):
    if not isinstance(war_data, dict) or not war_data or war_data.get("error"):
        return None

    rankedwars = war_data.get("rankedwars")
    if not isinstance(rankedwars, list) or not rankedwars:
        return None

    def is_active(w):
        try:
            return int(w.get("end", 0)) == 0
        except Exception:
            return False

    def start_ts(w):
        try:
            return int(w.get("start", 0))
        except Exception:
            return 0

    active = [w for w in rankedwars if isinstance(w, dict) and is_active(w)]
    pick = active if active else [w for w in rankedwars if isinstance(w, dict)]
    if not pick:
        return None

    pick.sort(key=start_ts, reverse=True)
    return pick[0]


def compute_war_timers(start_ts, end_ts, now_ts):
    starts_in = started_ago = ends_in = ended_ago = None

    try:
        s = int(start_ts) if start_ts is not None else None
    except Exception:
        s = None
    try:
        e = int(end_ts) if end_ts is not None else None
    except Exception:
        e = None

    n = int(now_ts)

    if s is None:
        return None, None, None, None

    if s > n:
        starts_in = s - n
        return starts_in, None, None, None

    started_ago = n - s

    if e is None or e == 0:
        return None, started_ago, None, None

    if e > n:
        ends_in = e - n
        return None, started_ago, ends_in, None

    ended_ago = n - e
    return None, started_ago, None, ended_ago


def ranked_war_to_state(entry: dict):
    out = {
        "opponent": None,
        "opponent_id": None,
        "start": None,
        "end": None,
        "target": None,
        "active": None,
        "our_score": None,
        "opp_score": None,
        "our_chain": None,
        "opp_chain": None,
        "war_id": None,
        "server_now": unix_now(),
        "starts_in": None,
        "started_ago": None,
        "ends_in": None,
        "ended_ago": None,
    }
    if not isinstance(entry, dict):
        return out

    out["war_id"] = entry.get("id")
    out["start"] = entry.get("start")
    out["end"] = entry.get("end")
    out["target"] = entry.get("target")

    try:
        e = int(entry.get("end", 0))
        out["active"] = (e == 0) or (e > out["server_now"])
    except Exception:
        out["active"] = None

    factions = entry.get("factions")
    our = None
    opp = None

    if isinstance(factions, list) and FACTION_ID:
        for f in factions:
            if not isinstance(f, dict):
                continue
            fid = f.get("id")
            if fid is None:
                continue
            if str(fid) == str(FACTION_ID):
                our = f
            else:
                opp = f

    if our:
        out["our_score"] = our.get("score")
        out["our_chain"] = our.get("chain")

    if opp:
        out["opponent"] = opp.get("name") or str(opp.get("id"))
        out["opponent_id"] = opp.get("id")
        out["opp_score"] = opp.get("score")
        out["opp_chain"] = opp.get("chain")

    starts_in, started_ago, ends_in, ended_ago = compute_war_timers(out["start"], out["end"], out["server_now"])
    out["starts_in"] = starts_in
    out["started_ago"] = started_ago
    out["ends_in"] = ends_in
    out["ended_ago"] = ended_ago
    return out


def ensure_state_shape():
    STATE.setdefault("rows", [])
    STATE.setdefault("updated_at", None)
    STATE.setdefault("chain", {"current": None, "max": None, "timeout": None, "cooldown": None})
    STATE.setdefault("war", {})
    for k in (
        "opponent", "opponent_id", "start", "end", "target", "active",
        "our_score", "opp_score", "our_chain", "opp_chain", "war_id",
        "server_now", "starts_in", "started_ago", "ends_in", "ended_ago",
    ):
        STATE["war"].setdefault(k, None)

    for k in ("online_count", "idle_count", "offline_count", "available_count", "opted_in_count"):
        STATE.setdefault(k, 0)

    STATE.setdefault("faction", {"name": None, "tag": None, "respect": None})
    STATE.setdefault("last_error", None)
    STATE.setdefault("war_debug", None)

    # NEW: toggle + enemy snapshot
    STATE.setdefault("view", "ours")
    STATE.setdefault("enemy", {
        "faction": {"name": None, "tag": None, "respect": None},
        "rows": [],
        "online_count": 0,
        "idle_count": 0,
        "offline_count": 0,
        "available_count": 0,
    })


STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {
        "opponent": None,
        "opponent_id": None,
        "start": None,
        "end": None,
        "target": None,
        "active": None,
        "our_score": None,
        "opp_score": None,
        "our_chain": None,
        "opp_chain": None,
        "war_id": None,
        "server_now": None,
        "starts_in": None,
        "started_ago": None,
        "ends_in": None,
        "ended_ago": None,
    },
    "online_count": 0,
    "idle_count": 0,
    "offline_count": 0,
    "available_count": 0,
    "opted_in_count": 0,
    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
    "war_debug": None,

    # NEW
    "view": "ours",
    "enemy": {
        "faction": {"name": None, "tag": None, "respect": None},
        "rows": [],
        "online_count": 0,
        "idle_count": 0,
        "offline_count": 0,
        "available_count": 0,
    },
}


# ===== background poll =====
async def poll_loop():
    ensure_state_shape()
    while True:
        ensure_state_shape()
        if not FACTION_ID or not FACTION_API_KEY:
            STATE["last_error"] = {"code": -1, "error": "Missing FACTION_ID or FACTION_API_KEY"}
            STATE["updated_at"] = now_iso()
        else:
            try:
                # ===== OUR FACTION =====
                core = await get_faction_core(FACTION_ID, FACTION_API_KEY)

                if isinstance(core, dict) and core.get("error"):
                    STATE["last_error"] = core["error"]
                    STATE["updated_at"] = now_iso()
                else:
                    basic = (core or {}).get("basic") or {}
                    chain = (core or {}).get("chain") or {}

                    STATE["faction"] = {
                        "name": basic.get("name"),
                        "tag": basic.get("tag"),
                        "respect": basic.get("respect"),
                    }

                    rows = merge_availability(safe_member_rows(core or {}))
                    STATE["opted_in_count"] = sum(1 for r in rows if r.get("is_chain_sitter") and r.get("opted_in"))

                    online_count = 0
                    idle_count = 0
                    offline_count = 0
                    for r in rows:
                        b = r.get("activity_bucket") or "offline"
                        if b == "online":
                            online_count += 1
                        elif b == "idle":
                            idle_count += 1
                        else:
                            offline_count += 1

                    STATE["rows"] = rows
                    STATE["online_count"] = online_count
                    STATE["idle_count"] = idle_count
                    STATE["offline_count"] = offline_count
                    STATE["available_count"] = online_count + idle_count

                    STATE["chain"] = {
                        "current": chain.get("current"),
                        "max": chain.get("max"),
                        "timeout": chain.get("timeout"),
                        "cooldown": chain.get("cooldown"),
                    }

                    # ===== WAR =====
                    war_data = await get_ranked_war_best_effort(FACTION_ID, FACTION_API_KEY)
                    STATE["war_debug"] = war_data
                    entry = parse_ranked_war_entry(war_data)
                    if entry:
                        STATE["war"] = ranked_war_to_state(entry)
                    else:
                        STATE["war"] = {
                            "opponent": None,
                            "opponent_id": None,
                            "start": None,
                            "end": None,
                            "target": None,
                            "active": None,
                            "our_score": None,
                            "opp_score": None,
                            "our_chain": None,
                            "opp_chain": None,
                            "war_id": None,
                            "server_now": unix_now(),
                            "starts_in": None,
                            "started_ago": None,
                            "ends_in": None,
                            "ended_ago": None,
                        }

                    # ===== ENEMY FACTION (opponent roster) =====
                    enemy_id = (STATE.get("war") or {}).get("opponent_id")
                    if enemy_id:
                        try:
                            enemy_core = await get_faction_core(str(enemy_id), FACTION_API_KEY)
                            if not (isinstance(enemy_core, dict) and enemy_core.get("error")):
                                ebasic = (enemy_core or {}).get("basic") or {}
                                erows = merge_availability(safe_member_rows(enemy_core or {}))

                                e_online = e_idle = e_off = 0
                                for r in erows:
                                    b = r.get("activity_bucket") or "offline"
                                    if b == "online":
                                        e_online += 1
                                    elif b == "idle":
                                        e_idle += 1
                                    else:
                                        e_off += 1

                                STATE["enemy"] = {
                                    "faction": {
                                        "name": ebasic.get("name"),
                                        "tag": ebasic.get("tag"),
                                        "respect": ebasic.get("respect"),
                                    },
                                    "rows": erows,
                                    "online_count": e_online,
                                    "idle_count": e_idle,
                                    "offline_count": e_off,
                                    "available_count": e_online + e_idle,
                                }
                        except Exception:
                            # don't break main panel if enemy fetch fails
                            pass
                    else:
                        STATE["enemy"] = {
                            "faction": {"name": None, "tag": None, "respect": None},
                            "rows": [],
                            "online_count": 0,
                            "idle_count": 0,
                            "offline_count": 0,
                            "available_count": 0,
                        }

                    STATE["updated_at"] = now_iso()
                    STATE["last_error"] = None

            except Exception as e:
                STATE["last_error"] = {"code": -2, "error": f"Torn request failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()


# ===== Flask app =====
app = Flask(__name__)

# ---------- GUNICORN SAFE BOOT ----------
_bg_started = False
_bg_lock = threading.Lock()


def ensure_background_started():
    global _bg_started
    if _bg_started:
        return
    with _bg_lock:
        if _bg_started:
            return
        init_db()
        start_poll_thread()
        _bg_started = True


@app.before_request
def _boot():
    ensure_background_started()
# ----------------------------------------


@app.after_request
def allow_iframe(resp):
    for h in ["X-Frame-Options", "x-frame-options"]:
        resp.headers.pop(h, None)

    resp.headers["Content-Security-Policy"] = (
        "frame-ancestors 'self' https://torn.com https://www.torn.com https://*.torn.com;"
    )

    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/state")
def state():
    ensure_state_shape()
    return jsonify(STATE)


@app.get("/health")
def health():
    return jsonify({"ok": True, "time": now_iso()})


@app.post("/api/view")
def api_view():
    data = request.get_json(silent=True) or {}
    v = (data.get("view") or "").strip().lower()
    if v not in ("ours", "enemy"):
        return jsonify({"ok": False, "error": "bad_view"}), 400
    STATE["view"] = v
    return jsonify({"ok": True, "view": v})


@app.post("/api/availability")
def api_availability():
    if AV
