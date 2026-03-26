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
    get_users_by_faction,
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
    list_hospital_dibs,
    list_overview_dibs,
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
FACTION_MEMBER_PRICE = int(os.getenv("PAYMENT_XANAX_PER_MEMBER", os.getenv("PAYMENT_PER_MEMBER", "3")))
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
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on", "enabled"}


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

    is_leader = is_owner or (leader_user_id == user_id) or _is_faction_leader(str(user.get("api_key") or ""), user_id, faction_id)
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


def _normalize_member_access_row(row: Dict[str, Any]) -> Dict[str, Any]:
    if not row:
        return {}
    return {
        **row,
        "enabled": bool(row.get("enabled")),
        "cycle_locked": bool(row.get("cycle_locked")),
    }


def _sync_login_user_to_billing(user_row: Dict[str, Any]):
    if not user_row:
        return
    faction_id = str(user_row.get("faction_id") or "").strip()
    if not faction_id:
        return
    existing = get_faction_member_access(faction_id, str(user_row.get("user_id") or "")) or {}
    if existing:
        activate_faction_member_for_billing(
            faction_id=faction_id,
            faction_name=str(user_row.get("faction_name") or ""),
            leader_user_id=str(existing.get("leader_user_id") or ""),
            leader_name=str(existing.get("leader_name") or ""),
            member_user_id=str(user_row.get("user_id") or ""),
            member_name=str(user_row.get("name") or ""),
            member_api_key=str(user_row.get("api_key") or ""),
            position=str(existing.get("position") or ""),
        )


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
    live_members = list(faction.get("members") or [])
    stored_users = get_user_map_by_faction(faction_id)
    out: List[Dict[str, Any]] = []

    for member in live_members:
        member_user_id = str(member.get("user_id") or "").strip()
        stored_user = stored_users.get(member_user_id) or {}
        access_row = get_faction_member_access(faction_id, member_user_id) or {}
        api_key = str(stored_user.get("api_key") or "")
        if member_user_id == str(user.get("user_id") or ""):
            api_key = str(user.get("api_key") or "") or api_key
        live_bar_payload = _build_member_bar_payload(member, api_key=api_key)

        out.append(
            {
                **member,
                "profile_url": profile_url(member_user_id),
                "attack_url": attack_url(member_user_id),
                "bounty_url": bounty_url(member_user_id),
                "enabled": bool(access_row.get("enabled")),
                "member_access": _normalize_member_access_row(access_row),
                "has_stored_api_key": bool(api_key),
                "life": (live_bar_payload.get("bars") or {}).get("life") or {},
                "energy": (live_bar_payload.get("bars") or {}).get("energy") or {},
                "nerve": (live_bar_payload.get("bars") or {}).get("nerve") or {},
                "happy": (live_bar_payload.get("bars") or {}).get("happy") or {},
                "medical_cooldown": _to_int(live_bar_payload.get("medical_cooldown"), 0),
                "medical_cooldown_text": _seconds_to_text(_to_int(live_bar_payload.get("medical_cooldown"), 0)),
            }
        )

    out.sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))
    return out


def _enemy_bucket_order() -> List[str]:
    return ["online", "idle", "travel", "jail", "hospital", "offline"]


def _empty_enemy_buckets() -> Dict[str, List[Dict[str, Any]]]:
    return {key: [] for key in _enemy_bucket_order()}


def _group_enemy_members(enemies: List[Dict[str, Any]]) -> Dict[str, Any]:
    buckets = _empty_enemy_buckets()

    for enemy in list(enemies or []):
        state = str(enemy.get("online_state") or "").strip().lower()
        if state not in buckets:
            state = "offline"
        buckets[state].append(enemy)

    for key in buckets:
        buckets[key].sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))

    counts = {key: len(buckets.get(key) or []) for key in _enemy_bucket_order()}

    return {
        "buckets": buckets,
        "counts": counts,
        "order": _enemy_bucket_order(),
        "total": sum(counts.values()),
    }


def _build_enemy_member_payload(member: Dict[str, Any], enemy_faction_id: str, enemy_faction_name: str) -> Dict[str, Any]:
    member_user_id = str(member.get("user_id") or "").strip()
    return {
        **member,
        "user_id": member_user_id,
        "profile_url": profile_url(member_user_id),
        "attack_url": attack_url(member_user_id),
        "bounty_url": bounty_url(member_user_id),
        "enemy": True,
        "source": "ranked_war_enemy_faction",
        "source_faction_id": str(enemy_faction_id or ""),
        "source_faction_name": str(enemy_faction_name or ""),
    }


