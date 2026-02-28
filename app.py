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

# Optional: require token for availability posting
AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()

# Chain sitters allowlist (ONLY these Torn IDs can opt in/out)
CHAIN_SITTER_IDS_RAW = (os.getenv("CHAIN_SITTER_IDS") or "1234").strip()


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


STATE = {
    "rows": [],
    "online_rows": [],
    "idle_rows": [],
    "offline_rows": [],
    "updated_at": None,

    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},

    # ✅ ALWAYS PRESENT
    "war": {"opponent": None, "start": None, "end": None, "target": None, "active": None},

    # ✅ DEBUG so you can see what API returns
    "war_debug": None,

    "online_count": 0,
    "idle_count": 0,
    "offline_count": 0,

    # online + idle (from last action)
    "available_count": 0,

    # chain sitters opted-in only
    "opted_in_count": 0,

    "faction": {"name": None, "tag": None, "respect": None},
    "last_error": None,
}


def ensure_state_shape():
    """Guarantee all expected keys exist before /state or UI reads them."""
    STATE.setdefault("rows", [])
    STATE.setdefault("online_rows", [])
    STATE.setdefault("idle_rows", [])
    STATE.setdefault("offline_rows", [])
    STATE.setdefault("updated_at", None)
    STATE.setdefault("last_error", None)

    STATE.setdefault("chain", {"current": None, "max": None, "timeout": None, "cooldown": None})
    if not isinstance(STATE.get("chain"), dict):
        STATE["chain"] = {"current": None, "max": None, "timeout": None, "cooldown": None}
    for k in ("current", "max", "timeout", "cooldown"):
        STATE["chain"].setdefault(k, None)

    if not isinstance(STATE.get("war"), dict):
        STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None, "active": None}
    for k in ("opponent", "start", "end", "target", "active"):
        STATE["war"].setdefault(k, None)

    STATE.setdefault("war_debug", None)

    STATE.setdefault("online_count", 0)
    STATE.setdefault("idle_count", 0)
    STATE.setdefault("offline_count", 0)
    STATE.setdefault("available_count", 0)
    STATE.setdefault("opted_in_count", 0)

    STATE.setdefault("faction", {"name": None, "tag": None, "respect": None})
    if not isinstance(STATE.get("faction"), dict):
        STATE["faction"] = {"name": None, "tag": None, "respect": None}
    for k in ("name", "tag", "respect"):
        STATE["faction"].setdefault(k, None)


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
    """
    Supports members returned as:
      - list of dicts
      - dict keyed by user_id -> dict
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


def parse_ranked_war_entry(war_data: dict):
    """
    Return ONE ranked war entry dict.
    Common shape:
      {"rankedwars": {"123": {"war": {...}, "factions": {...}}, ...}}
    Prefer active if detectable else newest.
    """
    if not isinstance(war_data, dict) or not war_data or war_data.get("error"):
        return None

    rankedwars = war_data.get("rankedwars", war_data.get("ranked_wars", war_data))
    wars_list = []

    if isinstance(rankedwars, dict):
        for _, entry in rankedwars.items():
            if isinstance(entry, dict):
                wars_list.append(entry)
    elif isinstance(rankedwars, list):
        wars_list = [x for x in rankedwars if isinstance(x, dict)]

    if not wars_list:
        return None

    def start_val(entry):
        war = entry.get("war") if isinstance(entry.get("war"), dict) else {}
        s = war.get("start")
        try:
            return int(s) if s is not None else 0
        except Exception:
            return 0

    def is_active(entry):
        if "active" in entry:
            return bool(entry.get("active"))
        war = entry.get("war") if isinstance(entry.get("war"), dict) else {}
        end = war.get("end")
        try:
            end_i = int(end) if end is not None else None
        except Exception:
            end_i = None
        return end_i in (0, None)

    active = [w for w in wars_list if is_active(w)]
    pick = active if active else wars_list
    pick.sort(key=start_val, reverse=True)
    return pick[0]


def ranked_war_to_state(entry: dict):
    out = {"opponent": None, "start": None, "end": None, "target": None, "active": None}
    if not isinstance(entry, dict):
        return out

    war = entry.get("war") if isinstance(entry.get("war"), dict) else {}
    out["start"] = war.get("start") or entry.get("start") or entry.get("start_time")
    out["end"] = war.get("end") or entry.get("end") or entry.get("end_time")
    out["target"] = war.get("target") or entry.get("target")
    out["active"] = entry.get("active") if "active" in entry else None

    # ✅ opponent via factions
    factions = entry.get("factions") if isinstance(entry.get("factions"), dict) else None
    if factions and FACTION_ID:
        for fid, fobj in factions.items():
            if str(fid) == str(FACTION_ID):
                continue
            if isinstance(fobj, dict):
                out["opponent"] = fobj.get("name") or fobj.get("tag") or str(fid)
            else:
                out["opponent"] = str(fid)
            break

    # fallback
    if not out["opponent"]:
        opp = entry.get("opponent")
        if isinstance(opp, dict):
            out["opponent"] = opp.get("name") or opp.get("tag") or opp.get("id")
        out["opponent"] = out["opponent"] or entry.get("opponent_name") or entry.get("enemy") or entry.get("opponent")

    return out


def war_from_core_fallback(core: dict):
    """
    If ranked war isn't available, try common faction payload areas.
    """
    out = {"opponent": None, "start": None, "end": None, "target": None, "active": None}
    if not isinstance(core, dict):
        return out

    warfare = core.get("warfare")
    if isinstance(warfare, dict) and warfare:
        out["start"] = warfare.get("start") or (warfare.get("war") or {}).get("start")
        out["end"] = warfare.get("end") or (warfare.get("war") or {}).get("end")
        out["target"] = warfare.get("target") or (warfare.get("war") or {}).get("target") or warfare.get("war_id") or warfare.get("id")

        opp = warfare.get("opponent")
        if isinstance(opp, dict):
            out["opponent"] = opp.get("name") or opp.get("tag") or opp.get("id")
        out["opponent"] = out["opponent"] or warfare.get("opponent_name") or warfare.get("enemy") or warfare.get("opponent")

        if out["start"] or out["end"] or out["target"] or out["opponent"]:
            return out

    wars = core.get("wars")
    if isinstance(wars, dict) and wars:
        w = list(wars.values())[0]
        if isinstance(w, dict):
            out["start"] = w.get("start")
            out["end"] = w.get("end")
            out["target"] = w.get("target") or w.get("war_id") or w.get("id")

            opp = w.get("opponent")
            if isinstance(opp, dict):
                out["opponent"] = opp.get("name") or opp.get("tag") or opp.get("id")
            out["opponent"] = out["opponent"] or w.get("opponent_name") or w.get("opponent")

            if out["start"] or out["end"] or out["target"] or out["opponent"]:
                return out

    return out


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

                    STATE["opted_in_count"] = sum(1 for r in rows if r.get("is_chain_sitter") and r.get("opted_in"))

                    online_rows, idle_rows, offline_rows = [], [], []
                    for r in rows:
                        b = r.get("activity_bucket") or "offline"
                        if b == "online":
                            online_rows.append(r)
                        elif b == "idle":
                            idle_rows.append(r)
                        else:
                            offline_rows.append(r)

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

                    # ✅ WAR baseline
                    STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None, "active": None}
                    STATE["war_debug"] = None

                    # 1) ranked war best effort
                    war_data = await get_ranked_war_best_effort(FACTION_ID, FACTION_API_KEY)
                    STATE["war_debug"] = war_data  # so /state shows what API returns

                    entry = parse_ranked_war_entry(war_data)
                    if entry:
                        STATE["war"] = ranked_war_to_state(entry)
                    else:
                        # 2) fallback to anything core might have (warfare/wars)
                        fb = war_from_core_fallback(core or {})
                        if fb and (fb.get("opponent") or fb.get("start") or fb.get("end") or fb.get("target")):
                            STATE["war"] = fb

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
                text = (
                    "🛡️ **War-Bot Update**\n"
                    f"Faction: {faction_label()}\n"
                    f"Chain: {c.get('current')}/{c.get('max')}\n"
                    f"War: {w.get('opponent') or '—'}\n"
                    f"Chain sitter opted-in: {STATE.get('opted_in_count')}\n"
                    f"Last action → Online(0–20m): {STATE.get('online_count')} | Idle(21–30m): {STATE.get('idle_count')} | Offline(31m+): {STATE.get('offline_count')}\n"
                    f"Panel: {panel_url()}\n"
                    f"Updated: {STATE.get('updated_at') or '—'}"
                )
            try:
                await send_webhook_message(text)
                set_setting("LAST_POST_TS", str(time.time()))
            except Exception as e:
                STATE["last_error"] = {"code": -3, "error": f"Webhook failed: {repr(e)}"}
                STATE["updated_at"] = now_iso()

        # smart ping
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
                        f"⚔️ **War Update**: Opponent = **{opp}**\n"
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


app = Flask(__name__)


@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
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
      <div class="pill" id="p_on">🟢 Online: —</div>
      <div class="pill" id="p_idle">🟡 Idle: —</div>
      <div class="pill" id="p_off">🔴 Offline: —</div>
      <div class="pill" id="p_opt">Chain sitter opted-in: —</div>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;" class="gold">🟢 Online (0–20m, sorted newest)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_on"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;" class="gold">🟡 Idle (21–30m, sorted newest)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_idle"></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:800; margin-bottom:8px;">🔴 Offline (31m+, sorted newest)</div>
    <div style="overflow:auto;">
      <table>
        <thead><tr><th>Member</th><th>Lvl</th><th>Last action</th><th>Status</th><th>Opt</th></tr></thead>
        <tbody id="rows_off"></tbody>
      </table>
    </div>
  </div>

<script>
function minutesFromLastAction(lastAction){
  const s = (lastAction || '').toLowerCase().trim();
  if (!s) return 1000000000;
  if (s.includes('just now') || s === 'now') return 0;
  const m = s.match(/(\\d+)\\s*(second|minute|hour|day|week|month|year)s?\\s*ago/i);
  if (!m) return 1000000000;
  const qty = parseInt(m[1], 10);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'second') return 0;
  if (unit === 'minute') return qty;
  if (unit === 'hour') return qty * 60;
  if (unit === 'day') return qty * 1440;
  if (unit === 'week') return qty * 10080;
  if (unit === 'month') return qty * 43200;
  if (unit === 'year') return qty * 525600;
  return 1000000000;
}

function bucketFromMinutes(mins){
  if (mins <= 20) return 'online';
  if (mins > 20 && mins <= 30) return 'idle';
  return 'offline';
}

function dotClass(kind){
  if (kind === 'online') return 'dot g';
  if (kind === 'idle') return 'dot y';
  return 'dot r';
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
  document.getElementById('chain').textContent = `Chain: ${c.current ?? '—'}/${c.max ?? '—'}`;

  const w = s.war || {};
  const activeTxt = (w.active === true) ? ' (active)' : '';
  document.getElementById('war').textContent =
    `War: ${(w.opponent || '—')}${activeTxt} | Start: ${(w.start ?? '—')} | End: ${(w.end ?? '—')}`;

  document.getElementById('p_on').textContent   = `🟢 Online: ${s.online_count ?? 0}`;
  document.getElementById('p_idle').textContent = `🟡 Idle: ${s.idle_count ?? 0}`;
  document.getElementById('p_off').textContent  = `🔴 Offline: ${s.offline_count ?? 0}`;
  document.getElementById('p_opt').textContent  = `Chain sitter opted-in: ${s.opted_in_count ?? 0}`;

  const fill = (id, arr) => {
    const tb = document.getElementById(id);
    tb.innerHTML = '';
    (arr || []).slice(0, 350).forEach(x=>{
      const opt = (x.is_chain_sitter && x.opted_in) ? '✅' : '—';
      const mins = minutesFromLastAction(x.last_action);
      const kind = bucketFromMinutes(mins);
      const sitterTag = x.is_chain_sitter ? '<span class="tag">CS</span>' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="namecell"><span class="${dotClass(kind)}"></span><span>${x.name||''}</span>${sitterTag}</div></td>
        <td>${x.level??''}</td>
        <td>${x.last_action||''}</td>
        <td>${x.status||''}</td>
        <td>${opt}</td>
      `;
      tb.appendChild(tr);
    });
  };

  fill('rows_on', s.online_rows || []);
  fill('rows_idle', s.idle_rows || []);
  fill('rows_off', s.offline_rows || []);
}
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>
"""

@app.get("/")
def home():
    return Response(HTML, mimetype="text/html")


def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()


if __name__ == "__main__":
    init_db()
    start_poll_thread()
    app.run(host="0.0.0.0", port=PORT)
