# app.py  ✅ Single Render service (Flask + background poll thread)
# - /           : Panel (iframe-safe for torn.com)
# - /state      : JSON state (for debugging / overlay)
# - /health     : simple healthcheck
# - /api/availability : chain-sitter opt in/out (protected optional token)
#
# IMPORTANT FIX FOR "Ask the owner":
#   We REMOVE X-Frame-Options and use CSP frame-ancestors to allow torn.com to iframe.

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
    """
    Returns minutes since last action.
    Unknown/unparseable -> very large number (sorts to bottom).
    """
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
    # Online = 0–20 mins, Idle = 21–30, Offline = 31+
    if minutes <= 20:
        return "online"
    if 20 < minutes <= 30:
        return "idle"
    return "offline"


# ========= Torn parsing =========
def safe_member_rows(data: dict):
    """
    Torn faction "members" is sometimes a dict keyed by user id.
    This supports both dict + list formats.
    """
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

        rows.append({
            "torn_id": mid,
            "name": m.get("name"),
            "level": m.get("level"),
            "last_action": last_action if isinstance(last_action, str) else (str(last_action) if last_action is not None else ""),
            "status": status if isinstance(status, str) else (str(status) if status is not None else ""),
        })

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
    """
    Picks the active ranked war if present (end==0), else the most recent by start.
    war_data is expected to have war_data["rankedwars"] as a list.
    """
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
    """
    NO 'phase' returned.
    We only return timer fields, and the UI infers upcoming/active/ended.
    """
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
    STATE.setdefault("online_rows", [])
    STATE.setdefault("idle_rows", [])
    STATE.setdefault("offline_rows", [])
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