def _build_hospital_payload(user: Dict[str, Any], war_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    if not faction_id:
        return {
            "items": [],
            "count": 0,
            "overview_items": [],
            "overview_count": 0,
            "enemy_faction_id": "",
            "enemy_faction_name": "",
        }

    payload = war_payload or _build_war_and_enemy_payload(user)
    war = payload.get("war") or {}
    enemies = payload.get("enemies") or []
    enemy_faction_id = str(war.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war.get("enemy_faction_name") or "").strip()

    hospital_members = hospital_members_from_enemies(enemies)
    synced = sync_hospital_dibs_snapshot(
        faction_id=faction_id,
        faction_name=faction_name,
        enemy_faction_id=enemy_faction_id,
        enemy_faction_name=enemy_faction_name,
        members=hospital_members,
    )

    dib_map = {str(item.get("enemy_user_id") or ""): item for item in synced}
    now_ts = int(datetime.now(timezone.utc).timestamp())
    out = []
    for member in hospital_members:
        enemy_user_id = str(member.get("user_id") or "").strip()
        dib = dib_map.get(enemy_user_id) or {}
        dibbed_by_name = str(dib.get("dibbed_by_name") or "").strip()
        dibs_lock_until_ts = _to_int(dib.get("dibs_lock_until_ts"), 0)
        dibs_available = not dibbed_by_name and (dibs_lock_until_ts <= now_ts)
        out.append({
            **member,
            "enemy_user_id": enemy_user_id,
            "dibbed_by_user_id": str(dib.get("dibbed_by_user_id") or ""),
            "dibbed_by_name": dibbed_by_name,
            "dibbed_at": str(dib.get("dibbed_at") or ""),
            "left_hospital_at": str(dib.get("left_hospital_at") or ""),
            "dibs_lock_until_ts": dibs_lock_until_ts,
            "overview_remove_after_ts": _to_int(dib.get("overview_remove_after_ts"), 0),
            "dibs_available": bool(dibs_available),
            "dibs_locked": bool(dibs_lock_until_ts > now_ts),
        })

    overview_items = []
    for dib in list_overview_dibs(faction_id):
        overview_items.append({
            "enemy_user_id": str(dib.get("enemy_user_id") or ""),
            "enemy_name": str(dib.get("enemy_name") or ""),
            "dibbed_by_user_id": str(dib.get("dibbed_by_user_id") or ""),
            "dibbed_by_name": str(dib.get("dibbed_by_name") or ""),
            "dibbed_at": str(dib.get("dibbed_at") or ""),
            "in_hospital": bool(dib.get("in_hospital")),
            "left_hospital_at": str(dib.get("left_hospital_at") or ""),
            "overview_remove_after_ts": _to_int(dib.get("overview_remove_after_ts"), 0),
        })

    out.sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))
    return {
        "items": out,
        "count": len(out),
        "overview_items": overview_items,
        "overview_count": len(overview_items),
        "enemy_faction_id": enemy_faction_id,
        "enemy_faction_name": enemy_faction_name,
    }


