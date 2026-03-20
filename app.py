# ============================================================
# 01. IMPORTS
# ============================================================

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
    get_users_by_faction,
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
    get_current_faction_billing_cycle,
    list_faction_billing_cycles,
    create_faction_payment_intent,
    list_faction_payment_intents,
    get_faction_payment_intent,
    confirm_faction_payment_intent,
    cancel_faction_payment_intent,
    process_all_faction_payment_warnings,
    process_faction_payment_warnings,
    list_due_faction_licenses,
    get_faction_exemption,
    get_user_exemption,
    list_faction_exemptions,
    list_user_exemptions,
    upsert_faction_exemption,
    upsert_user_exemption,
    delete_faction_exemption,
    delete_user_exemption,
    get_faction_member_access,
    upsert_faction_member_access,
    set_faction_member_enabled,
    delete_faction_member_access,
    list_dibs_for_faction,
    add_dib,
    delete_dib,
)

from torn_api import (
    me_basic,
    faction_basic,
    ranked_war_summary,
    member_live_bars,
    profile_url,
    attack_url,
    bounty_url,
)

from payment_service import (
    activate_faction_member_for_billing,
    confirm_faction_payment_and_renew,
    create_manual_renewal_request,
    get_due_factions,
    get_faction_billing_overview,
    get_faction_payment_status,
    get_payment_dashboard,
    list_faction_payment_history_service,
    remove_member_from_billing,
    run_payment_auto_match,
    run_payment_due_scan,
    run_payment_warning_scan,
    set_member_billing_enabled,
)

load_dotenv()

# ============================================================
# 02. ENV / APP CONFIG
# ============================================================

APP_NAME = "War Hub"
PAYMENT_PLAYER = str(os.getenv("PAYMENT_PLAYER", "Fries91")).strip() or "Fries91"
FACTION_MEMBER_PRICE = int(os.getenv("PAYMENT_XANAX_PER_MEMBER", os.getenv("PAYMENT_PER_MEMBER", "3")))
DEFAULT_REFRESH_SECONDS = int(os.getenv("DEFAULT_REFRESH_SECONDS", "30"))
LICENSE_ADMIN_TOKEN = str(os.getenv("LICENSE_ADMIN_TOKEN", "")).strip()
ALLOWED_SCRIPT_ORIGINS = {
    "https://www.torn.com",
    "https://torn.com",
    "",
}

app = Flask(__name__, static_folder="static")


# ============================================================
# 03. GENERIC RESPONSE HELPERS
# BASE_URL(), utc_now(), ok(), err()
# ============================================================

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


# ============================================================
# 04. GENERIC PARSERS / REQUEST HELPERS
# _to_int(), _safe_bool(), _require_json(), _check_request_origin(),
# _require_license_admin()
# ============================================================

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


# ============================================================
# 05. AUTH / SESSION / CORS HELPERS
# with_cors(), _after(), api_options(), _session_user(),
# require_session()
# ============================================================

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


# ============================================================
# 06. OWNER / LEADER / ACCESS CONTROL
# _owner_ids(), _owner_names(), _session_is_owner(),
# _build_license_status_payload(), _get_exemption_payload(),
# _is_faction_leader(), _can_manage_faction(),
# _feature_access_for_user(), _require_feature_access(),
# require_owner(), require_leader_session()
# ============================================================

def _owner_ids() -> set:
    raw = str(os.getenv("OWNER_USER_IDS", "")).strip()
    out = {"3679030"}

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


def _get_exemption_payload(user_id: str = "", faction_id: str = "") -> Dict[str, Any]:
    faction_row = get_faction_exemption(faction_id) if faction_id else None
    user_row = get_user_exemption(user_id) if user_id else None
    return {
        "is_faction_exempt": bool(faction_row),
        "is_user_exempt": bool(user_row),
        "faction_exemption": faction_row or {},
        "user_exemption": user_row or {},
    }



def _exemption_admin_payload() -> Dict[str, Any]:
    faction_items = list_faction_exemptions() or []
    user_items = list_user_exemptions() or []
    return {
        "faction_exemptions": faction_items,
        "user_exemptions": user_items,
        "counts": {
            "faction_exemptions": len(faction_items),
            "user_exemptions": len(user_items),
            "total": len(faction_items) + len(user_items),
        },
    }


def _is_faction_leader(api_key: str, user_id: str, faction_id: str) -> bool:
    api_key = str(api_key or "").strip()
    user_id = str(user_id or "").strip()
    faction_id = str(faction_id or "").strip()

    if not api_key or not user_id or not faction_id:
        return False

    try:
        faction = faction_basic(api_key, faction_id=faction_id) or {}
        members = faction.get("members") or []
        for m in members:
            mid = str(m.get("user_id") or m.get("id") or "").strip()
            pos = str(m.get("position") or "").strip().lower()
            if mid == user_id:
                return pos == "leader"
    except Exception:
        return False

    return False


def _can_manage_faction(user: Dict[str, Any], faction_id: str) -> bool:
    if _session_is_owner(user):
        return True

    user_id = str((user or {}).get("user_id") or "").strip()
    faction_id = str(faction_id or "").strip()
    if not user_id or not faction_id:
        return False

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id)
    leader_user_id = str(license_status.get("leader_user_id") or "").strip()
    if leader_user_id == user_id:
        return True

    return _is_faction_leader(str((user or {}).get("api_key") or ""), user_id, faction_id)


def _feature_access_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()

    is_owner = _session_is_owner(user)
    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    leader_user_id = str(license_status.get("leader_user_id") or "").strip()
    exemption = _get_exemption_payload(user_id=user_id, faction_id=faction_id)

    is_leader = (
        is_owner
        or (leader_user_id == user_id)
        or _is_faction_leader(str(user.get("api_key") or ""), user_id, faction_id)
    )

    member_row = get_faction_member_access(faction_id, user_id) if faction_id and user_id else {}
    member_enabled = True if is_leader else _safe_bool((member_row or {}).get("enabled"))

    payment_required = bool(license_status.get("payment_required")) and not bool(exemption.get("is_faction_exempt"))
    expired = str(license_status.get("status") or "").lower() == "expired" and not bool(exemption.get("is_faction_exempt"))

    can_use_features = (
        is_owner
        or is_leader
        or bool(exemption.get("is_faction_exempt"))
        or bool(exemption.get("is_user_exempt"))
        or (member_enabled and not payment_required and not expired)
    )

    message = str(license_status.get("message") or "")
    if exemption.get("is_faction_exempt"):
        message = "Faction is exempt from payment and renewal."
    elif exemption.get("is_user_exempt"):
        message = "Player exemption active. Full script access is unlocked except Admin and leader-only tabs."

    return {
        "is_owner": is_owner,
        "is_admin": is_owner,
        "is_faction_leader": is_leader,
        "can_manage_faction": (is_owner or is_leader),
        "show_admin": is_owner,
        "show_all_tabs": is_owner,
        "member_enabled": member_enabled,
        "payment_required": payment_required,
        "expired": expired,
        "trial_active": bool(license_status.get("trial_active")),
        "status": "exempt_user" if exemption.get("is_user_exempt") and not exemption.get("is_faction_exempt") else str(license_status.get("status") or ""),
        "can_use_features": can_use_features,
        "is_user_exempt": bool(exemption.get("is_user_exempt")),
        "is_faction_exempt": bool(exemption.get("is_faction_exempt")),
        "message": message,
        "license": {**license_status, **exemption},
    }


def _require_feature_access():
    access = _feature_access_for_user(request.user or {})
    if not access.get("can_use_features"):
        return err(
            "Read-only access. Your leader must enable you, or faction payment is required.",
            403,
            code="read_only_access",
            access=access,
            license=access.get("license") or {},
        )
    return None


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


# ============================================================
# 07. WAR / MEMBER NORMALIZATION HELPERS
# _seconds_to_text(), _faction_basic_by_id(), _ranked_war_payload_for_user(),
# _parse_minutes_from_member(), _member_activity_bucket(), _clean_member(),
# _bucket_sort_key(), _normalize_assignment(), _normalize_note(),
# _normalize_dib(), _merge_enemy_state()
# ============================================================

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
        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
        }

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

    return {
        "ok": False,
        "faction_id": faction_id,
        "faction_name": "",
        "members": [],
    }


