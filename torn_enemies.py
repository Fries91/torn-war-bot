import time
from typing import Any, Dict, List

from torn_faction import faction_basic
from torn_shared import to_int


def hospital_members_from_enemies(enemies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()

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

        in_hospital = bool(member.get("in_hospital")) or str(member.get("online_state") or "").strip().lower() == "hospital"
        hospital_until_ts = to_int(member.get("hospital_until_ts"), 0)
        hospital_seconds = to_int(member.get("hospital_seconds"), 0)

        if not in_hospital and hospital_until_ts <= int(time.time()):
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

        cards.append({
            "user_id": user_id,
            "name": str(member.get("name") or "Unknown"),
            "level": member.get("level", ""),
            "position": member.get("position", ""),
            "status": str(member.get("status") or ""),
            "status_detail": str(member.get("status_detail") or ""),
            "last_action": str(member.get("last_action") or ""),
            "online_state": str(member.get("online_state") or "offline"),
            "in_hospital": 1 if member.get("in_hospital") else 0,
            "hospital_seconds": to_int(member.get("hospital_seconds"), 0),
            "hospital_until_ts": to_int(member.get("hospital_until_ts"), 0),
            "profile_url": str(member.get("profile_url") or ""),
            "attack_url": str(member.get("attack_url") or ""),
            "bounty_url": str(member.get("bounty_url") or ""),
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


def enemy_faction_members(api_key: str, enemy_faction_id: str) -> Dict[str, Any]:
    enemy_faction_id = str(enemy_faction_id or "").strip()
    if not enemy_faction_id:
        return {
            "ok": False,
            "enemy_faction_id": "",
            "enemy_faction_name": "",
            "members": [],
            "hospital_members": [],
            "error": "Missing enemy faction ID.",
        }

    faction = faction_basic(api_key, enemy_faction_id)
    members = list((faction or {}).get("members") or [])
    cards = build_enemy_cards(members)
    hospital = hospital_members_from_enemies(cards)

    return {
        "ok": bool(faction.get("ok")),
        "enemy_faction_id": str(faction.get("faction_id") or enemy_faction_id),
        "enemy_faction_name": str(faction.get("faction_name") or ""),
        "members": cards,
        "hospital_members": hospital,
        "error": str(faction.get("error") or ""),
        "source": faction.get("source") or "",
        "debug_attempts": faction.get("debug_attempts") or [],
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
