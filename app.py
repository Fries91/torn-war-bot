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
    get_faction_member_access,
    upsert_faction_member_access,
    set_faction_member_enabled,
    delete_faction_member_access,
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
)

from torn_identity import me_basic
from torn_faction import faction_basic
from torn_members import member_live_bars
from torn_war import ranked_war_summary
from torn_enemies import hospital_members_from_enemies, enemy_faction_members, split_enemy_buckets
from torn_shared import profile_url, attack_url, bounty_url

load_dotenv()

APP_NAME = "War Hub"
DEFAULT_REFRESH_SECONDS = int(os.getenv("DEFAULT_REFRESH_SECONDS", "30"))
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
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Session-Token, X-License-Admin"
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
    return _is_faction_management_role(str((user or {}).get("api_key") or ""), user_id, faction_id)


def _feature_access_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    is_owner = _session_is_owner(user)
    is_management_role = _is_faction_management_role(str(user.get("api_key") or ""), user_id, faction_id)
    is_leader = is_owner or is_management_role
    is_co_leader = bool(is_management_role and not is_owner)

    member_row = get_faction_member_access(faction_id, user_id) if faction_id and user_id else {}
    member_enabled = True if (is_owner or is_leader) else bool((member_row or {}).get("enabled", True))

    return {
        "is_owner": is_owner,
        "is_admin": is_owner,
        "is_faction_leader": is_leader,
        "is_faction_co_leader": is_co_leader,
        "can_manage_faction": (is_owner or is_leader),
        "show_admin": is_owner,
        "show_all_tabs": is_owner,
        "member_enabled": member_enabled,
        "status": "active",
        "can_use_features": True,
        "message": "",
    }


def _require_feature_access():
    return None


def _admin_request_allowed(user: Optional[Dict[str, Any]] = None) -> bool:
    admin_header = str(request.headers.get("X-License-Admin", "")).strip()
    owner_token = str(os.getenv("OWNER_TOKEN", "")).strip()
    if admin_header and owner_token and admin_header == owner_token:
        return True
    return _session_is_owner(user)


def require_admin(fn):
    @wraps(fn)
    @require_session
    def wrapper(*args, **kwargs):
        if not _admin_request_allowed(request.user):
            return err("Owner access only.", 403)
        return fn(*args, **kwargs)
    return wrapper


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


def _extract_member_bars_from_member(member: Dict[str, Any]) -> Dict[str, Any]:
    member = member or {}
    life = member.get("life") if isinstance(member.get("life"), dict) else {}
    energy = member.get("energy") if isinstance(member.get("energy"), dict) else {}
    nerve = member.get("nerve") if isinstance(member.get("nerve"), dict) else {}
    happy = member.get("happy") if isinstance(member.get("happy"), dict) else {}

    bars = {
        "life": life or {},
        "energy": energy or {},
        "nerve": nerve or {},
        "happy": happy or {},
    }

    med_cd = _to_int(
        member.get("medical_cooldown")
        or member.get("medicalcooldown")
        or member.get("med_cd")
        or 0,
        0,
    )

    return {"bars": bars, "medical_cooldown": med_cd}


def _build_member_bar_payload(member: Dict[str, Any], api_key: str = "") -> Dict[str, Any]:
    embedded = _extract_member_bars_from_member(member)
    bars = embedded.get("bars") or {}
    med_cd = _to_int(embedded.get("medical_cooldown"), 0)

    has_embedded = any(bool((bars.get(k) or {})) for k in ("life", "energy", "nerve", "happy")) or med_cd > 0
    if has_embedded:
        return {"bars": bars, "medical_cooldown": med_cd}

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
            "enabled": bool(access_row.get("enabled", True)),
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
    # Fair Fight Scout only build: do not persist or merge backend stat prediction fallbacks.
    return list(enemies or [])



def _build_war_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    if not faction_id:
        return {
            "has_war": False,
            "active": False,
            "registered": False,
            "phase": "none",
            "war_id": "",
            "war_type": "",
            "my_faction_id": "",
            "my_faction_name": faction_name,
            "enemy_faction_id": "",
            "enemy_faction_name": "",
            "enemy_members": [],
            "score_us": 0,
            "score_them": 0,
            "chain_us": 0,
            "chain_them": 0,
            "target_score": 0,
            "source_note": "No faction found.",
            "debug_factions": [],
            "debug_raw_keys": [],
            "debug_raw": {},
        }

    return ranked_war_summary(
        str(user.get("api_key") or "").strip(),
        my_faction_id=faction_id,
        my_faction_name=faction_name,
    ) or {}


