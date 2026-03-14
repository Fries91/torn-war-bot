import inspect
import os
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory

from db import (
    init_db,
    upsert_user,
    get_user,
    get_user_map_by_faction,
    create_session,
    get_session,
    touch_session,
    delete_session,
    delete_sessions_for_user,
    set_availability,
    set_chain_sitter,
    list_med_deals_for_faction,
    add_med_deal,
    delete_med_deal,
    list_targets,
    add_target,
    delete_target,
    list_bounties,
    add_bounty,
    delete_bounty,
    list_notifications,
    add_notification,
    mark_notifications_seen,
    save_war_snapshot,
    list_recent_war_snapshots,
    get_enemy_state_map,
    upsert_enemy_state,
    list_target_assignments_for_war,
    upsert_target_assignment,
    delete_target_assignment,
    list_war_notes,
    upsert_war_note,
    delete_war_note,
    get_war_terms,
    upsert_war_terms,
    delete_war_terms,
    get_user_setting,
    set_user_setting,
    add_audit_log,
    ensure_faction_license_row,
    start_faction_trial_if_needed,
    compute_faction_license_status,
    renew_faction_after_payment,
    get_faction_payment_history,
    force_expire_faction_license,
    list_all_faction_licenses,
    get_faction_admin_dashboard_summary,
    list_faction_members,
    get_faction_member_access,
    upsert_faction_member_access,
    set_faction_member_enabled,
    delete_faction_member_access,
)

from torn_api import (
    me_basic,
    faction_basic,
    ranked_war_summary,
    profile_url,
    attack_url,
    bounty_url,
)

load_dotenv()

APP_NAME = "War Hub"
PAYMENT_PLAYER = str(os.getenv("PAYMENT_PLAYER", "Fries91")).strip() or "Fries91"
FACTION_MEMBER_PRICE = int(os.getenv("PAYMENT_PER_MEMBER", "2500000"))
DEFAULT_REFRESH_SECONDS = int(os.getenv("DEFAULT_REFRESH_SECONDS", "30"))
LICENSE_ADMIN_TOKEN = str(os.getenv("LICENSE_ADMIN_TOKEN", "")).strip()
ALLOWED_SCRIPT_ORIGINS = {
    "https://www.torn.com",
    "https://torn.com",
    "",
}

app = Flask(__name__, static_folder="static")


def BASE_URL() -> str:
    return str(os.getenv("PUBLIC_BASE_URL", "")).strip()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ok(data: Optional[Dict[str, Any]] = None, **kwargs):
    payload = {"ok": True}
    if data:
        payload.update(data)
    payload.update(kwargs)
    return jsonify(payload)


def err(message: str, status: int = 400, **kwargs):
    payload = {"ok": False, "error": message}
    payload.update(kwargs)
    return jsonify(payload), status


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    s = str(value or "").strip().lower()
    return s in {"1", "true", "yes", "y", "on", "enabled"}


def _require_json() -> Dict[str, Any]:
    if request.is_json:
        return request.get_json(silent=True) or {}

    data = request.form.to_dict() or {}
    if data:
        return data

    if request.data:
        try:
            import json
            parsed = json.loads(request.data.decode("utf-8"))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    return {}


def _check_request_origin() -> bool:
    origin = str(request.headers.get("Origin", "")).strip()
    referer = str(request.headers.get("Referer", "")).strip()

    if origin and origin not in ALLOWED_SCRIPT_ORIGINS:
        return False

    allowed_prefixes = (
        "https://www.torn.com",
        "https://torn.com",
    )
    if BASE_URL():
        allowed_prefixes = allowed_prefixes + (BASE_URL(),)

    if referer and not any(referer.startswith(x) for x in allowed_prefixes):
        return False

    return True


def _require_license_admin():
    header_token = str(request.headers.get("X-License-Admin", "")).strip()
    bearer = str(request.headers.get("Authorization", "")).strip()

    auth_token = header_token
    if not auth_token and bearer.lower().startswith("bearer "):
        auth_token = bearer[7:].strip()

    if not LICENSE_ADMIN_TOKEN:
        return False, err("LICENSE_ADMIN_TOKEN is not configured on the server.", 503)

    if auth_token != LICENSE_ADMIN_TOKEN:
        return False, err("Unauthorized admin request.", 401)

    return True, None


def with_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*") or "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-License-Admin, X-Session-Token"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return resp


@app.after_request
def _after(resp):
    return with_cors(resp)


@app.route("/api/<path:_path>", methods=["OPTIONS"])
@app.route("/<path:_path>", methods=["OPTIONS"])
def api_options(_path: str):
    return with_cors(ok(message="ok"))


def _session_user():
    token = str(request.headers.get("Authorization", "")).replace("Bearer ", "").strip()
    if not token:
        token = str(request.args.get("token", "")).strip()
    if not token:
        token = str(request.headers.get("X-Session-Token", "")).strip()
    if not token:
        return None, None

    sess = get_session(token)
    if not sess:
        return None, None

    touch_session(token)
    user = get_user(sess.get("user_id"))
    if not user:
        return None, None

    return sess, user


