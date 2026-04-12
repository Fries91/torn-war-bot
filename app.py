import os
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Dict, List, Optional

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
    list_notifications,
    mark_notifications_seen,
    add_audit_log,
    ensure_faction_license_row,
    start_faction_trial_if_needed,
    compute_faction_license_status,
    force_expire_faction_license,
    list_all_faction_licenses,
    get_faction_admin_dashboard_summary,
    get_faction_payment_history,
    get_faction_exemption,
    get_user_exemption,
    list_faction_exemptions,
    list_user_exemptions,
    upsert_faction_exemption,
    upsert_user_exemption,
    delete_faction_exemption,
    delete_user_exemption,
    get_faction_member_access,
    get_faction_terms_summary,
    upsert_faction_terms_summary,
    sync_hospital_dibs_snapshot,
    claim_hospital_dib,
    list_overview_dibs,
    list_user_targets,
    upsert_user_target,
    delete_user_target,
    list_chain_statuses,
    upsert_chain_status,
    list_med_deals,
    upsert_med_deal,
    delete_med_deal,
    upsert_enemy_stat_prediction,
    list_enemy_stat_predictions,
)

from torn_identity import me_basic
from torn_faction import faction_basic
from torn_members import member_live_bars
from torn_war import ranked_war_summary
from torn_enemies import hospital_members_from_enemies, enemy_faction_members, split_enemy_buckets
from torn_shared import profile_url, attack_url, bounty_url

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

APP_NAME = "War Hub"
PAYMENT_PLAYER = str(os.getenv("PAYMENT_PLAYER", "Fries91")).strip() or "Fries91"
FACTION_MEMBER_PRICE = int(os.getenv("PAYMENT_XANAX_PER_MEMBER", os.getenv("PAYMENT_PER_MEMBER", "2")))
DEFAULT_REFRESH_SECONDS = int(os.getenv("DEFAULT_REFRESH_SECONDS", "30"))
LICENSE_ADMIN_TOKEN = str(os.getenv("LICENSE_ADMIN_TOKEN", "")).strip()
ALLOWED_SCRIPT_ORIGINS = {"https://www.torn.com", "https://torn.com", ""}

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
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on", "enabled"}


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
    allowed_prefixes = ("https://www.torn.com", "https://torn.com")
    if BASE_URL():
        allowed_prefixes = allowed_prefixes + (BASE_URL(),)
    if referer and not any(referer.startswith(x) for x in allowed_prefixes):
        return False
    return True


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
    uid = str(user.get("user_id") or "").strip()
    name = str(user.get("name") or "").strip().lower()
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


def _is_faction_management_role(api_key: str, user_id: str, faction_id: str) -> bool:
    if not api_key or not user_id or not faction_id:
        return False
    try:
        faction = faction_basic(api_key, faction_id=faction_id) or {}
        for m in faction.get("members") or []:
            mid = str(m.get("user_id") or m.get("id") or "").strip()
            pos = str(m.get("position") or "").strip().lower()
            if mid == str(user_id):
                return pos in {"leader", "co-leader", "co leader", "coleader"}
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
    return _is_faction_management_role(str((user or {}).get("api_key") or ""), user_id, faction_id)


def _feature_access_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    is_owner = _session_is_owner(user)

    license_status = _build_license_status_payload(faction_id, viewer_user_id=user_id) if faction_id else {}
    leader_user_id = str(license_status.get("leader_user_id") or "").strip()
    exemption = _get_exemption_payload(user_id=user_id, faction_id=faction_id)

    is_management_role = _is_faction_management_role(str(user.get("api_key") or ""), user_id, faction_id)
    is_leader = is_owner or (leader_user_id == user_id) or is_management_role
    is_co_leader = bool(is_management_role and not is_owner and leader_user_id != user_id)

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
        "is_faction_co_leader": is_co_leader,
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


def _normalize_member_access_row(row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}
    return {
        **row,
        "enabled": bool(row.get("enabled")),
        "cycle_locked": bool(row.get("cycle_locked")),
    }