def _build_enemy_payload(user: Dict[str, Any], war_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user = user or {}

    api_key = str(user.get("api_key") or "").strip()
    my_faction_id = str(user.get("faction_id") or "").strip()
    my_faction_name = str(user.get("faction_name") or "").strip()

    war = dict(war_payload or _build_war_payload(user) or {})
    enemy_faction_id = str(war.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(war.get("enemy_faction_name") or "").strip()

    empty = {
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "items": [],
        "buckets": _empty_enemy_buckets(),
        "counts_by_state": {key: 0 for key in _enemy_bucket_order()},
        "order": _enemy_bucket_order(),
        "count": 0,
        "war_ref": {
            "war_id": str(war.get("war_id") or ""),
            "active": bool(war.get("active")),
            "registered": bool(war.get("registered")),
            "phase": str(war.get("phase") or "none"),
        },
    }

    if not enemy_faction_id:
        return empty
    if my_faction_id and enemy_faction_id == my_faction_id:
        return empty
    if enemy_faction_name and my_faction_name and enemy_faction_name.lower() == my_faction_name.lower():
        return empty

    enemy_payload = enemy_faction_members(api_key, enemy_faction_id)
    if not enemy_payload.get("ok"):
        empty["source_note"] = str(enemy_payload.get("error") or "")
        empty["debug_attempts"] = enemy_payload.get("debug_attempts") or []
        return empty

    resolved_enemy_faction_id = str(enemy_payload.get("enemy_faction_id") or enemy_faction_id or "").strip()
    resolved_enemy_faction_name = str(enemy_payload.get("enemy_faction_name") or enemy_faction_name or "").strip()

    items = [
        _build_enemy_member_payload(m, resolved_enemy_faction_id, resolved_enemy_faction_name)
        for m in (enemy_payload.get("members") or [])
    ]

    items = _store_enemy_predictions(my_faction_id, resolved_enemy_faction_id, list(items))
    buckets = split_enemy_buckets(items)
    counts_by_state = {key: len(buckets.get(key) or []) for key in _enemy_bucket_order()}

    return {
        "enemy_faction_id": resolved_enemy_faction_id,
        "enemy_faction_name": resolved_enemy_faction_name,
        "items": items,
        "buckets": buckets,
        "counts_by_state": counts_by_state,
        "order": _enemy_bucket_order(),
        "count": len(items),
        "source_note": str(enemy_payload.get("source") or ""),
        "debug_attempts": enemy_payload.get("debug_attempts") or [],
        "war_ref": {
            "war_id": str(war.get("war_id") or ""),
            "active": bool(war.get("active")),
            "registered": bool(war.get("registered")),
            "phase": str(war.get("phase") or "none"),
            "enemy_faction_id": resolved_enemy_faction_id,
            "enemy_faction_name": resolved_enemy_faction_name,
        },
    }


def _build_hospital_payload(
    user: Dict[str, Any],
    war_payload: Optional[Dict[str, Any]] = None,
    enemy_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
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

    war = dict(war_payload or _build_war_payload(user) or {})
    enemies_payload = enemy_payload or _build_enemy_payload(user, war)

    enemy_faction_id = str(enemies_payload.get("enemy_faction_id") or "").strip()
    enemy_faction_name = str(enemies_payload.get("enemy_faction_name") or "").strip()

    hospital_members = hospital_members_from_enemies(enemies_payload.get("items") or [])

    synced = sync_hospital_dibs_snapshot(
        faction_id=faction_id,
        faction_name=faction_name,
        enemy_faction_id=enemy_faction_id,
        enemy_faction_name=enemy_faction_name,
        members=hospital_members,
    )

    dib_map = {str(item.get("enemy_user_id") or ""): item for item in synced}
    now_ts = int(datetime.now(timezone.utc).timestamp())

    items = []
    for member in hospital_members:
        enemy_user_id = str(member.get("user_id") or "").strip()
        dib = dib_map.get(enemy_user_id) or {}
        dibbed_by_name = str(dib.get("dibbed_by_name") or "").strip()
        dibs_lock_until_ts = _to_int(dib.get("dibs_lock_until_ts"), 0)

        items.append({
            **member,
            "enemy_user_id": enemy_user_id,
            "dibbed_by_user_id": str(dib.get("dibbed_by_user_id") or ""),
            "dibbed_by_name": dibbed_by_name,
            "dibbed_at": str(dib.get("dibbed_at") or ""),
            "left_hospital_at": str(dib.get("left_hospital_at") or ""),
            "dibs_lock_until_ts": dibs_lock_until_ts,
            "overview_remove_after_ts": _to_int(dib.get("overview_remove_after_ts"), 0),
            "dibs_available": bool(not dibbed_by_name and dibs_lock_until_ts <= now_ts),
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

    items.sort(
        key=lambda x: (
            _to_int(x.get("hospital_until_ts"), 0) if _to_int(x.get("hospital_until_ts"), 0) > 0 else 9999999999,
            str(x.get("name") or "").lower(),
        )
    )

    return {
        "items": items,
        "count": len(items),
        "overview_items": overview_items,
        "overview_count": len(overview_items),
        "enemy_faction_id": enemy_faction_id,
        "enemy_faction_name": enemy_faction_name,
    }


def _build_targets_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    owner_user_id = str(user.get("user_id") or "").strip()
    faction_id = str(user.get("faction_id") or "").strip()
    if not owner_user_id:
        return {"items": [], "count": 0}

    items = list_user_targets(user_id=owner_user_id, faction_id=faction_id) or []
    cleaned: List[Dict[str, Any]] = []

    for item in items:
        target_user_id = str(item.get("target_user_id") or item.get("user_id") or "").strip()
        target_name = str(item.get("target_name") or item.get("name") or "").strip()

        cleaned.append({
            **item,
            "user_id": target_user_id,
            "target_user_id": target_user_id,
            "name": target_name,
            "target_name": target_name,
            "profile_url": profile_url(target_user_id) if target_user_id else "",
            "attack_url": attack_url(target_user_id) if target_user_id else "",
            "bounty_url": bounty_url(target_user_id) if target_user_id else "",
        })

    cleaned.sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))
    return {"items": cleaned, "count": len(cleaned)}


def _build_chain_payload(user: Dict[str, Any], war: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    rows = list_chain_statuses(faction_id) if faction_id else []
    mine = next((r for r in rows if str(r.get("user_id") or "") == user_id), {})
    available_items = [r for r in rows if _safe_bool(r.get("available"))]
    sitter_items = [r for r in rows if _safe_bool(r.get("sitter_enabled"))]
    war = war or {}

    return {
        "available": bool(mine.get("available")),
        "sitter_enabled": bool(mine.get("sitter_enabled")),
        "current": _to_int(war.get("chain_us") or war.get("our_chain") or 0, 0),
        "cooldown": _to_int(war.get("chain_cooldown") or 0, 0),
        "available_items": available_items,
        "available_count": len(available_items),
        "sitter_items": sitter_items,
        "sitter_count": len(sitter_items),
    }


def _build_med_deals_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    faction_id = str(user.get("faction_id") or "").strip()
    rows = list_med_deals(faction_id) if faction_id else []
    text = "\n".join([
        f"{str(r.get('user_name') or r.get('user_id') or '').strip()} → {str(r.get('enemy_name') or r.get('enemy_user_id') or '').strip()}"
        for r in rows
        if str(r.get("user_id") or "").strip()
    ])
    return {"items": rows, "count": len(rows), "text": text}


def _build_state_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    user = user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    access = _feature_access_for_user(user)
    war = _build_war_payload(user) if faction_id else {}
    notifications = list_notifications(str(user.get("user_id") or ""), limit=25)
    terms_summary_row = get_faction_terms_summary(faction_id) if faction_id else {}
    med_deals_payload = _build_med_deals_payload(user)
    chain_payload = _build_chain_payload(user, war)

    return {
        "app_name": APP_NAME,
        "viewer": {
            "user_id": str(user.get("user_id") or ""),
            "name": str(user.get("name") or ""),
            "faction_id": faction_id,
            "faction_name": faction_name,
        },
        "faction": {"faction_id": faction_id, "faction_name": faction_name, "name": faction_name},
        "war": war,
        "notifications": notifications,
        "access": access,
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
        "med_deals": med_deals_payload,
        "chain": chain_payload,
        "refresh_seconds": DEFAULT_REFRESH_SECONDS,
    }


def _summary_member_row(member: Dict[str, Any], member_stats_map: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    user_id = str(member.get("user_id") or member.get("id") or "").strip()
    name = str(member.get("name") or member.get("user_name") or "Player").strip() or "Player"
    stats = member_stats_map.get(user_id) or {}

    hits = _to_int(stats.get("hits", stats.get("attack_count", stats.get("attacks", 0))), 0)
    respect_gain = _to_float(stats.get("respect_gain", stats.get("respect_gained", 0.0)), 0.0)
    respect_lost = _to_float(stats.get("respect_lost", stats.get("points_lost", 0.0)), 0.0)
    hits_taken = _to_int(stats.get("hits_taken", stats.get("attacked_by", 0)), 0)
    net_impact = _to_float(stats.get("net_impact"), respect_gain - respect_lost)
    efficiency = _to_float(stats.get("efficiency"), (respect_gain / hits) if hits > 0 else 0.0)

    return {
        "user_id": user_id,
        "name": name,
        "role": str(member.get("position") or member.get("role") or "").strip(),
        "status": str(member.get("status") or member.get("online_state") or "").strip() or "Unknown",
        "profile_url": str(member.get("profile_url") or profile_url(user_id)),
        "enabled": bool(member.get("enabled")),
        "member_access": member.get("member_access") or {},
        "has_stored_api_key": bool(member.get("has_stored_api_key")),
        "online_state": str(member.get("online_state") or "").strip().lower(),
        "hits": hits,
        "respect_gain": round(respect_gain, 2),
        "respect_lost": round(respect_lost, 2),
        "net_impact": round(net_impact, 2),
        "hits_taken": hits_taken,
        "efficiency": round(efficiency, 2),
        "last_action": str(stats.get("last_action") or member.get("last_action") or "").strip(),
        "hospital_eta": "",
        "hospital_eta_seconds": 0,
        "no_show": hits <= 0,
        "recovering_soon": False,
        "flags": [],
    }


def _extract_first_list(payload: Dict[str, Any], *keys: str) -> List[Dict[str, Any]]:
    payload = payload or {}
    for key in keys:
        maybe = payload.get(key)
        if isinstance(maybe, list):
            return [x for x in maybe if isinstance(x, dict)]
    return []


def _top_name(rows: List[Dict[str, Any]], key: str, default: str = "—") -> str:
    if not rows:
        return default
    ranked = sorted(rows, key=lambda r: r.get(key) or 0, reverse=True)
    top = ranked[0] if ranked else {}
    if not top or not (top.get(key) or 0):
        return default
    return f"{top.get('name') or 'Player'} [{top.get('user_id') or ''}]".strip()


def _live_summary_payload(user: Dict[str, Any]) -> Dict[str, Any]:
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    members = _build_live_faction_members(user) if faction_id else []
    war = _build_war_payload(user) if faction_id else {}

    member_stats_source = _extract_first_list(
        war,
        "member_summary",
        "member_stats",
        "faction_member_stats",
        "our_member_stats",
        "our_members",
        "members",
        "leaderboard",
        "scoreboard",
        "stats",
        "rows",
    )
    member_stats_map = {str(item.get("user_id") or item.get("id") or ""): item for item in member_stats_source}

    rows = [_summary_member_row(member, member_stats_map) for member in members]
    rows.sort(
        key=lambda r: (
            (r.get("net_impact") or 0),
            (r.get("respect_gain") or 0),
            (r.get("hits") or 0),
        ),
        reverse=True,
    )

    total_respect_gain = round(sum(_to_float(r.get("respect_gain"), 0.0) for r in rows), 2)
    total_respect_lost = round(sum(_to_float(r.get("respect_lost"), 0.0) for r in rows), 2)
    total_hits = sum(_to_int(r.get("hits"), 0) for r in rows)
    total_hits_taken = sum(_to_int(r.get("hits_taken"), 0) for r in rows)
    net_impact = round(total_respect_gain - total_respect_lost, 2)

    no_shows = [r for r in rows if r.get("no_show")]
    top_hitters = sorted(rows, key=lambda r: ((r.get("hits") or 0), (r.get("respect_gain") or 0)), reverse=True)
    top_respect_gain = sorted(rows, key=lambda r: ((r.get("respect_gain") or 0), (r.get("hits") or 0)), reverse=True)
    top_respect_lost = sorted(rows, key=lambda r: ((r.get("respect_lost") or 0), (r.get("hits_taken") or 0)), reverse=True)
    top_hits_taken = sorted(rows, key=lambda r: ((r.get("hits_taken") or 0), (r.get("respect_lost") or 0)), reverse=True)
    top_net_impact = sorted(rows, key=lambda r: ((r.get("net_impact") or 0), (r.get("respect_gain") or 0)), reverse=True)
    best_efficiency = sorted(rows, key=lambda r: ((r.get("efficiency") or 0), (r.get("respect_gain") or 0)), reverse=True)

    cards = [
        {"label": "Respect Gained", "value": total_respect_gain, "cls": "good"},
        {"label": "Respect Lost", "value": total_respect_lost, "cls": "bad"},
        {"label": "Net Impact", "value": net_impact, "cls": "good" if net_impact >= 0 else "bad"},
        {"label": "Hits Made", "value": total_hits, "cls": ""},
        {"label": "Hits Taken", "value": total_hits_taken, "cls": ""},
        {"label": "No Shows", "value": len(no_shows), "cls": "warn" if no_shows else ""},
    ]

    overall = {
        "respect_gain": total_respect_gain,
        "respect_lost": total_respect_lost,
        "net": net_impact,
        "hits": total_hits,
        "hits_taken": total_hits_taken,
    }

    return {
        "cards": cards,
        "top": {
            "top_hitter": _top_name(top_hitters, "hits"),
            "top_respect_gain": _top_name(top_respect_gain, "respect_gain"),
            "top_respect_lost": _top_name(top_respect_lost, "respect_lost"),
            "top_hits_taken": _top_name(top_hits_taken, "hits_taken"),
            "best_efficiency": _top_name(best_efficiency, "efficiency"),
            "best_finisher": _top_name(top_net_impact, "net_impact"),
        },
        "rows": rows,
        "top_five": {
            "top_hitters": top_hitters[:5],
            "top_respect_gain": top_respect_gain[:5],
            "top_respect_lost": top_respect_lost[:5],
            "top_hits_taken": top_hits_taken[:5],
            "top_net_impact": top_net_impact[:5],
            "no_shows": no_shows[:5],
            "recovering_soon": [],
        },
        "alerts": {
            "no_shows": no_shows[:5],
            "bleeding": top_respect_lost[:5],
            "under_fire": top_hits_taken[:5],
            "recovering_soon": [],
            "carrying": top_net_impact[:5],
        },
        "trend": {
            "last_15m": overall,
            "last_60m": overall,
            "overall": overall,
        },
        "war": {
            "war_id": war.get("war_id") or war.get("ranked_war_id") or 0,
            "our_faction_name": str(war.get("our_faction_name") or faction_name),
            "enemy_faction_name": str(war.get("enemy_faction_name") or ""),
            "score_us": _to_float(war.get("score_us", war.get("our_score", 0.0)), 0.0),
            "score_them": _to_float(war.get("score_them", war.get("enemy_score", 0.0)), 0.0),
            "chain_us": _to_int(war.get("chain_us"), 0),
            "chain_them": _to_int(war.get("chain_them"), 0),
            "enemy_members_count": 0,
        },
        "meta": {
            "faction_id": faction_id,
            "faction_name": faction_name,
            "generated_at": utc_now(),
            "member_rows": len(rows),
        },
    }


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
    name = str(me.get("name") or "Unknown").strip() or "Unknown"

    if not user_id:
        return err("Could not resolve user ID.", 400)

    upsert_user(
        user_id=user_id,
        name=name,
        api_key=api_key,
        faction_id=faction_id,
        faction_name=faction_name,
    )

    delete_sessions_for_user(user_id)
    sess = create_session(user_id)
    user = get_user(user_id) or {}
    access = _feature_access_for_user(user)

    add_audit_log(
        actor_user_id=user_id,
        actor_name=name,
        action="auth_login",
        meta_json=f"faction_id={faction_id}",
    )

    try:
        state_payload = _build_state_payload(user)
    except Exception as e:
        add_audit_log(
            actor_user_id=user_id,
            actor_name=name,
            action="auth_state_build_warning",
            meta_json=str(e),
        )
        state_payload = {
            "app_name": APP_NAME,
            "viewer": {
                "user_id": user_id,
                "name": name,
                "faction_id": faction_id,
                "faction_name": faction_name,
            },
            "faction": {"faction_id": faction_id, "faction_name": faction_name, "name": faction_name},
            "war": {},
            "notifications": [],
            "access": access,
            "admin": {
                "is_owner": bool(access.get("is_owner")),
                "show_admin": bool(access.get("show_admin")),
            },
            "terms_summary": {
                "text": "",
                "updated_by_user_id": "",
                "updated_by_name": "",
                "updated_at": "",
            },
            "med_deals": {"items": [], "count": 0, "text": ""},
            "chain": {"items": [], "available": [], "sitters": []},
            "auth_state_warning": str(e),
        }

    viewer_payload = {
        "user_id": user_id,
        "name": name,
        "faction_id": faction_id,
        "faction_name": faction_name,
    }

    return ok(
        token=str(sess.get("token") or ""),
        session_token=str(sess.get("token") or ""),
        viewer=viewer_payload,
        user=viewer_payload,
        access=access,
        state=state_payload,
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
    return ok(**_build_state_payload(request.user or {}))


@app.route("/api/overview/live", methods=["GET"])
@require_session
def api_overview_live():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    if not faction_id:
        return ok(
            overview={
                "faction_id": "",
                "faction_name": faction_name,
                "war_id": 0,
                "our_faction_name": faction_name,
                "enemy_faction_name": "",
                "score_us": 0,
                "score_them": 0,
                "chain_us": 0,
                "chain_them": 0,
                "updated_at": utc_now(),
            }
        )

    war = _build_war_payload(user)
    return ok(
        overview={
            "faction_id": faction_id,
            "faction_name": faction_name,
            "war_id": war.get("war_id") or war.get("ranked_war_id") or 0,
            "our_faction_name": war.get("our_faction_name") or war.get("my_faction_name") or faction_name,
            "enemy_faction_id": war.get("enemy_faction_id") or "",
            "enemy_faction_name": war.get("enemy_faction_name") or "",
            "score_us": war.get("score_us") or war.get("our_score") or 0,
            "score_them": war.get("score_them") or war.get("enemy_score") or 0,
            "chain_us": war.get("chain_us") or 0,
            "chain_them": war.get("chain_them") or 0,
            "updated_at": utc_now(),
        }
    )


@app.route("/api/live-summary", methods=["GET"])
@require_session
def api_live_summary():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()

    if not faction_id:
        return ok(
            cards=[],
            top={},
            rows=[],
            top_five={},
            alerts={},
            trend={},
            war={
                "war_id": 0,
                "our_faction_name": faction_name,
                "enemy_faction_name": "",
                "score_us": 0,
                "score_them": 0,
                "chain_us": 0,
                "chain_them": 0,
                "enemy_members_count": 0,
            },
            meta={
                "faction_id": "",
                "faction_name": faction_name,
                "generated_at": utc_now(),
                "member_rows": 0,
            },
        )

    return ok(**_live_summary_payload(user))


@app.route("/api/notifications/seen", methods=["POST"])
@require_session
def api_notifications_seen():
    mark_notifications_seen(str((request.user or {}).get("user_id") or ""))
    return ok(message="Notifications marked seen.")


@app.route("/api/war", methods=["GET"])
@require_session
def api_war():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()

    if not faction_id:
        return ok(war={}, count=0)

    war = _build_war_payload(user)
    return ok(war=war, count=0)


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

    war = _build_war_payload(user)
    payload = _build_enemy_payload(user, war)

    return ok(
        items=payload.get("items") or [],
        count=payload.get("count") or 0,
        faction_id=str(payload.get("enemy_faction_id") or ""),
        faction_name=str(payload.get("enemy_faction_name") or ""),
        buckets=payload.get("buckets") or _empty_enemy_buckets(),
        counts_by_state=payload.get("counts_by_state") or {key: 0 for key in _enemy_bucket_order()},
        order=payload.get("order") or _enemy_bucket_order(),
        war=payload.get("war_ref") or {},
        source_note=str(payload.get("source_note") or ""),
        debug_attempts=payload.get("debug_attempts") or [],
    )


@app.route("/api/hospital", methods=["GET"])
@require_session
def api_hospital():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()

    if not faction_id:
        return ok(
            items=[],
            count=0,
            overview_items=[],
            overview_count=0,
            faction_id="",
            faction_name="",
            enemy_faction_id="",
            enemy_faction_name="",
        )

    war = _build_war_payload(user)
    enemy_payload = _build_enemy_payload(user, war)
    hospital_payload = _build_hospital_payload(user, war, enemy_payload)

    return ok(
        items=hospital_payload.get("items") or [],
        count=hospital_payload.get("count") or 0,
        overview_items=hospital_payload.get("overview_items") or [],
        overview_count=hospital_payload.get("overview_count") or 0,
        faction_id=faction_id,
        faction_name=str(user.get("faction_name") or ""),
        enemy_faction_id=hospital_payload.get("enemy_faction_id") or "",
        enemy_faction_name=hospital_payload.get("enemy_faction_name") or "",
        war={
            "war_id": str((war or {}).get("war_id") or ""),
            "active": bool((war or {}).get("active")),
            "registered": bool((war or {}).get("registered")),
            "phase": str((war or {}).get("phase") or "none"),
            "enemy_faction_id": hospital_payload.get("enemy_faction_id") or "",
            "enemy_faction_name": hospital_payload.get("enemy_faction_name") or "",
        },
    )


@app.route("/api/hospital/dibs/<enemy_user_id>", methods=["POST"])
@require_session
def api_hospital_dibs_claim(enemy_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()

    if not faction_id:
        return err("No faction found.", 400)

    war = _build_war_payload(user)
    enemy_payload = _build_enemy_payload(user, war)
    _build_hospital_payload(user, war, enemy_payload)

    result = claim_hospital_dib(
        faction_id=faction_id,
        enemy_user_id=str(enemy_user_id),
        dibbed_by_user_id=str(user.get("user_id") or ""),
        dibbed_by_name=str(user.get("name") or ""),
    )

    if not result.get("ok"):
        return err(str(result.get("error") or "Could not dib enemy."), 400)

    hospital_payload = _build_hospital_payload(user, war, enemy_payload)

    return ok(
        message="Dibs claimed.",
        item=result.get("item") or {},
        overview_items=hospital_payload.get("overview_items") or [],
        overview_count=hospital_payload.get("overview_count") or 0,
        hospital_items=hospital_payload.get("items") or [],
        hospital_count=hospital_payload.get("count") or 0,
    )


@app.route("/api/targets", methods=["GET"])
@require_session
def api_targets():
    payload = _build_targets_payload(request.user or {})
    return ok(items=payload.get("items") or [], count=payload.get("count") or 0)


@app.route("/api/targets", methods=["POST"])
@require_session
def api_targets_save():
    user = request.user or {}
    owner_user_id = str(user.get("user_id") or "").strip()
    if not owner_user_id:
        return err("Unauthorized.", 401)

    data = _require_json()
    target_user_id = str(data.get("user_id") or data.get("target_user_id") or "").strip()
    target_name = str(data.get("name") or data.get("target_name") or "").strip()
    note = str(data.get("note") or "").strip()

    if not target_user_id:
        return err("Missing target user ID.", 400)
    if not target_name:
        return err("Missing target name.", 400)

    item = upsert_user_target(
        owner_user_id=owner_user_id,
        owner_name=str(user.get("name") or ""),
        faction_id=str(user.get("faction_id") or ""),
        faction_name=str(user.get("faction_name") or ""),
        target_user_id=target_user_id,
        target_name=target_name,
        note=note,
    )
    return ok(message="Target saved.", item=item)


@app.route("/api/targets/<target_user_id>", methods=["DELETE", "POST"])
@require_session
def api_targets_delete(target_user_id: str):
    user = request.user or {}
    owner_user_id = str(user.get("user_id") or "").strip()
    if not owner_user_id:
        return err("Unauthorized.", 401)

    delete_user_target(
        owner_user_id=owner_user_id,
        faction_id=str(user.get("faction_id") or ""),
        target_user_id=str(target_user_id or "").strip(),
    )
    payload = _build_targets_payload(user)
    return ok(
        message="Target deleted.",
        target_user_id=str(target_user_id or "").strip(),
        items=payload.get("items") or [],
        count=payload.get("count") or 0,
    )


@app.route("/api/meddeals", methods=["GET"])
@require_session
def api_meddeals_get():
    return ok(**_build_med_deals_payload(request.user or {}))


@app.route("/api/meddeals", methods=["POST"])
@require_session
def api_meddeals_save():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)

    data = _require_json()
    deal_user_id = str(data.get("user_id") or user.get("user_id") or "").strip()
    deal_user_name = str(data.get("user_name") or user.get("name") or "").strip()
    enemy_user_id = str(data.get("enemy_user_id") or "").strip()
    enemy_name = str(data.get("enemy_name") or "").strip()

    if not deal_user_id:
        return err("Missing user ID.", 400)
    if not enemy_user_id:
        return err("Missing enemy user ID.", 400)

    item = upsert_med_deal(
        faction_id=faction_id,
        user_id=deal_user_id,
        user_name=deal_user_name,
        enemy_user_id=enemy_user_id,
        enemy_name=enemy_name,
    )
    return ok(message="Med deal saved.", item=item, **_build_med_deals_payload(user))


@app.route("/api/meddeals/<enemy_user_id>", methods=["DELETE", "POST"])
@require_session
def api_meddeals_delete(enemy_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return err("No faction found.", 400)

    delete_med_deal(faction_id=faction_id, enemy_user_id=str(enemy_user_id or "").strip())
    return ok(message="Med deal deleted.", enemy_user_id=str(enemy_user_id or "").strip(), **_build_med_deals_payload(user))


@app.route("/api/chain", methods=["GET"])
@require_session
def api_chain_get():
    user = request.user or {}
    war = _build_war_payload(user)
    return ok(**_build_chain_payload(user, war))


@app.route("/api/chain", methods=["POST"])
@require_session
def api_chain_save():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    user_id = str(user.get("user_id") or "").strip()
    if not faction_id or not user_id:
        return err("No faction or user found.", 400)

    data = _require_json()
    item = upsert_chain_status(
        faction_id=faction_id,
        user_id=user_id,
        user_name=str(user.get("name") or ""),
        available=1 if _safe_bool(data.get("available")) else 0,
        sitter_enabled=1 if _safe_bool(data.get("sitter_enabled")) else 0,
    )
    war = _build_war_payload(user)
    payload = _build_chain_payload(user, war)
    return ok(message="Chain status updated.", item=item, **payload)


@app.route("/api/terms", methods=["GET"])
@require_session
def api_terms_get():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    if not faction_id:
        return ok(text="", updated_by_user_id="", updated_by_name="", updated_at="")

    row = get_faction_terms_summary(faction_id) or {}
    return ok(
        text=str(row.get("text") or ""),
        updated_by_user_id=str(row.get("updated_by_user_id") or ""),
        updated_by_name=str(row.get("updated_by_name") or ""),
        updated_at=str(row.get("updated_at") or ""),
    )


@app.route("/api/terms", methods=["POST"])
@require_leader_session
def api_terms_save():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    data = _require_json()

    item = upsert_faction_terms_summary(
        faction_id=faction_id,
        faction_name=faction_name,
        text=str(data.get("text") or "").strip(),
        updated_by_user_id=str(user.get("user_id") or ""),
        updated_by_name=str(user.get("name") or ""),
    )
    return ok(message="Terms updated.", item=item)


@app.route("/api/faction/members", methods=["GET"])
@require_session
def api_faction_members():
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    items = _build_live_faction_members(user)
    return ok(
        faction_id=faction_id,
        faction_name=faction_name,
        items=items,
        count=len(items),
        source="api_faction_members_single_path",
        viewer_user_id=str(user.get("user_id") or ""),
    )


@app.route("/api/faction/members/<member_user_id>/access", methods=["POST"])
@app.route("/api/faction/members/<member_user_id>/billing", methods=["POST"])
@require_leader_session
def api_faction_member_access(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    data = _require_json()

    member_name = str(data.get("member_name") or "").strip()
    member_api_key = str(data.get("member_api_key") or "").strip()
    position = str(data.get("position") or "").strip()
    enabled = _safe_bool(data.get("enabled"))

    row = get_faction_member_access(faction_id, str(member_user_id))
    if row:
        item = set_faction_member_enabled(
            faction_id=faction_id,
            member_user_id=str(member_user_id),
            enabled=1 if enabled else 0,
            changed_by_user_id=str(user.get("user_id") or ""),
            changed_by_name=str(user.get("name") or ""),
        )
    else:
        item = upsert_faction_member_access(
            faction_id=faction_id,
            faction_name=faction_name,
            leader_user_id=str(user.get("user_id") or ""),
            leader_name=str(user.get("name") or ""),
            member_user_id=str(member_user_id),
            member_name=member_name,
            member_api_key=member_api_key,
            enabled=1 if enabled else 0,
            position=position,
        )

    return ok(message="Member access updated.", item=item)


@app.route("/api/faction/members/<member_user_id>/activate", methods=["POST"])
@require_leader_session
def api_faction_member_activate(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()
    faction_name = str(user.get("faction_name") or "").strip()
    data = _require_json()

    item = upsert_faction_member_access(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=str(user.get("user_id") or ""),
        leader_name=str(user.get("name") or ""),
        member_user_id=str(member_user_id),
        member_name=str(data.get("member_name") or "").strip(),
        member_api_key=str(data.get("member_api_key") or "").strip(),
        enabled=1,
        position=str(data.get("position") or "").strip(),
    )

    return ok(message="Member activated.", item=item)


@app.route("/api/faction/members/<member_user_id>", methods=["DELETE"])
@require_leader_session
def api_faction_member_delete(member_user_id: str):
    user = request.user or {}
    faction_id = str(user.get("faction_id") or "").strip()

    row = get_faction_member_access(faction_id, str(member_user_id))
    if row:
        delete_faction_member_access(faction_id=faction_id, member_user_id=str(member_user_id))

    return ok(message="Member removed.", member_user_id=str(member_user_id))


@app.route("/api/faction/members/<member_user_id>/remove", methods=["POST"])
@require_leader_session
def api_faction_member_remove_alias(member_user_id: str):
    return api_faction_member_delete(member_user_id)


@app.route("/api/admin/dashboard", methods=["GET"])
@require_admin
def api_admin_dashboard():
    faction_id = str((request.user or {}).get("faction_id") or "").strip()
    members = _build_live_faction_members(request.user or {}) if faction_id else []
    enabled_count = sum(1 for m in members if bool(m.get("enabled", True)))
    return ok(
        summary={
            "leaders_using_bot": 1,
            "members_using_bot": len(members),
            "enabled_members": enabled_count,
            "factions_using_bot": 1 if faction_id else 0,
        },
        faction_licenses=[],
        items=[],
        generated_at=utc_now(),
    )


@app.route("/api/admin/top-five", methods=["GET"])
@require_admin
def api_admin_top_five():
    live = _live_summary_payload(request.user or {})
    top_five = live.get("top_five") or {}
    return ok(
        top_hitters=top_five.get("top_hitters") or [],
        top_respect_gain=top_five.get("top_respect_gain") or [],
        top_respect_lost=top_five.get("top_respect_lost") or [],
        top_hits_taken=top_five.get("top_hits_taken") or [],
        top_net_impact=top_five.get("top_net_impact") or [],
        no_shows=top_five.get("no_shows") or [],
        generated_at=utc_now(),
    )


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
