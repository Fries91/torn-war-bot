import os
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Dict, Optional, List

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
    ensure_license_row,
    start_trial_if_needed,
    compute_license_status,
    clear_license_admin_key,
    renew_after_payment,
    get_payment_history,
    force_expire_license,
)
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
PAYMENT_PLAYER = os.getenv("PAYMENT_PLAYER", "Fries91")
PAYMENT_AMOUNT_XANAX = int(os.getenv("PAYMENT_AMOUNT_XANAX", "50"))
DEFAULT_REFRESH_SECONDS = int(os.getenv("DEFAULT_REFRESH_SECONDS", "30"))
LICENSE_ADMIN_TOKEN = str(os.getenv("LICENSE_ADMIN_TOKEN", "")).strip()


def _parse_admin_keys() -> set[str]:
    raw_multi = os.getenv("ADMIN_KEYS", "")
    raw_single = os.getenv("ADMIN_KEY", "")

    raw = raw_multi if raw_multi.strip() else raw_single
    if not raw.strip():
        return set()

    keys: set[str] = set()
    for part in raw.split(","):
        cleaned = str(part or "").strip().strip('"').strip("'")
        if cleaned:
            keys.add(cleaned)
    return keys


ADMIN_KEYS = _parse_admin_keys()

app = Flask(__name__, static_folder="static")


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


def _payment_details_payload(user_id: str = "") -> Dict[str, Any]:
    license_status = compute_license_status(user_id) if user_id else None
    return {
        "payment": {
            "required_player": PAYMENT_PLAYER,
            "required_amount": PAYMENT_AMOUNT_XANAX,
            "required_kind": "xanax",
            "message": f"Trial expired. Send {PAYMENT_AMOUNT_XANAX} Xanax to {PAYMENT_PLAYER} to continue access.",
        },
        "license": license_status,
    }


def _license_block_response(user_id: str, reason: str = ""):
    payload = _payment_details_payload(user_id)
    block_reason = reason or str((payload.get("license") or {}).get("block_reason") or "license_inactive")
    return err(
        f"Access blocked: {block_reason}. Send {PAYMENT_AMOUNT_XANAX} Xanax to {PAYMENT_PLAYER} to continue.",
        403,
        **payload,
    )


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