def _build_member_bar_payload(member: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    bars = {}
    med_cd = 0
    if api_key:
        live = member_live_bars(api_key, user_id=str(member.get("user_id") or ""))
        if live.get("ok"):
            bars = live.get("bars") or {}
            med_cd = _to_int(live.get("medical_cooldown"), 0)
    return {"bars": bars, "medical_cooldown": med_cd}


def _build_live_faction_members(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return []

    faction = faction_basic(str(user.get("api_key") or ""), faction_id=faction_id) or {}
    if not faction.get("ok"):
        return []

    faction_name = str(faction.get("faction_name") or user.get("faction_name") or "").strip()

    raw_members = faction.get("members") or []
    live_members: List[Dict[str, Any]] = []

    if isinstance(raw_members, dict):
        for key, value in raw_members.items():
            member = value if isinstance(value, dict) else {}
            member_user_id = str(
                member.get("user_id")
                or member.get("id")
                or key
                or ""
            ).strip()
            if not member_user_id:
                continue
            live_members.append({
                **member,
                "user_id": member_user_id,
            })
    elif isinstance(raw_members, list):
        for member in raw_members:
            if not isinstance(member, dict):
                continue
            member_user_id = str(member.get("user_id") or member.get("id") or "").strip()
            if not member_user_id:
                continue
            live_members.append({
                **member,
                "user_id": member_user_id,
            })

    stored_users = get_user_map_by_faction(faction_id)
    out: List[Dict[str, Any]] = []

    for member in live_members:
        member_user_id = str(member.get("user_id") or "").strip()
        if not member_user_id:
            continue

        stored_user = stored_users.get(member_user_id) or {}
        access_row = get_faction_member_access(faction_id, member_user_id) or {}

        member_api_key = str(stored_user.get("api_key") or "")
        if member_user_id == str(user.get("user_id") or ""):
            member_api_key = str(user.get("api_key") or "") or member_api_key

        live_bar_payload = _build_member_bar_payload(member, api_key=member_api_key)

        out.append({
            **member,
            "user_id": member_user_id,
            "profile_url": profile_url(member_user_id),
            "attack_url": attack_url(member_user_id),
            "bounty_url": bounty_url(member_user_id),
            "enemy": False,
            "source": "viewer_faction_members",
            "faction_id": faction_id,
            "faction_name": faction_name,
            "enabled": bool(access_row.get("enabled")),
            "member_access": _normalize_member_access_row(access_row),
            "has_stored_api_key": bool(member_api_key),
            "life": (live_bar_payload.get("bars") or {}).get("life") or {},
            "energy": (live_bar_payload.get("bars") or {}).get("energy") or {},
            "nerve": (live_bar_payload.get("bars") or {}).get("nerve") or {},
            "happy": (live_bar_payload.get("bars") or {}).get("happy") or {},
            "medical_cooldown": _to_int(live_bar_payload.get("medical_cooldown"), 0),
            "medical_cooldown_text": _seconds_to_text(_to_int(live_bar_payload.get("medical_cooldown"), 0)),
        })

    out.sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))
    return out


def _enemy_bucket_order() -> List[str]:
    return ["online", "idle", "travel", "jail", "hospital", "offline"]


def _empty_enemy_buckets() -> Dict[str, List[Dict[str, Any]]]:
    return {key: [] for key in _enemy_bucket_order()}


def _build_enemy_member_payload(member: Dict[str, Any], enemy_faction_id: str, enemy_faction_name: str) -> Dict[str, Any]:
    member_user_id = str(member.get("user_id") or "").strip()
    return {
        **member,
        "user_id": member_user_id,
        "profile_url": profile_url(member_user_id),
        "attack_url": attack_url(member_user_id),
        "bounty_url": bounty_url(member_user_id),
        "faction_id": str(enemy_faction_id or ""),
        "faction_name": str(enemy_faction_name or ""),
        "enemy_faction_id": str(enemy_faction_id or ""),
        "enemy_faction_name": str(enemy_faction_name or ""),
        "enemy": True,
        "source": "ranked_war_enemy_faction",
    }


def _store_enemy_predictions(faction_id: str, enemy_faction_id: str, enemies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    faction_id = str(faction_id or "").strip()
    if not faction_id:
        return list(enemies or [])

    stored_map = {
        str(row.get("enemy_user_id") or "").strip(): row
        for row in list_enemy_stat_predictions(faction_id)
        if isinstance(row, dict)
    }

    out: List[Dict[str, Any]] = []

    for member in list(enemies or []):
        enemy_user_id = str(member.get("user_id") or "").strip()
        if not enemy_user_id:
            out.append(member)
            continue

        pred_total = int(member.get("predicted_total_stats") or 0)
        pred_total_m = float(
            member.get("predicted_total_stats_m")
            or member.get("total_stats_m")
            or member.get("battle_stats_m")
            or 0.0
        )
        confidence = str(
            member.get("prediction_confidence")
            or (member.get("battle_prediction") or {}).get("confidence")
            or "Estimate"
        ).strip()
        source = str(
            member.get("prediction_source")
            or 
