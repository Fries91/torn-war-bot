import os
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Dict, Optional, List, Tuple

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
    cache_purge_expired,
)

# faction-license imports with compatibility fallback
try:
    from db import (
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
except Exception:
    from db import (
        ensure_faction_license as _ensure_faction_license,
        start_faction_trial_if_needed,
        compute_faction_license_status as _compute_faction_license_status_raw,
        renew_faction_after_payment,
        get_faction_payment_history,
        force_expire_faction_license,
        list_all_faction_licenses,
        get_owner_faction_dashboard as _get_owner_faction_dashboard,
        list_faction_members,
        get_faction_member as _get_faction_member,
        add_or_update_faction_member as _add_or_update_faction_member,
        set_faction_member_enabled,
        delete_faction_member as _delete_faction_member,
    )

    def ensure_faction_license_row(
        faction_id: str,
        faction_name: str = "",
        leader_user_id: str = "",
        leader_name: str = "",
        leader_api_key: str = "",
    ):
        return _ensure_faction_license(
            faction_id=faction_id,
            faction_name=faction_name,
            leader_user_id=leader_user_id,
            leader_name=leader_name,
        )

    def compute_faction_license_status(faction_id: str, viewer_user_id: str = ""):
        return _compute_faction_license_status_raw(faction_id)

    def get_faction_admin_dashboard_summary():
        raw = _get_owner_faction_dashboard(limit=250) or {}
        factions = raw.get("factions", []) or []
        enabled_members_total = 0
        projected_renewal_total = 0
        trials_total = 0
        paid_total = 0
        payment_required_total = 0

        for row in factions:
            lic = row.get("license") or row
            enabled_members_total += int(lic.get("enabled_member_count") or row.get("enabled_member_count") or 0)
            projected_renewal_total += int(lic.get("renewal_cost") or row.get("renewal_cost") or 0)
            status = str(lic.get("status") or row.get("status") or "").lower()
            if status == "trial":
                trials_total += 1
            elif status == "paid":
                paid_total += 1
            if bool(lic.get("payment_required") or row.get("payment_required")):
                payment_required_total += 1

        return {
            "faction_licenses_total": len(factions),
            "trials_total": trials_total,
            "paid_total": paid_total,
            "payment_required_total": payment_required_total,
            "enabled_members_total": enabled_members_total,
            "projected_renewal_total": projected_renewal_total,
        }

    def get_faction_member_access(faction_id: str, member_user_id: str):
        return _get_faction_member(faction_id, member_user_id)

    def upsert_faction_member_access(
        faction_id: str,
        faction_name: str,
        leader_user_id: str,
        leader_name: str,
        member_user_id: str,
        member_name: str,
        member_api_key: str,
        enabled: int = 1,
        position: str = "",
    ):
        return _add_or_update_faction_member(
            faction_id=faction_id,
            leader_user_id=leader_user_id,
            member_user_id=member_user_id,
            member_name=member_name,
            member_api_key=member_api_key,
            enabled=enabled,
        )

    def delete_faction_member_access(faction_id: str, member_user_id: str):
        return _delete_faction_member(faction_id, member_user_id)


from torn_api import (
    me_basic,
    faction_basic,
    faction_wars,
    ranked_war_summary,
    profile_url,
    attack_url,
    bounty_url,
)

load_dotenv()

APP_NAME = "War Hub"
PAYMENT_PLAYER = str(os.getenv("PAYMENT_PLAYER", "Fries91")).strip() or "Fries91"
FACTION_MEMBER_PRICE = int(os.getenv("FACTION_MEMBER_PRICE", "2500000"))
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


def now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


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
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-License-Admin"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return resp


@app.after_request
def _after(resp):
    return with_cors(resp)


@app.route("/health", methods=["GET"])
def health():
    return ok(
        app=APP_NAME,
        now=utc_now(),
        base_url=BASE_URL(),
    )


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


@app.route("/api/options", methods=["OPTIONS"])
@app.route("/api/auth", methods=["OPTIONS"])
@app.route("/api/state", methods=["OPTIONS"])
def api_options():
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
    if "fries91" not in out:
        out.add("fries91")
    return out


def _session_is_owner(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    uid = str(user.get("user_id", "")).strip()
    name = str(user.get("name", "")).strip().lower()
    return (uid and uid in _owner_ids()) or (name and name in _owner_names())


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
        faction_position = str(user.get("faction_position", "") or "").strip().lower()
        if faction_position not in {"leader", "co-leader", "coleader"} and not _session_is_owner(user):
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


def _ranked_war_payload_for_user(api_key: str) -> Dict[str, Any]:
    wars = faction_wars(api_key) or {}
    summary = ranked_war_summary(wars) or {}

    our = summary.get("our_faction") or {}
    enemy = summary.get("enemy_faction") or {}
    war = summary.get("war") or {}

    war_id = str(war.get("war_id") or "")
    return {
        "war_id": war_id,
        "war": war,
        "our_faction": our,
        "enemy_faction": enemy,
        "members": summary.get("members") or [],
        "enemies": summary.get("enemies") or [],
        "is_ranked_war": bool(summary.get("is_ranked_war")),
        "has_war": bool(summary.get("has_war")),
        "score": {
            "our": _to_int((our or {}).get("score")),
            "enemy": _to_int((enemy or {}).get("score")),
            "target": _to_int((war or {}).get("target")),
        },
    }


def _status_class(member: Dict[str, Any]) -> str:
    online_state = str(member.get("online_state", "") or "").strip().lower()
    if online_state in {"online", "idle", "offline", "hospital"}:
        return online_state

    status = str(member.get("status", "") or "").strip().lower()
    status_detail = str(member.get("status_detail", "") or "").strip().lower()
    last_action = str(member.get("last_action", "") or "").strip().lower()

    joined = " ".join([status, status_detail, last_action]).strip()
    if "hospital" in joined:
        return "hospital"
    if "idle" in joined:
        return "idle"
    if "online" in joined:
        return "online"
    return "offline"


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

    if online_state in {"online", "idle", "offline", "hospital"}:
        return online_state

    s = " ".join([
        str(member.get("status", "") or ""),
        str(member.get("status_detail", "") or ""),
        str(member.get("last_action", "") or ""),
    ]).strip().lower()

    if "hospital" in s or hospital_seconds > 0:
        return "hospital"
    if "online" in s:
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
        hosp = _to_int(enemy_state.get("hospital_seconds"))
        if hosp > 0:
            status_class = "hospital"
            hospital_seconds = hosp

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
    m["chain_sitter"] = _safe_bool(m.get("chain_sitter"))
    return m


def _bucket_sort_key(member: Dict[str, Any]) -> Tuple[int, int, str]:
    bucket = str(member.get("activity_bucket") or "")
    order = {"online": 0, "idle": 1, "hospital": 2, "offline": 3, "other": 4}
    return (
        order.get(bucket, 9),
        _to_int(member.get("minutes_value"), 10**9),
        str(member.get("name") or "").lower(),
    )


def _normalize_assignment(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["war_id"] = str(r.get("war_id") or "")
    r["target_id"] = str(r.get("target_id") or "")
    r["assigned_to"] = str(r.get("assigned_to") or "")
    r["assigned_by"] = str(r.get("assigned_by") or "")
    r["target_name"] = str(r.get("target_name") or "")
    return r


def _normalize_note(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["war_id"] = str(r.get("war_id") or "")
    r["target_id"] = str(r.get("target_id") or "")
    r["note"] = str(r.get("note") or "")
    r["updated_by"] = str(r.get("updated_by") or "")
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
    r["member_api_key_masked"] = ""
    api_key = str(r.get("member_api_key") or "")
    if api_key:
        r["member_api_key_masked"] = ("*" * max(0, len(api_key) - 4)) + api_key[-4:]
    r["enabled"] = 1 if _safe_bool(r.get("enabled")) else 0
    return r


def _build_license_status_payload(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    status = compute_faction_license_status(faction_id, viewer_user_id=viewer_user_id) or {}
    status["faction_id"] = str(status.get("faction_id") or faction_id or "")
    status["payment_player"] = PAYMENT_PLAYER
    status["faction_member_price"] = FACTION_MEMBER_PRICE
    return status


def _require_json():
    if request.is_json:
        return request.get_json(silent=True) or {}
    data = request.form.to_dict() or {}
    if not data and request.data:
        try:
            import json
            parsed = json.loads(request.data.decode("utf-8"))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return data


@app.route("/api/auth", methods=["POST"])
def api_auth():
    if not _check_request_origin():
        return err("Blocked request origin.", 403)

    data = _require_json()
    api_key = str(data.get("api_key") or "").strip()
    leader_admin_key = str(data.get("leader_admin_key") or data.get("admin_key") or "").strip()

    if not api_key:
        return err("Missing api_key.", 400)

    me = me_basic(api_key)
    if not me or not str(me.get("user_id") or "").strip():
        return err("Invalid API key or Torn API unavailable.", 401)

    user_id = str(me.get("user_id")).strip()
    name = str(me.get("name") or "").strip()
    faction_id = str(me.get("faction_id") or "").strip()
    faction_name = str(me.get("faction_name") or "").strip()
    faction_position = str(me.get("faction_position") or "").strip()

    upsert_user(
        user_id=user_id,
        name=name,
        api_key=api_key,
        faction_id=faction_id,
        faction_name=faction_name,
        faction_position=faction_position,
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
        )

    is_leader = faction_position.strip().lower() in {"leader", "co-leader", "coleader"}
    if is_leader and faction_id:
        db_leader = get_user_map_by_faction(faction_id) or {}
        leader_api_key = api_key
        if leader_admin_key:
            set_user_setting(user_id, "leader_admin_key", leader_admin_key)
        elif db_leader:
            leader_api_key = str(db_leader.get("api_key") or api_key)

        ensure_faction_license_row(
            faction_id=faction_id,
            faction_name=faction_name,
            leader_user_id=user_id,
            leader_name=name,
            leader_api_key=leader_api_key,
        )

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    requires_payment = bool(license_status.get("payment_required"))
    status_name = str(license_status.get("status") or "").lower()

    if not _session_is_owner({"name": name, "user_id": user_id}):
        if faction_id and requires_payment and not is_leader:
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

        if faction_id and status_name == "expired":
            return err(
                "Faction license expired. Leader payment required.",
                403,
                code="license_expired",
                faction_id=faction_id,
                faction_name=faction_name,
                license=license_status,
            )

        if faction_id and status_name == "trial_expired":
            return err(
                "Faction trial expired. Leader payment required.",
                403,
                code="trial_expired",
                faction_id=faction_id,
                faction_name=faction_name,
                license=license_status,
            )

    delete_sessions_for_user(user_id)
    token = create_session(user_id)
    is_owner = _session_is_owner({"name": name, "user_id": user_id})

    return ok(
        message="Authenticated.",
        token=token,
                user={
            "user_id": user_id,
            "name": name,
            "faction_id": faction_id,
            "faction_name": faction_name,
            "faction_position": faction_position,
            "is_owner": is_owner,
            "is_leader": is_leader,
        },
        license=license_status,
    )


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
    members_map = faction_map or {}

    me = me_basic(api_key) or {}
    war_payload = _ranked_war_payload_for_user(api_key) if api_key else {
        "war_id": "",
        "war": {},
        "our_faction": {},
        "enemy_faction": {},
        "members": [],
        "enemies": [],
        "is_ranked_war": False,
        "has_war": False,
        "score": {"our": 0, "enemy": 0, "target": 0},
    }

    war_id = str(war_payload.get("war_id") or "")
    members = [_clean_member(members_map.get(str(m.get("user_id") or m.get("id") or ""), m)) for m in (war_payload.get("members") or [])]
    members = [_clean_member(m) for m in members]
    members.sort(key=_bucket_sort_key)

    enemies = _merge_enemy_state(war_payload.get("enemies") or [], war_id)

    assignments = [_normalize_assignment(x) for x in (list_target_assignments_for_war(war_id) if war_id else [])]
    notes = [_normalize_note(x) for x in (list_war_notes(war_id) if war_id else [])]
    terms = get_war_terms(faction_id) if faction_id else {}

    med_deals = list_med_deals_for_faction(faction_id) if faction_id else []
    targets = list_targets(faction_id) if faction_id else []
    bounties = list_bounties(faction_id) if faction_id else []
    notifications = list_notifications(user_id)
    mark_notifications_seen(user_id)

    owner_flags = {
        "is_owner": _session_is_owner(user),
        "is_leader": str(user.get("faction_position", "")).strip().lower() in {"leader", "co-leader", "coleader"},
    }

    settings = {
        "refresh_seconds": _to_int(get_user_setting(user_id, "refresh_seconds"), DEFAULT_REFRESH_SECONDS),
        "compact_mode": _safe_bool(get_user_setting(user_id, "compact_mode")),
        "leader_admin_key_saved": bool(str(get_user_setting(user_id, "leader_admin_key") or "").strip()),
    }

    return ok(
        now=utc_now(),
        me=me,
        user={
            "user_id": user_id,
            "name": str(user.get("name") or ""),
            "faction_id": faction_id,
            "faction_name": faction_name,
            "faction_position": str(user.get("faction_position") or ""),
            **owner_flags,
        },
        settings=settings,
        license=license_status,
        war=war_payload.get("war") or {},
        our_faction=war_payload.get("our_faction") or {},
        enemy_faction=war_payload.get("enemy_faction") or {},
        members=members,
        enemies=enemies,
        assignments=assignments,
        notes=notes,
        terms=terms or {},
        med_deals=med_deals or [],
        targets=targets or [],
        bounties=bounties or [],
        notifications=notifications or [],
        score=war_payload.get("score") or {"our": 0, "enemy": 0, "target": 0},
        has_war=bool(war_payload.get("has_war")),
        is_ranked_war=bool(war_payload.get("is_ranked_war")),
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
        meta={"available": available},
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
        meta={"enabled": enabled},
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

    if "leader_admin_key" in data:
        set_user_setting(user_id, "leader_admin_key", str(data.get("leader_admin_key") or "").strip())

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
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    item = add_med_deal(
        faction_id=faction_id,
        seller_name=str(data.get("seller_name") or "").strip(),
        item_name=str(data.get("item_name") or "").strip(),
        price=str(data.get("price") or "").strip(),
        note=str(data.get("note") or "").strip(),
        created_by=str(user.get("name") or ""),
    )
    return ok(message="Med deal added.", item=item)


@app.route("/api/med-deals/<int:item_id>", methods=["DELETE"])
@require_session
def api_delete_med_deal(item_id: int):
    delete_med_deal(item_id)
    return ok(message="Med deal deleted.", id=item_id)


@app.route("/api/targets", methods=["GET"])
@require_session
def api_list_targets():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    return ok(items=list_targets(faction_id) if faction_id else [])


@app.route("/api/targets", methods=["POST"])
@require_session
def api_add_target():
    user = request.user or {}
    data = _require_json()
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    target_id = str(data.get("target_id") or "").strip()
    if not target_id:
        return err("Missing target_id.", 400)

    item = add_target(
        faction_id=faction_id,
        target_id=target_id,
        target_name=str(data.get("target_name") or "").strip(),
        reason=str(data.get("reason") or "").strip(),
        created_by=str(user.get("name") or ""),
    )
    return ok(message="Target added.", item=item)


@app.route("/api/targets/<int:item_id>", methods=["DELETE"])
@require_session
def api_delete_target(item_id: int):
    delete_target(item_id)
    return ok(message="Target deleted.", id=item_id)


@app.route("/api/bounties", methods=["GET"])
@require_session
def api_list_bounties():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    return ok(items=list_bounties(faction_id) if faction_id else [])


@app.route("/api/bounties", methods=["POST"])
@require_session
def api_add_bounty():
    user = request.user or {}
    data = _require_json()
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    item = add_bounty(
        faction_id=faction_id,
        target_id=str(data.get("target_id") or "").strip(),
        target_name=str(data.get("target_name") or "").strip(),
        amount=str(data.get("amount") or "").strip(),
        note=str(data.get("note") or "").strip(),
        created_by=str(user.get("name") or ""),
    )
    return ok(message="Bounty added.", item=item)


@app.route("/api/bounties/<int:item_id>", methods=["DELETE"])
@require_session
def api_delete_bounty(item_id: int):
    delete_bounty(item_id)
    return ok(message="Bounty deleted.", id=item_id)


@app.route("/api/notifications", methods=["GET"])
@require_session
def api_notifications():
    user = request.user or {}
    items = list_notifications(str(user.get("user_id") or ""))
    mark_notifications_seen(str(user.get("user_id") or ""))
    return ok(items=items)


@app.route("/api/war/snapshot", methods=["POST"])
@require_session
def api_save_war_snapshot():
    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    if not api_key:
        return err("Missing API key.", 400)

    payload = _ranked_war_payload_for_user(api_key)
    war = payload.get("war") or {}
    our = payload.get("our_faction") or {}
    enemy = payload.get("enemy_faction") or {}
    war_id = str(payload.get("war_id") or "")

    if not war_id:
        return err("No active ranked war.", 400)

    item = save_war_snapshot(
        war_id=war_id,
        faction_id=str(user.get("faction_id") or ""),
        our_score=_to_int((payload.get("score") or {}).get("our")),
        enemy_score=_to_int((payload.get("score") or {}).get("enemy")),
        target_score=_to_int((payload.get("score") or {}).get("target")),
        payload={
            "war": war,
            "our_faction": our,
            "enemy_faction": enemy,
        },
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
    user = request.user or {}
    data = _require_json()

    war_id = str(data.get("war_id") or "").strip()
    enemy_id = str(data.get("enemy_id") or data.get("user_id") or "").strip()
    if not war_id or not enemy_id:
        return err("Missing war_id or enemy_id.", 400)

    row = upsert_enemy_state(
        war_id=war_id,
        enemy_id=enemy_id,
        enemy_name=str(data.get("enemy_name") or "").strip(),
        hospital_seconds=_to_int(data.get("hospital_seconds")),
        status_class=str(data.get("status_class") or "").strip(),
        updated_by=str(user.get("name") or ""),
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
        assigned_to=str(data.get("assigned_to") or "").strip(),
        assigned_by=str(user.get("name") or ""),
    )
    return ok(message="Assignment saved.", item=_normalize_assignment(row))


@app.route("/api/war/assignments", methods=["DELETE"])
@require_session
def api_delete_assignment():
    war_id = str(request.args.get("war_id") or "").strip()
    target_id = str(request.args.get("target_id") or "").strip()
    if not war_id or not target_id:
        return err("Missing war_id or target_id.", 400)

    delete_target_assignment(war_id, target_id)
    return ok(message="Assignment deleted.")


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
    if not war_id or not target_id:
        return err("Missing war_id or target_id.", 400)

    row = upsert_war_note(
        war_id=war_id,
        target_id=target_id,
        note=str(data.get("note") or "").strip(),
        updated_by=str(user.get("name") or ""),
    )
    return ok(message="Note saved.", item=_normalize_note(row))


@app.route("/api/war/notes", methods=["DELETE"])
@require_session
def api_delete_note():
    war_id = str(request.args.get("war_id") or "").strip()
    target_id = str(request.args.get("target_id") or "").strip()
    if not war_id or not target_id:
        return err("Missing war_id or target_id.", 400)

    delete_war_note(war_id, target_id)
    return ok(message="Note deleted.")


@app.route("/api/war-terms", methods=["GET"])
@require_session
def api_get_terms():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    return ok(item=get_war_terms(faction_id) if faction_id else {})


@app.route("/api/war-terms", methods=["POST"])
@require_leader_session
def api_upsert_terms():
    user = request.user or {}
    data = _require_json()
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    row = upsert_war_terms(
        faction_id=faction_id,
        terms=str(data.get("terms") or "").strip(),
        updated_by=str(user.get("name") or ""),
    )
    return ok(message="War terms saved.", item=row)


@app.route("/api/war-terms", methods=["DELETE"])
@require_leader_session
def api_delete_terms():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)
    delete_war_terms(faction_id)
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
        user_id=leader_user_id,
        title="Faction member access updated",
        body=f"{member_name or member_user_id} access updated.",
        kind="faction_access",
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
    member_count = _to_int(data.get("member_count"))
    note = str(data.get("note") or "").strip()

    row = renew_faction_after_payment(
        faction_id=str(faction_id),
        amount=amount,
        member_count=member_count,
        payment_player=PAYMENT_PLAYER,
        renewed_by=str(user.get("name") or ""),
        note=note,
    )
    return ok(message="Faction renewed.", item=row)


@app.route("/api/admin/faction-licenses/<faction_id>/expire", methods=["POST"])
@require_owner
def api_admin_faction_license_expire(faction_id: str):
    user = request.user or {}
    row = force_expire_faction_license(
        faction_id=str(faction_id),
        expired_by=str(user.get("name") or ""),
    )
    return ok(message="Faction expired.", item=row)


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
    member_count = _to_int(data.get("member_count"))
    renewed_by = str(data.get("renewed_by") or "license-admin").strip()
    note = str(data.get("note") or "").strip()

    row = renew_faction_after_payment(
        faction_id=str(faction_id),
        amount=amount,
        member_count=member_count,
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

    data = _require_json()
    expired_by = str(data.get("expired_by") or "license-admin").strip()

    row = force_expire_faction_license(
        faction_id=str(faction_id),
        expired_by=expired_by,
    )
    return ok(message="Faction expired.", item=row)


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


@app.route("/api/debug/session", methods=["GET"])
@require_session
def api_debug_session():
    return ok(
        session=request.session or {},
        user={
            "user_id": str((request.user or {}).get("user_id") or ""),
            "name": str((request.user or {}).get("name") or ""),
            "faction_id": str((request.user or {}).get("faction_id") or ""),
            "faction_name": str((request.user or {}).get("faction_name") or ""),
            "faction_position": str((request.user or {}).get("faction_position") or ""),
            "is_owner": _session_is_owner(request.user),
        },
    )


@app.route("/api/debug/compile-check", methods=["GET"])
def api_debug_compile_check():
    return ok(message="app.py compiled and routes loaded.")


@app.route("/api/debug/cache-purge", methods=["POST"])
@require_owner
def api_debug_cache_purge():
    purged = cache_purge_expired()
    return ok(message="Cache purge complete.", purged=purged)


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


init_db()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
