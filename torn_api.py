import re
import requests
from typing import Any, Dict, List, Tuple

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


def _extract_hospital_seconds_from_text(text: str) -> int:
    s = str(text or "").lower().strip()
    if not s:
        return 0

    # examples like "3h 20m", "12m", "1h", "2d 3h"
    total = 0
    matches = re.findall(r"(\d+)\s*([dhms])", s)
    if matches:
        for num, unit in matches:
            n = int(num)
            if unit == "d":
                total += n * 86400
            elif unit == "h":
                total += n * 3600
            elif unit == "m":
                total += n * 60
            elif unit == "s":
                total += n
        return total

    maybe_digits = re.findall(r"\d+", s)
    if maybe_digits and "hospital" in s:
        return int(maybe_digits[0]) * 60

    return 0


def _member_state_from_last_action(last_action_text: str) -> str:
    s = str(last_action_text or "").lower()
    if any(x in s for x in ["online", "active", "abroad online"]):
        return "online"
    if any(x in s for x in ["idle", "inactive"]):
        return "idle"
    if any(x in s for x in ["hospital", "rehab"]):
        return "hospital"
    return "offline"


def _normalize_member(uid: Any, member: Dict[str, Any]) -> Dict[str, Any]:
    last_action = ""
    status_text = ""
    status_detail = ""
    level = member.get("level", "")
    position = member.get("position", "")
    name = member.get("name", "Unknown")

    la = member.get("last_action")
    if isinstance(la, dict):
        last_action = la.get("status", "") or la.get("relative", "") or la.get("timestamp", "") or ""
    else:
        last_action = str(la or "")

    status = member.get("status")
    if isinstance(status, dict):
        status_text = str(status.get("state") or status.get("description") or status.get("color") or "")
        status_detail = str(status.get("description") or status.get("details") or "")
    else:
        status_text = str(status or "")

    combined = " ".join([status_text, status_detail, last_action]).strip().lower()

    in_hospital = 1 if ("hospital" in combined) else 0
    hospital_seconds = _extract_hospital_seconds_from_text(combined)
    online_state = "hospital" if in_hospital else _member_state_from_last_action(last_action)

    if not in_hospital and "online" in status_text.lower():
        online_state = "online"
    elif not in_hospital and "idle" in status_text.lower():
        online_state = "idle"
    elif not in_hospital and "offline" in status_text.lower():
        online_state = "offline"

    return {
        "user_id": str(uid or ""),
        "name": name,
        "level": level,
        "position": position,
        "status": status_text,
        "status_detail": status_detail,
        "last_action": last_action,
        "online_state": online_state,
        "in_hospital": in_hospital,
        "hospital_seconds": hospital_seconds,
        "hospital_until_ts": 0,
    }


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


def faction_basic(api_key: str, faction_id: str = "") -> Dict[str, Any]:
    if faction_id:
        res = _safe_get(
            f"{API_BASE}/faction/",
            {
                "selections": "basic",
                "ID": faction_id,
                "key": api_key,
            },
        )
        if not res["ok"]:
            # try lowercase id too
            res = _safe_get(
                f"{API_BASE}/faction/",
                {
                    "selections": "basic",
                    "id": faction_id,
                    "key": api_key,
                },
            )
        if not res["ok"]:
            return {"ok": False, "members": [], "error": res.get("error", "Could not load faction.")}

        data = res["data"]
        members_raw = data.get("members") or {}
        members: List[Dict[str, Any]] = []

        for uid, member in members_raw.items():
            members.append(_normalize_member(uid, member))

        return {
            "ok": True,
            "faction_id": str(data.get("ID") or faction_id or ""),
            "faction_name": data.get("name") or "",
            "members": members,
        }

    me = me_basic(api_key)
    if not me["ok"]:
        return {"ok": False, "members": [], "error": me.get("error", "Could not load player.")}

    my_faction_id = me["player"].get("faction_id")
    if not my_faction_id:
        return {
            "ok": True,
            "faction_id": "",
            "faction_name": "",
            "members": [],
        }

    return faction_basic(api_key, faction_id=str(my_faction_id))


def _find_war_container(data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    for key in ("rankedwars", "wars"):
        v = data.get(key)
        if isinstance(v, dict) and v:
            return key, v
    return "", {}


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    default = {
        "ok": True,
        "active": False,
        "war_id": "",
        "war_type": "",
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "enemy_members": [],
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

    tries = ["rankedwars", "wars", "basic"]
    chosen_container_name = ""
    chosen_container = {}
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

        container_name, container = _find_war_container(res.get("data") or {})
        if container_name and container:
            chosen_container_name = container_name
            chosen_container = container
            break

        last_note = f"No ranked war data in selection '{selection}'."

    if not chosen_container:
        out = dict(default)
        out["source_note"] = last_note or out["source_note"]
        return out

    chosen_war_id = ""
    chosen_war = None

    for war_id, war in chosen_container.items():
        if not isinstance(war, dict):
            continue

        factions = war.get("factions") or war.get("participants") or {}
        if not isinstance(factions, dict):
            continue

        faction_keys = [str(k) for k in factions.keys()]
        if my_faction_id and str(my_faction_id) in faction_keys:
            chosen_war_id = str(war_id)
            chosen_war = war
            break

    if not chosen_war:
        first_key = next(iter(chosen_container.keys()), "")
        if first_key:
            chosen_war_id = str(first_key)
            chosen_war = chosen_container[first_key]

    if not chosen_war:
        out = dict(default)
        out["source_note"] = "Could not parse ranked war container."
        return out

    war = chosen_war
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

    def _side_name(side_data: Dict[str, Any], fallback: str = "") -> str:
        return side_data.get("name") or side_data.get("faction_name") or fallback

    def _side_score(side_data: Dict[str, Any]) -> int:
        for key in ("score", "points", "war_score", "chain"):
            val = side_data.get(key)
            if isinstance(val, (int, float)):
                return int(val)
        return 0

    score_us = _side_score(my_data)
    score_them = _side_score(enemy_data)
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

    status_text = str(war.get("status") or war.get("state") or "")
    if not status_text:
        status_text = "Active war" if (enemy_id or score_us or score_them) else "No active ranked war found."

    enemy_members = []
    enemy_name = _side_name(enemy_data, "")

    if enemy_id:
        enemy_faction = faction_basic(api_key, faction_id=str(enemy_id))
        if enemy_faction.get("ok"):
            enemy_name = enemy_faction.get("faction_name") or enemy_name
            enemy_members = enemy_faction.get("members", [])

    return {
        "ok": True,
        "active": True if enemy_id or score_us or score_them else False,
        "war_id": chosen_war_id,
        "war_type": war.get("war_type") or chosen_container_name,
        "enemy_faction_id": str(enemy_id or ""),
        "enemy_faction_name": enemy_name,
        "enemy_members": enemy_members,
        "score_us": score_us,
        "score_them": score_them,
        "lead": lead,
        "target_score": target_score,
        "remaining_to_target": remaining_to_target,
        "start": start,
        "end": end,
        "status_text": status_text,
        "source_ok": True,
        "source_note": f"Loaded from faction {chosen_container_name}.",
    }