def require_session(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if request.method == "OPTIONS":
            return with_cors(ok(message="ok"))

        if not _check_request_origin():
            return err("Blocked request origin.", 403)

        sess, user = _session_user()
        if not sess or not user:
            return err("Unauthorized.", 401)

        request.session = sess
        request.user = user
        return fn(*args, **kwargs)

    return wrapper


def _owner_ids() -> set:
    raw = str(os.getenv("OWNER_USER_IDS", "")).strip()
    out = set()
    if raw:
        for x in raw.split(","):
            x = x.strip()
            if x:
                out.add(x)

    owner_id = str(os.getenv("OWNER_USER_ID", "")).strip()
    if owner_id:
        out.add(owner_id)

    return out


def _owner_names() -> set:
    raw = str(os.getenv("OWNER_NAMES", "")).strip()
    out = set()
    if raw:
        for x in raw.split(","):
            x = x.strip().lower()
            if x:
                out.add(x)

    owner_name = str(os.getenv("OWNER_NAME", "")).strip().lower()
    if owner_name:
        out.add(owner_name)

    out.add("fries91")
    return out


def _session_is_owner(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    uid = str(user.get("user_id", "")).strip()
    name = str(user.get("name", "")).strip().lower()
    return (uid and uid in _owner_ids()) or (name and name in _owner_names())


def _build_license_status_payload(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    status = compute_faction_license_status(faction_id, viewer_user_id=viewer_user_id) or {}
    status["faction_id"] = str(status.get("faction_id") or faction_id or "")
    status["payment_player"] = PAYMENT_PLAYER
    status["faction_member_price"] = FACTION_MEMBER_PRICE
    return status


def _can_manage_faction(user: Dict[str, Any], faction_id: str) -> bool:
    if _session_is_owner(user):
        return True

    user_id = str((user or {}).get("user_id") or "").strip()
    faction_id = str(faction_id or "").strip()
    if not user_id or not faction_id:
        return False

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id)
    leader_user_id = str(license_status.get("leader_user_id") or "").strip()
    return leader_user_id == user_id


def require_owner(fn):
    @wraps(fn)
    @require_session
    def wrapper(*args, **kwargs):
        if not _session_is_owner(request.user):
            return err("Owner access only.", 403)
        return fn(*args, **kwargs)

    return wrapper


def require_leader_session(fn):
    @wraps(fn)
    @require_session
    def wrapper(*args, **kwargs):
        user = request.user or {}
        faction_id = str(user.get("faction_id") or "").strip()
        if not faction_id:
            return err("No faction found.", 403)

        if not _can_manage_faction(user, faction_id):
            return err("Leader access required.", 403)

        return fn(*args, **kwargs)

    return wrapper


def _seconds_to_text(seconds: int) -> str:
    sec = max(0, int(seconds or 0))
    if sec <= 0:
        return "0m"

    days, rem = divmod(sec, 86400)
    hours, rem = divmod(rem, 3600)
    mins, _ = divmod(rem, 60)

    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if mins or not parts:
        parts.append(f"{mins}m")

    return " ".join(parts)


def _faction_basic_by_id(api_key: str, faction_id: str) -> Dict[str, Any]:
    faction_id = str(faction_id or "").strip()
    if not api_key or not faction_id:
        return {"ok": False, "members": []}

    try:
        data = faction_basic(api_key, faction_id=faction_id)
        if isinstance(data, dict):
            return data
    except TypeError:
        pass
    except Exception:
        pass

    try:
        data = faction_basic(api_key, faction_id)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    return {"ok": False, "members": []}


def _ranked_war_payload_for_user(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    summary = ranked_war_summary(
        api_key,
        my_faction_id=my_faction_id,
        my_faction_name=my_faction_name,
    ) or {}

    war_id = str(summary.get("war_id") or "")
    return {
        "war_id": war_id,
        "war": {
            "war_id": war_id,
            "status": summary.get("status_text") or (
                "War active"
                if summary.get("active")
                else "War registered"
                if summary.get("registered")
                else "Currently not in war"
            ),
            "active": bool(summary.get("active")),
            "registered": bool(summary.get("registered")),
            "phase": str(summary.get("phase") or "none"),
            "war_type": str(summary.get("war_type") or ""),
            "start": _to_int(summary.get("start")),
            "end": _to_int(summary.get("end")),
            "target": _to_int(summary.get("target_score")),
        },
        "our_faction": {
            "faction_id": str(summary.get("my_faction_id") or my_faction_id or ""),
            "name": str(summary.get("my_faction_name") or my_faction_name or ""),
            "score": _to_int(summary.get("score_us")),
            "chain": _to_int(summary.get("chain_us")),
        },
        "enemy_faction": {
            "faction_id": str(summary.get("enemy_faction_id") or ""),
            "name": str(summary.get("enemy_faction_name") or ""),
            "score": _to_int(summary.get("score_them")),
            "chain": _to_int(summary.get("chain_them")),
        },
        "members": [],
        "enemies": summary.get("enemy_members") or [],
        "is_ranked_war": bool(summary.get("has_war")),
        "has_war": bool(summary.get("has_war")),
        "score": {
            "our": _to_int(summary.get("score_us")),
            "enemy": _to_int(summary.get("score_them")),
            "target": _to_int(summary.get("target_score")),
        },
    }


def _parse_minutes_from_member(member: Dict[str, Any]) -> int:
    online_state = str(member.get("online_state", "") or "").strip().lower()
    hospital_seconds = int(member.get("hospital_seconds") or 0)
    last_action = str(member.get("last_action", "") or "").strip().lower()
    status = str(member.get("status", "") or "").strip().lower()
    status_detail = str(member.get("status_detail", "") or "").strip().lower()

    if online_state == "online":
        return 0
    if online_state == "idle":
        return 1
    if online_state == "hospital":
        return hospital_seconds if hospital_seconds > 0 else 10**7

    s = " ".join([last_action, status, status_detail]).strip()

    if "online" in s:
        return 0
    if "idle" in s:
        return 1
    if "offline" in s:
        return 10**8
    if "hospital" in s:
        return hospital_seconds if hospital_seconds > 0 else 10**7

    parts = s.replace(",", " ").split()
    total = 0
    found = False

    for i, tok in enumerate(parts):
        if not tok.isdigit():
            continue
        val = int(tok)
        nxt = parts[i + 1] if i + 1 < len(parts) else ""
        if nxt.startswith("min"):
            total += val
            found = True
        elif nxt.startswith("hour") or nxt.startswith("hr"):
            total += val * 60
            found = True
        elif nxt.startswith("day"):
            total += val * 1440
            found = True

    if found:
        return total

    return 10**9


def _member_activity_bucket(member: Dict[str, Any]) -> str:
    online_state = str(member.get("online_state", "") or "").strip().lower()
    hospital_seconds = int(member.get("hospital_seconds") or 0)

    if online_state in {"online", "idle", "offline", "hospital", "travel", "jail"}:
        return online_state

    s = " ".join([
        str(member.get("status", "") or ""),
        str(member.get("status_detail", "") or ""),
        str(member.get("last_action", "") or ""),
    ]).strip().lower()

    if "hospital" in s or hospital_seconds > 0:
        return "hospital"
    if any(x in s for x in ["jail", "jailed"]):
        return "jail"
    if any(x in s for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
        return "travel"
    if "online" in s or "okay" in s:
        return "online"
    if "idle" in s:
        return "idle"
    if "offline" in s:
        return "offline"
    return "other"


def _clean_member(member: Dict[str, Any], enemy_state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    m = dict(member or {})
    user_id = str(m.get("user_id") or m.get("id") or "").strip()
    name = str(m.get("name") or "").strip()

    status_class = _member_activity_bucket(m)
    minutes_value = _parse_minutes_from_member(m)
    hospital_seconds = _to_int(m.get("hospital_seconds"))

    if enemy_state:
        st = str(enemy_state.get("online_state") or "").strip().lower()
        hosp = _to_int(enemy_state.get("hospital_seconds"))
        if st:
            status_class = st
        if hosp > 0:
            status_class = "hospital"
            hospital_seconds = hosp

    display_status = str(m.get("status_detail") or m.get("status") or m.get("last_action") or "").strip()
    if status_class == "hospital" and hospital_seconds > 0:
        display_status = _seconds_to_text(hospital_seconds)
    elif status_class == "travel" and not display_status:
        display_status = "Traveling"
    elif status_class == "jail" and not display_status:
        display_status = "Jailed"
    elif status_class == "online" and not display_status:
        display_status = "Online"
    elif status_class == "idle" and not display_status:
        display_status = "Idle"
    elif status_class == "offline" and not display_status:
        display_status = "Offline"

    m["user_id"] = user_id
    m["id"] = user_id or m.get("id")
    m["name"] = name
    m["profile_url"] = profile_url(user_id) if user_id else ""
    m["attack_url"] = attack_url(user_id) if user_id else ""
    m["bounty_url"] = bounty_url(user_id) if user_id else ""
    m["status_class"] = status_class
    m["activity_bucket"] = status_class
    m["minutes_value"] = minutes_value
    m["hospital_seconds"] = hospital_seconds
    m["hospital_text"] = _seconds_to_text(hospital_seconds) if hospital_seconds > 0 else ""
    m["display_status"] = display_status
    m["chain_sitter"] = _safe_bool(m.get("chain_sitter"))
    return m


def _bucket_sort_key(member: Dict[str, Any]) -> Tuple[int, int, str]:
    bucket = str(member.get("activity_bucket") or "")
    order = {
        "online": 0,
        "idle": 1,
        "travel": 2,
        "hospital": 3,
        "jail": 4,
        "offline": 5,
        "other": 6,
    }
    return (
        order.get(bucket, 9),
        _to_int(member.get("minutes_value"), 10**9),
        str(member.get("name") or "").lower(),
    )


def _normalize_assignment(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["war_id"] = str(r.get("war_id") or "")
    r["target_id"] = str(r.get("target_id") or "")
    r["target_name"] = str(r.get("target_name") or "")
    r["assigned_to_user_id"] = str(r.get("assigned_to_user_id") or "")
    r["assigned_to_name"] = str(r.get("assigned_to_name") or "")
    r["assigned_by_user_id"] = str(r.get("assigned_by_user_id") or "")
    r["assigned_by_name"] = str(r.get("assigned_by_name") or "")
    r["priority"] = str(r.get("priority") or "normal")
    r["note"] = str(r.get("note") or "")
    return r


def _normalize_note(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["war_id"] = str(r.get("war_id") or "")
    r["target_id"] = str(r.get("target_id") or "")
    r["note"] = str(r.get("note") or "")
    r["created_by_user_id"] = str(r.get("created_by_user_id") or "")
    r["created_by_name"] = str(r.get("created_by_name") or "")
    return r


def _merge_enemy_state(enemies: List[Dict[str, Any]], war_id: str) -> List[Dict[str, Any]]:
    state_map = get_enemy_state_map(war_id) if war_id else {}
    merged = []
    for enemy in enemies or []:
        enemy_id = str(enemy.get("user_id") or enemy.get("id") or "")
        st = state_map.get(enemy_id) if enemy_id else None
        merged.append(_clean_member(enemy, st))
    merged.sort(key=_bucket_sort_key)
    return merged


def _normalize_member_access_row(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["faction_id"] = str(r.get("faction_id") or "")
    r["leader_user_id"] = str(r.get("leader_user_id") or "")
    r["leader_name"] = str(r.get("leader_name") or "")
    r["member_user_id"] = str(r.get("member_user_id") or "")
    r["member_name"] = str(r.get("member_name") or "")
    r["position"] = str(r.get("position") or "")

    r["member_api_key_masked"] = ""
    api_key = str(r.get("member_api_key") or "")
    if api_key:
        r["member_api_key_masked"] = ("*" * max(0, len(api_key) - 4)) + api_key[-4:]

    r["enabled"] = 1 if _safe_bool(r.get("enabled")) else 0
    return r


def _add_med_deal_compat(
    *,
    user: Dict[str, Any],
    seller_name: str,
    item_name: str,
    price: str,
    note: str,
):
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    user_name = str(user.get("name") or "").strip()

    try:
        sig = inspect.signature(add_med_deal)
        param_count = len(sig.parameters)

        if param_count >= 7:
            return add_med_deal(
                creator_user_id=user_id,
                creator_name=user_name,
                faction_id=faction_id,
                faction_name=faction_name,
                buyer_name=item_name,
                seller_name=seller_name,
                notes=note or price,
            )

        return add_med_deal(faction_id, seller_name, item_name, price, note)
    except TypeError:
        return add_med_deal(faction_id, seller_name, item_name, price, note)


def _delete_med_deal_compat(faction_id: str, deal_id: int):
    try:
        sig = inspect.signature(delete_med_deal)
        param_count = len(sig.parameters)
        if param_count >= 2:
            return delete_med_deal(faction_id, int(deal_id))
        return delete_med_deal(int(deal_id))
    except TypeError:
        return delete_med_deal(faction_id, int(deal_id))


@app.route("/health", methods=["GET"])
def health():
    return ok(app=APP_NAME, now=utc_now(), base_url=BASE_URL())


@app.route("/", methods=["GET"])
def index():
    if os.path.isdir(app.static_folder):
        index_path = os.path.join(app.static_folder, "index.html")
        if os.path.isfile(index_path):
            return send_from_directory(app.static_folder, "index.html")
    return ok(message=f"{APP_NAME} server is running.", now=utc_now())


@app.route("/static/<path:filename>", methods=["GET"])
def static_files(filename: str):
    return send_from_directory(app.static_folder, filename)


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    if os.path.isdir(app.static_folder):
        fav = os.path.join(app.static_folder, "favicon.ico")
        if os.path.isfile(fav):
            return send_from_directory(app.static_folder, "favicon.ico")
    return ("", 204)


@app.route("/api/ping", methods=["GET"])
def api_ping():
    return ok(message="pong", now=utc_now())


@app.route("/api/config", methods=["GET"])
def api_config():
    return ok(
        payment_player=PAYMENT_PLAYER,
        faction_member_price=FACTION_MEMBER_PRICE,
        default_refresh_seconds=DEFAULT_REFRESH_SECONDS,
        base_url=BASE_URL(),
    )


@app.route("/api/auth", methods=["POST"])
def api_auth():
    try:
        if not _check_request_origin():
            return err("Blocked request origin.", 403)

        data = _require_json()
        api_key = str(data.get("api_key") or "").strip()
        if not api_key:
            return err("Missing api_key.", 400)

        me = me_basic(api_key)
        if not me or not me.get("ok") or not str(me.get("user_id") or "").strip():
            return err(
                me.get("error", "Invalid API key or Torn API unavailable."),
                401,
                torn_response=me,
            )

        user_id = str(me.get("user_id")).strip()
        name = str(me.get("name") or "").strip()
        faction_id = str(me.get("faction_id") or "").strip()
        faction_name = str(me.get("faction_name") or "").strip()

        upsert_user(
            user_id=user_id,
            name=name,
            api_key=api_key,
            faction_id=faction_id,
            faction_name=faction_name,
        )

        if faction_id:
            ensure_faction_license_row(
                faction_id=faction_id,
                faction_name=faction_name,
                leader_user_id=user_id,
                leader_name=name,
                leader_api_key=api_key,
            )
            start_faction_trial_if_needed(
                faction_id=faction_id,
                faction_name=faction_name,
                leader_user_id=user_id,
                leader_name=name,
                leader_api_key=api_key,
            )

        license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
        is_owner = _session_is_owner({"name": name, "user_id": user_id})

        if faction_id and not is_owner:
            if bool(license_status.get("payment_required")) and str(license_status.get("leader_user_id") or "") != user_id:
                member_row = get_faction_member_access(faction_id, user_id) or {}
                if not _safe_bool(member_row.get("enabled")):
                    return err(
                        "Your faction leader has not enabled your access yet.",
                        403,
                        code="member_not_enabled",
                        faction_id=faction_id,
                        faction_name=faction_name,
                        license=license_status,
                    )

            if str(license_status.get("status") or "").lower() == "expired":
                leader_id = str(license_status.get("leader_user_id") or "")
                if leader_id != user_id:
                    return err(
                        "Faction license expired. Leader payment required.",
                        403,
                        code="license_expired",
                        faction_id=faction_id,
                        faction_name=faction_name,
                        license=license_status,
                    )

        delete_sessions_for_user(user_id)
        token = create_session(user_id)

        return ok(
            message="Authenticated.",
            token=token,
            user={
                "user_id": user_id,
                "name": name,
                "faction_id": faction_id,
                "faction_name": faction_name,
                "is_owner": is_owner,
                "is_leader": str(license_status.get("leader_user_id") or "") == user_id,
            },
            license=license_status,
        )
    except Exception as e:
        return err("Login failed.", 500, details=str(e))


@app.route("/api/logout", methods=["POST"])
@require_session
def api_logout():
    token = str((request.session or {}).get("token") or "")
    if token:
        delete_session(token)
    return ok(message="Logged out.")


@app.route("/api/state", methods=["GET"])
@require_session
def api_state():
    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    faction_map = get_user_map_by_faction(faction_id) if faction_id else {}

    me = me_basic(api_key) or {}
    live_faction_id = str(me.get("faction_id") or faction_id or "").strip()
    live_faction_name = str(me.get("faction_name") or faction_name or "").strip()

    if live_faction_id and live_faction_id != faction_id:
        faction_id = live_faction_id
        faction_name = live_faction_name
        license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
        faction_map = get_user_map_by_faction(faction_id) if faction_id else {}

    faction_info = faction_basic(api_key, faction_id=faction_id) if api_key else {"ok": False, "members": []}

    war_api_key = api_key
    if faction_map:
        leader_row = None

        for _, row in faction_map.items():
            if not isinstance(row, dict):
                continue

            row_user_id = str(row.get("member_user_id") or row.get("user_id") or "")
            row_api_key = str(row.get("member_api_key") or row.get("api_key") or "").strip()
            row_position = str(row.get("position") or "").lower()
            row_enabled = bool(row.get("enabled", True))

            if row_api_key and "leader" in row_position:
                leader_row = row
                break

            if row_api_key and row_enabled and row_user_id == user_id:
                war_api_key = row_api_key

        if leader_row:
            war_api_key = str(
                leader_row.get("member_api_key")
                or leader_row.get("api_key")
                or war_api_key
            ).strip()

    war_info = ranked_war_summary(
        war_api_key,
        my_faction_id=live_faction_id,
        my_faction_name=live_faction_name,
    ) if war_api_key else {
        "ok": True,
        "active": False,
        "registered": False,
        "has_war": False,
        "phase": "none",
        "war_id": "",
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "enemy_members": [],
        "score_us": 0,
        "score_them": 0,
        "target_score": 0,
        "chain_us": 0,
        "chain_them": 0,
        "status_text": "Currently not in war",
        "source_ok": False,
        "source_note": "No war API key available.",
    }

    members = []
    for m in (faction_info.get("members") or []):
        member_id = str(m.get("user_id") or m.get("id") or "")
        merged = dict(m)
        if member_id and member_id in faction_map:
            merged.update({k: v for k, v in faction_map[member_id].items() if v not in (None, "")})
        members.append(_clean_member(merged))
    members.sort(key=_bucket_sort_key)

    war_id = str(war_info.get("war_id") or "")
    enemy_faction_id = str(war_info.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war_info.get("enemy_faction_name") or "").strip()

    raw_enemy_members = war_info.get("enemy_members") or []
    enemies = []

    our_faction_id = str(war_info.get("my_faction_id") or live_faction_id or "").strip()
    our_faction_name = str(war_info.get("my_faction_name") or live_faction_name or "").strip().lower()

    if enemy_faction_id and our_faction_id and enemy_faction_id == our_faction_id:
        enemy_faction_id = ""
        enemy_faction_name = ""
        raw_enemy_members = []

    if enemy_faction_name and our_faction_name and enemy_faction_name.strip().lower() == our_faction_name:
        enemy_faction_id = ""
        enemy_faction_name = ""
        raw_enemy_members = []

    if enemy_faction_id and bool(war_info.get("has_war")) and not raw_enemy_members:
        enemy_info = _faction_basic_by_id(war_api_key or api_key, enemy_faction_id)
        raw_enemy_members = enemy_info.get("members") or []
        if not enemy_faction_name:
            enemy_faction_name = str(enemy_info.get("faction_name") or "").strip()

        fetched_enemy_id = str(enemy_info.get("faction_id") or enemy_faction_id).strip()
        fetched_enemy_name = str(enemy_info.get("faction_name") or enemy_faction_name).strip().lower()

        if fetched_enemy_id and our_faction_id and fetched_enemy_id == our_faction_id:
            enemy_faction_id = ""
            enemy_faction_name = ""
            raw_enemy_members = []
        elif fetched_enemy_name and our_faction_name and fetched_enemy_name == our_faction_name:
            enemy_faction_id = ""
            enemy_faction_name = ""
            raw_enemy_members = []

    if raw_enemy_members:
        enemies = _merge_enemy_state(raw_enemy_members, war_id)

    assignments = [_normalize_assignment(x) for x in (list_target_assignments_for_war(war_id) if war_id else [])]
    notes = [_normalize_note(x) for x in (list_war_notes(war_id) if war_id else [])]
    terms = get_war_terms(war_id) if war_id else {}

    med_deals = list_med_deals_for_faction(faction_id) if faction_id else []
    targets = list_targets(user_id) if user_id else []
    bounties = list_bounties(user_id) if user_id else []
    notifications = list_notifications(user_id)
    mark_notifications_seen(user_id)

    settings = {
        "refresh_seconds": _to_int(get_user_setting(user_id, "refresh_seconds"), DEFAULT_REFRESH_SECONDS),
        "compact_mode": _safe_bool(get_user_setting(user_id, "compact_mode")),
    }

    return ok(
        now=utc_now(),
        me=me,
        user={
            "user_id": user_id,
            "name": str(user.get("name") or ""),
            "faction_id": faction_id,
            "faction_name": faction_name,
            "is_owner": _session_is_owner(user),
            "is_leader": str(license_status.get("leader_user_id") or "") == user_id,
        },
        settings=settings,
        license=license_status,
        war={
            "war_id": war_id,
            "status": war_info.get("status_text") or (
                "War active"
                if war_info.get("active")
                else "War registered"
                if war_info.get("registered")
                else "Currently not in war"
            ),
            "active": bool(war_info.get("active")),
            "registered": bool(war_info.get("registered")),
            "phase": str(war_info.get("phase") or "none"),
            "war_type": str(war_info.get("war_type") or ""),
            "start": _to_int(war_info.get("start")),
            "end": _to_int(war_info.get("end")),
            "target_score": _to_int(war_info.get("target_score")),
        },
        faction={
            "faction_id": str(war_info.get("my_faction_id") or live_faction_id or ""),
            "name": str(war_info.get("my_faction_name") or live_faction_name or ""),
            "score": _to_int(war_info.get("score_us")),
            "chain": _to_int(war_info.get("chain_us")),
        },
        enemy_faction={
            "faction_id": enemy_faction_id,
            "name": enemy_faction_name,
            "score": _to_int(war_info.get("score_them")),
            "chain": _to_int(war_info.get("chain_them")),
        },
        members=members,
        enemies=enemies,
        assignments=assignments,
        notes=notes,
        terms=terms,
        med_deals=med_deals,
        targets=targets,
        bounties=bounties,
        notifications=notifications,
        score={
            "our": _to_int(war_info.get("score_us")),
            "enemy": _to_int(war_info.get("score_them")),
            "target": _to_int(war_info.get("target_score")),
        },
        has_war=bool(war_info.get("has_war")),
        is_ranked_war=bool(war_info.get("has_war")),
    )

@app.route("/api/availability", methods=["POST"])
@require_session
def api_set_availability():
    user = request.user or {}
    data = _require_json()
    available = 1 if _safe_bool(data.get("available")) else 0

    set_availability(str(user.get("user_id") or ""), available)
    add_audit_log(
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
        action="set_availability",
        meta_json={"available": available},
    )
    return ok(message="Availability updated.", available=available)


@app.route("/api/chain-sitter", methods=["POST"])
@require_session
def api_chain_sitter():
    user = request.user or {}
    data = _require_json()
    enabled = 1 if _safe_bool(data.get("enabled")) else 0

    set_chain_sitter(str(user.get("user_id") or ""), enabled)
    add_audit_log(
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
        action="set_chain_sitter",
        meta_json={"enabled": enabled},
    )
    return ok(message="Chain sitter updated.", enabled=enabled)


@app.route("/api/settings", methods=["POST"])
@require_session
def api_settings():
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    data = _require_json()

    if "refresh_seconds" in data:
        refresh_seconds = max(10, _to_int(data.get("refresh_seconds"), DEFAULT_REFRESH_SECONDS))
        set_user_setting(user_id, "refresh_seconds", str(refresh_seconds))

    if "compact_mode" in data:
        set_user_setting(user_id, "compact_mode", "1" if _safe_bool(data.get("compact_mode")) else "0")

    return ok(message="Settings saved.")


@app.route("/api/med-deals", methods=["GET"])
@require_session
def api_list_med_deals():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    return ok(items=list_med_deals_for_faction(faction_id) if faction_id else [])


@app.route("/api/med-deals", methods=["POST"])
@require_session
def api_add_med_deal():
    user = request.user or {}
    data = _require_json()

    if not str(user.get("faction_id") or "").strip():
        return err("No faction found.", 400)

    seller_name = str(data.get("seller_name") or "").strip()
    item_name = str(data.get("item_name") or "").strip()
    price = str(data.get("price") or "").strip()
    note = str(data.get("note") or "").strip()

    item = _add_med_deal_compat(
        user=user,
        seller_name=seller_name,
        item_name=item_name,
        price=price,
        note=note,
    )
    return ok(message="Med deal added.", item=item)


@app.route("/api/med-deals/<int:deal_id>", methods=["DELETE"])
@require_session
def api_delete_med_deal(deal_id: int):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    _delete_med_deal_compat(faction_id, int(deal_id))
    return ok(message="Med deal deleted.", id=deal_id)


@app.route("/api/targets", methods=["GET"])
@require_session
def api_list_targets():
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    return ok(items=list_targets(user_id) if user_id else [])


@app.route("/api/targets", methods=["POST"])
@require_session
def api_add_target():
    user = request.user or {}
    data = _require_json()
    user_id = str(user.get("user_id") or "")
    if not user_id:
        return err("No user found.", 400)

    target_id = str(data.get("target_id") or "").strip()
    target_name = str(data.get("target_name") or "").strip()
    notes = str(data.get("notes") or data.get("reason") or "").strip()

    if not target_id:
        return err("Missing target_id.", 400)

    item = add_target(user_id, target_id, target_name, notes)
    return ok(message="Target added.", item=item)


@app.route("/api/targets/<int:target_row_id>", methods=["DELETE"])
@require_session
def api_delete_target(target_row_id: int):
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    if not user_id:
        return err("No user found.", 400)

    delete_target(user_id, int(target_row_id))
    return ok(message="Target deleted.", id=target_row_id)


@app.route("/api/bounties", methods=["GET"])
@require_session
def api_list_bounties():
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    return ok(items=list_bounties(user_id) if user_id else [])


@app.route("/api/bounties", methods=["POST"])
@require_session
def api_add_bounty():
    user = request.user or {}
    data = _require_json()
    user_id = str(user.get("user_id") or "")
    if not user_id:
        return err("No user found.", 400)

    target_id = str(data.get("target_id") or "").strip()
    target_name = str(data.get("target_name") or "").strip()
    reward_text = str(data.get("reward_text") or data.get("amount") or "").strip()

    if not target_id:
        return err("Missing target_id.", 400)

    item = add_bounty(user_id, target_id, target_name, reward_text)
    return ok(message="Bounty added.", item=item)


@app.route("/api/bounties/<int:bounty_row_id>", methods=["DELETE"])
@require_session
def api_delete_bounty(bounty_row_id: int):
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    if not user_id:
        return err("No user found.", 400)

    delete_bounty(user_id, int(bounty_row_id))
    return ok(message="Bounty deleted.", id=bounty_row_id)


@app.route("/api/notifications", methods=["GET"])
@require_session
def api_notifications():
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    items = list_notifications(user_id)
    mark_notifications_seen(user_id)
    return ok(items=items)


@app.route("/api/war/snapshot", methods=["POST"])
@require_session
def api_save_war_snapshot():
    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    if not api_key:
        return err("Missing API key.", 400)

    payload = _ranked_war_payload_for_user(
        api_key,
        my_faction_id=str(user.get("faction_id") or ""),
        my_faction_name=str(user.get("faction_name") or ""),
    )

    if not str(payload.get("war_id") or ""):
        return err("No active ranked war.", 400)

    war = payload.get("war") or {}
    our = payload.get("our_faction") or {}
    enemy = payload.get("enemy_faction") or {}
    score = payload.get("score") or {}

    item = save_war_snapshot(
        war_id=str(payload.get("war_id") or ""),
        faction_id=str(user.get("faction_id") or ""),
        faction_name=str(our.get("name") or user.get("faction_name") or ""),
        enemy_faction_id=str(enemy.get("faction_id") or enemy.get("id") or ""),
        enemy_faction_name=str(enemy.get("name") or ""),
        our_score=_to_int(score.get("our")),
        enemy_score=_to_int(score.get("enemy")),
        lead=_to_int(score.get("our")) - _to_int(score.get("enemy")),
        target_score=_to_int(score.get("target")),
        start_ts=_to_int(war.get("start") or war.get("start_ts")),
        end_ts=_to_int(war.get("end") or war.get("end_ts")),
        status_text=str(war.get("status") or ""),
    )
    return ok(message="War snapshot saved.", item=item)


@app.route("/api/war/snapshots", methods=["GET"])
@require_session
def api_list_war_snapshots():
    war_id = str(request.args.get("war_id") or "").strip()
    if not war_id:
        return err("Missing war_id.", 400)
    return ok(items=list_recent_war_snapshots(war_id))


@app.route("/api/war/enemy-state", methods=["POST"])
@require_session
def api_upsert_enemy_state():
    data = _require_json()
    war_id = str(data.get("war_id") or "").strip()
    enemy_id = str(data.get("enemy_id") or data.get("user_id") or "").strip()
    enemy_name = str(data.get("enemy_name") or data.get("name") or "").strip()
    online_state = str(data.get("online_state") or data.get("status_class") or "").strip().lower()
    hospital_seconds = _to_int(data.get("hospital_seconds"))

    if not war_id or not enemy_id:
        return err("Missing war_id or enemy_id.", 400)

    row = upsert_enemy_state(
        war_id=war_id,
        user_id=enemy_id,
        name=enemy_name,
        online_state=online_state,
        hospital_seconds=hospital_seconds,
    )
    return ok(message="Enemy state updated.", item=row)


@app.route("/api/war/assignments", methods=["GET"])
@require_session
def api_list_assignments():
    war_id = str(request.args.get("war_id") or "").strip()
    if not war_id:
        return err("Missing war_id.", 400)
    return ok(items=[_normalize_assignment(x) for x in list_target_assignments_for_war(war_id)])


@app.route("/api/war/assignments", methods=["POST"])
@require_session
def api_upsert_assignment():
    user = request.user or {}
    data = _require_json()

    war_id = str(data.get("war_id") or "").strip()
    target_id = str(data.get("target_id") or "").strip()
    if not war_id or not target_id:
        return err("Missing war_id or target_id.", 400)

    row = upsert_target_assignment(
        war_id=war_id,
        target_id=target_id,
        target_name=str(data.get("target_name") or "").strip(),
        assigned_to_user_id=str(data.get("assigned_to_user_id") or data.get("assigned_to") or "").strip(),
        assigned_to_name=str(data.get("assigned_to_name") or "").strip(),
        assigned_by_user_id=str(user.get("user_id") or ""),
        assigned_by_name=str(user.get("name") or ""),
        priority=str(data.get("priority") or "normal").strip(),
        note=str(data.get("note") or "").strip(),
    )
    return ok(message="Assignment saved.", item=_normalize_assignment(row))


@app.route("/api/war/assignments/<int:assignment_id>", methods=["DELETE"])
@require_session
def api_delete_assignment(assignment_id: int):
    delete_target_assignment(int(assignment_id))
    return ok(message="Assignment deleted.", id=assignment_id)


@app.route("/api/war/notes", methods=["GET"])
@require_session
def api_list_notes():
    war_id = str(request.args.get("war_id") or "").strip()
    if not war_id:
        return err("Missing war_id.", 400)
    return ok(items=[_normalize_note(x) for x in list_war_notes(war_id)])


@app.route("/api/war/notes", methods=["POST"])
@require_session
def api_upsert_note():
    user = request.user or {}
    data = _require_json()

    war_id = str(data.get("war_id") or "").strip()
    target_id = str(data.get("target_id") or "").strip()
    note = str(data.get("note") or "").strip()

    if not war_id or not target_id:
        return err("Missing war_id or target_id.", 400)

    row = upsert_war_note(
        war_id=war_id,
        target_id=target_id,
        note=note,
        created_by_user_id=str(user.get("user_id") or ""),
        created_by_name=str(user.get("name") or ""),
    )
    return ok(message="Note saved.", item=_normalize_note(row))


@app.route("/api/war/notes/<int:note_id>", methods=["DELETE"])
@require_session
def api_delete_note(note_id: int):
    delete_war_note(int(note_id))
    return ok(message="Note deleted.", id=note_id)


@app.route("/api/war-terms", methods=["GET"])
@require_session
def api_get_terms():
    war_id = str(request.args.get("war_id") or "").strip()
    if not war_id:
        return ok(item={})
    return ok(item=get_war_terms(war_id) or {})


@app.route("/api/war-terms", methods=["POST"])
@require_leader_session
def api_upsert_terms():
    user = request.user or {}
    data = _require_json()
    war_id = str(data.get("war_id") or "").strip()
    if not war_id:
        return err("Missing war_id.", 400)

    row = upsert_war_terms(
        war_id=war_id,
        terms_text=str(data.get("terms") or data.get("terms_text") or "").strip(),
        updated_by_user_id=str(user.get("user_id") or ""),
        updated_by_name=str(user.get("name") or ""),
    )
    return ok(message="War terms saved.", item=row)


@app.route("/api/war-terms", methods=["DELETE"])
@require_leader_session
def api_delete_terms():
    war_id = str(request.args.get("war_id") or "").strip()
    if not war_id:
        return err("Missing war_id.", 400)

    delete_war_terms(war_id)
    return ok(message="War terms deleted.")


@app.route("/api/faction/license", methods=["GET"])
@require_session
def api_faction_license():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    return ok(item=_build_license_status_payload(faction_id, viewer_user_id=str(user.get("user_id") or "")))


@app.route("/api/faction/members", methods=["GET"])
@require_leader_session
def api_faction_members():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    items = [_normalize_member_access_row(x) for x in (list_faction_members(faction_id) or [])]
    return ok(items=items)


@app.route("/api/faction/members", methods=["POST"])
@require_leader_session
def api_faction_member_upsert():
    user = request.user or {}
    data = _require_json()

    faction_id = str(user.get("faction_id") or "")
    faction_name = str(user.get("faction_name") or "")
    leader_user_id = str(user.get("user_id") or "")
    leader_name = str(user.get("name") or "")

    member_user_id = str(data.get("member_user_id") or "").strip()
    member_name = str(data.get("member_name") or "").strip()
    member_api_key = str(data.get("member_api_key") or "").strip()
    enabled = 1 if _safe_bool(data.get("enabled", True)) else 0
    position = str(data.get("position") or "").strip()

    if not faction_id:
        return err("No faction found.", 400)
    if not member_user_id:
        return err("Missing member_user_id.", 400)

    row = upsert_faction_member_access(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
        member_user_id=member_user_id,
        member_name=member_name,
        member_api_key=member_api_key,
        enabled=enabled,
        position=position,
    )

    add_notification(
        leader_user_id,
        "faction_access",
        f"{member_name or member_user_id} access updated.",
    )

    return ok(message="Faction member access saved.", item=_normalize_member_access_row(row))


@app.route("/api/faction/members/<member_user_id>/enable", methods=["POST"])
@require_leader_session
def api_faction_member_enable(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    data = _require_json()
    enabled = 1 if _safe_bool(data.get("enabled", True)) else 0

    if not faction_id:
        return err("No faction found.", 400)

    set_faction_member_enabled(faction_id, str(member_user_id), enabled)
    return ok(message="Faction member enable updated.", member_user_id=str(member_user_id), enabled=enabled)


@app.route("/api/faction/members/<member_user_id>", methods=["DELETE"])
@require_leader_session
def api_faction_member_delete(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    delete_faction_member_access(faction_id, str(member_user_id))
    return ok(message="Faction member removed.", member_user_id=str(member_user_id))


@app.route("/api/admin/faction-licenses", methods=["GET"])
@require_owner
def api_admin_faction_licenses():
    items = list_all_faction_licenses() or []
    summary = get_faction_admin_dashboard_summary() or {}
    return ok(items=items, summary=summary)


@app.route("/api/admin/faction-licenses/<faction_id>/history", methods=["GET"])
@require_owner
def api_admin_faction_license_history(faction_id: str):
    return ok(items=get_faction_payment_history(str(faction_id)) or [])


@app.route("/api/admin/faction-licenses/<faction_id>/renew", methods=["POST"])
@require_owner
def api_admin_faction_license_renew(faction_id: str):
    user = request.user or {}
    data = _require_json()

    amount = _to_int(data.get("amount"))
    note = str(data.get("note") or "").strip()

    row = renew_faction_after_payment(
        faction_id=str(faction_id),
        amount=amount,
        payment_player=PAYMENT_PLAYER,
        renewed_by=str(user.get("name") or ""),
        note=note,
    )
    return ok(message="Faction renewed.", item=row)


@app.route("/api/admin/faction-licenses/<faction_id>/expire", methods=["POST"])
@require_owner
def api_admin_faction_license_expire(faction_id: str):
    force_expire_faction_license(str(faction_id))
    return ok(message="Faction expired.", faction_id=str(faction_id))


@app.route("/api/license-admin/dashboard", methods=["GET"])
def api_license_admin_dashboard():
    allowed, response = _require_license_admin()
    if not allowed:
        return response

    items = list_all_faction_licenses() or []
    summary = get_faction_admin_dashboard_summary() or {}
    return ok(items=items, summary=summary)


@app.route("/api/license-admin/factions/<faction_id>/history", methods=["GET"])
def api_license_admin_faction_history(faction_id: str):
    allowed, response = _require_license_admin()
    if not allowed:
        return response

    return ok(items=get_faction_payment_history(str(faction_id)) or [])


@app.route("/api/license-admin/factions/<faction_id>/renew", methods=["POST"])
def api_license_admin_renew(faction_id: str):
    allowed, response = _require_license_admin()
    if not allowed:
        return response

    data = _require_json()
    amount = _to_int(data.get("amount"))
    renewed_by = str(data.get("renewed_by") or "license-admin").strip()
    note = str(data.get("note") or "").strip()

    row = renew_faction_after_payment(
        faction_id=str(faction_id),
        amount=amount,
        payment_player=PAYMENT_PLAYER,
        renewed_by=renewed_by,
        note=note,
    )
    return ok(message="Faction renewed.", item=row)


@app.route("/api/license-admin/factions/<faction_id>/expire", methods=["POST"])
def api_license_admin_expire(faction_id: str):
    allowed, response = _require_license_admin()
    if not allowed:
        return response

    force_expire_faction_license(str(faction_id))
    return ok(message="Faction expired.", faction_id=str(faction_id))


@app.route("/api/owner/factions", methods=["GET"])
@require_owner
def api_owner_factions_alias():
    return api_admin_faction_licenses()


@app.route("/api/owner/factions/<faction_id>/history", methods=["GET"])
@require_owner
def api_owner_factions_history_alias(faction_id: str):
    return api_admin_faction_license_history(faction_id)


@app.route("/api/owner/factions/<faction_id>/renew", methods=["POST"])
@require_owner
def api_owner_factions_renew_alias(faction_id: str):
    return api_admin_faction_license_renew(faction_id)


@app.route("/api/owner/factions/<faction_id>/expire", methods=["POST"])
@require_owner
def api_owner_factions_expire_alias(faction_id: str):
    return api_admin_faction_license_expire(faction_id)


@app.errorhandler(404)
def not_found(e):
    return err("Not Found", 404, details=str(e))


@app.errorhandler(405)
def not_allowed(e):
    return err("Method Not Allowed", 405, details=str(e))


@app.errorhandler(Exception)
def handle_error(e):
    return err("Unhandled error.", 500, details=str(e))


def create_app():
    init_db()
    return app


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