def _build_war_and_enemy_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    api_key = str(user.get("api_key") or "").strip()
    my_faction_id = str(user.get("faction_id") or "").strip()
    my_faction_name = str(user.get("faction_name") or "").strip()

    war = ranked_war_summary(
        api_key,
        my_faction_id=my_faction_id,
        my_faction_name=my_faction_name,
    ) or {}

    enemy_faction_id = str(war.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war.get("enemy_faction_name") or "").strip()

    enemies: List[Dict[str, Any]] = []

    invalid_enemy = False
    if not enemy_faction_id:
        invalid_enemy = True
    if enemy_faction_id and my_faction_id and enemy_faction_id == my_faction_id:
        invalid_enemy = True
    if enemy_faction_name and my_faction_name and enemy_faction_name.strip().lower() == my_faction_name.strip().lower():
        invalid_enemy = True

    if not invalid_enemy:
        enemy_payload = enemy_faction_members(api_key, enemy_faction_id)
        if enemy_payload.get("ok"):
            enemy_faction_id = str(enemy_payload.get("enemy_faction_id") or enemy_faction_id or "").strip()
            enemy_faction_name = str(enemy_payload.get("enemy_faction_name") or enemy_faction_name or "").strip()
            enemies = list(enemy_payload.get("members") or [])
        else:
            enemy_faction_id = ""
            enemy_faction_name = ""
            enemies = []
    else:
        enemy_faction_id = ""
        enemy_faction_name = ""
        enemies = []

    grouped = split_enemy_buckets(enemies)

    war["enemy_faction_id"] = enemy_faction_id
    war["enemy_faction_name"] = enemy_faction_name
    war["enemy_members_count"] = len(enemies)
    war["enemy_members"] = enemies
    war["enemy_buckets"] = grouped
    war["enemy_bucket_counts"] = {key: len(grouped.get(key) or []) for key in _enemy_bucket_order()}

    return {
        "war": war,
        "enemies": enemies,
        "enemy_buckets": grouped,
        "enemy_bucket_counts": {key: len(grouped.get(key) or []) for key in _enemy_bucket_order()},
        "enemy_bucket_order": _enemy_bucket_order(),
        "enemy_total": len(enemies),
    }


def _build_state_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    if faction_id:
        ensure_faction_license_row(faction_id=faction_id, faction_name=faction_name)
    access = _feature_access_for_user(user)
    members = _build_live_faction_members(user)
    war_payload = _build_war_and_enemy_payload(user) if faction_id else {
        "war": {},
        "enemies": [],
        "enemy_buckets": _empty_enemy_buckets(),
        "enemy_bucket_counts": {key: 0 for key in _enemy_bucket_order()},
        "enemy_bucket_order": _enemy_bucket_order(),
        "enemy_total": 0,
    }
    notifications = list_notifications(str(user.get("user_id") or ""), limit=25)
    terms_summary_row = get_faction_terms_summary(faction_id) if faction_id else {}
    hospital_payload = _build_hospital_payload(user, war_payload=war_payload) if faction_id else {"items": [], "overview_items": []}

    return {
        "app_name": APP_NAME,
        "viewer": {
            "user_id": str(user.get("user_id") or ""),
            "name": str(user.get("name") or ""),
            "faction_id": faction_id,
            "faction_name": faction_name,
        },
        "faction": {
            "faction_id": faction_id,
            "faction_name": faction_name,
            "member_count": len(members),
        },
        "members": members,
        "war": war_payload.get("war") or {},
        "enemies": war_payload.get("enemies") or [],
        "enemies_by_state": war_payload.get("enemy_buckets") or _empty_enemy_buckets(),
        "enemy_bucket_counts": war_payload.get("enemy_bucket_counts") or {key: 0 for key in _enemy_bucket_order()},
        "enemy_bucket_order": war_payload.get("enemy_bucket_order") or _enemy_bucket_order(),
        "notifications": notifications,
        "access": access,
        "license": access.get("license") or {},
        "admin": {
            "is_owner": bool(access.get("is_owner")),
            "show_admin": bool(access.get("show_admin")),
        },
        "terms_summary": {
            "text": str((terms_summary_row or {}).get("text") or ""),
            "updated_by_user_id": str((terms_summary_row or {}).get("updated_by_user_id") or ""),
            "updated_by_name": str((terms_summary_row or {}).get("updated_by_name") or ""),
            "updated_at": str((terms_summary_row or {}).get("updated_at") or ""),
        },
        "dibs": {
            "items": hospital_payload.get("overview_items") or [],
            "count": len(hospital_payload.get("overview_items") or []),
        },
        "hospital": {
            "items": hospital_payload.get("items") or [],
            "count": len(hospital_payload.get("items") or []),
            "enemy_faction_id": hospital_payload.get("enemy_faction_id") or "",
            "enemy_faction_name": hospital_payload.get("enemy_faction_name") or "",
        },
        "payment": {
            "payment_player": PAYMENT_PLAYER,
            "payment_per_member": FACTION_MEMBER_PRICE,
            "default_refresh_seconds": DEFAULT_REFRESH_SECONDS,
        },
        "refresh_seconds": DEFAULT_REFRESH_SECONDS,
    }