STATE = {
    "rows": [],
    "online_rows": [],
    "idle_rows": [],
    "offline_rows": [],
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

                    # Chain sitters only
                    STATE["opted_in_count"] = sum(1 for r in rows if r.get("is_chain_sitter") and r.get("opted_in"))

                    # split by activity bucket (based on last action minutes)
                    online_rows, idle_rows, offline_rows = [], [], []
                    for r in rows:
                        b = r.get("activity_bucket") or "offline"
                        if b == "online":
                            online_rows.append(r)
                        elif b == "idle":
                            idle_rows.append(r)
                        else:
                            offline_rows.append(r)

                    # SORT MOST RECENT FIRST (smallest minutes first)
                    online_rows.sort(key=lambda x: x.get("last_action_minutes", 10**9))
                    idle_rows.sort(key=lambda x: x.get("last_action_minutes", 10**9))
                    offline_rows.sort(key=lambda x: x.get("last_action_minutes", 10**9))

                    STATE["rows"] = rows
                    STATE["online_rows"] = online_rows
                    STATE["idle_rows"] = idle_rows
                    STATE["offline_rows"] = offline_rows

                    STATE["online_count"] = len(online_rows)
                    STATE["idle_count"] = len(idle_rows)
                    STATE["offline_count"] = len(offline_rows)
                    STATE["available_count"] = STATE["online_count"] + STATE["idle_count"]

                    STATE["chain"] = {
                        "current": chain.get("current"),
                        "max": chain.get("max"),
                        "timeout": chain.get("timeout"),
                        "cooldown": chain.get("cooldown"),
                    }

                    # ranked war (scores + timers; NO phase)
                    war_data = await get_ranked_war_best_effort(FACTION_ID, FACTION_API_KEY)
                    STATE["war_debug"] = war_data
                    entry = parse_ranked_war_entry(war_data)
                    if entry:
                        STATE["war"] = ranked_war_to_state(entry)
                    else:
                        STATE["war"] = {
                            "opponent": None, "opponent_id": None,
                            "start": None, "end": None, "target": None, "active": None,
                            "our_score": None, "opp_score": None,
                            "our_chain": None, "opp_chain": None,
                            "war_id": None,
                            "server_now": unix_now(),
                            "starts_in": None, "started_ago": None, "ends_in": None, "ended_ago": None,
                        }

                    STATE["updated_at"] = now_iso()
                    STATE["last_error"] = None

            except Exception as e:
                STATE["last_error"] = {"code": -2, "error": f"Torn request failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # webhook update (throttled)
        try:
            last_post = get_setting("LAST_POST_TS", "0")
            last_post_f = float(last_post) if last_post else 0.0
        except Exception:
            last_post_f = 0.0

        if DISCORD_WEBHOOK_URL and (time.time() - last_post_f) >= POST_INTERVAL_SECONDS:
            err = STATE.get("last_error")
            if err:
                text = (
                    "🛡️ **War-Bot (ERROR)**\n"
                    f"Faction: {faction_label()}\n"
                    f"Error: `{err}`\n"
                    f"Panel: {panel_url()}\n"
                    f"Updated: {STATE.get('updated_at') or '—'}"
                )
            else:
                c = STATE.get("chain") or {}
                w = STATE.get("war") or {}

                score = f"{w.get('our_score') or '—'}–{w.get('opp_score') or '—'}"
                target = w.get("target") or "—"

                text = (
                    "🛡️ **War-Bot Update**\n"
                    f"Faction: {faction_label()}\n"
                    f"Chain: {c.get('current')}/{c.get('max')} (timeout {c.get('timeout')}s)\n"
                    f"War: {w.get('opponent') or '—'} | Score: {score} | Target: {target}\n"
                    f"Online(0–20m): {STATE.get('online_count')} | Idle(21–30m): {STATE.get('idle_count')} | Offline(31m+): {STATE.get('offline_count')}\n"
                    f"Panel: {panel_url()}\n"
                    f"Updated: {STATE.get('updated_at') or '—'}"
                )
            try:
                await send_webhook_message(text)
                set_setting("LAST_POST_TS", str(time.time()))
            except Exception as e:
                STATE["last_error"] = {"code": -3, "error": f"Webhook failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # smart ping (online+idle) throttled
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                onlineish = int(STATE.get("available_count") or 0)
                if onlineish >= SMART_PING_MIN_ONLINE and should_fire("SMART_PING", SMART_PING_COOLDOWN_SECONDS):
                    await send_webhook_message(
                        f"{SMART_PING_MENTION} 🟢 **Smart Ping**: {onlineish} active (online/idle by last action).\n"
                        f"Faction: {faction_label()}\n"
                        f"Panel: {panel_url()}"
                    )
                    mark_fired("SMART_PING")
        except Exception:
            pass

        # chain timeout alert
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                timeout = STATE.get("chain", {}).get("timeout")
                if isinstance(timeout, (int, float)) and timeout > 0 and timeout <= CHAIN_TIMEOUT_ALERT_SECONDS:
                    if should_fire("CHAIN_TIMEOUT", CHAIN_TIMEOUT_COOLDOWN_SECONDS):
                        c = STATE.get("chain") or {}
                        await send_webhook_message(
                            f"⏳ **Chain Timeout Soon**: ~{int(timeout)}s remaining.\n"
                            f"Faction: {faction_label()}\n"
                            f"Chain: {c.get('current')}/{c.get('max')}\n"
                            f"Panel: {panel_url()}"
                        )
                        mark_fired("CHAIN_TIMEOUT")
        except Exception:
            pass

        # war opponent change alert
        try:
            if DISCORD_WEBHOOK_URL and STATE.get("last_error") is None:
                opp = (STATE.get("war") or {}).get("opponent") or ""
                prev = get_alert_state("WAR_OPPONENT", "")
                if opp and opp != prev and should_fire("WAR_CHANGE", WAR_ALERT_COOLDOWN_SECONDS):
                    await send_webhook_message(
                        f"⚔️ **Ranked War Update**: Opponent = **{opp}**\n"
                        f"Faction: {faction_label()}\n"
                        f"Panel: {panel_url()}"
                    )
                    set_alert_state("WAR_OPPONENT", opp)
                    mark_fired("WAR_CHANGE")
        except Exception:
            pass

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()


# ===== Flask app =====
app = Flask(__name__)


@app.after_request
def allow_iframe(resp):
    """
    CRITICAL: Fixes Torn "Ask the owner" iframe block.
    Remove X-Frame-Options completely and allow torn.com via CSP frame-ancestors.
    """
    resp.headers.pop("X-Frame-Options", None)
    resp.headers["Content-Security-Policy"] = "frame-ancestors https://*.torn.com https://torn.com;"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/state")
def state():
    ensure_state_shape()
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
    name = (data.get("name") or "")[:64]
    available = bool(data.get("available"))

    if torn_id is None:
        return jsonify({"ok": False, "error": "missing torn_id"}), 400

    try:
        torn_id = int(torn_id)
    except Exception:
        return jsonify({"ok": False, "error": "invalid torn_id"}), 400

    # Chain sitter gate
    if not is_chain_sitter(torn_id):
        return jsonify({"ok": False, "error": "not_chain_sitter"}), 403

    upsert_availability(torn_id=torn_id, name=name, available=available, updated_at=now_iso())
    return jsonify({"ok": True})


HTML = """<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>7DS*: Wrath War-Bot</title>
<style>
  body { font-family: Arial, sans-serif; margin: 12px; background:#0b0b0f; color:#fff; }
  .card { background:#151521; border:1px solid #2a2a3a; border-radius:12px; padding:12px; margin-bottom:10px; }
  .muted { opacity:0.75; font-size: 12px; }
  table { width:100%; border-collapse: collapse; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid #2a2a3a; font-size: 13px; vertical-align: middle; }
  th { opacity:0.85; }
  .pill { display:inline-block; padding:2px 10px; border:1px solid #2a2a3a; border-radius:999px; font-size:12px; opacity:0.95; }
  .err { color:#ffb4b4; }
  .gold { color:#ffd86a; }
  .grid { display:flex; gap:10px; flex-wrap:wrap; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; }
  .g { background:#3dff86; box-shadow: 0 0 10px rgba(61,255,134,0.35); }
  .y { background:#ffd86a; box-shadow: 0 0 10px rgba(255,216,106,0.28); }
  .r { background:#ff4b4b; box-shadow: 0 0 10px rgba(255,75,75,0.28); }
  .namecell { display:flex; align-items:center; }
  .tag { font-size: 11px; opacity: 0.75; margin-left: 8px; }
  .tiny { font-size: 11px; opacity: 0.75; }
</style>
</head>
<body>
  <div class="card">
    <div id="title" style="font-weight:800; font-size:16px;">
      <span class="gold">7DS*: Wrath</span> War-Bot
    </div>
    <div class="muted" id="updated">Loading…</div>
    <div class="muted err" id="err"></div>
  </div>

  <div class="card">
    <div class="grid">
      <div class="pill" id="chain">Chain: —</div>
      <div class="pill" id="war">War: —</div>
      <div class="pill" id="war_score">Score: —</div>
      <div class="pill" id="war_target">Target: —</div>
      <div class="pill" id="war_progress">Progress: —</div>
      <div class="pill" id="war_time">Time: —</div>
      <div class="pill" id="p_on">🟢 Online: —</div>
      <div class="pill" id="p_idle">🟡 Idle: —</div>
      <div class="pill" id="p_off">🔴 Offline: —</div>
      <div class="pill" id="p_opt">Chain sitter opted-in: —</div>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;" class="gold">🟢 Online (0–20m, LIVE)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_on"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;" class="gold">🟡 Idle (21–30m, LIVE)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_idle"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;">🔴 Offline (31m+, LIVE)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_off"></tbody>
      </table>
    </div>
  </div>

<script>
function fmtDur(sec){
  sec = Math.max(0, Math.floor(sec || 0));
  const d = Math.floor(sec / 86400); sec %= 86400;
  const h = Math.floor(sec / 3600);  sec %= 3600;
  const m = Math.floor(sec / 60);    sec %= 60;
  const parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  parts.push(sec + "s");
  return parts.join(" ");
}

function dotClass(kind){
  if (kind === 'online') return 'dot g';
  if (kind === 'idle') return 'dot y';
  return 'dot r';
}

function bucketFromMinutes(mins){
  if (mins <= 20) return 'online';
  if (mins > 20 && mins <= 30) return 'idle';
  return 'offline';
}

// ===== LIVE war timer state (NO phase) =====
let warStartsIn = null;
let warStartedAgo = null;
let warEndsIn = null;
let warEndedAgo = null;

function warKind(){
  // Infer upcoming/active/ended based on which timers exist
  if (warStartsIn != null) return "upcoming";
  if (warEndedAgo != null) return "ended";
  // default: active (even if unknown)
  return "active";
}

function renderWarTime(){
  let t = "Time: —";
  const kind = warKind();

  if (kind === "upcoming" && warStartsIn != null) {
    t = `Time: starts in ${fmtDur(warStartsIn)}`;
  } else if (kind === "active") {
    const started = (warStartedAgo != null) ? `started ${fmtDur(warStartedAgo)} ago` : "started";
    const ends = (warEndsIn != null) ? ` | ends in ${fmtDur(warEndsIn)}` : "";
    t = `Time: ${started}${ends}`;
  } else if (kind === "ended" && warEndedAgo != null) {
    t = `Time: ended ${fmtDur(warEndedAgo)} ago`;
  }

  document.getElementById('war_time').textContent = t;
}

function tickWarTime(){
  const kind = warKind();

  if (kind === "upcoming") {
    if (warStartsIn != null) {
      warStartsIn = Math.max(0, warStartsIn - 1);
      if (warStartsIn === 0) { warStartsIn = null; warStartedAgo = 0; }
    }
  } else if (kind === "active") {
    if (warStartedAgo != null) warStartedAgo += 1;
    if (warEndsIn != null) {
      warEndsIn = Math.max(0, warEndsIn - 1);
      if (warEndsIn === 0) { warEndsIn = null; warEndedAgo = 0; }
    }
  } else if (kind === "ended") {
    if (warEndedAgo != null) warEndedAgo += 1;
  }

  renderWarTime();
}

function pct(n, d){
  n = Number(n); d = Number(d);
  if (!isFinite(n) || !isFinite(d) || d <= 0) return null;
  const p = Math.max(0, Math.min(100, (n / d) * 100));
  return Math.round(p);
}

// ===== LIVE members =====
let latestRows = [];
let rowsFetchedAtMs = 0;

function elapsedSeconds(){
  if (!rowsFetchedAtMs) return 0;
  return Math.max(0, (Date.now() - rowsFetchedAtMs) / 1000);
}

function liveMinutes(baseMinutes){
  const e = elapsedSeconds();
  const inc = e / 60.0;
  const v = (baseMinutes == null) ? 1000000000 : baseMinutes;
  if (v >= 1000000000) return v;
  return v + inc;
}

function liveLastActionText(minsFloat){
  if (minsFloat >= 1000000000) return "—";
  const totalSec = Math.floor(minsFloat * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s ago`;
  return `${m}m ${s}s ago`;
}

function renderMemberTables(){
  const online = [];
  const idle = [];
  const off = [];

  for (const r of (latestRows || [])) {
    const mins = liveMinutes(r.last_action_minutes);
    const kind = bucketFromMinutes(mins);
    const rr = Object.assign({}, r, {
      _live_mins: mins,
      _kind: kind,
      _live_text: liveLastActionText(mins)
    });
    if (kind === "online") online.push(rr);
    else if (kind === "idle") idle.push(rr);
    else off.push(rr);
  }

  const sortFn = (a,b)=> (a._live_mins || 1e9) - (b._live_mins || 1e9);
  online.sort(sortFn);
  idle.sort(sortFn);
  off.sort(sortFn);

  document.getElementById('p_on').textContent   = `🟢 Online: ${online.length}`;
  document.getElementById('p_idle').textContent = `🟡 Idle: ${idle.length}`;
  document.getElementById('p_off').textContent  = `🔴 Offline: ${off.length}`;

  const fill = (id, arr) => {
    const tb = document.getElementById(id);
    tb.innerHTML = '';
    (arr || []).slice(0, 350).forEach(x=>{
      const opt = (x.is_chain_sitter && x.opted_in) ? '✅' : '—';
      const sitterTag = x.is_chain_sitter ? '<span class="tag">CS</span>' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="namecell"><span class="${dotClass(x._kind)}"></span><span>${x.name||''}</span>${sitterTag}</div></td>
        <td>${x.level??''}</td>
        <td title="${(x.last_action || '').replace(/"/g,'&quot;')}">${x._live_text}</td>
        <td>${x.status||''}</td>
        <td>${opt}</td>
      `;
      tb.appendChild(tr);
    });
  };

  fill('rows_on', online);
  fill('rows_idle', idle);
  fill('rows_off', off);
}

function tickMembers(){
  if (!latestRows || latestRows.length === 0) return;
  renderMemberTables();
}

async function refresh(){
  const r = await fetch('/state');
  const s = await r.json();

  const f = s.faction || {};
  document.getElementById('title').innerHTML =
    `<span class="gold">${(f.tag ? '['+f.tag+'] ' : '') + (f.name || '7DS*: Wrath')}</span> War-Bot`;

  document.getElementById('updated').textContent = 'Updated: ' + (s.updated_at || '—');
  document.getElementById('err').textContent = s.last_error ? ('Error: ' + JSON.stringify(s.last_error)) : '';

  const c = s.chain || {};
  document.getElementById('chain').textContent =
    `Chain: ${c.current ?? '—'}/${c.max ?? '—'} (timeout: ${c.timeout ?? '—'}s)`;

  const w = s.war || {};
  const opp = (w.opponent || '—');
  document.getElementById('war').textContent =
    `War: ${opp}`;

  // score + chains
  const ourScore = (w.our_score ?? null);
  const oppScore = (w.opp_score ?? null);
  const ourChain = (w.our_chain ?? '—');
  const oppChain = (w.opp_chain ?? '—');

  document.getElementById('war_score').textContent =
    `Score: ${(ourScore ?? '—')}–${(oppScore ?? '—')} | Chains: ${ourChain}–${oppChain}`;

  // target + progress vs target (LIVE via refresh)
  const target = (w.target ?? null);
  document.getElementById('war_target').textContent =
    `Target: ${(target ?? '—')}`;

  const pOur = pct(ourScore, target);
  const pOpp = pct(oppScore, target);
  const progText =
    (pOur != null || pOpp != null)
      ? `Progress: ${(ourScore ?? '—')}/${(target ?? '—')} (${pOur ?? '—'}%) vs ${(oppScore ?? '—')}/${(target ?? '—')} (${pOpp ?? '—'}%)`
      : `Progress: —`;
  document.getElementById('war_progress').textContent = progText;

  // timers (NO phase)
  warStartsIn = (w.starts_in != null) ? Math.max(0, Math.floor(w.starts_in)) : null;
  warStartedAgo = (w.started_ago != null) ? Math.max(0, Math.floor(w.started_ago)) : null;
  warEndsIn = (w.ends_in != null) ? Math.max(0, Math.floor(w.ends_in)) : null;
  warEndedAgo = (w.ended_ago != null) ? Math.max(0, Math.floor(w.ended_ago)) : null;
  renderWarTime();

  document.getElementById('p_opt').textContent  = `Chain sitter opted-in: ${s.opted_in_count ?? 0}`;

  latestRows = (s.rows || []);
  rowsFetchedAtMs = Date.now();
  renderMemberTables();
}

refresh();
setInterval(refresh, 10000);
setInterval(tickWarTime, 1000);
setInterval(tickMembers, 1000);
</script>
</body>
</html>
"""


@app.get("/")
def home():
    return Response(HTML, mimetype="text/html")


if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=PORT)