def _ranked_war_payload_for_user(
    api_key: str,
    my_faction_id: str = "",
    my_faction_name: str = "",
    war_api_key_source: str = "session_user_key",
) -> Dict[str, Any]:
    summary = ranked_war_summary(
        api_key,
        my_faction_id=my_faction_id,
        my_faction_name=my_faction_name,
    ) or {}

    war_id = str(summary.get("war_id") or "")
    raw_enemy_members = summary.get("enemy_members") or []
    debug_enemy_fetch = summary.get("debug_enemy_fetch") or {}
    enemy_faction_name = str(
        summary.get("enemy_faction_name")
        or debug_enemy_fetch.get("enemy_fetch_faction_name")
        or debug_enemy_fetch.get("enemy_name")
        or ""
    )

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
            "name": enemy_faction_name,
            "score": _to_int(summary.get("score_them")),
            "chain": _to_int(summary.get("chain_them")),
        },
        "enemy_faction_id": str(summary.get("enemy_faction_id") or ""),
        "enemy_faction_name": enemy_faction_name,
        "enemy_members_count": len(raw_enemy_members),
        "members_count": 0,
        "members": [],
        "enemies": raw_enemy_members,
        "debug_enemy_fetch": debug_enemy_fetch,
        "debug_factions": summary.get("debug_factions") or [],
        "debug_raw_keys": summary.get("debug_raw_keys") or [],
        "debug_raw": summary.get("debug_raw") or {},
        "source_note": str(summary.get("source_note") or ""),
        "war_api_key_source": war_api_key_source,
        "is_ranked_war": bool(summary.get("has_war")),
        "has_war": bool(summary.get("has_war")),
        "score": {
            "our": _to_int(summary.get("score_us")),
            "enemy": _to_int(summary.get("score_them")),
            "target": _to_int(summary.get("target_score")),
        },
        "my_user_id": "",
        "my_faction_id": str(summary.get("my_faction_id") or my_faction_id or ""),
        "my_faction_name": str(summary.get("my_faction_name") or my_faction_name or ""),
        "our_faction_id": str(summary.get("my_faction_id") or my_faction_id or ""),
        "our_faction_name": str(summary.get("my_faction_name") or my_faction_name or ""),
        "score_us": _to_int(summary.get("score_us")),
        "score_them": _to_int(summary.get("score_them")),
        "chain_us": _to_int(summary.get("chain_us")),
        "chain_them": _to_int(summary.get("chain_them")),
        "war_phase": str(summary.get("phase") or "none"),
        "war_type": str(summary.get("war_type") or ""),
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


