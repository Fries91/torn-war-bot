import requests
from typing import Any, Dict, List

API_BASE = "https://api.torn.com"


def _safe_get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    try:
        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict) and data.get("error"):
            return {
                "ok": False,
                "error": data["error"].get("error", "Torn API error"),
                "data": data,
            }
        return {"ok": True, "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e), "data": {}}


def profile_url(user_id: str) -> str:
    return f"https://www.torn.com/profiles.php?XID={user_id}"


def attack_url(user_id: str) -> str:
    return f"https://www.torn.com/loader.php?sid=attack&user2ID={user_id}"


def bounty_url(user_id: str) -> str:
    return f"https://www.torn.com/bounties.php#/p=add&userID={user_id}"


def me_basic(api_key: str) -> Dict[str, Any]:
    res = _safe_get(
        f"{API_BASE}/user/",
        {
            "selections": "profile",
            "key": api_key,
        },
    )
    if not res["ok"]:
        return {"ok": False, "error": res.get("error", "Could not load user profile.")}

    data = res["data"]
    faction = data.get("faction") or {}

    return {
        "ok": True,
        "player": {
            "user_id": str(data.get("player_id") or ""),
            "name": data.get("name") or "Unknown",
            "level": data.get("level") or "",
            "faction_id": str(faction.get("faction_id") or ""),
            "faction_name": faction.get("faction_name") or "",
        },
    }


def faction_basic(api_key: str) -> Dict[str, Any]:
    me = me_basic(api_key)
    if not me["ok"]:
        return {"ok": False, "members": [], "error": me.get("error", "Could not load player.")}

    faction_id = me["player"].get("faction_id")
    if not faction_id:
        return {
            "ok": True,
            "faction_id": "",
            "faction_name": "",
            "members": [],
        }

    res = _safe_get(
        f"{API_BASE}/faction/",
        {
            "selections": "basic",
            "key": api_key,
        },
    )
    if not res["ok"]:
        return {"ok": False, "members": [], "error": res.get("error", "Could not load faction.")}

    data = res["data"]
    members_raw = data.get("members") or {}
    members: List[Dict[str, Any]] = []

    for uid, member in members_raw.items():
        last_action = ""
        la = member.get("last_action")
        if isinstance(la, dict):
            last_action = la.get("status", "") or la.get("relative", "") or ""

        members.append(
            {
                "user_id": str(uid),
                "name": member.get("name", "Unknown"),
                "level": member.get("level", ""),
                "status": member.get("status", ""),
                "position": member.get("position", ""),
                "last_action": last_action,
            }
        )

    members.sort(key=lambda x: (x.get("name") or "").lower())

    return {
        "ok": True,
        "faction_id": str(data.get("ID") or faction_id or ""),
        "faction_name": data.get("name") or me["player"].get("faction_name") or "",
        "members": members,
    }


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    """
    Safe ranked war summary helper.

    This returns a stable object shape even if Torn does not return ranked war
    data from the selections available to this key/account.
    """

    default = {
        "ok": True,
        "active": False,
        "war_id": "",
        "war_type": "",
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "score_us": 0,
        "score_them": 0,
        "lead": 0,
        "target_score": 0,
        "remaining_to_target": 0,
        "start": 0,
        "end": 0,
        "status_text": "No active ranked war found.",
        "source_ok": False,
        "source_note": "Ranked war endpoint not available or no active war found.",
    }

    # Try a few likely faction selections safely.
    tries = [
        "rankedwars",
        "wars",
        "basic",
    ]

    best_data = None
    last_note = ""

    for selection in tries:
        res = _safe_get(
            f"{API_BASE}/faction/",
            {
                "selections": selection,
                "key": api_key,
            },
        )
        if not res["ok"]:
            last_note = res.get("error", "Unknown Torn API error")
            continue

        data = res.get("data") or {}
        if not isinstance(data, dict):
            continue

        # Look for likely war containers.
        rankedwars = data.get("rankedwars")
        wars = data.get("wars")

        if isinstance(rankedwars, dict) and rankedwars:
            best_data = ("rankedwars", rankedwars)
            break

        if isinstance(wars, dict) and wars:
            best_data = ("wars", wars)
            break

        last_note = f"No ranked war data in selection '{selection}'."

    if not best_data:
        out = dict(default)
        out["source_note"] = last_note or default["source_note"]
        return out

    container_name, container = best_data

    chosen = None

    for war_id, war in container.items():
        if not isinstance(war, dict):
            continue

        factions = war.get("factions") or war.get("participants") or {}
        if not isinstance(factions, dict):
            continue

        faction_keys = [str(k) for k in factions.keys()]
        if my_faction_id and my_faction_id in faction_keys:
            chosen = (str(war_id), war)
            break

    if not chosen:
        # Fall back to first war if present.
        first_key = next(iter(container.keys()), "")
        if first_key:
            chosen = (str(first_key), container[first_key])

    if not chosen:
        out = dict(default)
        out["source_note"] = f"Could not parse {container_name} data."
        return out

    war_id, war = chosen
    factions = war.get("factions") or war.get("participants") or {}

    my_side = None
    enemy_side = None

    for fid, fdata in factions.items():
        fid_s = str(fid)
        if my_faction_id and fid_s == str(my_faction_id):
            my_side = (fid_s, fdata)
        else:
            enemy_side = (fid_s, fdata)

    if my_side is None and len(factions) >= 1:
        first_fid = next(iter(factions.keys()))
        my_side = (str(first_fid), factions[first_fid])

    if enemy_side is None:
        for fid, fdata in factions.items():
            if my_side and str(fid) != my_side[0]:
                enemy_side = (str(fid), fdata)
                break

    my_id = my_side[0] if my_side else str(my_faction_id or "")
    my_data = my_side[1] if my_side else {}
    enemy_id = enemy_side[0] if enemy_side else ""
    enemy_data = enemy_side[1] if enemy_side else {}

    def _name(side_data: Dict[str, Any], fallback: str = "") -> str:
        return (
            side_data.get("name")
            or side_data.get("faction_name")
            or fallback
        )

    def _score(side_data: Dict[str, Any]) -> int:
        for key in ("score", "points", "chain", "war_score"):
            val = side_data.get(key)
            if isinstance(val, (int, float)):
                return int(val)
        return 0

    score_us = _score(my_data)
    score_them = _score(enemy_data)
    lead = score_us - score_them

    target_score = 0
    for key in ("target", "target_score", "goal", "score_target"):
        val = war.get(key)
        if isinstance(val, (int, float)):
            target_score = int(val)
            break

    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    start = 0
    end = 0
    for key in ("start", "start_time", "started"):
        val = war.get(key)
        if isinstance(val, (int, float)):
            start = int(val)
            break
    for key in ("end", "end_time", "ends"):
        val = war.get(key)
        if isinstance(val, (int, float)):
            end = int(val)
            break

    status_text = war.get("status") or war.get("state") or ""
    if not status_text:
        status_text = "Active war" if (score_us or score_them or enemy_id) else "No active ranked war found."

    return {
        "ok": True,
        "active": True if enemy_id or score_us or score_them else False,
        "war_id": war_id,
        "war_type": war.get("war_type") or container_name,
        "enemy_faction_id": enemy_id,
        "enemy_faction_name": _name(enemy_data, ""),
        "score_us": score_us,
        "score_them": score_them,
        "lead": lead,
        "target_score": target_score,
        "remaining_to_target": remaining_to_target,
        "start": start,
        "end": end,
        "status_text": status_text,
        "source_ok": True,
        "source_note": f"Loaded from faction {container_name}.",
    }