def require_session(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-Session-Token", "").strip()
        if not token:
            return err("Missing session token.", 401)

        sess = get_session(token)
        if not sess:
            return err("Invalid session token.", 401)

        user_id = str(sess.get("user_id") or "").strip()
        if not user_id:
            delete_session(token)
            return err("Invalid session user.", 401)

        license_status = compute_license_status(user_id)
        if not bool(license_status.get("active")):
            delete_sessions_for_user(user_id)
            return _license_block_response(user_id)

        touch_session(token)
        request.session = sess
        request.license_status = license_status
        return fn(*args, **kwargs)

    return wrapper


def _seconds_to_text(seconds: int) -> str:
    seconds = max(0, int(seconds or 0))
    if seconds <= 0:
        return "0s"

    days = seconds // 86400
    seconds %= 86400
    hours = seconds // 3600
    seconds %= 3600
    mins = seconds // 60
    secs = seconds % 60

    parts: List[str] = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if mins:
        parts.append(f"{mins}m")
    if secs and not parts:
        parts.append(f"{secs}s")
    return " ".join(parts[:3])


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


def _sort_members(members: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    bucket_rank = {
        "online": 0,
        "idle": 1,
        "offline": 2,
        "hospital": 3,
        "other": 4,
    }
    return sorted(
        members,
        key=lambda x: (
            bucket_rank.get(x.get("activity_bucket", "other"), 9),
            x.get("activity_minutes", 10**9),
            (x.get("name") or "").lower(),
        ),
    )


def _sort_hospital_members(members: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        [m for m in members if str(m.get("activity_bucket", "")) == "hospital"],
        key=lambda x: (
            int(x.get("hospital_seconds") or 10**9),
            (x.get("name") or "").lower(),
        ),
    )


def _merge_faction_members(faction_id: str, members: List[Dict[str, Any]]) -> Dict[str, Any]:
    local_map = get_user_map_by_faction(faction_id) if faction_id else {}

    merged = []
    chain_sitters = []
    available_count = 0
    linked_user_count = 0

    counts = {
        "online": 0,
        "idle": 0,
        "offline": 0,
        "hospital": 0,
    }

    for m in members:
        uid = str(m.get("user_id") or "")
        local = local_map.get(uid)

        available = int(local["available"]) if local else 1
        chain_sitter = int(local["chain_sitter"]) if local else 0
        linked_user = bool(local)

        if linked_user:
            linked_user_count += 1
        if available:
            available_count += 1

        activity_bucket = _member_activity_bucket(m)
        activity_minutes = _parse_minutes_from_member(m)

        if activity_bucket in counts:
            counts[activity_bucket] += 1

        item = {
            "user_id": uid,
            "id": uid,
            "name": m.get("name", "Unknown"),
            "level": m.get("level", ""),
            "status": m.get("status", ""),
            "status_detail": m.get("status_detail", ""),
            "last_action": m.get("last_action", ""),
            "position": m.get("position", ""),
            "online_state": m.get("online_state", activity_bucket),
            "online_status": m.get("online_state", activity_bucket),
            "hospital_seconds": int(m.get("hospital_seconds") or 0),
            "hospital_text": _seconds_to_text(int(m.get("hospital_seconds") or 0)),
            "available": available,
            "chain_sitter": chain_sitter,
            "linked_user": linked_user,
            "activity_bucket": activity_bucket,
            "activity_minutes": activity_minutes,
            "life_current": _to_int(m.get("life_current"), 0),
            "life_max": _to_int(m.get("life_max"), 0),
            "profile_url": profile_url(uid),
            "attack_url": attack_url(uid),
            "bounty_url": bounty_url(uid),
        }
        merged.append(item)

        if chain_sitter:
            chain_sitters.append(
                {
                    "user_id": uid,
                    "id": uid,
                    "name": item["name"],
                    "level": item["level"],
                    "online_state": item["online_state"],
                    "online_status": item["online_status"],
                    "hospital_seconds": item["hospital_seconds"],
                    "hospital_text": item["hospital_text"],
                    "profile_url": item["profile_url"],
                    "attack_url": item["attack_url"],
                }
            )

    merged = _sort_members(merged)
    chain_sitters.sort(key=lambda x: (x["name"] or "").lower())

    return {
        "members": merged,
        "chain_sitters": chain_sitters,
        "available_count": available_count,
        "linked_user_count": linked_user_count,
        "counts": counts,
        "hospital_members": _sort_hospital_members(merged),
    }


def _decorate_enemy_members(enemy_members: List[Dict[str, Any]]) -> Dict[str, Any]:
    counts = {
        "online": 0,
        "idle": 0,
        "offline": 0,
        "hospital": 0,
    }

    decorated = []
    for m in enemy_members:
        uid = str(m.get("user_id") or "")
        activity_bucket = _member_activity_bucket(m)
        activity_minutes = _parse_minutes_from_member(m)

        if activity_bucket in counts:
            counts[activity_bucket] += 1

        decorated.append(
            {
                "user_id": uid,
                "id": uid,
                "target_id": uid,
                "name": m.get("name", "Unknown"),
                "target_name": m.get("name", "Unknown"),
                "level": m.get("level", ""),
                "status": m.get("status", ""),
                "status_detail": m.get("status_detail", ""),
                "last_action": m.get("last_action", ""),
                "position": m.get("position", ""),
                "online_state": m.get("online_state", activity_bucket),
                "online_status": m.get("online_state", activity_bucket),
                "hospital_seconds": int(m.get("hospital_seconds") or 0),
                "hospital_text": _seconds_to_text(int(m.get("hospital_seconds") or 0)),
                "activity_bucket": activity_bucket,
                "activity_minutes": activity_minutes,
                "life_current": _to_int(m.get("life_current"), 0),
                "life_max": _to_int(m.get("life_max"), 0),
                "profile_url": profile_url(uid),
                "attack_url": attack_url(uid),
                "bounty_url": bounty_url(uid),
            }
        )

    decorated = _sort_members(decorated)

    return {
        "members": decorated,
        "counts": counts,
        "hospital_members": _sort_hospital_members(decorated),
    }


def _safe_name_map(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        uid = str(row.get("user_id") or "")
        if uid:
            out[uid] = row
    return out


def _rank_enemy_targets(enemy_members: List[Dict[str, Any]], assignments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    assigned_ids = {str(a.get("target_id") or "") for a in assignments if str(a.get("target_id") or "")}
    ranked: List[Dict[str, Any]] = []

    for m in enemy_members:
        score = 0
        online_state = str(m.get("online_state") or "").lower()
        hospital_seconds = int(m.get("hospital_seconds") or 0)
        level = _to_int(m.get("level"), 0)
        uid = str(m.get("user_id") or "")
        life_current = _to_int(m.get("life_current"), 0)
        life_max = max(1, _to_int(m.get("life_max"), 1))
        life_pct = (life_current / life_max) * 100 if life_max > 0 else 100

        if online_state == "online":
            score += 100
        elif online_state == "idle":
            score += 70
        elif online_state == "offline":
            score += 25

        if hospital_seconds > 0:
            if hospital_seconds <= 300:
                score += 35
            elif hospital_seconds <= 900:
                score += 10
            else:
                score -= 80

        if level > 0:
            score += max(0, 60 - min(level, 60))

        if life_pct <= 25:
            score += 45
        elif life_pct <= 50:
            score += 25
        elif life_pct <= 75:
            score += 10

        if uid in assigned_ids:
            score -= 40

        ranked.append(
            {
                **m,
                "priority_score": score,
                "is_assigned": uid in assigned_ids,
                "life_pct": round(life_pct, 1),
            }
        )

    ranked.sort(
        key=lambda x: (
            -int(x.get("priority_score") or 0),
            int(x.get("hospital_seconds") or 0),
            (x.get("name") or "").lower(),
        )
    )
    return ranked


def _calc_pace_and_estimate(war_id: str, score_us: int, score_them: int, target_score: int) -> Dict[str, Any]:
    if not war_id:
        return {
            "lead": score_us - score_them,
            "pace_per_hour_us": 0.0,
            "pace_per_hour_them": 0.0,
            "eta_to_target_us_seconds": 0,
            "eta_to_target_us_text": "",
            "snapshot_count": 0,
        }

    rows = list_recent_war_snapshots(war_id, limit=20)
    if not rows:
        return {
            "lead": score_us - score_them,
            "pace_per_hour_us": 0.0,
            "pace_per_hour_them": 0.0,
            "eta_to_target_us_seconds": 0,
            "eta_to_target_us_text": "",
            "snapshot_count": 0,
        }

    first = rows[-1]
    last = rows[0]

    first_us = _to_int(first.get("score_us"), score_us)
    first_them = _to_int(first.get("score_them"), score_them)
    last_us = _to_int(last.get("score_us"), score_us)
    last_them = _to_int(last.get("score_them"), score_them)

    first_ts = _to_int(first.get("ts"), 0)
    last_ts = _to_int(last.get("ts"), 0)

    elapsed = max(0, last_ts - first_ts)
    us_gain = max(0, last_us - first_us)
    them_gain = max(0, last_them - first_them)

    pace_us = round((us_gain / elapsed) * 3600, 2) if elapsed > 0 else 0.0
    pace_them = round((them_gain / elapsed) * 3600, 2) if elapsed > 0 else 0.0

    eta_seconds = 0
    eta_text = ""
    if target_score > 0 and pace_us > 0:
        remaining = max(0, target_score - score_us)
        if remaining > 0:
            eta_seconds = int(remaining / (pace_us / 3600)) if pace_us > 0 else 0
            eta_text = _seconds_to_text(eta_seconds)
        else:
            eta_text = "Reached"

    return {
        "lead": score_us - score_them,
        "pace_per_hour_us": pace_us,
        "pace_per_hour_them": pace_them,
        "eta_to_target_us_seconds": eta_seconds,
        "eta_to_target_us_text": eta_text,
        "snapshot_count": len(rows),
    }


def _emit_enemy_hospital_alerts(user_id: str, war_id: str, enemies: List[Dict[str, Any]]) -> None:
    if not war_id:
        return

    prev_map = get_enemy_state_map(war_id)
    for enemy in enemies:
        uid = str(enemy.get("user_id") or "")
        if not uid:
            continue

        cur_hosp = int(enemy.get("hospital_seconds") or 0)
        cur_state = str(enemy.get("online_state") or "")
        prev = prev_map.get(uid)
        prev_hosp = int(prev.get("hospital_seconds") or 0) if prev else 0

        if prev and prev_hosp > 0 and cur_hosp == 0:
            add_notification(user_id, "enemy_out", f'{enemy.get("name", "Enemy")} left hospital.')

        upsert_enemy_state(
            war_id=war_id,
            user_id=uid,
            name=str(enemy.get("name") or "Unknown"),
            online_state=cur_state,
            hospital_seconds=cur_hosp,
        )


def _decorate_assignments(assignments: List[Dict[str, Any]], enemy_map: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for row in assignments:
        target_id = str(row.get("target_id") or "")
        enemy = enemy_map.get(target_id, {})
        out.append(
            {
                **row,
                "assignee": row.get("assigned_to_name", ""),
                "target": row.get("target_name") or target_id,
                "target_profile_url": profile_url(target_id) if target_id else "",
                "target_attack_url": attack_url(target_id) if target_id else "",
                "target_bounty_url": bounty_url(target_id) if target_id else "",
                "online_state": enemy.get("online_state", ""),
                "online_status": enemy.get("online_status", ""),
                "hospital_seconds": int(enemy.get("hospital_seconds") or 0),
                "hospital_text": _seconds_to_text(int(enemy.get("hospital_seconds") or 0)),
                "level": enemy.get("level", row.get("target_level", "")),
            }
        )
    return out


def _top_lists(our_members: List[Dict[str, Any]], enemy_members: List[Dict[str, Any]]) -> Dict[str, Any]:
    online_ours = [m for m in our_members if str(m.get("online_state") or "") == "online"]
    online_enemies = [m for m in enemy_members if str(m.get("online_state") or "") == "online"]
    hospital_enemies = [m for m in enemy_members if int(m.get("hospital_seconds") or 0) > 0]

    return {
        "online_members": sorted(online_ours, key=lambda x: (x.get("name") or "").lower())[:10],
        "online_enemies": sorted(online_enemies, key=lambda x: (x.get("name") or "").lower())[:10],
        "hospital_enemies": sorted(hospital_enemies, key=lambda x: int(x.get("hospital_seconds") or 10**9))[:10],
    }


def _serialize_med_deals(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for row in rows:
        seller = str(row.get("seller_name") or "").strip()
        buyer = str(row.get("buyer_name") or "").strip()
        note = str(row.get("notes") or "").strip()

        out.append(
            {
                **row,
                "seller": seller,
                "seller_name": seller,
                "buyer": buyer,
                "buyer_name": buyer,
                "name": f"{seller} → {buyer}" if seller or buyer else "Unknown",
                "player": seller or buyer or "Unknown",
                "cost": "",
                "price": "",
                "amount": 0,
                "note": note,
                "terms": note,
            }
        )
    return out


def _serialize_targets(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for row in rows:
        tid = str(row.get("target_id") or "").strip()
        tname = str(row.get("target_name") or "").strip()
        notes = str(row.get("notes") or "").strip()
        out.append(
            {
                **row,
                "id": row.get("id"),
                "target_id": tid,
                "user_id": tid,
                "name": tname or tid,
                "target_name": tname or tid,
                "reason": notes,
                "note": notes,
                "attack_url": attack_url(tid) if tid else "",
                "profile_url": profile_url(tid) if tid else "",
                "bounty_url": bounty_url(tid) if tid else "",
            }
        )
    return out


def _serialize_notes(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for row in rows:
        out.append(
            {
                **row,
                "text": row.get("note", ""),
                "message": row.get("note", ""),
            }
        )
    return out


@app.route("/")
def root():
    return ok(
        service=APP_NAME,
        status="online",
        now=utc_now(),
        admin_keys_loaded=sorted(list(ADMIN_KEYS)),
        license_admin_enabled=bool(LICENSE_ADMIN_TOKEN),
        endpoints=[
            "/health",
            "/api/auth",
            "/api/logout",
            "/api/state",
            "/api/wars",
            "/api/analytics",
            "/api/settings",
            "/api/license/status",
            "/api/availability/set",
            "/api/chain-sitter/set",
            "/api/med-deals/add",
            "/api/med-deals/delete",
            "/api/targets/add",
            "/api/targets/delete",
            "/api/targets/assign",
            "/api/targets/unassign",
            "/api/targets/note",
            "/api/targets/note/delete",
            "/api/war-terms/set",
            "/api/war-terms/delete",
            "/api/bounties/add",
            "/api/bounties/delete",
            "/api/notifications",
            "/api/notifications/seen",
            "/api/admin/payment/confirm",
            "/api/admin/license/expire",
            "/api/admin/license/status",
            "/static/war-bot.user.js",
        ],
    )


@app.route("/health")
def health():
    return ok(
        service=APP_NAME,
        status="healthy",
        now=utc_now(),
        admin_keys_loaded=sorted(list(ADMIN_KEYS)),
        license_admin_enabled=bool(LICENSE_ADMIN_TOKEN),
    )


@app.route("/static/<path:path>")
def static_proxy(path):
    return send_from_directory("static", path)


@app.post("/api/auth")
def api_auth():
    try:
        data = request.get_json(force=True, silent=True) or {}
        admin_key = str(data.get("admin_key", "")).strip().strip('"').strip("'")
        api_key = str(data.get("api_key", "")).strip()

        if not api_key:
            return err("Missing Torn API key.")

        me = me_basic(api_key)
        if not me.get("ok"):
            return err(me.get("error", "Could not verify Torn API key."), 400)

        user_id = str(me["player"]["user_id"])
        name = me["player"]["name"]
        faction_id = str(me["player"].get("faction_id") or "")
        faction_name = me["player"].get("faction_name") or ""

        upsert_user(
            user_id=user_id,
            name=name,
            api_key=api_key,
            faction_id=faction_id,
            faction_name=faction_name,
        )

        ensure_license_row(user_id, admin_key=admin_key)
        license_status = compute_license_status(user_id)

        has_trial_started = bool(str(license_status.get("trial_started_at") or "").strip())
        license_active = bool(license_status.get("active"))

        if not has_trial_started:
            if not admin_key:
                return err("Missing admin key for first activation.", 403, **_payment_details_payload(user_id))
            if ADMIN_KEYS and admin_key not in ADMIN_KEYS:
                return err(
                    f"Invalid admin key. Server loaded these keys: {sorted(list(ADMIN_KEYS))}",
                    403,
                    **_payment_details_payload(user_id),
                )
            license_status = start_trial_if_needed(user_id, admin_key=admin_key)
            license_active = bool(license_status.get("active"))

        elif not license_active:
            clear_license_admin_key(user_id, note="trial_expired")
            delete_sessions_for_user(user_id)
            return _license_block_response(user_id)

        if not license_active:
            return _license_block_response(user_id)

        if get_user_setting(user_id, "refresh_seconds") is None:
            set_user_setting(user_id, "refresh_seconds", str(DEFAULT_REFRESH_SECONDS))
        if get_user_setting(user_id, "alerts_enabled") is None:
            set_user_setting(user_id, "alerts_enabled", "1")

        token = create_session(user_id)
        add_notification(user_id, "auth", f"Logged into {APP_NAME} successfully.")

        return ok(
            token=token,
            session_token=token,
            user={
                "user_id": user_id,
                "name": name,
                "faction_id": faction_id,
                "faction_name": faction_name,
                "profile_url": profile_url(user_id),
            },
            license=license_status,
            payment={
                "required_player": PAYMENT_PLAYER,
                "required_amount": PAYMENT_AMOUNT_XANAX,
                "required_kind": "xanax",
            },
        )
    except Exception as e:
        return err(f"Auth failed: {e}", 500)


@app.post("/api/logout")
@require_session
def api_logout():
    try:
        token = request.headers.get("X-Session-Token", "").strip()
        if token:
            delete_session(token)
        return ok(message="Logged out.")
    except Exception as e:
        return err(f"Logout failed: {e}", 500)


@app.get("/api/license/status")
@require_session
def api_license_status():
    try:
        user_id = request.session["user_id"]
        return ok(
            license=compute_license_status(user_id),
            payment={
                "required_player": PAYMENT_PLAYER,
                "required_amount": PAYMENT_AMOUNT_XANAX,
                "required_kind": "xanax",
            },
            payment_history=get_payment_history(user_id, limit=10),
        )
    except Exception as e:
        return err(f"Could not load license status: {e}", 500)


@app.get("/api/wars")
@require_session
def api_wars():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        res = faction_wars(user["api_key"])
        if not res.get("ok"):
            return err(res.get("error", "Could not load wars."), 500)

        return ok(
            wars=res.get("wars", []),
            source_ok=bool(res.get("source_ok")),
            source_note=res.get("source_note", ""),
            license=request.license_status,
        )
    except Exception as e:
        return err(f"Could not load wars: {e}", 500)


@app.get("/api/state")
@require_session
def api_state():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        api_key = user["api_key"]
        faction_id = user["faction_id"] or ""
        faction_name = user["faction_name"] or ""

        faction = {
            "ok": True,
            "faction_id": faction_id,
            "faction_name": faction_name,
            "members": [],
        }
        if faction_id:
            faction = faction_basic(api_key)
            if not faction.get("ok"):
                return err(faction.get("error", "Could not load faction."), 500)

        merged = _merge_faction_members(
            str(faction.get("faction_id", faction_id) or ""),
            faction.get("members", []),
        )

        war_summary = ranked_war_summary(
            api_key=api_key,
            my_faction_id=str(faction.get("faction_id", faction_id) or ""),
            my_faction_name=str(faction.get("faction_name", faction_name) or ""),
        )

        enemy_info = _decorate_enemy_members(war_summary.get("enemy_members", []))

        state_faction_id = str(faction.get("faction_id", faction_id) or "")
        state_faction_name = str(faction.get("faction_name", faction_name) or "")
        enemy_faction_name = str(war_summary.get("enemy_faction_name", "") or "").strip()
        enemy_faction_id = str(war_summary.get("enemy_faction_id", "") or "").strip()
        war_id = str(war_summary.get("war_id", "") or "")
        score_us = _to_int(war_summary.get("score_us"), 0)
        score_them = _to_int(war_summary.get("score_them"), 0)
        target_score = _to_int(war_summary.get("target_score"), 0)

        enemy_faction_options: List[Dict[str, str]] = []
        if enemy_faction_name or enemy_faction_id:
            enemy_faction_options.append(
                {
                    "faction_id": enemy_faction_id,
                    "faction_name": enemy_faction_name or f"Faction {enemy_faction_id}",
                }
            )

        war_active = bool(war_summary.get("active"))
        war_status_text = str(war_summary.get("status_text") or "").strip()
        if not war_active:
            war_status_text = "Currently not in war"

        if war_id:
            save_war_snapshot(
                war_id=war_id,
                faction_id=state_faction_id,
                faction_name=state_faction_name,
                enemy_faction_id=enemy_faction_id,
                enemy_faction_name=enemy_faction_name,
                score_us=score_us,
                score_them=score_them,
                target_score=target_score,
                lead=score_us - score_them,
                start_ts=_to_int(war_summary.get("start"), 0),
                end_ts=_to_int(war_summary.get("end"), 0),
                status_text=str(war_summary.get("status_text") or ""),
            )

        if _to_int(get_user_setting(user_id, "alerts_enabled"), 1):
            _emit_enemy_hospital_alerts(user_id, war_id, enemy_info["members"])

        assignments = list_target_assignments_for_war(war_id) if war_id else []
        enemy_map = _safe_name_map(enemy_info["members"])
        assignments = _decorate_assignments(assignments, enemy_map)

        ranked_targets = _rank_enemy_targets(enemy_info["members"], assignments)
        notes = _serialize_notes(list_war_notes(war_id) if war_id else [])
        war_terms = get_war_terms(war_id) if war_id else None
        pace = _calc_pace_and_estimate(war_id, score_us, score_them, target_score)
        tops = _top_lists(merged["members"], enemy_info["members"])

        refresh_seconds = _to_int(get_user_setting(user_id, "refresh_seconds"), DEFAULT_REFRESH_SECONDS)
        alerts_enabled = _to_int(get_user_setting(user_id, "alerts_enabled"), 1)

        med_deals = _serialize_med_deals(list_med_deals_for_faction(state_faction_id))
        targets = _serialize_targets(list_targets(user_id))
        notifications = list_notifications(user_id)
        license_status = compute_license_status(user_id)

        return ok(
            me={
                "user_id": user["user_id"],
                "name": user["name"],
                "faction_id": state_faction_id,
                "faction_name": state_faction_name,
                "profile_url": profile_url(user["user_id"]),
                "available": int(user.get("available", 1)),
                "chain_sitter": int(user.get("chain_sitter", 0)),
            },
            license=license_status,
            payment={
                "required_player": PAYMENT_PLAYER,
                "required_amount": PAYMENT_AMOUNT_XANAX,
                "required_kind": "xanax",
                "message": f"Send {PAYMENT_AMOUNT_XANAX} Xanax to {PAYMENT_PLAYER} to keep access after the trial.",
            },
            faction={
                "id": state_faction_id,
                "faction_id": state_faction_id,
                "name": state_faction_name,
                "faction_name": state_faction_name,
                "members": merged["members"],
            },
            enemy_faction={
                "id": enemy_faction_id,
                "faction_id": enemy_faction_id,
                "name": enemy_faction_name,
                "faction_name": enemy_faction_name,
                "members": enemy_info["members"],
                "message": "" if war_active else "Currently not in war",
            },
            quick_links={
                "opt_in": {
                    "endpoint": "/api/chain-sitter/set",
                    "payload": {"enabled": True},
                },
                "opt_out": {
                    "endpoint": "/api/chain-sitter/set",
                    "payload": {"enabled": False},
                },
                "available": {
                    "endpoint": "/api/availability/set",
                    "payload": {"available": True},
                },
                "unavailable": {
                    "endpoint": "/api/availability/set",
                    "payload": {"available": False},
                },
            },
            settings={
                "refresh_seconds": refresh_seconds,
                "alerts_enabled": alerts_enabled,
            },
            war={
                "active": war_active,
                "id": war_id,
                "war_id": war_id,
                "faction_id": state_faction_id,
                "faction_name": state_faction_name,
                "enemy_faction_id": enemy_faction_id,
                "enemy_faction_name": enemy_faction_name,
                "enemy_faction": {
                    "id": enemy_faction_id,
                    "faction_id": enemy_faction_id,
                    "name": enemy_faction_name,
                    "faction_name": enemy_faction_name,
                    "members": enemy_info["members"],
                },
                "enemy_faction_options": enemy_faction_options,
                "member_count": len(merged["members"]),
                "available_count": merged["available_count"],
                "chain_sitter_count": len(merged["chain_sitters"]),
                "linked_user_count": merged["linked_user_count"],
                "online_count": merged["counts"]["online"],
                "idle_count": merged["counts"]["idle"],
                "offline_count": merged["counts"]["offline"],
                "hospital_count": merged["counts"]["hospital"],
                "enemy_member_count": len(enemy_info["members"]),
                "enemy_online_count": enemy_info["counts"]["online"],
                "enemy_idle_count": enemy_info["counts"]["idle"],
                "enemy_offline_count": enemy_info["counts"]["offline"],
                "enemy_hospital_count": enemy_info["counts"]["hospital"],
                "war_type": war_summary.get("war_type", ""),
                "score": score_us,
                "our_score": score_us,
                "score_us": score_us,
                "enemy_score": score_them,
                "score_them": score_them,
                "lead": score_us - score_them,
                "target_score": target_score,
                "remaining_to_target": max(0, target_score - score_us) if target_score else 0,
                "chain": _to_int(war_summary.get("chain_us"), 0),
                "chain_us": _to_int(war_summary.get("chain_us"), 0),
                "chain_them": _to_int(war_summary.get("chain_them"), 0),
                "start": _to_int(war_summary.get("start"), 0),
                "end": _to_int(war_summary.get("end"), 0),
                "status_text": war_status_text,
                "message": "" if war_active else "Currently not in war",
                "source_ok": bool(war_summary.get("source_ok")),
                "source_note": war_summary.get("source_note", ""),
                "pace_per_hour_us": pace["pace_per_hour_us"],
                "pace_per_hour_them": pace["pace_per_hour_them"],
                "eta_to_target_us_seconds": pace["eta_to_target_us_seconds"],
                "eta_to_target_us_text": pace["eta_to_target_us_text"],
                "snapshot_count": pace["snapshot_count"],
                "terms_text": (war_terms or {}).get("terms_text", ""),
                "terms_updated_by_name": (war_terms or {}).get("updated_by_name", ""),
                "terms_updated_at": (war_terms or {}).get("updated_at", ""),
            },
            members=merged["members"],
            chain_sitters=merged["chain_sitters"],
            enemies=enemy_info["members"],
            enemy_options=enemy_info["members"],
            med_deal_buyers=enemy_info["members"] if war_active else [],
            med_deals_message="" if war_active else "Currently not in war",
            top_targets=ranked_targets[:15],
            target_assignments=assignments,
            assignments=assignments,
            war_notes=notes,
            notes=notes,
            war_terms=war_terms,
            top_lists=tops,
            hospital={
                "our_faction": merged["hospital_members"],
                "enemy_faction": enemy_info["hospital_members"],
                "our_count": len(merged["hospital_members"]),
                "enemy_count": len(enemy_info["hospital_members"]),
            },
            analytics={
                "lead": pace["lead"],
                "pace_per_hour_us": pace["pace_per_hour_us"],
                "pace_per_hour_them": pace["pace_per_hour_them"],
                "eta_to_target_us_seconds": pace["eta_to_target_us_seconds"],
                "eta_to_target_us_text": pace["eta_to_target_us_text"],
                "our_online": merged["counts"]["online"],
                "enemy_online": enemy_info["counts"]["online"],
                "our_hospital": merged["counts"]["hospital"],
                "enemy_hospital": enemy_info["counts"]["hospital"],
                "total_members": len(merged["members"]),
                "total_enemies": len(enemy_info["members"]),
                "online_members": merged["counts"]["online"],
            },
            med_deals=med_deals,
            targets=targets,
            bounties=list_bounties(user_id),
            notifications=notifications,
        )
    except Exception as e:
        return err(f"Could not load state: {e}", 500)


@app.get("/api/analytics")
@require_session
def api_analytics():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        api_key = user["api_key"]
        faction_id = str(user.get("faction_id") or "")
        faction_name = str(user.get("faction_name") or "")

        war_summary = ranked_war_summary(
            api_key=api_key,
            my_faction_id=faction_id,
            my_faction_name=faction_name,
        )

        war_id = str(war_summary.get("war_id") or "")
        score_us = _to_int(war_summary.get("score_us"), 0)
        score_them = _to_int(war_summary.get("score_them"), 0)
        target_score = _to_int(war_summary.get("target_score"), 0)
        pace = _calc_pace_and_estimate(war_id, score_us, score_them, target_score)
        snapshots = list_recent_war_snapshots(war_id, limit=25) if war_id else []

        return ok(
            analytics={
                "war_id": war_id,
                "score_us": score_us,
                "score_them": score_them,
                "lead": pace["lead"],
                "target_score": target_score,
                "pace_per_hour_us": pace["pace_per_hour_us"],
                "pace_per_hour_them": pace["pace_per_hour_them"],
                "eta_to_target_us_seconds": pace["eta_to_target_us_seconds"],
                "eta_to_target_us_text": pace["eta_to_target_us_text"],
                "snapshots": snapshots,
            },
            license=request.license_status,
        )
    except Exception as e:
        return err(f"Could not load analytics: {e}", 500)


@app.get("/api/settings")
@require_session
def api_settings_get():
    try:
        user_id = request.session["user_id"]
        return ok(
            settings={
                "refresh_seconds": _to_int(get_user_setting(user_id, "refresh_seconds"), DEFAULT_REFRESH_SECONDS),
                "alerts_enabled": _to_int(get_user_setting(user_id, "alerts_enabled"), 1),
            },
            license=request.license_status,
            payment={
                "required_player": PAYMENT_PLAYER,
                "required_amount": PAYMENT_AMOUNT_XANAX,
                "required_kind": "xanax",
            },
        )
    except Exception as e:
        return err(f"Could not load settings: {e}", 500)


@app.post("/api/settings")
@require_session
def api_settings_set():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}

        if "refresh_seconds" in data:
            refresh_seconds = max(10, min(300, _to_int(data.get("refresh_seconds"), DEFAULT_REFRESH_SECONDS)))
            set_user_setting(user_id, "refresh_seconds", str(refresh_seconds))

        if "alerts_enabled" in data:
            alerts_enabled = 1 if bool(data.get("alerts_enabled")) else 0
            set_user_setting(user_id, "alerts_enabled", str(alerts_enabled))

        return ok(message="Settings updated.")
    except Exception as e:
        return err(f"Could not update settings: {e}", 500)


@app.post("/api/availability/set")
@require_session
def api_availability_set():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        value = 1 if bool(data.get("available")) else 0
        set_availability(user_id, value)
        return ok(message="Availability updated.", available=value)
    except Exception as e:
        return err(f"Could not update availability: {e}", 500)


@app.post("/api/chain-sitter/set")
@require_session
def api_chain_sitter_set():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        value = 1 if bool(data.get("enabled")) else 0
        set_chain_sitter(user_id, value)
        return ok(message="Chain sitter updated.", enabled=value)
    except Exception as e:
        return err(f"Could not update chain sitter: {e}", 500)


@app.post("/api/med-deals/add")
@require_session
def api_med_deals_add():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        data = request.get_json(force=True, silent=True) or {}

        war_summary = ranked_war_summary(
            api_key=str(user.get("api_key") or "").strip(),
            my_faction_id=str(user.get("faction_id") or "").strip(),
            my_faction_name=str(user.get("faction_name") or "").strip(),
        )

        if not war_summary.get("active"):
            return err("Currently not in war.")

        seller_name = str(user.get("name") or "").strip()
        buyer_name = str(data.get("buyer_name", "")).strip()
        notes = str(data.get("notes", "")).strip()

        enemy_members = war_summary.get("enemy_members", []) or []
        valid_enemy_names = {
            str(m.get("name") or "").strip()
            for m in enemy_members
            if str(m.get("name") or "").strip()
        }

        if not buyer_name:
            return err("Choose a buyer.")
        if buyer_name not in valid_enemy_names:
            return err("Buyer must be an active enemy faction member from the current war.")

        add_med_deal(
            creator_user_id=user_id,
            creator_name=seller_name,
            faction_id=str(user.get("faction_id") or "").strip(),
            faction_name=str(user.get("faction_name") or "").strip(),
            buyer_name=buyer_name,
            seller_name=seller_name,
            notes=notes,
        )

        add_notification(user_id, "med_deal", f"Med deal added: {seller_name} → {buyer_name}.")
        return ok(message="Med deal added.")
    except Exception as e:
        return err(f"Could not add med deal: {e}", 500)


@app.post("/api/med-deals/delete")
@require_session
def api_med_deals_delete():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        data = request.get_json(force=True, silent=True) or {}
        deal_id = int(data.get("id") or 0)
        if not deal_id:
            return err("Missing med deal id.")

        delete_med_deal(
            faction_id=str(user.get("faction_id") or "").strip(),
            deal_id=deal_id,
        )
        return ok(message="Med deal deleted.")
    except Exception as e:
        return err(f"Could not delete med deal: {e}", 500)


@app.post("/api/targets/add")
@require_session
def api_targets_add():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}

        target_id = str(data.get("target_id", "")).strip()
        target_name = str(data.get("target_name", "")).strip()
        notes = str(data.get("notes", "")).strip()

        if not target_id and not target_name:
            return err("Enter a target id or name.")

        add_target(user_id, target_id, target_name, notes)
        return ok(message="Target added.")
    except Exception as e:
        return err(f"Could not add target: {e}", 500)


@app.post("/api/targets/delete")
@require_session
def api_targets_delete():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        target_row_id = int(data.get("id") or 0)
        if not target_row_id:
            return err("Missing target id.")
        delete_target(user_id, target_row_id)
        return ok(message="Target deleted.")
    except Exception as e:
        return err(f"Could not delete target: {e}", 500)


@app.post("/api/targets/assign")
@require_session
def api_targets_assign():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        data = request.get_json(force=True, silent=True) or {}
        war_id = str(data.get("war_id", "")).strip()
        target_id = str(data.get("target_id", "")).strip()
        target_name = str(data.get("target_name", "")).strip()
        assigned_to_user_id = str(data.get("assigned_to_user_id", user_id)).strip()
        assigned_to_name = str(data.get("assigned_to_name", user.get("name") or "")).strip()
        priority = str(data.get("priority", "normal")).strip()
        note = str(data.get("note", "")).strip()

        if not war_id:
            return err("Missing war id.")
        if not target_id and not target_name:
            return err("Missing target.")

        upsert_target_assignment(
            war_id=war_id,
            target_id=target_id,
            target_name=target_name,
            assigned_to_user_id=assigned_to_user_id,
            assigned_to_name=assigned_to_name,
            assigned_by_user_id=user_id,
            assigned_by_name=str(user.get("name") or "").strip(),
            priority=priority,
            note=note,
        )

        add_notification(user_id, "target_assign", f"Assigned target: {target_name or target_id}.")
        return ok(message="Target assigned.")
    except Exception as e:
        return err(f"Could not assign target: {e}", 500)


@app.post("/api/targets/unassign")
@require_session
def api_targets_unassign():
    try:
        data = request.get_json(force=True, silent=True) or {}
        assignment_id = _to_int(data.get("id"), 0)
        if not assignment_id:
            return err("Missing assignment id.")

        delete_target_assignment(assignment_id)
        return ok(message="Target assignment removed.")
    except Exception as e:
        return err(f"Could not remove assignment: {e}", 500)


@app.post("/api/targets/note")
@require_session
def api_targets_note():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        data = request.get_json(force=True, silent=True) or {}
        war_id = str(data.get("war_id", "")).strip()
        target_id = str(data.get("target_id", "")).strip()
        note = str(data.get("note", "")).strip()

        if not war_id:
            return err("Missing war id.")
        if not target_id:
            return err("Missing target id.")
        if not note:
            return err("Missing note.")

        upsert_war_note(
            war_id=war_id,
            target_id=target_id,
            note=note,
            created_by_user_id=user_id,
            created_by_name=str(user.get("name") or "").strip(),
        )

        return ok(message="Note saved.")
    except Exception as e:
        return err(f"Could not save note: {e}", 500)


@app.post("/api/targets/note/delete")
@require_session
def api_targets_note_delete():
    try:
        data = request.get_json(force=True, silent=True) or {}
        note_id = _to_int(data.get("id"), 0)
        if not note_id:
            return err("Missing note id.")
        delete_war_note(note_id)
        return ok(message="Note deleted.")
    except Exception as e:
        return err(f"Could not delete note: {e}", 500)


@app.post("/api/war-terms/set")
@require_session
def api_war_terms_set():
    try:
        user_id = request.session["user_id"]
        user = get_user(user_id)
        if not user:
            return err("User not found.", 404)

        data = request.get_json(force=True, silent=True) or {}
        war_id = str(data.get("war_id", "")).strip()
        terms_text = str(data.get("terms_text", "")).strip()

        if not war_id:
            return err("Missing war id.")
        if not terms_text:
            return err("Missing terms text.")

        upsert_war_terms(
            war_id=war_id,
            terms_text=terms_text,
            updated_by_user_id=user_id,
            updated_by_name=str(user.get("name") or "").strip(),
        )

        add_notification(user_id, "war_terms", "War terms updated.")
        return ok(message="War terms updated.")
    except Exception as e:
        return err(f"Could not update war terms: {e}", 500)


@app.post("/api/war-terms/delete")
@require_session
def api_war_terms_delete():
    try:
        data = request.get_json(force=True, silent=True) or {}
        war_id = str(data.get("war_id", "")).strip()

        if not war_id:
            return err("Missing war id.")

        delete_war_terms(war_id)
        return ok(message="War terms deleted.")
    except Exception as e:
        return err(f"Could not delete war terms: {e}", 500)


@app.post("/api/bounties/add")
@require_session
def api_bounties_add():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}

        target_id = str(data.get("target_id", "")).strip()
        target_name = str(data.get("target_name", "")).strip()
        reward_text = str(data.get("reward_text", "")).strip()

        if not target_id and not target_name:
            return err("Enter a target id or name.")
        if not reward_text:
            return err("Enter a reward.")

        add_bounty(user_id, target_id, target_name, reward_text)
        return ok(message="Bounty added.")
    except Exception as e:
        return err(f"Could not add bounty: {e}", 500)


@app.post("/api/bounties/delete")
@require_session
def api_bounties_delete():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        bounty_id = int(data.get("id") or 0)
        if not bounty_id:
            return err("Missing bounty id.")
        delete_bounty(user_id, bounty_id)
        return ok(message="Bounty deleted.")
    except Exception as e:
        return err(f"Could not delete bounty: {e}", 500)


@app.get("/api/notifications")
@require_session
def api_notifications():
    try:
        user_id = request.session["user_id"]
        return ok(notifications=list_notifications(user_id), license=request.license_status)
    except Exception as e:
        return err(f"Could not load notifications: {e}", 500)


@app.post("/api/notifications/seen")
@require_session
def api_notifications_seen():
    try:
        user_id = request.session["user_id"]
        mark_notifications_seen(user_id)
        return ok(message="Notifications marked seen.")
    except Exception as e:
        return err(f"Could not update notifications: {e}", 500)


@app.post("/api/admin/payment/confirm")
def api_admin_payment_confirm():
    try:
        allowed, response = _require_license_admin()
        if not allowed:
            return response

        data = request.get_json(force=True, silent=True) or {}
        user_id = str(data.get("user_id", "")).strip()
        amount = _to_int(data.get("amount"), PAYMENT_AMOUNT_XANAX)
        payment_kind = str(data.get("payment_kind", "xanax")).strip() or "xanax"
        note = str(data.get("note", "")).strip()
        received_by = str(data.get("received_by", PAYMENT_PLAYER)).strip() or PAYMENT_PLAYER
        extend_days = _to_int(data.get("extend_days"), 45)

        if not user_id:
            return err("Missing user_id.")

        status = renew_after_payment(
            user_id=user_id,
            amount=amount,
            payment_kind=payment_kind,
            note=note,
            received_by=received_by,
            extend_days=max(1, extend_days),
        )

        add_notification(user_id, "payment", f"Payment confirmed. Access renewed by {received_by}.")
        return ok(
            message="Payment confirmed and license renewed.",
            license=status,
            payment_history=get_payment_history(user_id, limit=10),
        )
    except Exception as e:
        return err(f"Could not confirm payment: {e}", 500)


@app.post("/api/admin/license/expire")
def api_admin_license_expire():
    try:
        allowed, response = _require_license_admin()
        if not allowed:
            return response

        data = request.get_json(force=True, silent=True) or {}
        user_id = str(data.get("user_id", "")).strip()
        if not user_id:
            return err("Missing user_id.")

        status = force_expire_license(user_id, clear_key=True)
        delete_sessions_for_user(user_id)
        add_notification(user_id, "license", "Your access has expired. Payment is required to continue.")
        return ok(message="License expired.", license=status)
    except Exception as e:
        return err(f"Could not expire license: {e}", 500)


@app.get("/api/admin/license/status")
def api_admin_license_status():
    try:
        allowed, response = _require_license_admin()
        if not allowed:
            return response

        user_id = str(request.args.get("user_id", "")).strip()
        if not user_id:
            return err("Missing user_id.")

        return ok(
            license=compute_license_status(user_id),
            payment_history=get_payment_history(user_id, limit=25),
            payment={
                "required_player": PAYMENT_PLAYER,
                "required_amount": PAYMENT_AMOUNT_XANAX,
                "required_kind": "xanax",
            },
        )
    except Exception as e:
        return err(f"Could not load admin license status: {e}", 500)


@app.errorhandler(404)
def not_found(_e):
    return err("404 Not Found: The requested URL was not found on the server.", 404)


@app.errorhandler(Exception)
def handle_exception(e):
    return err(f"Unhandled error: {e}", 500)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")), debug=False)
else:
    init_db()