def _normalize_dib(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["id"] = _to_int(r.get("id"))
    r["faction_id"] = str(r.get("faction_id") or "")
    r["faction_name"] = str(r.get("faction_name") or "")
    r["war_id"] = str(r.get("war_id") or "")
    r["target_id"] = str(r.get("target_id") or r.get("enemy_id") or "")
    r["target_name"] = str(r.get("target_name") or r.get("enemy_name") or "")
    r["claimer_user_id"] = str(
        r.get("claimer_user_id")
        or r.get("created_by_user_id")
        or r.get("user_id")
        or ""
    )
    r["claimer_name"] = str(
        r.get("claimer_name")
        or r.get("created_by_name")
        or r.get("name")
        or ""
    )
    r["note"] = str(r.get("note") or r.get("reason") or "")
    r["created_at"] = str(r.get("created_at") or "")
    return r


def _merge_enemy_state(enemies: List[Dict[str, Any]], war_id: str) -> List[Dict[str, Any]]:
    state_map = get_enemy_state_map(war_id) if war_id else {}
    merged = []
    seen_ids = set()

    for enemy in enemies or []:
        enemy_id = str(enemy.get("user_id") or enemy.get("id") or "").strip()
        if enemy_id and enemy_id in seen_ids:
            continue
        if enemy_id:
            seen_ids.add(enemy_id)

        st = state_map.get(enemy_id) if enemy_id else None
        merged.append(_clean_member(enemy, st))

    merged.sort(key=_bucket_sort_key)
    return merged


# ============================================================
# 08. PAYMENT / BILLING HELPERS
# _normalize_member_access_row(), _normalize_payment_cycle(),
# _normalize_payment_intent(), _payment_payload_for_faction()
# ============================================================

def _normalize_member_access_row(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["faction_id"] = str(r.get("faction_id") or "")
    r["leader_user_id"] = str(r.get("leader_user_id") or "")
    r["leader_name"] = str(r.get("leader_name") or "")
    r["member_user_id"] = str(r.get("member_user_id") or "")
    r["member_name"] = str(r.get("member_name") or "")
    r["position"] = str(r.get("position") or "")
    r["activated_at"] = str(r.get("activated_at") or "")
    r["last_renewed_at"] = str(r.get("last_renewed_at") or "")
    r["xanax_owed"] = _to_int(r.get("xanax_owed"), 0)
    r["cycle_locked"] = 1 if _safe_bool(r.get("cycle_locked")) else 0

    r["member_api_key_masked"] = ""
    api_key = str(r.get("member_api_key") or "")
    if api_key:
        r["member_api_key_masked"] = ("*" * max(0, len(api_key) - 4)) + api_key[-4:]

    r["enabled"] = 1 if _safe_bool(r.get("enabled")) else 0
    r["can_remove_now"] = 0 if (r["enabled"] and r["cycle_locked"]) else 1
    return r




def _normalize_payment_cycle(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["id"] = _to_int(r.get("id"))
    r["faction_id"] = str(r.get("faction_id") or "")
    r["cycle_status"] = str(r.get("cycle_status") or r.get("status") or "")
    r["amount_due"] = _to_int(r.get("amount_due"))
    r["amount_paid"] = _to_int(r.get("amount_paid"))
    r["enabled_member_count"] = _to_int(r.get("enabled_member_count"))
    r["payment_per_member"] = _to_int(r.get("payment_per_member"))
    return r


def _normalize_payment_intent(row: Dict[str, Any]) -> Dict[str, Any]:
    r = dict(row or {})
    r["id"] = _to_int(r.get("id"))
    r["faction_id"] = str(r.get("faction_id") or "")
    r["cycle_id"] = _to_int(r.get("cycle_id"))
    r["status"] = str(r.get("status") or "")
    r["amount_due"] = _to_int(r.get("amount_due"))
    r["pay_to_user_id"] = str(r.get("pay_to_user_id") or "")
    r["pay_to_name"] = str(r.get("pay_to_name") or "")
    return r


def _payment_payload_for_faction(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    license_status = _build_license_status_payload(faction_id, viewer_user_id=viewer_user_id) if faction_id else {}
    current_cycle = get_current_faction_billing_cycle(faction_id) if faction_id else {}
    intents = list_faction_payment_intents(faction_id=faction_id, status="pending", limit=10) if faction_id else []
    return {
        "license": license_status,
        "current_cycle": _normalize_payment_cycle(current_cycle or {}),
        "pending_intents": [_normalize_payment_intent(x) for x in (intents or [])],
        "payment_player": PAYMENT_PLAYER,
        "payment_per_member": FACTION_MEMBER_PRICE,
    }
# ============================================================
# 09. COMPAT WRAPPERS
# _add_med_deal_compat(), _delete_med_deal_compat(),
# _add_dib_compat(), _delete_dib_compat()
# ============================================================

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


def _add_dib_compat(
    *,
    user: Dict[str, Any],
    war_id: str,
    target_id: str,
    target_name: str,
    note: str,
):
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    user_name = str(user.get("name") or "").strip()

    try:
        return add_dib(
            faction_id=faction_id,
            faction_name=faction_name,
            war_id=war_id,
            target_id=target_id,
            target_name=target_name,
            claimer_user_id=user_id,
            claimer_name=user_name,
            note=note,
        )
    except TypeError:
        return add_dib(faction_id, war_id, target_id, target_name, user_id, user_name, note)


def _delete_dib_compat(faction_id: str, dib_id: int):
    try:
        return delete_dib(faction_id=faction_id, dib_id=int(dib_id))
    except TypeError:
        return delete_dib(faction_id, int(dib_id))


# ============================================================
# 10. BASIC / STATIC ROUTES
# /health, /, /static/<path>, /favicon.ico, /api/ping, /api/config
# ============================================================

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


# ============================================================
# 11. AUTH ROUTES
# /api/auth, /api/logout
# ============================================================

@app.route("/api/auth", methods=["POST"])
def api_auth():
    try:
        if not _check_request_origin():
            return err("Blocked request origin.", 403)

        data = _require_json()
        api_key = str(data.get("api_key") or "").strip()
        if not api_key:
            return err("Missing api_key.", 400)

        me = me_basic(api_key) or {}
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

        is_owner = _session_is_owner({"name": name, "user_id": user_id})
        leader_login = False

        if faction_id:
            leader_login = _is_faction_leader(api_key, user_id, faction_id)

            if leader_login:
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
        access = _feature_access_for_user({
            "user_id": user_id,
            "name": name,
            "api_key": api_key,
            "faction_id": faction_id,
            "faction_name": faction_name,
        })

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
                "is_admin": is_owner,
                "is_leader": access["is_faction_leader"],
            },
            access={
                "is_owner": bool(access.get("is_owner")),
                "is_admin": bool(access.get("is_admin")),
                "member_enabled": bool(access.get("member_enabled")),
                "is_faction_leader": bool(access.get("is_faction_leader")),
                "can_manage_faction": bool(access.get("can_manage_faction")),
                "show_admin": bool(access.get("show_admin")),
                "show_all_tabs": bool(access.get("show_all_tabs")),
                "payment_required": bool(access.get("payment_required")),
                "expired": bool(access.get("expired")),
                "trial_active": bool(access.get("trial_active")),
                "status": str(access.get("status") or ""),
                "can_use_features": bool(access.get("can_use_features")),
                "is_user_exempt": bool(access.get("is_user_exempt")),
                "is_faction_exempt": bool(access.get("is_faction_exempt")),
                "message": str(access.get("message") or ""),
            },
            license=access.get("license") or license_status,
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


def _enrich_members_with_saved_keys(
    members: List[Dict[str, Any]],
    faction_map: Dict[str, Any],
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for member in members or []:
        merged = dict(member or {})
        member_id = str(merged.get("user_id") or merged.get("id") or "").strip()

        row = faction_map.get(member_id) if member_id and isinstance(faction_map, dict) else None
        row = row if isinstance(row, dict) else {}

        member_api_key = str(
            row.get("member_api_key")
            or row.get("api_key")
            or ""
        ).strip()

        enabled = _safe_bool(row.get("enabled", True))

        if member_api_key and enabled:
            try:
                live = member_live_bars(member_api_key, member_id) or {}
            except Exception:
                live = {}

            live_user_id = str(live.get("user_id") or "").strip()
            bars = live.get("bars") or {}
            life = bars.get("life") or {}
            energy = bars.get("energy") or {}
            nerve = bars.get("nerve") or {}
            happy = bars.get("happy") or {}

            if live.get("ok") and (not live_user_id or live_user_id == member_id):
                merged["life_current"] = _to_int(life.get("current"))
                merged["life_max"] = _to_int(life.get("maximum"))
                merged["energy_current"] = _to_int(energy.get("current"))
                merged["energy_max"] = _to_int(energy.get("maximum"))
                merged["nerve_current"] = _to_int(nerve.get("current"))
                merged["nerve_max"] = _to_int(nerve.get("maximum"))
                merged["happy_current"] = _to_int(happy.get("current"))
                merged["happy_max"] = _to_int(happy.get("maximum"))
                merged["life_ticktime"] = _to_int(life.get("ticktime"))
                merged["energy_ticktime"] = _to_int(energy.get("ticktime"))
                merged["nerve_ticktime"] = _to_int(nerve.get("ticktime"))
                merged["happy_ticktime"] = _to_int(happy.get("ticktime"))
                merged["medical_cooldown"] = _to_int(
                    live.get("medical_cooldown")
                    or live.get("medicalCooldown")
                    or ((live.get("cooldowns") or {}).get("medical") if isinstance(live.get("cooldowns"), dict) else 0)
                )
                merged["cooldowns"] = live.get("cooldowns") if isinstance(live.get("cooldowns"), dict) else {}
                merged["live_stats_enabled"] = True
            else:
                merged["medical_cooldown"] = _to_int(merged.get("medical_cooldown"))
                merged["live_stats_enabled"] = False
        else:
            merged["live_stats_enabled"] = False

        out.append(merged)

    return out




def _first_stat(personalstats: Dict[str, Any], keys: List[str], default: int = 0) -> int:
    stats = personalstats or {}
    for key in keys:
        val = stats.get(key)
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str):
            s = val.strip().replace(',', '')
            if s.lstrip('-').isdigit():
                return int(s)
    return default


def _build_live_war_summary(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    viewer_user_id = str(user.get("user_id") or "").strip()
    viewer_key = str(user.get("api_key") or "").strip()

    if not faction_id:
        return {
            "ok": True,
            "war_id": "",
            "faction_id": "",
            "faction_name": "",
            "has_war": False,
            "members": [],
            "leaders": {},
            "totals": {},
            "meta": {"reason": "no_faction"},
        }

    license_status = _build_license_status_payload(faction_id, viewer_user_id=viewer_user_id) if faction_id else {}
    leader_user_id = str((license_status or {}).get("leader_user_id") or "").strip()
    leader_user = get_user(leader_user_id) if leader_user_id else None
    leader_key = str((leader_user or {}).get("api_key") or "").strip()

    war_key = leader_key or viewer_key
    war_api_key_source = "leader_user_key" if leader_key else ("session_user_key" if viewer_key else "missing")

    war_payload = _ranked_war_payload_for_user(
        war_key,
        my_faction_id=faction_id,
        my_faction_name=faction_name,
        war_api_key_source=war_api_key_source,
    ) if war_key else {
        "war_id": "",
        "war": {"active": False, "registered": False, "phase": "none", "status": "Currently not in war"},
        "score_us": 0,
        "score_them": 0,
        "chain_us": 0,
        "chain_them": 0,
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "members": [],
    }

    faction_fetch_key = war_key or viewer_key
    faction_info = _faction_basic_by_id(faction_fetch_key, faction_id) if faction_fetch_key else {"ok": False, "members": []}
    live_members = list((faction_info or {}).get("members") or [])

    users_by_faction = get_users_by_faction(faction_id) or []
    user_map = {str(x.get("user_id") or "").strip(): x for x in users_by_faction if str(x.get("user_id") or "").strip()}
    faction_member_rows = list_faction_members(faction_id) or []
    faction_member_map = {str(x.get("member_user_id") or "").strip(): x for x in faction_member_rows if str(x.get("member_user_id") or "").strip()}

    items = []
    synced_count = 0
    unsynced_count = 0

    for member in live_members:
        member_user_id = str(member.get("user_id") or member.get("id") or "").strip()
        if not member_user_id:
            continue

        saved_user = user_map.get(member_user_id) or {}
        access_row = faction_member_map.get(member_user_id) or {}
        is_viewer_member = bool(member_user_id and viewer_user_id and member_user_id == viewer_user_id)

        member_key = str(
            (viewer_key if is_viewer_member else "")
            or access_row.get("member_api_key")
            or saved_user.get("api_key")
        ).strip()

        live = {
            "ok": False,
            "user_id": member_user_id,
            "personalstats": {},
            "cooldowns": {},
            "bars": {},
            "states": {},
            "status": {},
            "medical_cooldown": 0,
        }

        if member_key:
            if is_viewer_member:
                live = member_live_bars(member_key)

                live_user_id = str(live.get("user_id") or "").strip()
                if not live.get("ok") or (live_user_id and live_user_id != member_user_id):
                    fallback_live = member_live_bars(member_key, user_id=member_user_id)
                    fallback_user_id = str(fallback_live.get("user_id") or "").strip()
                    if fallback_live.get("ok") and (not fallback_user_id or fallback_user_id == member_user_id):
                        live = fallback_live
            else:
                live = member_live_bars(member_key, user_id=member_user_id)
        synced = bool(live.get("ok"))
        if synced:
            synced_count += 1
        else:
            unsynced_count += 1

        personalstats = live.get("personalstats") or {}

        hits = _first_stat(personalstats, [
            "rankedwarhits", "ranked_war_hits", "attackhits", "attackswon", "attacks_won"
        ], 0)
        respect_gain = _first_stat(personalstats, [
            "respectforfaction", "respectforyourfaction", "rankedwarrespect", "ranked_war_respect", "respect"
        ], 0)
        respect_lost = _first_stat(personalstats, [
            "respectlost", "rankedwarrespectlost", "ranked_war_respect_lost", "respectforenemy"
        ], 0)
        attacks_lost = _first_stat(personalstats, [
            "attackslost", "defendslost", "attacks_lost"
        ], 0)
        bleed_value = respect_lost if respect_lost > 0 else attacks_lost
        bleed_source = "respect_lost" if respect_lost > 0 else ("attacks_lost" if attacks_lost > 0 else "none")

        life = ((live.get("bars") or {}).get("life") or {})
        energy = ((live.get("bars") or {}).get("energy") or {})
        nerve = ((live.get("bars") or {}).get("nerve") or {})

        items.append({
            "user_id": member_user_id,
            "name": str(member.get("name") or saved_user.get("name") or access_row.get("member_name") or member_user_id),
            "position": str(member.get("position") or access_row.get("position") or ""),
            "status": str(member.get("status_detail") or member.get("status") or member.get("last_action") or ""),
            "online_state": str(member.get("online_state") or live.get("states", {}).get("status") or ""),
            "hospital_seconds": _to_int(member.get("hospital_seconds")),
            "profile_url": member.get("profile_url") or profile_url(member_user_id),
            "attack_url": member.get("attack_url") or attack_url(member_user_id),
            "bounty_url": member.get("bounty_url") or bounty_url(member_user_id),
            "bars": {
                "life_current": _to_int(life.get("current")),
                "life_max": _to_int(life.get("maximum")),
                "energy_current": _to_int(energy.get("current")),
                "energy_max": _to_int(energy.get("maximum")),
                "nerve_current": _to_int(nerve.get("current")),
                "nerve_max": _to_int(nerve.get("maximum")),
            },
            "stats": {
                "hits": hits,
                "respect_gain": respect_gain,
                "respect_lost": respect_lost,
                "attacks_lost": attacks_lost,
                "bleed_value": bleed_value,
                "bleed_source": bleed_source,
            },
            "synced": synced,
            "sync_source": "member_key" if member_key else "none",
        })

    def _leader_by(stat_key: str) -> Dict[str, Any]:
        ranked = sorted(items, key=lambda x: (int(((x.get("stats") or {}).get(stat_key) or 0)), str(x.get("name") or "").lower()), reverse=True)
        if not ranked:
            return {}
        top = ranked[0]
        value = int(((top.get("stats") or {}).get(stat_key) or 0))
        if value <= 0:
            return {}
        return {
            "user_id": str(top.get("user_id") or ""),
            "name": str(top.get("name") or "Unknown"),
            "value": value,
            "profile_url": top.get("profile_url") or profile_url(str(top.get("user_id") or "")),
        }

    items.sort(key=lambda x: (
        -int(((x.get("stats") or {}).get("hits") or 0)),
        -int(((x.get("stats") or {}).get("respect_gain") or 0)),
        str(x.get("name") or "").lower(),
    ))

    totals = {
        "members_total": len(items),
        "synced_members": synced_count,
        "unsynced_members": unsynced_count,
        "hits": sum(int(((x.get("stats") or {}).get("hits") or 0)) for x in items),
        "respect_gain": sum(int(((x.get("stats") or {}).get("respect_gain") or 0)) for x in items),
        "respect_lost": sum(int(((x.get("stats") or {}).get("respect_lost") or 0)) for x in items),
        "bleed_value": sum(int(((x.get("stats") or {}).get("bleed_value") or 0)) for x in items),
    }

    return {
        "ok": True,
        "war_id": str(war_payload.get("war_id") or ""),
        "faction_id": faction_id,
        "faction_name": str((faction_info or {}).get("faction_name") or faction_name or ""),
        "enemy_faction_id": str(war_payload.get("enemy_faction_id") or ""),
        "enemy_faction_name": str(war_payload.get("enemy_faction_name") or ""),
        "has_war": bool(war_payload.get("has_war")),
        "war": war_payload.get("war") or {},
        "score": war_payload.get("score") or {},
        "leaders": {
            "top_hitter": _leader_by("hits"),
            "top_respect_gain": _leader_by("respect_gain"),
            "top_points_bleeder": _leader_by("bleed_value"),
        },
        "totals": totals,
        "members": items,
        "meta": {
            "war_api_key_source": war_payload.get("war_api_key_source") or war_api_key_source,
            "bleeder_metric": "respect_lost_then_attacks_lost_fallback",
            "generated_at": utc_now(),
        },
    }


@app.route("/api/war/summary-live", methods=["GET"])
@require_session
def api_war_summary_live():
    blocked = _require_feature_access()
    if blocked:
        return blocked
    return ok(item=_build_live_war_summary(request.user or {}))

@app.route("/api/war/enemies", methods=["GET"])
@require_session
def api_war_enemies():
    blocked = _require_feature_access()
    if blocked:
        return blocked

    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    requested_war_id = str(request.args.get("war_id") or "").strip()

    if not faction_id:
        return err("No faction found.", 400)

    viewer_war_api_key = api_key or ""
    leader_war_api_key = ""
    war_api_key = viewer_war_api_key
    war_api_key_source = "session_user_key" if viewer_war_api_key else "missing"

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    leader_user_id = str((license_status or {}).get("leader_user_id") or "").strip()
    if leader_user_id:
        try:
            leader_user = get_user(leader_user_id) or {}
        except Exception:
            leader_user = {}
        leader_war_api_key = str((leader_user or {}).get("api_key") or "").strip()

    if leader_war_api_key:
        war_api_key = leader_war_api_key
        war_api_key_source = "leader_user_key"

    if not war_api_key:
        return err("No war API key available.", 400)

    war_info = ranked_war_summary(
        war_api_key,
        my_faction_id=faction_id,
        my_faction_name=faction_name,
    ) or {
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

    war_id = str(war_info.get("war_id") or "").strip()
    if requested_war_id and war_id and requested_war_id != war_id:
        return err(
            "Requested war_id does not match current active war.",
            409,
            requested_war_id=requested_war_id,
            current_war_id=war_id,
        )

    enemy_faction_id = str(war_info.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war_info.get("enemy_faction_name") or "").strip()
    raw_enemy_members = war_info.get("enemy_members") or []

    our_faction_id = str(war_info.get("my_faction_id") or faction_id or "").strip()
    our_faction_name = str(war_info.get("my_faction_name") or faction_name or "").strip().lower()

    if enemy_faction_id and our_faction_id and enemy_faction_id == our_faction_id:
        enemy_faction_id = ""
        enemy_faction_name = ""
        raw_enemy_members = []

    if (
        enemy_faction_name
        and our_faction_name
        and enemy_faction_name.strip().lower() == our_faction_name
        and not enemy_faction_id
        and not raw_enemy_members
    ):
        enemy_faction_name = ""

    fallback_sides = [x for x in (war_info.get("debug_factions") or []) if isinstance(x, dict)]

    if not enemy_faction_id or not enemy_faction_name:
        for side in fallback_sides:
            side_id = str(side.get("faction_id") or "").strip()
            side_name = str(side.get("faction_name") or "").strip()

            if side_id and our_faction_id and side_id == our_faction_id:
                continue
            if side_name and our_faction_name and side_name.lower() == our_faction_name:
                continue

            if not enemy_faction_id and side_id:
                enemy_faction_id = side_id
            if not enemy_faction_name and side_name:
                enemy_faction_name = side_name

            if enemy_faction_id and enemy_faction_name:
                break

    faction_fetch_key = war_api_key or viewer_war_api_key
    if ((not raw_enemy_members) or (not enemy_faction_name)) and enemy_faction_id and faction_fetch_key:
        enemy_faction_info = _faction_basic_by_id(faction_fetch_key, enemy_faction_id)
        if enemy_faction_info.get("ok"):
            fetched_enemy_id = str(enemy_faction_info.get("faction_id") or enemy_faction_id or "").strip()
            fetched_enemy_name = str(
                enemy_faction_info.get("faction_name")
                or enemy_faction_name
                or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_fetch_faction_name"))
                or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_name"))
                or ""
            ).strip()

            if not our_faction_id or fetched_enemy_id != our_faction_id:
                enemy_faction_id = fetched_enemy_id or enemy_faction_id
                enemy_faction_name = fetched_enemy_name or enemy_faction_name
                raw_enemy_members = enemy_faction_info.get("members") or raw_enemy_members

    if raw_enemy_members:
        our_faction_info = _faction_basic_by_id(faction_fetch_key, our_faction_id) if faction_fetch_key and our_faction_id else {}
        our_members = our_faction_info.get("members") or []
        our_member_ids = {
            str(m.get("user_id") or m.get("id") or "").strip()
            for m in our_members
            if str(m.get("user_id") or m.get("id") or "").strip()
        }

        seen_enemy_ids = set()
        filtered_enemy_members = []

        for enemy in raw_enemy_members:
            enemy_user_id = str(enemy.get("user_id") or enemy.get("id") or "").strip()
            if enemy_user_id and enemy_user_id in our_member_ids:
                continue
            if enemy_user_id and enemy_user_id in seen_enemy_ids:
                continue
            if enemy_user_id:
                seen_enemy_ids.add(enemy_user_id)
            filtered_enemy_members.append(enemy)

        raw_enemy_members = filtered_enemy_members

    enemies = _merge_enemy_state(raw_enemy_members, war_id) if raw_enemy_members else []

    enemy_faction_name = str(
        enemy_faction_name
        or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_fetch_faction_name"))
        or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_name"))
        or ""
    ).strip()

    return ok(
        war_id=war_id,
        requested_war_id=requested_war_id,
        enemy_faction_id=enemy_faction_id,
        enemy_faction_name=enemy_faction_name,
        enemy_members=enemies,
        enemyMembers=enemies,
        enemies=enemies,
        enemy_members_count=len(enemies),
        has_war=bool(war_info.get("has_war")),
        war_api_key_source=war_api_key_source,
        debug={
            "source_note": str(war_info.get("source_note") or ""),
            "debug_enemy_fetch": war_info.get("debug_enemy_fetch") or {},
            "debug_factions": war_info.get("debug_factions") or [],
            "current_war_id": war_id,
            "requested_war_id": requested_war_id,
            "our_faction_id": our_faction_id,
            "our_faction_name": our_faction_name,
            "enemy_faction_id": enemy_faction_id,
            "enemy_faction_name": enemy_faction_name,
            "enemy_members_count": len(enemies),
        },
    )
    
# ============================================================
# 12. STATE / WAR ROUTES
# /api/state, /api/war/*, /api/faction/basic, /api/enemies, etc.
# ============================================================

@app.route("/api/state", methods=["GET"])
@require_session
def api_state():
    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    access = _feature_access_for_user(user)
    faction_map = get_user_map_by_faction(faction_id) if faction_id else {}

    me = me_basic(api_key) or {}
    me = {
        **dict(me or {}),
        "available": 1 if _safe_bool((user or {}).get("available")) else 0,
        "chain_sitter": 1 if _safe_bool((user or {}).get("chain_sitter")) else 0,
    }
    live_faction_id = str(me.get("faction_id") or faction_id or "").strip()
    live_faction_name = str(me.get("faction_name") or faction_name or "").strip()

    if live_faction_id and live_faction_id != faction_id:
        faction_id = live_faction_id
        faction_name = live_faction_name
        license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
        access = _feature_access_for_user({**user, "faction_id": faction_id, "faction_name": faction_name})
        faction_map = get_user_map_by_faction(faction_id) if faction_id else {}

    viewer_war_api_key = api_key or ""
    leader_war_api_key = ""
    war_api_key = viewer_war_api_key
    war_api_key_source = "session_user_key" if viewer_war_api_key else "missing"

    leader_user_id = str((license_status or {}).get("leader_user_id") or "").strip()
    if leader_user_id:
        try:
            leader_user = get_user(leader_user_id) or {}
        except Exception:
            leader_user = {}
        leader_war_api_key = str((leader_user or {}).get("api_key") or "").strip()

    if leader_war_api_key:
        war_api_key = leader_war_api_key
        war_api_key_source = "leader_user_key"

    faction_fetch_key = war_api_key or viewer_war_api_key
    faction_info = faction_basic(faction_fetch_key, faction_id=faction_id) if faction_fetch_key else {"ok": False, "members": []}

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

    raw_members = []
    for m in (faction_info.get("members") or []):
        member_id = str(m.get("user_id") or m.get("id") or "")
        merged = dict(m)
        if member_id and member_id in faction_map:
            merged.update({k: v for k, v in faction_map[member_id].items() if v not in (None, "")})
        raw_members.append(merged)

    enriched_members = _enrich_members_with_saved_keys(raw_members, faction_map or {})

    members = [_clean_member(x) for x in enriched_members]
    members.sort(key=_bucket_sort_key)
    chain_sitters = [m for m in members if _safe_bool(m.get("chain_sitter"))]

    war_id = str(war_info.get("war_id") or "")
    enemy_faction_id = str(war_info.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war_info.get("enemy_faction_name") or "").strip()

    raw_enemy_members = war_info.get("enemy_members") or []
    enemies: List[Dict[str, Any]] = []

    our_faction_id = str(war_info.get("my_faction_id") or live_faction_id or "").strip()
    our_faction_name = str(war_info.get("my_faction_name") or live_faction_name or "").strip().lower()

    if enemy_faction_id and our_faction_id and enemy_faction_id == our_faction_id:
        enemy_faction_id = ""
        enemy_faction_name = ""
        raw_enemy_members = []

    if (
        enemy_faction_name
        and our_faction_name
        and enemy_faction_name.strip().lower() == our_faction_name
        and not enemy_faction_id
        and not raw_enemy_members
    ):
        enemy_faction_name = ""

    has_war = bool(war_info.get("has_war"))

    if has_war or enemy_faction_id or enemy_faction_name or raw_enemy_members:
        fallback_sides = [x for x in (war_info.get("debug_factions") or []) if isinstance(x, dict)]

        if not enemy_faction_id or not enemy_faction_name:
            for side in fallback_sides:
                side_id = str(side.get("faction_id") or "").strip()
                side_name = str(side.get("faction_name") or "").strip()

                if side_id and our_faction_id and side_id == our_faction_id:
                    continue
                if side_name and our_faction_name and side_name.lower() == our_faction_name:
                    continue

                if not enemy_faction_id and side_id:
                    enemy_faction_id = side_id
                if not enemy_faction_name and side_name:
                    enemy_faction_name = side_name

                if enemy_faction_id and enemy_faction_name:
                    break

        if ((not raw_enemy_members) or (not enemy_faction_name)) and enemy_faction_id and faction_fetch_key:
            enemy_faction_info = _faction_basic_by_id(faction_fetch_key, enemy_faction_id)
            if enemy_faction_info.get("ok"):
                fetched_enemy_id = str(enemy_faction_info.get("faction_id") or enemy_faction_id or "").strip()
                fetched_enemy_name = str(
                    enemy_faction_info.get("faction_name")
                    or enemy_faction_name
                    or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_name"))
                    or ""
                ).strip()

                if not our_faction_id or fetched_enemy_id != our_faction_id:
                    enemy_faction_id = fetched_enemy_id or enemy_faction_id
                    enemy_faction_name = fetched_enemy_name or enemy_faction_name
                    raw_enemy_members = enemy_faction_info.get("members") or raw_enemy_members

        if raw_enemy_members:
            our_member_ids = {
                str(m.get("user_id") or m.get("id") or "").strip()
                for m in members
                if str(m.get("user_id") or m.get("id") or "").strip()
            }
            seen_enemy_ids = set()
            filtered_enemy_members = []

            for enemy in raw_enemy_members:
                enemy_user_id = str(enemy.get("user_id") or enemy.get("id") or "").strip()
                if enemy_user_id and enemy_user_id in our_member_ids:
                    continue
                if enemy_user_id and enemy_user_id in seen_enemy_ids:
                    continue
                if enemy_user_id:
                    seen_enemy_ids.add(enemy_user_id)
                filtered_enemy_members.append(enemy)

            raw_enemy_members = filtered_enemy_members
            enemies = _merge_enemy_state(raw_enemy_members, war_id)

    assignments = [_normalize_assignment(x) for x in (list_target_assignments_for_war(war_id) if war_id else [])]
    notes = [_normalize_note(x) for x in (list_war_notes(war_id) if war_id else [])]
    terms = get_war_terms(war_id) if war_id else {}
    dibs = [_normalize_dib(x) for x in (list_dibs_for_faction(faction_id, war_id=war_id) if faction_id else [])]

    med_deals = list_med_deals_for_faction(faction_id) if faction_id else []
    targets = list_targets(user_id) if user_id else []
    bounties = list_bounties(user_id) if user_id else []
    notifications = list_notifications(user_id)
    mark_notifications_seen(user_id)

    settings = {
        "refresh_seconds": _to_int(get_user_setting(user_id, "refresh_seconds"), DEFAULT_REFRESH_SECONDS),
        "compact_mode": _safe_bool(get_user_setting(user_id, "compact_mode")),
    }

    war_payload = {
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
        "debug_factions": war_info.get("debug_factions") or [],
        "debug_raw_keys": war_info.get("debug_raw_keys") or [],
        "debug_raw": war_info.get("debug_raw") or {},
        "source_note": str(war_info.get("source_note") or ""),
    }

    our_faction_payload = {
        "faction_id": str(war_info.get("my_faction_id") or live_faction_id or ""),
        "name": str(war_info.get("my_faction_name") or live_faction_name or ""),
        "score": _to_int(war_info.get("score_us")),
        "chain": _to_int(war_info.get("chain_us")),
    }

    enemy_faction_name = str(
        enemy_faction_name
        or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_fetch_faction_name"))
        or ((war_info.get("debug_enemy_fetch") or {}).get("enemy_name"))
        or ""
    ).strip()

    enemy_faction_payload = {
        "faction_id": enemy_faction_id,
        "name": enemy_faction_name,
        "score": _to_int(war_info.get("score_them")),
        "chain": _to_int(war_info.get("chain_them")),
    }

    score_payload = {
        "our": _to_int(war_info.get("score_us")),
        "enemy": _to_int(war_info.get("score_them")),
        "target": _to_int(war_info.get("target_score")),
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
            "is_admin": bool(access.get("is_owner")),
            "is_leader": bool(access.get("is_faction_leader")),
        },
        access={
            "is_owner": bool(access.get("is_owner")),
            "is_admin": bool(access.get("is_admin")),
            "is_faction_leader": bool(access.get("is_faction_leader")),
            "can_manage_faction": bool(access.get("can_manage_faction")),
            "show_admin": bool(access.get("show_admin")),
            "show_all_tabs": bool(access.get("show_all_tabs")),
            "member_enabled": bool(access.get("member_enabled")),
            "payment_required": bool(access.get("payment_required")),
            "expired": bool(access.get("expired")),
            "trial_active": bool(access.get("trial_active")),
            "status": str(access.get("status") or ""),
            "can_use_features": bool(access.get("can_use_features")),
            "is_user_exempt": bool(access.get("is_user_exempt")),
            "is_faction_exempt": bool(access.get("is_faction_exempt")),
            "message": str(access.get("message") or ""),
        },
        settings=settings,
        license=access.get("license") or license_status,
        war=war_payload,
        faction=our_faction_payload,
        our_faction=our_faction_payload,
        enemy_faction=enemy_faction_payload,
        enemyFaction=enemy_faction_payload,
        enemy_faction_id=enemy_faction_id,
        enemy_faction_name=enemy_faction_name,
        enemy_members_count=len(raw_enemy_members or []),
        enemy_members=enemies,
        enemyMembers=enemies,
        members_count=len(members or []),
        members=members,
        chain_sitters=chain_sitters,
        chainSitters=chain_sitters,
        enemies=enemies,
        assignments=assignments,
        notes=notes,
        terms=terms,
        dibs=dibs,
        med_deals=med_deals,
        medDeals=med_deals,
        targets=targets,
        bounties=bounties,
        notifications=notifications,
        score=score_payload,
        has_war=has_war,
        is_ranked_war=has_war,
        debug={
            "debug_enemy_fetch": war_info.get("debug_enemy_fetch") or {},
            "source_note": str(war_info.get("source_note") or ""),
            "my_user_id": user_id,
            "my_faction_id": str(war_info.get("my_faction_id") or ""),
            "my_faction_name": str(war_info.get("my_faction_name") or ""),
            "our_faction_id": our_faction_id,
            "our_faction_name": our_faction_name,
            "enemy_faction_id": enemy_faction_id,
            "enemy_faction_name": enemy_faction_name,
            "enemy_members_count": len(raw_enemy_members or []),
            "members_count": len(members or []),
            "score_us": _to_int(war_info.get("score_us")),
            "score_them": _to_int(war_info.get("score_them")),
            "chain_us": _to_int(war_info.get("chain_us")),
            "chain_them": _to_int(war_info.get("chain_them")),
            "debug_factions": war_info.get("debug_factions") or [],
            "debug_raw_keys": war_info.get("debug_raw_keys") or [],
            "debug_raw": war_info.get("debug_raw") or {},
            "war_api_key_source": war_api_key_source,
        },
    )
@app.route("/api/war/summary", methods=["GET"])
@require_session
def api_war_summary():
    user = request.user or {}
    api_key = str(user.get("api_key") or "").strip()
    if not api_key:
        return err("Missing API key.", 400)

    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    viewer_war_api_key = api_key
    war_api_key = viewer_war_api_key
    war_api_key_source = "session_user_key" if viewer_war_api_key else "missing"

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    leader_user_id = str((license_status or {}).get("leader_user_id") or "").strip()
    leader_war_api_key = ""
    if leader_user_id:
        try:
            leader_user = get_user(leader_user_id) or {}
        except Exception:
            leader_user = {}
        leader_war_api_key = str((leader_user or {}).get("api_key") or "").strip()

    if leader_war_api_key:
        war_api_key = leader_war_api_key
        war_api_key_source = "leader_user_key"

    faction_fetch_key = war_api_key or viewer_war_api_key
    payload = _ranked_war_payload_for_user(
        war_api_key,
        my_faction_id=faction_id,
        my_faction_name=faction_name,
        war_api_key_source=war_api_key_source,
    )
    payload["my_user_id"] = user_id
    payload["is_owner"] = _session_is_owner(user)
    payload["is_admin"] = _session_is_owner(user)

    faction_info = faction_basic(faction_fetch_key, faction_id=faction_id) if (faction_fetch_key and faction_id) else {"ok": False, "members": []}
    payload["members_count"] = len((faction_info or {}).get("members") or [])

    raw_enemy_members = list((payload.get("enemies") or []))
    enemy_faction_id = str(payload.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(payload.get("enemy_faction_name") or "").strip()
    debug_enemy_fetch = payload.get("debug_enemy_fetch") or {}
    our_faction_id = str(payload.get("our_faction_id") or faction_id or "").strip()
    our_faction_name = str(payload.get("our_faction_name") or faction_name or "").strip().lower()
    war_id = str(payload.get("war_id") or "")

    if enemy_faction_id and our_faction_id and enemy_faction_id == our_faction_id:
        enemy_faction_id = ""
        enemy_faction_name = ""
        raw_enemy_members = []

    if (
        enemy_faction_name
        and our_faction_name
        and enemy_faction_name.strip().lower() == our_faction_name
        and not enemy_faction_id
        and not raw_enemy_members
    ):
        enemy_faction_name = ""

    fallback_sides = [x for x in (payload.get("debug_factions") or []) if isinstance(x, dict)]
    if not enemy_faction_id or not enemy_faction_name:
        for side in fallback_sides:
            side_id = str(side.get("faction_id") or "").strip()
            side_name = str(side.get("faction_name") or "").strip()
            if side_id and our_faction_id and side_id == our_faction_id:
                continue
            if side_name and our_faction_name and side_name.lower() == our_faction_name:
                continue
            if not enemy_faction_id and side_id:
                enemy_faction_id = side_id
            if not enemy_faction_name and side_name:
                enemy_faction_name = side_name
            if enemy_faction_id and enemy_faction_name:
                break

    if ((not raw_enemy_members) or (not enemy_faction_name)) and enemy_faction_id and faction_fetch_key:
        enemy_faction_info = _faction_basic_by_id(faction_fetch_key, enemy_faction_id)
        if enemy_faction_info.get("ok"):
            fetched_enemy_id = str(enemy_faction_info.get("faction_id") or enemy_faction_id or "").strip()
            fetched_enemy_name = str(
                enemy_faction_info.get("faction_name")
                or enemy_faction_name
                or debug_enemy_fetch.get("enemy_name")
                or ""
            ).strip()
            if not our_faction_id or fetched_enemy_id != our_faction_id:
                enemy_faction_id = fetched_enemy_id or enemy_faction_id
                enemy_faction_name = fetched_enemy_name or enemy_faction_name
                raw_enemy_members = enemy_faction_info.get("members") or raw_enemy_members

    members_raw = list((faction_info or {}).get("members") or [])
    our_member_ids = {
        str(m.get("user_id") or m.get("id") or "").strip()
        for m in members_raw
        if str(m.get("user_id") or m.get("id") or "").strip()
    }
    filtered_enemy_members = []
    seen_enemy_ids = set()
    for enemy in raw_enemy_members:
        enemy_user_id = str(enemy.get("user_id") or enemy.get("id") or "").strip()
        if enemy_user_id and enemy_user_id in our_member_ids:
            continue
        if enemy_user_id and enemy_user_id in seen_enemy_ids:
            continue
        if enemy_user_id:
            seen_enemy_ids.add(enemy_user_id)
        filtered_enemy_members.append(enemy)

    enemies = _merge_enemy_state(filtered_enemy_members, war_id) if filtered_enemy_members else []

    payload["enemy_faction_id"] = enemy_faction_id
    payload["enemy_faction_name"] = str(
        enemy_faction_name
        or debug_enemy_fetch.get("enemy_fetch_faction_name")
        or debug_enemy_fetch.get("enemy_name")
        or ""
    ).strip()
    payload["enemy_faction"] = {
        **dict(payload.get("enemy_faction") or {}),
        "faction_id": enemy_faction_id,
        "name": payload["enemy_faction_name"],
    }
    payload["enemyFaction"] = payload["enemy_faction"]
    payload["enemies"] = enemies
    payload["enemy_members"] = enemies
    payload["enemyMembers"] = enemies
    payload["enemy_members_count"] = len(filtered_enemy_members)
    if isinstance(payload.get("war"), dict):
        payload["war"]["enemy_members"] = enemies
        payload["war"]["enemy_members_count"] = len(filtered_enemy_members)
    return ok(**payload)


# ============================================================
# 13. PLAYER ACTION ROUTES
# availability, chain-sitter, settings, notifications
# ============================================================

@app.route("/api/availability", methods=["POST"])
@require_session
def api_set_availability():
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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


# ============================================================
# 14. SHARED WAR TOOL ROUTES
# med-deals, dibs, targets, bounties, assignments, notes, terms
# ============================================================

@app.route("/api/med-deals", methods=["GET"])
@require_session
def api_list_med_deals():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    return ok(items=list_med_deals_for_faction(faction_id) if faction_id else [])


@app.route("/api/med-deals", methods=["POST"])
@require_session
def api_add_med_deal():
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    _delete_med_deal_compat(faction_id, int(deal_id))
    return ok(message="Med deal deleted.", id=deal_id)


@app.route("/api/dibs", methods=["GET"])
@require_session
def api_list_dibs():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    war_id = str(request.args.get("war_id") or "").strip()

    if not faction_id:
        return ok(items=[])

    items = list_dibs_for_faction(faction_id, war_id=war_id) if war_id else list_dibs_for_faction(faction_id)
    return ok(items=[_normalize_dib(x) for x in (items or [])])


@app.route("/api/dibs", methods=["POST"])
@require_session
def api_add_dib():
    blocked = _require_feature_access()
    if blocked:
        return blocked

    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)

    data = _require_json()
    war_id = str(data.get("war_id") or "").strip()
    target_id = str(
        data.get("target_id")
        or data.get("enemy_id")
        or data.get("user_id")
        or ""
    ).strip()
    target_name = str(
        data.get("target_name")
        or data.get("enemy_name")
        or data.get("name")
        or ""
    ).strip()
    note = str(data.get("note") or data.get("reason") or "").strip()

    if not target_id:
        return err("Missing target_id.", 400)

    item = _add_dib_compat(
        user=user,
        war_id=war_id,
        target_id=target_id,
        target_name=target_name,
        note=note,
    )

    add_audit_log(
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
        action="add_dib",
        meta_json={
            "faction_id": faction_id,
            "war_id": war_id,
            "target_id": target_id,
            "target_name": target_name,
        },
    )

    return ok(message="Dib added.", item=_normalize_dib(item or {}))


@app.route("/api/dibs/<int:dib_id>", methods=["DELETE"])
@require_session
def api_delete_dib(dib_id: int):
    blocked = _require_feature_access()
    if blocked:
        return blocked

    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)

    _delete_dib_compat(faction_id, int(dib_id))

    add_audit_log(
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
        action="delete_dib",
        meta_json={
            "faction_id": faction_id,
            "dib_id": int(dib_id),
        },
    )

    return ok(message="Dib deleted.", id=dib_id)


@app.route("/api/targets", methods=["GET"])
@require_session
def api_list_targets():
    user = request.user or {}
    user_id = str(user.get("user_id") or "")
    return ok(items=list_targets(user_id) if user_id else [])


@app.route("/api/targets", methods=["POST"])
@require_session
def api_add_target():
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
        score_us=_to_int(score.get("our")),
        score_them=_to_int(score.get("enemy")),
        target_score=_to_int(score.get("target")),
        lead=_to_int(score.get("our")) - _to_int(score.get("enemy")),
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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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
    blocked = _require_feature_access()
    if blocked:
        return blocked

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


# ============================================================
# 15. FACTION MEMBER ACCESS / BILLING ROUTES
# /api/faction/members, /api/faction/members/<member_user_id>/enable,
# /api/faction/members/<member_user_id>
# ============================================================

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
    position = str(data.get("position") or "").strip()

    if not faction_id:
        return err("No faction found.", 400)
    if not member_user_id:
        return err("Missing member_user_id.", 400)

    result = activate_faction_member_for_billing(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
        member_user_id=member_user_id,
        member_name=member_name,
        member_api_key=member_api_key,
        position=position,
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
    )

    if not result.get("ok"):
        return err(str(result.get("error") or "Could not activate member."), 400)

    return ok(
        message=str(result.get("message") or "Faction member activated for billing."),
        item=_normalize_member_access_row(result.get("item") or {}),
        payment_added=result.get("payment_added", FACTION_MEMBER_PRICE),
        payment_instruction=result.get("payment_instruction") or "",
        license=result.get("license") or {},
    )

@app.route("/api/faction/members/<member_user_id>/enable", methods=["POST"])
@require_leader_session
def api_faction_member_enable(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    data = _require_json()
    enabled = 1 if _safe_bool(data.get("enabled", True)) else 0

    if not faction_id:
        return err("No faction found.", 400)

    result = set_member_billing_enabled(
        faction_id=faction_id,
        member_user_id=str(member_user_id),
        enabled=enabled,
        changed_by_user_id=str(user.get("user_id") or ""),
        changed_by_name=str(user.get("name") or ""),
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not update member billing."), 400)

    return ok(
        message=str(result.get("message") or "Faction member billing updated."),
        member_user_id=str(member_user_id),
        enabled=enabled,
        item=_normalize_member_access_row(result.get("item") or {}),
        license=result.get("license") or {},
        payment_instruction=result.get("payment_instruction") or "",
    )

@app.route("/api/faction/members/<member_user_id>", methods=["DELETE"])
@require_leader_session
def api_faction_member_delete(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    result = remove_member_from_billing(
        faction_id=faction_id,
        member_user_id=str(member_user_id),
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not remove member."), 400)

    return ok(
        message=str(result.get("message") or "Faction member removed from billing."),
        member_user_id=str(member_user_id),
        member_name=str(result.get("member_name") or ""),
        license=result.get("license") or {},
        payment_instruction=result.get("payment_instruction") or "",
    )

# ============================================================
# 16. FACTION PAYMENT ROUTES
# /api/faction/payment/status, /api/faction/payment/current-cycle,
# /api/faction/payment/history, /api/faction/payment/request-renewal
# ============================================================

@app.route("/api/faction/payment/status", methods=["GET"])
@require_session
def api_faction_payment_status():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    result = get_faction_payment_status(faction_id, viewer_user_id=str(user.get("user_id") or ""))
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not load faction payment status."), 400)
    return ok(**result)

@app.route("/api/faction/payment/current-cycle", methods=["GET"])
@require_session
def api_faction_payment_current_cycle():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    result = get_faction_billing_overview(faction_id)
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not load current billing cycle."), 400)
    current_cycle = get_current_faction_billing_cycle(faction_id) or {}
    return ok(
        item=_normalize_payment_cycle(current_cycle),
        billing=result,
    )

@app.route("/api/faction/payment/history", methods=["GET"])
@require_session
def api_faction_payment_history():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    limit = max(1, min(100, _to_int(request.args.get("limit"), 25)))
    result = list_faction_payment_history_service(faction_id, limit=limit)
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not load faction payment history."), 400)
    cycles = list_faction_billing_cycles(faction_id, limit=limit) or []
    intents = list_faction_payment_intents(faction_id=faction_id, limit=limit) or []
    return ok(
        items=result.get("items") or [],
        payments=result.get("items") or [],
        billing_cycles=[_normalize_payment_cycle(x) for x in cycles],
        intents=[_normalize_payment_intent(x) for x in intents],
        payment_config={
            "payment_player": result.get("payment_player"),
            "payment_kind": result.get("payment_kind"),
            "payment_per_member": result.get("payment_per_member"),
        },
    )

@app.route("/api/faction/payment/request-renewal", methods=["POST"])
@require_leader_session
def api_faction_payment_request_renewal():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)

    data = _require_json()
    note = str(data.get("note") or "").strip()
    result = create_manual_renewal_request(
        faction_id=faction_id,
        requested_by_user_id=str(user.get("user_id") or ""),
        requested_by_name=str(user.get("name") or ""),
        note=note,
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not create renewal request."), 400)

    amount_override = _to_int(data.get("amount"), 0)
    item = create_faction_payment_intent(
        faction_id=faction_id,
        created_by_user_id=str(user.get("user_id") or ""),
        created_by_name=str(user.get("name") or ""),
        amount_due=amount_override,
        note=note,
    )
    process_faction_payment_warnings(faction_id)
    return ok(
        message=str(result.get("message") or "Renewal request created."),
        item=_normalize_payment_intent(item or {}),
        renewal_cost=result.get("renewal_cost", 0),
        payment_instruction=result.get("payment_instruction") or "",
        payment=_payment_payload_for_faction(faction_id, viewer_user_id=str(user.get("user_id") or "")),
    )

# ============================================================
# 17. ADMIN PAYMENT / LICENSE ROUTES
# /api/admin/faction-payments/*, /api/admin/faction-licenses/*,
# /api/admin/exemptions/*
# ============================================================

@app.route("/api/admin/faction-payments/due", methods=["GET"])
@require_owner
def api_admin_faction_payments_due():
    limit = max(1, min(250, _to_int(request.args.get("limit"), 100)))
    result = get_due_factions(limit=limit)
    return ok(
        items=result.get("items") or [],
        count=result.get("count", 0),
        summary=get_faction_admin_dashboard_summary() or {},
        payment_config={
            "payment_player": result.get("payment_player"),
            "payment_kind": result.get("payment_kind"),
            "payment_per_member": result.get("payment_per_member"),
        },
    )

@app.route("/api/admin/faction-payments/pending", methods=["GET"])
@require_owner
def api_admin_faction_payments_pending():
    faction_id = str(request.args.get("faction_id") or "").strip()
    limit = max(1, min(250, _to_int(request.args.get("limit"), 100)))
    items = list_faction_payment_intents(faction_id=faction_id, status="pending", limit=limit) or []
    return ok(items=[_normalize_payment_intent(x) for x in items])


@app.route("/api/admin/faction-payments/history", methods=["GET"])
@require_owner
def api_admin_faction_payments_history():
    faction_id = str(request.args.get("faction_id") or "").strip()
    limit = max(1, min(250, _to_int(request.args.get("limit"), 100)))
    dashboard = get_payment_dashboard(limit=limit)
    cycles = list_faction_billing_cycles(faction_id=faction_id, limit=limit) if faction_id else []
    intents = list_faction_payment_intents(faction_id=faction_id, limit=limit) if faction_id else []
    payments = get_faction_payment_history(faction_id, limit=limit) if faction_id else []
    return ok(
        billing_cycles=[_normalize_payment_cycle(x) for x in (cycles or [])],
        intents=[_normalize_payment_intent(x) for x in (intents or [])],
        payments=payments,
        dashboard=dashboard.get("dashboard") or {},
        due_items=dashboard.get("due_items") or [],
        due_count=dashboard.get("due_count", 0),
    )

@app.route("/api/admin/faction-payments/confirm", methods=["POST"])
@require_owner
def api_admin_faction_payments_confirm():
    user = request.user or {}
    data = _require_json()
    intent_id = _to_int(data.get("intent_id"), 0)
    faction_id = str(data.get("faction_id") or "").strip()
    note = str(data.get("note") or "").strip()
    amount = _to_int(data.get("amount"), 0)

    if intent_id > 0:
        item = confirm_faction_payment_intent(
            intent_id=intent_id,
            confirmed_by_user_id=str(user.get("user_id") or ""),
            confirmed_by_name=str(user.get("name") or ""),
            note=note,
            amount_paid=amount,
        )
        faction_id = str((item or {}).get("faction_id") or faction_id)
        result = confirm_faction_payment_and_renew(
            faction_id=faction_id,
            amount=amount,
            renewed_by=str(user.get("name") or ""),
            note=note,
            payment_player=PAYMENT_PLAYER,
        )
        if not result.get("ok"):
            return err(str(result.get("error") or "Could not renew faction."), 400)
        return ok(
            message="Faction payment confirmed.",
            intent=_normalize_payment_intent(item or {}),
            item=result.get("item") or {},
            payment=_payment_payload_for_faction(faction_id),
            license=result.get("license") or {},
        )

    if not faction_id:
        return err("Missing intent_id or faction_id.", 400)

    result = confirm_faction_payment_and_renew(
        faction_id=faction_id,
        amount=amount,
        renewed_by=str(user.get("name") or ""),
        note=note,
        payment_player=PAYMENT_PLAYER,
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not renew faction."), 400)
    return ok(
        message=str(result.get("message") or "Faction renewed."),
        item=result.get("item") or {},
        payment=_payment_payload_for_faction(faction_id),
        license=result.get("license") or {},
    )

@app.route("/api/admin/faction-payments/<int:intent_id>/cancel", methods=["POST"])
@require_owner
def api_admin_faction_payment_cancel(intent_id: int):
    user = request.user or {}
    data = _require_json()
    note = str(data.get("note") or "").strip()
    item = cancel_faction_payment_intent(
        intent_id=int(intent_id),
        cancelled_by_user_id=str(user.get("user_id") or ""),
        cancelled_by_name=str(user.get("name") or ""),
        note=note,
    )
    return ok(message="Payment intent cancelled.", item=_normalize_payment_intent(item or {}))


@app.route("/api/admin/faction-payments/run-warning-scan", methods=["POST"])
@require_owner
def api_admin_faction_payments_run_warning_scan():
    result = run_payment_warning_scan()
    return ok(
        message=str(result.get("message") or "Warning scan complete."),
        items=result.get("warned") or [],
        count=result.get("count", 0),
        summary=get_faction_admin_dashboard_summary() or {},
    )

@app.route("/api/admin/faction-payments/run-auto-match", methods=["POST"])
@require_owner
def api_admin_faction_payments_run_auto_match():
    result = run_payment_auto_match()
    return ok(
        message=str(result.get("message") or "Auto-match is not connected to a Torn payment feed yet."),
        matched=len(result.get("matched") or []),
        items=result.get("matched") or [],
    )

# ============================================================
# 18. INTERNAL PAYMENT AUTOMATION ROUTES
# /internal/payments/run-due-scan, /internal/payments/run-warning-scan,
# /internal/payments/run-auto-match
# ============================================================

@app.route("/internal/payments/run-due-scan", methods=["POST"])
def api_internal_payments_run_due_scan():
    allowed, response = _require_license_admin()
    if not allowed:
        return response
    result = run_payment_due_scan()
    return ok(
        message=str(result.get("message") or "Due scan complete."),
        items=result.get("items") or [],
        count=result.get("count", 0),
    )

@app.route("/internal/payments/run-warning-scan", methods=["POST"])
def api_internal_payments_run_warning_scan():
    allowed, response = _require_license_admin()
    if not allowed:
        return response
    result = run_payment_warning_scan()
    return ok(
        message=str(result.get("message") or "Warning scan complete."),
        items=result.get("warned") or [],
        count=result.get("count", 0),
    )

@app.route("/internal/payments/run-auto-match", methods=["POST"])
def api_internal_payments_run_auto_match():
    allowed, response = _require_license_admin()
    if not allowed:
        return response
    result = run_payment_auto_match()
    return ok(
        message=str(result.get("message") or "Auto-match is not configured for an external payment feed yet."),
        matched=len(result.get("matched") or []),
        items=result.get("matched") or [],
    )

@app.route("/api/admin/faction-licenses", methods=["GET"])
@require_owner
def api_admin_faction_licenses():
    items = list_all_faction_licenses() or []
    summary = get_faction_admin_dashboard_summary() or {}
    return ok(
        items=items,
        summary=summary,
        **_exemption_admin_payload(),
    )


@app.route("/api/admin/exemptions", methods=["GET"])
@require_owner
def api_admin_exemptions():
    return ok(**_exemption_admin_payload())


@app.route("/api/admin/exemptions/factions", methods=["GET"])
@require_owner
def api_admin_list_faction_exemptions():
    payload = _exemption_admin_payload()
    return ok(
        items=payload.get("faction_exemptions") or [],
        count=int(((payload.get("counts") or {}).get("faction_exemptions") or 0)),
    )


@app.route("/api/admin/exemptions/users", methods=["GET"])
@require_owner
def api_admin_list_user_exemptions():
    payload = _exemption_admin_payload()
    return ok(
        items=payload.get("user_exemptions") or [],
        count=int(((payload.get("counts") or {}).get("user_exemptions") or 0)),
    )


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


@app.route("/api/admin/exemptions/factions", methods=["POST"])
@require_owner
def api_admin_add_faction_exemption():
    user = request.user or {}
    data = _require_json()
    faction_id = str(data.get("faction_id") or "").strip()
    faction_name = str(data.get("faction_name") or "").strip()
    note = str(data.get("note") or "").strip()
    if not faction_id:
        return err("Missing faction_id.", 400)

    item = upsert_faction_exemption(
        faction_id=faction_id,
        faction_name=faction_name,
        note=note,
        added_by_user_id=str(user.get("user_id") or ""),
        added_by_name=str(user.get("name") or ""),
    )
    return ok(message="Faction exemption saved.", item=item)


@app.route("/api/admin/exemptions/factions/<faction_id>", methods=["DELETE"])
@require_owner
def api_admin_delete_faction_exemption(faction_id: str):
    delete_faction_exemption(str(faction_id))
    return ok(message="Faction exemption removed.", faction_id=str(faction_id))


@app.route("/api/admin/exemptions/users", methods=["POST"])
@require_owner
def api_admin_add_user_exemption():
    user = request.user or {}
    data = _require_json()
    user_id = str(data.get("user_id") or "").strip()
    user_name = str(data.get("user_name") or "").strip()
    faction_id = str(data.get("faction_id") or "").strip()
    faction_name = str(data.get("faction_name") or "").strip()
    note = str(data.get("note") or "").strip()
    if not user_id:
        return err("Missing user_id.", 400)

    item = upsert_user_exemption(
        user_id=user_id,
        user_name=user_name,
        faction_id=faction_id,
        faction_name=faction_name,
        note=note,
        added_by_user_id=str(user.get("user_id") or ""),
        added_by_name=str(user.get("name") or ""),
    )
    return ok(message="Player exemption saved.", item=item)


@app.route("/api/admin/exemptions/users/<user_id>", methods=["DELETE"])
@require_owner
def api_admin_delete_user_exemption(user_id: str):
    delete_user_exemption(str(user_id))
    return ok(message="Player exemption removed.", user_id=str(user_id))


@app.route("/api/license-admin/dashboard", methods=["GET"])
def api_license_admin_dashboard():
    allowed, response = _require_license_admin()
    if not allowed:
        return response

    items = list_all_faction_licenses() or []
    summary = get_faction_admin_dashboard_summary() or {}
    return ok(
        items=items,
        summary=summary,
        **_exemption_admin_payload(),
    )


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


@app.route("/api/owner/exemptions", methods=["GET"])
@require_owner
def api_owner_exemptions_alias():
    return api_admin_exemptions()


@app.route("/api/owner/exemptions/factions", methods=["GET"])
@require_owner
def api_owner_faction_exemptions_alias():
    return api_admin_list_faction_exemptions()


@app.route("/api/owner/exemptions/users", methods=["GET"])
@require_owner
def api_owner_user_exemptions_alias():
    return api_admin_list_user_exemptions()


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


@app.route("/api/owner/exemptions/factions", methods=["POST"])
@require_owner
def api_owner_add_faction_exemption_alias():
    return api_admin_add_faction_exemption()


@app.route("/api/owner/exemptions/factions/<faction_id>", methods=["DELETE"])
@require_owner
def api_owner_delete_faction_exemption_alias(faction_id: str):
    return api_admin_delete_faction_exemption(faction_id)


@app.route("/api/owner/exemptions/users", methods=["POST"])
@require_owner
def api_owner_add_user_exemption_alias():
    return api_admin_add_user_exemption()


@app.route("/api/owner/exemptions/users/<user_id>", methods=["DELETE"])
@require_owner
def api_owner_delete_user_exemption_alias(user_id: str):
    return api_admin_delete_user_exemption(user_id)


@app.errorhandler(404)
def not_found(e):
    return err("Not Found", 404, details=str(e))


@app.errorhandler(405)
def not_allowed(e):
    return err("Method Not Allowed", 405, details=str(e))


@app.errorhandler(Exception)
def handle_error(e):
    return err("Unhandled error.", 500, details=str(e))


# ============================================================
# 19. APP FACTORY / STARTUP
# init_db(), create_app(), __main__
# ============================================================

def create_app():
    init_db()
    return app


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
