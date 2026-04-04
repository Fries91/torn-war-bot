import time
from typing import Any, Dict, List

from torn_shared import (
    API_BASE,
    CACHE_TTL_FACTION_BASIC,
    safe_get,
    to_int,
)
from torn_status import normalize_member


def hospital_members_from_enemies(enemies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    now_ts = int(time.time())

    for member in list(enemies or []):
        if not isinstance(member, dict):
            continue

        user_id = str(
            member.get("user_id")
            or member.get("player_id")
            or member.get("id")
            or ""
        ).strip()

        if not user_id or user_id in seen:
            continue

        online_state = str(member.get("online_state") or "").strip().lower()
        in_hospital = bool(member.get("in_hospital")) or online_state == "hospital"
        hospital_until_ts = to_int(member.get("hospital_until_ts"), 0)
        hospital_seconds = to_int(member.get("hospital_seconds"), 0)

        if not in_hospital and hospital_until_ts <= now_ts:
            continue

        seen.add(user_id)
        out.append({
            **member,
            "user_id": user_id,
            "in_hospital": 1,
            "hospital_until_ts": hospital_until_ts,
            "hospital_seconds": hospital_seconds,
        })

    out.sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))
    return out


def _predict_battle_stats(member: Dict[str, Any]) -> Dict[str, Any]:
    state = str(member.get("online_state") or "offline").strip().lower()
    level = to_int(member.get("level"), 0)
    position = str(member.get("position") or "").strip().lower()

    score = 35 + min(45, max(0, int(round(level * 0.75))))

    if state == "online":
        score += 16
    elif state == "idle":
        score += 9
    elif state == "travel":
        score -= 8
    elif state == "jail":
        score -= 18
    elif state == "hospital":
        score -= 32
    else:
        score -= 12

    if "leader" in position:
        score += 10
    elif position in {"co-leader", "co leader", "coleader", "officer"}:
        score += 6

    score = max(1, min(99, int(round(score))))

    if score >= 82:
        tier = "High"
    elif score >= 58:
        tier = "Medium"
    else:
        tier = "Low"

    if state in {"hospital", "jail"}:
        attack_window = "Best now"
    elif state in {"offline", "travel"}:
        attack_window = "Good"
    elif state == "idle":
        attack_window = "Okay"
    else:
        attack_window = "Risky"

    if state == "hospital":
        summary = "Hospitalized target with reduced immediate threat."
    elif state == "jail":
        summary = "Jailed target and usually safe to line up."
    elif state == "travel":
        summary = "Traveling target with limited immediate pressure."
    elif state == "offline":
        summary = "Offline target with moderate uncertainty."
    elif state == "idle":
        summary = "Idle target that may react slower than active enemies."
    else:
        summary = "Active target with the highest chance to fight back quickly."

    return {
        "score": score,
        "tier": tier,
        "threat": tier,
        "attack_window": attack_window,
        "confidence": "Estimate",
        "summary": summary,
        "source": "warhub_model",
        "predicted_total_stats": 0,
        "predicted_total_stats_m": 0.0,
    }


