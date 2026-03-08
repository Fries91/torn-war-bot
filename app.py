import os
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Dict, Optional

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
    set_availability,
    set_chain_sitter,
    list_med_deals,
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
ADMIN_KEYS = {k.strip() for k in os.getenv("ADMIN_KEYS", "").split(",") if k.strip()}

app = Flask(__name__, static_folder="static")


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


def require_session(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-Session-Token", "").strip()
        if not token:
            return err("Missing session token.", 401)

        sess = get_session(token)
        if not sess:
            return err("Invalid session token.", 401)

        touch_session(token)
        request.session = sess
        return fn(*args, **kwargs)

    return wrapper


def _parse_minutes_from_text(text: str) -> int:
    s = str(text or "").strip().lower()
    if not s:
        return 10**9

    if "online" in s:
        return 0
    if "offline" in s:
        return 10**8
    if "idle" in s:
        return 10**7

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

    if "second" in s:
        return 0

    return 10**6


def _member_activity_bucket(status_text: str) -> str:
    s = str(status_text or "").strip().lower()

    if "hospital" in s:
        return "hospital"
    if "online" in s:
        return "online"
    if "idle" in s:
        return "idle"
    if "offline" in s:
        return "offline"
    return "other"


def _sort_members(members: list) -> list:
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


def _merge_faction_members(faction_id: str, members: list) -> Dict[str, Any]:
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

        status_text = str(m.get("status", "") or "")
        activity_bucket = _member_activity_bucket(status_text)
        activity_minutes = _parse_minutes_from_text(status_text)

        if activity_bucket in counts:
            counts[activity_bucket] += 1

        item = {
            "user_id": uid,
            "name": m.get("name", "Unknown"),
            "level": m.get("level", ""),
            "status": status_text,
            "position": m.get("position", ""),
            "last_action": m.get("last_action", ""),
            "available": available,
            "chain_sitter": chain_sitter,
            "linked_user": linked_user,
            "activity_bucket": activity_bucket,
            "activity_minutes": activity_minutes,
            "profile_url": profile_url(uid),
            "attack_url": attack_url(uid),
            "bounty_url": bounty_url(uid),
        }
        merged.append(item)

        if chain_sitter:
            chain_sitters.append(
                {
                    "user_id": uid,
                    "name": item["name"],
                    "level": item["level"],
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
    }


def _decorate_enemy_members(enemy_members: list) -> Dict[str, Any]:
    counts = {
        "online": 0,
        "idle": 0,
        "offline": 0,
        "hospital": 0,
    }

    decorated = []
    for m in enemy_members:
        uid = str(m.get("user_id") or "")
        status_text = str(m.get("status", "") or "")
        activity_bucket = _member_activity_bucket(status_text)
        activity_minutes = _parse_minutes_from_text(status_text)

        if activity_bucket in counts:
            counts[activity_bucket] += 1

        decorated.append(
            {
                "user_id": uid,
                "name": m.get("name", "Unknown"),
                "level": m.get("level", ""),
                "status": status_text,
                "position": m.get("position", ""),
                "last_action": m.get("last_action", ""),
                "activity_bucket": activity_bucket,
                "activity_minutes": activity_minutes,
                "profile_url": profile_url(uid),
                "attack_url": attack_url(uid),
                "bounty_url": bounty_url(uid),
            }
        )

    decorated = _sort_members(decorated)

    return {
        "members": decorated,
        "counts": counts,
    }


@app.route("/")
def root():
    return ok(
        service=APP_NAME,
        status="online",
        now=utc_now(),
        endpoints=[
            "/health",
            "/api/auth",
            "/api/state",
            "/static/war-bot.user.js",
        ],
    )


@app.route("/health")
def health():
    return ok(service=APP_NAME, status="healthy", now=utc_now())


@app.route("/static/<path:path>")
def static_proxy(path):
    return send_from_directory("static", path)


@app.post("/api/auth")
def api_auth():
    try:
        data = request.get_json(force=True, silent=True) or {}
        admin_key = str(data.get("admin_key", "")).strip()
        api_key = str(data.get("api_key", "")).strip()

        if not admin_key:
            return err("Missing admin key.")
        if ADMIN_KEYS and admin_key not in ADMIN_KEYS:
            return err("Invalid admin key.", 403)
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

        token = create_session(user_id)
        add_notification(user_id, "auth", f"Logged into {APP_NAME} successfully.")

        return ok(
            token=token,
            user={
                "user_id": user_id,
                "name": name,
                "faction_id": faction_id,
                "faction_name": faction_name,
                "profile_url": profile_url(user_id),
            },
        )
    except Exception as e:
        return err(f"Auth failed: {e}", 500)


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
            faction.get("faction_id", faction_id),
            faction.get("members", []),
        )

        war_summary = ranked_war_summary(
            api_key=api_key,
            my_faction_id=str(faction.get("faction_id", faction_id) or ""),
            my_faction_name=str(faction.get("faction_name", faction_name) or ""),
        )

        enemy_info = _decorate_enemy_members(war_summary.get("enemy_members", []))

        return ok(
            me={
                "user_id": user["user_id"],
                "name": user["name"],
                "faction_id": faction.get("faction_id", faction_id),
                "faction_name": faction.get("faction_name", faction_name),
                "profile_url": profile_url(user["user_id"]),
                "available": int(user.get("available", 1)),
                "chain_sitter": int(user.get("chain_sitter", 0)),
            },
            war={
                "active": bool(war_summary.get("active")) or bool(faction.get("faction_id")),
                "faction_id": faction.get("faction_id", faction_id),
                "faction_name": faction.get("faction_name", faction_name),
                "enemy_faction_id": war_summary.get("enemy_faction_id", ""),
                "enemy_faction_name": war_summary.get("enemy_faction_name", ""),
                "member_count": len(merged["members"]),
                "available_count": merged["available_count"],
                "chain_sitter_count": len(merged["chain_sitters"]),
                "linked_user_count": merged["linked_user_count"],
                "online_count": merged["counts"]["online"],
                "idle_count": merged["counts"]["idle"],
                "offline_count": merged["counts"]["offline"],
                "hospital_count": merged["counts"]["hospital"],
                "enemy_online_count": enemy_info["counts"]["online"],
                "enemy_idle_count": enemy_info["counts"]["idle"],
                "enemy_offline_count": enemy_info["counts"]["offline"],
                "enemy_hospital_count": enemy_info["counts"]["hospital"],
                "war_id": war_summary.get("war_id", ""),
                "war_type": war_summary.get("war_type", ""),
                "score_us": war_summary.get("score_us", 0),
                "score_them": war_summary.get("score_them", 0),
                "lead": war_summary.get("lead", 0),
                "target_score": war_summary.get("target_score", 0),
                "remaining_to_target": war_summary.get("remaining_to_target", 0),
                "start": war_summary.get("start", 0),
                "end": war_summary.get("end", 0),
                "status_text": war_summary.get("status_text", ""),
                "source_ok": bool(war_summary.get("source_ok")),
                "source_note": war_summary.get("source_note", ""),
            },
            members=merged["members"],
            chain_sitters=merged["chain_sitters"],
            enemies=enemy_info["members"],
            med_deals=list_med_deals(user_id),
            targets=list_targets(user_id),
            bounties=list_bounties(user_id),
            notifications=list_notifications(user_id),
        )
    except Exception as e:
        return err(f"Could not load state: {e}", 500)


@app.post("/api/availability/set")
@require_session
def api_availability_set():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        value = 1 if bool(data.get("available")) else 0
        set_availability(user_id, value)
        return ok(message="Availability updated.")
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
        return ok(message="Chain sitter updated.")
    except Exception as e:
        return err(f"Could not update chain sitter: {e}", 500)


@app.post("/api/med-deals/add")
@require_session
def api_med_deals_add():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}

        buyer_name = str(data.get("buyer_name", "")).strip()
        seller_name = str(data.get("seller_name", "")).strip()
        amount = int(data.get("amount") or 0)
        notes = str(data.get("notes", "")).strip()

        if not buyer_name and not seller_name:
            return err("Enter a buyer or seller name.")
        if amount < 0:
            return err("Amount must be 0 or more.")

        add_med_deal(user_id, buyer_name, seller_name, amount, notes)
        return ok(message="Med deal added.")
    except Exception as e:
        return err(f"Could not add med deal: {e}", 500)


@app.post("/api/med-deals/delete")
@require_session
def api_med_deals_delete():
    try:
        user_id = request.session["user_id"]
        data = request.get_json(force=True, silent=True) or {}
        deal_id = int(data.get("id") or 0)
        if not deal_id:
            return err("Missing med deal id.")
        delete_med_deal(user_id, deal_id)
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
        return ok(notifications=list_notifications(user_id))
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