@app.route("/api/terms-summary", methods=["GET"])
@require_session
def api_terms_summary_get():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return ok(item={"text": "", "updated_by_user_id": "", "updated_by_name": "", "updated_at": ""})

    row = get_faction_terms_summary(faction_id) or {}
    return ok(
        item={
            "text": str(row.get("text") or ""),
            "updated_by_user_id": str(row.get("updated_by_user_id") or ""),
            "updated_by_name": str(row.get("updated_by_name") or ""),
            "updated_at": str(row.get("updated_at") or ""),
        }
    )


@app.route("/api/terms-summary", methods=["POST"])
@require_leader_session
def api_terms_summary_save():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    if not faction_id:
        return err("No faction found.", 400)

    data = _require_json()
    text = str(data.get("text") or "")

    row = upsert_faction_terms_summary(
        faction_id=faction_id,
        faction_name=faction_name,
        text=text,
        updated_by_user_id=str(user.get("user_id") or ""),
        updated_by_name=str(user.get("name") or ""),
    )

    return ok(
        message="Terms / Summary saved.",
        item={
            "text": str(row.get("text") or ""),
            "updated_by_user_id": str(row.get("updated_by_user_id") or ""),
            "updated_by_name": str(row.get("updated_by_name") or ""),
            "updated_at": str(row.get("updated_at") or ""),
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return ok(status="ok", app=APP_NAME)


@app.route("/", methods=["GET"])
def index():
    static_dir = app.static_folder or "static"
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return send_from_directory(static_dir, "index.html")
    return ok(app=APP_NAME, status="ok")


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    static_dir = app.static_folder or "static"
    favicon_path = os.path.join(static_dir, "favicon.ico")
    if os.path.exists(favicon_path):
        return send_from_directory(static_dir, "favicon.ico")
    return "", 204


@app.route("/static/<path:path>", methods=["GET"])
def static_files(path: str):
    return send_from_directory(app.static_folder or "static", path)


@app.route("/api/ping", methods=["GET"])
def api_ping():
    return ok(app=APP_NAME, status="ok", now=utc_now())


@app.route("/api/config", methods=["GET"])
def api_config():
    return ok(
        app_name=APP_NAME,
        payment_player=PAYMENT_PLAYER,
        faction_member_price=FACTION_MEMBER_PRICE,
        default_refresh_seconds=DEFAULT_REFRESH_SECONDS,
        base_url=BASE_URL(),
    )


@app.route("/api/auth", methods=["POST"])
def api_auth():
    data = _require_json()
    api_key = str(data.get("api_key") or data.get("key") or "").strip()
    if not api_key:
        return err("Missing API key.", 400)

    me = me_basic(api_key)
    if not me.get("ok"):
        return err(str(me.get("error") or "Could not authenticate."), 400)

    user_id = str(me.get("user_id") or "").strip()
    faction_id = str(me.get("faction_id") or "").strip()
    faction_name = str(me.get("faction_name") or "").strip()
    name = str(me.get("name") or "Unknown")

    if not user_id:
        return err("Could not resolve user ID.", 400)

    upsert_user(user_id=user_id, name=name, api_key=api_key, faction_id=faction_id, faction_name=faction_name)

    if faction_id:
        if _is_faction_leader(api_key, user_id, faction_id):
            start_faction_trial_if_needed(
                faction_id=faction_id,
                faction_name=faction_name,
                leader_user_id=user_id,
                leader_name=name,
                leader_api_key=api_key,
            )
        else:
            ensure_faction_license_row(faction_id=faction_id, faction_name=faction_name)

    delete_sessions_for_user(user_id)
    sess = create_session(user_id)
    user = get_user(user_id) or {}
    _sync_login_user_to_billing(user)
    access = _feature_access_for_user(user)

    add_audit_log(actor_user_id=user_id, actor_name=name, action="auth_login", meta_json=f"faction_id={faction_id}")

    return ok(
        token=str(sess.get("token") or ""),
        session_token=str(sess.get("token") or ""),
        user={
            "user_id": user_id,
            "name": name,
            "faction_id": faction_id,
            "faction_name": faction_name,
        },
        access=access,
        license=access.get("license") or {},
        state=_build_state_payload(user),
    )


@app.route("/api/logout", methods=["POST"])
@require_session
def api_logout():
    token = str(request.session.get("token") or "")
    delete_session(token)
    return ok(message="Logged out.")


@app.route("/api/state", methods=["GET"])
@require_session
def api_state():
    user = request.user or {}
    return ok(**_build_state_payload(user))

@app.route("/api/overview/live", methods=["GET"])
@require_session
def api_overview_live():
    user = request.current_user
    faction_id = int(user.get("faction_id") or 0)

    war = get_active_war_for_faction(faction_id) if faction_id else {}
    faction = get_faction_summary(faction_id) if faction_id else {}

    return jsonify({
        "ok": True,
        "overview": {
            "faction_id": faction_id,
            "faction_name": faction.get("name") or user.get("faction_name") or "",
            "war_id": war.get("war_id") or 0,
            "our_faction_name": war.get("our_faction_name") or faction.get("name") or "",
            "enemy_faction_name": war.get("enemy_faction_name") or "",
            "score_us": war.get("score_us") or 0,
            "score_them": war.get("score_them") or 0,
            "chain_us": war.get("chain_us") or 0,
            "chain_them": war.get("chain_them") or 0,
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
    })
    
@app.route("/api/notifications/seen", methods=["POST"])
@require_session
def api_notifications_seen():
    user = request.user or {}
    mark_notifications_seen(str(user.get("user_id") or ""))
    return ok(message="Notifications marked seen.")


@app.route("/api/war", methods=["GET"])
@require_session
def api_war():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return ok(
            war=ranked_war_summary(str(user.get("api_key") or ""), my_faction_id="", my_faction_name=""),
            enemies=[],
            enemy_buckets=_empty_enemy_buckets(),
            enemy_bucket_counts={key: 0 for key in _enemy_bucket_order()},
            enemy_bucket_order=_enemy_bucket_order(),
            count=0,
        )
    access_error = _require_feature_access()
    if access_error:
        return access_error
    payload = _build_war_and_enemy_payload(user)
    return ok(
        war=payload.get("war") or {},
        enemies=payload.get("enemies") or [],
        enemy_buckets=payload.get("enemy_buckets") or _empty_enemy_buckets(),
        enemy_bucket_counts=payload.get("enemy_bucket_counts") or {key: 0 for key in _enemy_bucket_order()},
        enemy_bucket_order=payload.get("enemy_bucket_order") or _enemy_bucket_order(),
        count=len(payload.get("enemies") or []),
    )


@app.route("/api/enemies", methods=["GET"])
@require_session
def api_enemies():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return ok(
            items=[],
            count=0,
            faction_id="",
            faction_name="",
            buckets=_empty_enemy_buckets(),
            counts_by_state={key: 0 for key in _enemy_bucket_order()},
            order=_enemy_bucket_order(),
            war={},
        )
    access_error = _require_feature_access()
    if access_error:
        return access_error
    payload = _build_war_and_enemy_payload(user)
    war = payload.get("war") or {}
    enemies = payload.get("enemies") or []
    return ok(
        items=enemies,
        count=len(enemies),
        faction_id=str(war.get("enemy_faction_id") or ""),
        faction_name=str(war.get("enemy_faction_name") or ""),
        buckets=payload.get("enemy_buckets") or _empty_enemy_buckets(),
        counts_by_state=payload.get("enemy_bucket_counts") or {key: 0 for key in _enemy_bucket_order()},
        order=payload.get("enemy_bucket_order") or _enemy_bucket_order(),
        war=war,
    )


@app.route("/api/hospital", methods=["GET"])
@require_session
def api_hospital():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return ok(items=[], count=0, overview_items=[], overview_count=0, faction_id="", faction_name="", enemy_faction_id="", enemy_faction_name="")
    access_error = _require_feature_access()
    if access_error:
        return access_error
    war_payload = _build_war_and_enemy_payload(user)
    hospital_payload = _build_hospital_payload(user, war_payload=war_payload)
    return ok(
        items=hospital_payload.get("items") or [],
        count=hospital_payload.get("count") or 0,
        overview_items=hospital_payload.get("overview_items") or [],
        overview_count=hospital_payload.get("overview_count") or 0,
        faction_id=faction_id,
        faction_name=str(user.get("faction_name") or ""),
        enemy_faction_id=hospital_payload.get("enemy_faction_id") or "",
        enemy_faction_name=hospital_payload.get("enemy_faction_name") or "",
        war=war_payload.get("war") or {},
    )


@app.route("/api/hospital/dibs/<enemy_user_id>", methods=["POST"])
@require_session
def api_hospital_dibs_claim(enemy_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    access_error = _require_feature_access()
    if access_error:
        return access_error

    war_payload = _build_war_and_enemy_payload(user)
    _build_hospital_payload(user, war_payload=war_payload)

    result = claim_hospital_dib(
        faction_id=faction_id,
        enemy_user_id=str(enemy_user_id),
        dibbed_by_user_id=str(user.get("user_id") or ""),
        dibbed_by_name=str(user.get("name") or ""),
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not dib enemy."), 400)

    hospital_payload = _build_hospital_payload(user, war_payload=war_payload)
    claimed = result.get("item") or {}
    return ok(
        message="Dibs claimed.",
        item=claimed,
        overview_items=hospital_payload.get("overview_items") or [],
        overview_count=hospital_payload.get("overview_count") or 0,
        hospital_items=hospital_payload.get("items") or [],
        hospital_count=hospital_payload.get("count") or 0,
    )


@app.route("/api/faction/members", methods=["GET"])
@require_session
def api_faction_members():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)
    access_error = _require_feature_access()
    if access_error:
        return access_error
    members = _build_live_faction_members(user)
    return ok(items=members, count=len(members), faction_id=faction_id)


@app.route("/api/faction/members/<member_user_id>/activate", methods=["POST"])
@require_leader_session
def api_faction_member_activate(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    if not faction_id:
        return err("No faction found.", 400)

    members = _build_live_faction_members(user)
    target = next((m for m in members if str(m.get("user_id") or "") == str(member_user_id)), None)
    member_name = str((target or {}).get("name") or "")
    position = str((target or {}).get("position") or "")
    stored_user = get_user(str(member_user_id)) or {}

    result = activate_faction_member_for_billing(
        faction_id=faction_id,
        faction_name=str(user.get("faction_name") or ""),
        leader_user_id=str(user.get("user_id") or ""),
        leader_name=str(user.get("name") or ""),
        member_user_id=str(member_user_id),
        member_name=member_name,
        member_api_key=str(stored_user.get("api_key") or ""),
        position=position,
        actor_user_id=str(user.get("user_id") or ""),
        actor_name=str(user.get("name") or ""),
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not activate member."), 400)
    return ok(
        message=str(result.get("message") or "Faction member activated."),
        item=_normalize_member_access_row(result.get("item") or {}),
        license=result.get("license") or {},
        payment_instruction=result.get("payment_instruction") or "",
    )


@app.route("/api/faction/members/<member_user_id>/enable", methods=["POST"])
@require_leader_session
def api_faction_member_enable(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "")
    data = _require_json()
    enabled = _safe_bool(data.get("enabled", True))
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
    return ok(billing=result)


@app.route("/api/faction/payment/history", methods=["GET"])
@require_session
def api_faction_payment_history():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    result = list_faction_payment_history_service(faction_id)
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not load faction payment history."), 400)
    return ok(**result)


@app.route("/api/faction/payment/request-renewal", methods=["POST"])
@require_session
def api_faction_payment_request_renewal():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    data = _require_json()
    note = str(data.get("note") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)
    result = create_manual_renewal_request(
        faction_id=faction_id,
        requested_by_user_id=str(user.get("user_id") or ""),
        requested_by_name=str(user.get("name") or ""),
        note=note,
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not create renewal request."), 400)
    return ok(**result)


@app.route("/api/admin/dashboard", methods=["GET"])
@require_owner
def api_admin_dashboard():
    return ok(summary=get_faction_admin_dashboard_summary(), payment=get_payment_dashboard())


@app.route("/api/admin/factions", methods=["GET"])
@require_owner
def api_admin_faction_licenses():
    return ok(items=list_all_faction_licenses())


@app.route("/api/admin/factions/due", methods=["GET"])
@require_owner
def api_admin_due_factions():
    return ok(**get_due_factions())


@app.route("/api/admin/factions/<faction_id>/history", methods=["GET"])
@require_owner
def api_admin_faction_license_history(faction_id: str):
    return ok(faction_id=str(faction_id), items=get_faction_payment_history(str(faction_id), limit=100))


@app.route("/api/admin/factions/<faction_id>/renew", methods=["POST"])
@require_owner
def api_admin_faction_license_renew(faction_id: str):
    data = _require_json()
    amount = _to_int(data.get("amount"), 0)
    note = str(data.get("note") or "").strip()
    renewed_by = str(data.get("renewed_by") or request.user.get("name") or "").strip()
    result = confirm_faction_payment_and_renew(
        faction_id=str(faction_id),
        amount=amount,
        renewed_by=renewed_by,
        note=note,
        payment_player=PAYMENT_PLAYER,
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not renew faction."), 400)
    return ok(message="Faction renewed.", item=result.get("item") or {}, license=result.get("license") or {})


@app.route("/api/admin/factions/<faction_id>/expire", methods=["POST"])
@require_owner
def api_admin_faction_license_expire(faction_id: str):
    force_expire_faction_license(str(faction_id))
    return ok(message="Faction expired.", faction_id=str(faction_id))


@app.route("/api/admin/exemptions", methods=["GET"])
@require_owner
def api_admin_exemptions():
    return ok(**_exemption_admin_payload())


@app.route("/api/admin/exemptions/factions", methods=["GET"])
@require_owner
def api_admin_list_faction_exemptions():
    return ok(items=list_faction_exemptions())


@app.route("/api/admin/exemptions/factions", methods=["POST"])
@require_owner
def api_admin_add_faction_exemption():
    data = _require_json()
    item = upsert_faction_exemption(
        faction_id=str(data.get("faction_id") or "").strip(),
        faction_name=str(data.get("faction_name") or "").strip(),
        note=str(data.get("note") or "").strip(),
        added_by_user_id=str(request.user.get("user_id") or ""),
        added_by_name=str(request.user.get("name") or ""),
    )
    return ok(item=item)


@app.route("/api/admin/exemptions/factions/<faction_id>", methods=["DELETE"])
@require_owner
def api_admin_delete_faction_exemption(faction_id: str):
    delete_faction_exemption(str(faction_id))
    return ok(message="Faction exemption deleted.", faction_id=str(faction_id))


@app.route("/api/admin/exemptions/users", methods=["GET"])
@require_owner
def api_admin_list_user_exemptions():
    return ok(items=list_user_exemptions())


@app.route("/api/admin/exemptions/users", methods=["POST"])
@require_owner
def api_admin_add_user_exemption():
    data = _require_json()
    item = upsert_user_exemption(
        user_id=str(data.get("user_id") or "").strip(),
        user_name=str(data.get("user_name") or "").strip(),
        faction_id=str(data.get("faction_id") or "").strip(),
        faction_name=str(data.get("faction_name") or "").strip(),
        note=str(data.get("note") or "").strip(),
        added_by_user_id=str(request.user.get("user_id") or ""),
        added_by_name=str(request.user.get("name") or ""),
    )
    return ok(item=item)


@app.route("/api/admin/exemptions/users/<user_id>", methods=["DELETE"])
@require_owner
def api_admin_delete_user_exemption(user_id: str):
    delete_user_exemption(str(user_id))
    return ok(message="User exemption deleted.", user_id=str(user_id))


@app.route("/api/admin/payment/warnings/scan", methods=["POST"])
@require_owner
def api_admin_payment_warning_scan():
    return ok(**run_payment_warning_scan())


@app.route("/api/admin/payment/due/scan", methods=["POST"])
@require_owner
def api_admin_payment_due_scan():
    return ok(**run_payment_due_scan())


@app.route("/api/admin/payment/auto-match", methods=["POST"])
@require_owner
def api_admin_payment_auto_match():
    return ok(**run_payment_auto_match())


@app.route("/api/license-admin/factions/<faction_id>/renew", methods=["POST"])
def api_license_admin_renew(faction_id: str):
    allowed, response = _require_license_admin()
    if not allowed:
        return response
    data = _require_json()
    amount = _to_int(data.get("amount"), 0)
    note = str(data.get("note") or "").strip()
    renewed_by = str(data.get("renewed_by") or "LicenseAdmin").strip()
    result = confirm_faction_payment_and_renew(
        faction_id=str(faction_id),
        amount=amount,
        renewed_by=renewed_by,
        note=note,
        payment_player=PAYMENT_PLAYER,
    )
    if not result.get("ok"):
        return err(str(result.get("error") or "Could not renew faction."), 400)
    return ok(message="Faction renewed.", item=result.get("item") or {}, license=result.get("license") or {})


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


def create_app():
    init_db()
    return app


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