def build_enemy_cards(enemies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []

    for member in list(enemies or []):
        if not isinstance(member, dict):
            continue

        user_id = str(
            member.get("user_id")
            or member.get("player_id")
            or member.get("id")
            or ""
        ).strip()

        if not user_id:
            continue

        battle_prediction = _predict_battle_stats(member)

        cards.append({
            "user_id": user_id,
            "name": str(member.get("name") or "Unknown"),
            "level": member.get("level", ""),
            "position": member.get("position", ""),
            "status": str(member.get("status") or ""),
            "status_detail": str(member.get("status_detail") or ""),
            "last_action": str(member.get("last_action") or ""),
            "online_state": str(member.get("online_state") or "offline").strip().lower(),
            "in_hospital": 1 if member.get("in_hospital") else 0,
            "hospital_seconds": to_int(member.get("hospital_seconds"), 0),
            "hospital_until_ts": to_int(member.get("hospital_until_ts"), 0),
            "profile_url": str(member.get("profile_url") or ""),
            "attack_url": str(member.get("attack_url") or ""),
            "bounty_url": str(member.get("bounty_url") or ""),
            "battle_prediction": battle_prediction,
            "battle_score": battle_prediction.get("score"),
            "battle_tier": battle_prediction.get("tier"),
            "predicted_total_stats": battle_prediction.get("predicted_total_stats", 0),
            "predicted_total_stats_m": battle_prediction.get("predicted_total_stats_m", 0.0),
            "total_stats_m": battle_prediction.get("predicted_total_stats_m", 0.0),
            "battle_stats_m": battle_prediction.get("predicted_total_stats_m", 0.0),
            "prediction_confidence": battle_prediction.get("confidence", "Estimate"),
            "prediction_source": battle_prediction.get("source", "warhub_model"),
            "prediction_summary": battle_prediction.get("summary", ""),
        })

    cards.sort(
        key=lambda x: (
            x.get("online_state") != "online",
            x.get("online_state") != "idle",
            x.get("online_state") != "travel",
            x.get("online_state") != "hospital",
            str(x.get("name") or "").lower(),
        )
    )
    return cards


def _extract_enemy_members(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    raw_members = payload.get("members")
    if not isinstance(raw_members, dict):
        return []

    out: List[Dict[str, Any]] = []
    for uid, member in raw_members.items():
        if not isinstance(member, dict):
            continue
        out.append(normalize_member(uid, member))
    return out


def _extract_enemy_root(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    if isinstance(payload.get("faction"), dict):
        return payload.get("faction") or {}
    return payload


def enemy_faction_members(api_key: str, enemy_faction_id: str) -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    enemy_faction_id = str(enemy_faction_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "enemy_faction_id": enemy_faction_id,
            "enemy_faction_name": "",
            "members": [],
            "hospital_members": [],
            "error": "Missing API key.",
            "source": "",
            "debug_attempts": [],
        }

    if not enemy_faction_id:
        return {
            "ok": False,
            "enemy_faction_id": "",
            "enemy_faction_name": "",
            "members": [],
            "hospital_members": [],
            "error": "Missing enemy faction ID.",
            "source": "",
            "debug_attempts": [],
        }

    attempts = [
        (
            f"{API_BASE}/v2/faction/{enemy_faction_id}/members",
            {"key": api_key, "striptags": "true"},
            "v2_enemy_faction_members_direct",
        ),
        (
            f"{API_BASE}/faction/{enemy_faction_id}",
            {"selections": "basic,members", "key": api_key, "striptags": "true"},
            "v1_enemy_faction_members_direct_fallback",
        ),
    ]

    debug_attempts: List[Dict[str, Any]] = []
    last_error = "Could not load enemy faction."

    for url, params, prefix in attempts:
        res = safe_get(
            url,
            params,
            cache_seconds=CACHE_TTL_FACTION_BASIC,
            cache_prefix=prefix,
        )

        if not res.get("ok"):
            last_error = str(res.get("error") or last_error)
            debug_attempts.append({
                "source": prefix,
                "ok": False,
                "error": last_error,
            })
            continue

        payload = res.get("data") or {}
        root = _extract_enemy_root(payload)
        members = _extract_enemy_members(payload)

        resolved_enemy_faction_id = str(
            root.get("ID")
            or root.get("id")
            or root.get("faction_id")
            or enemy_faction_id
            or ""
        ).strip()

        resolved_enemy_faction_name = str(
            root.get("name")
            or root.get("faction_name")
            or ""
        ).strip()

        debug_attempts.append({
            "source": prefix,
            "ok": True,
            "enemy_faction_id": resolved_enemy_faction_id,
            "enemy_faction_name": resolved_enemy_faction_name,
            "member_count": len(members),
        })

        if resolved_enemy_faction_id and resolved_enemy_faction_id != enemy_faction_id:
            last_error = (
                f"Enemy faction mismatch: requested {enemy_faction_id}, got {resolved_enemy_faction_id}."
            )
            continue

        if not members:
            last_error = "Enemy faction returned no members."
            continue

        cards = build_enemy_cards(members)
        hospital = hospital_members_from_enemies(cards)

        return {
            "ok": True,
            "enemy_faction_id": resolved_enemy_faction_id or enemy_faction_id,
            "enemy_faction_name": resolved_enemy_faction_name,
            "members": cards,
            "hospital_members": hospital,
            "error": "",
            "source": prefix,
            "debug_attempts": debug_attempts,
        }

    return {
        "ok": False,
        "enemy_faction_id": enemy_faction_id,
        "enemy_faction_name": "",
        "members": [],
        "hospital_members": [],
        "error": last_error,
        "source": "",
        "debug_attempts": debug_attempts,
    }


def split_enemy_buckets(enemies: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    buckets = {
        "online": [],
        "idle": [],
        "travel": [],
        "hospital": [],
        "jail": [],
        "offline": [],
    }

    for member in list(enemies or []):
        if not isinstance(member, dict):
            continue

        state = str(member.get("online_state") or "offline").strip().lower()
        if state not in buckets:
            state = "offline"
        buckets[state].append(member)

    for key in buckets:
        buckets[key].sort(key=lambda x: (str(x.get("name") or "").lower(), str(x.get("user_id") or "")))

    return buckets
