import json
import os
import re
import time
from typing import Any, Dict, List, Tuple

import requests

API_BASE = os.getenv("TORN_API_BASE", "https://api.torn.com").rstrip("/")
TORN_TIMEOUT = int(os.getenv("TORN_TIMEOUT", "30"))
CACHE_TTL_USER_PROFILE = int(os.getenv("CACHE_TTL_USER_PROFILE", "30"))
CACHE_TTL_FACTION_BASIC = int(os.getenv("CACHE_TTL_FACTION_BASIC", "20"))
CACHE_TTL_FACTION_WARS = int(os.getenv("CACHE_TTL_FACTION_WARS", "15"))

try:
    from db import cache_get, cache_set
except Exception:
    def cache_get(_cache_key: str):
        return None

    def cache_set(_cache_key: str, _payload_text: str, _ttl_seconds: int):
        return None


def _cache_key(prefix: str, params: Dict[str, Any]) -> str:
    ordered = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()))
    return f"{prefix}:{ordered}"


def _safe_get(url: str, params: Dict[str, Any], cache_seconds: int = 0, cache_prefix: str = "") -> Dict[str, Any]:
    try:
        cache_key = ""
        if cache_seconds > 0 and cache_prefix:
            safe_params = {k: v for k, v in params.items() if k != "key"}
            cache_key = _cache_key(cache_prefix, safe_params)
            cached = cache_get(cache_key)
            if cached:
                try:
                    data = json.loads(cached)
                    return {"ok": True, "data": data, "cached": True}
                except Exception:
                    pass

        r = requests.get(url, params=params, timeout=TORN_TIMEOUT)
        r.raise_for_status()
        data = r.json()

        if isinstance(data, dict) and data.get("error"):
            err_obj = data.get("error") or {}
            return {
                "ok": False,
                "error": err_obj.get("error", "Torn API error"),
                "data": data,
            }

        if cache_seconds > 0 and cache_prefix and cache_key:
            try:
                cache_set(cache_key, json.dumps(data), cache_seconds)
            except Exception:
                pass

        return {"ok": True, "data": data, "cached": False}
    except Exception as e:
        return {"ok": False, "error": str(e), "data": {}}


def profile_url(user_id: str) -> str:
    return f"https://www.torn.com/profiles.php?XID={user_id}"


def attack_url(user_id: str) -> str:
    return f"https://www.torn.com/loader.php?sid=attack&user2ID={user_id}"


def bounty_url(user_id: str) -> str:
    return f"https://www.torn.com/bounties.php#/p=add&userID={user_id}"


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _extract_hospital_seconds_from_text(text: str) -> int:
    s = str(text or "").lower().strip()
    if not s:
        return 0

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
    if maybe_digits and ("hospital" in s or "rehab" in s):
        return int(maybe_digits[0]) * 60

    return 0


def _extract_hospital_until_ts(member: Dict[str, Any], fallback_seconds: int = 0) -> int:
    candidates = [
        member.get("until"),
        member.get("hospital_until"),
        member.get("hospital_timestamp"),
        member.get("hospital_time"),
        member.get("timestamp"),
    ]

    status = member.get("status")
    if isinstance(status, dict):
        candidates.extend(
            [
                status.get("until"),
                status.get("until_timestamp"),
                status.get("timestamp"),
                status.get("time"),
            ]
        )

    now = int(time.time())
    for value in candidates:
        if isinstance(value, (int, float)) and int(value) > 0:
            ts = int(value)
            if ts > now - 3600:
                return ts

    if fallback_seconds > 0:
        return now + int(fallback_seconds)

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
        last_action = (
            la.get("status", "")
            or la.get("relative", "")
            or la.get("timestamp", "")
            or ""
        )
    else:
        last_action = str(la or "")

    status = member.get("status")
    if isinstance(status, dict):
        status_text = str(status.get("state") or status.get("description") or status.get("color") or "")
        status_detail = str(status.get("description") or status.get("details") or "")
    else:
        status_text = str(status or "")

    life = member.get("life")
    current_life = 0
    max_life = 0
    if isinstance(life, dict):
        current_life = _to_int(life.get("current"), 0)
        max_life = _to_int(life.get("maximum"), 0)
    else:
        current_life = _to_int(member.get("current_life"), 0)
        max_life = _to_int(member.get("max_life"), 0)

    combined = " ".join([status_text, status_detail, last_action]).strip().lower()

    in_hospital = 1 if ("hospital" in combined or "rehab" in combined) else 0
    hospital_seconds = _extract_hospital_seconds_from_text(combined)
    hospital_until_ts = _extract_hospital_until_ts(member, hospital_seconds)

    if hospital_until_ts > int(time.time()):
        in_hospital = 1
        if hospital_seconds <= 0:
            hospital_seconds = max(0, hospital_until_ts - int(time.time()))

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
        "hospital_until_ts": hospital_until_ts,
        "life_current": current_life,
        "life_max": max_life,
        "profile_url": profile_url(str(uid or "")),
        "attack_url": attack_url(str(uid or "")),
        "bounty_url": bounty_url(str(uid or "")),
    }


def me_basic(api_key: str) -> Dict[str, Any]:
    res = _safe_get(
        f"{API_BASE}/user/",
        {
            "selections": "profile",
            "key": api_key,
        },
        cache_seconds=CACHE_TTL_USER_PROFILE,
        cache_prefix="user_profile",
    )

    if not res.get("ok"):
        return {
            "ok": False,
            "error": res.get("error", "Could not load user profile."),
            "user_id": "",
            "name": "",
            "level": "",
            "faction_id": "",
            "faction_name": "",
        }

    data = res.get("data") or {}
    faction = data.get("faction") or {}

    return {
        "ok": True,
        "user_id": str(data.get("player_id") or ""),
        "name": data.get("name") or "Unknown",
        "level": data.get("level") or "",
        "faction_id": str(faction.get("faction_id") or ""),
        "faction_name": faction.get("faction_name") or "",
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
            cache_seconds=CACHE_TTL_FACTION_BASIC,
            cache_prefix="faction_basic",
        )
        if not res.get("ok"):
            res = _safe_get(
                f"{API_BASE}/faction/",
                {
                    "selections": "basic",
                    "id": faction_id,
                    "key": api_key,
                },
                cache_seconds=CACHE_TTL_FACTION_BASIC,
                cache_prefix="faction_basic",
            )
        if not res.get("ok"):
            return {
                "ok": False,
                "faction_id": str(faction_id or ""),
                "faction_name": "",
                "members": [],
                "error": res.get("error", "Could not load faction."),
            }

        data = res.get("data") or {}
        members_raw = data.get("members") or {}
        members: List[Dict[str, Any]] = []

        if isinstance(members_raw, dict):
            for uid, member in members_raw.items():
                if isinstance(member, dict):
                    members.append(_normalize_member(uid, member))

        return {
            "ok": True,
            "faction_id": str(data.get("ID") or faction_id or ""),
            "faction_name": data.get("name") or "",
            "members": members,
        }

    me = me_basic(api_key)
    if not me.get("ok"):
        return {
            "ok": False,
            "faction_id": "",
            "faction_name": "",
            "members": [],
            "error": me.get("error", "Could not load player."),
        }

    my_faction_id = me.get("faction_id")
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


def _extract_factions_from_war(war: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("factions", "participants", "sides", "teams"):
        factions = war.get(key)
        if isinstance(factions, dict) and factions:
            return factions
    return {}


def _is_active_war(war: Dict[str, Any]) -> bool:
    raw = " ".join(
        [
            str(war.get("status") or ""),
            str(war.get("state") or ""),
        ]
    ).strip().lower()

    if any(x in raw for x in ["active", "running", "ongoing", "started", "live"]):
        return True
    if any(x in raw for x in ["ended", "finished", "complete", "completed", "expired"]):
        return False

    end_val = war.get("end") or war.get("end_time") or war.get("ends") or 0
    if isinstance(end_val, (int, float)) and int(end_val) > 0:
        return int(end_val) > int(time.time())

    start_val = war.get("start") or war.get("start_time") or war.get("started") or 0
    if isinstance(start_val, (int, float)) and int(start_val) > 0:
        return True

    return True


def _side_name(side_data: Dict[str, Any], fallback: str = "") -> str:
    return str(side_data.get("name") or side_data.get("faction_name") or fallback or "")


def _side_score(side_data: Dict[str, Any]) -> int:
    for key in ("score", "points", "war_score", "chain"):
        val = side_data.get(key)
        if isinstance(val, (int, float)):
            return int(val)
    return 0


def _side_chain(side_data: Dict[str, Any]) -> int:
    for key in ("chain", "chain_count", "hits"):
        val = side_data.get(key)
        if isinstance(val, (int, float)):
            return int(val)
    return 0


def faction_wars(api_key: str) -> Dict[str, Any]:
    tries = ["rankedwars", "wars", "basic"]
    chosen_container_name = ""
    chosen_container: Dict[str, Any] = {}
    last_note = ""

    for selection in tries:
        res = _safe_get(
            f"{API_BASE}/faction/",
            {
                "selections": selection,
                "key": api_key,
            },
            cache_seconds=CACHE_TTL_FACTION_WARS,
            cache_prefix=f"faction_{selection}",
        )
        if not res.get("ok"):
            last_note = res.get("error", "Unknown Torn API error")
            continue

        data = res.get("data") or {}
        container_name, container = _find_war_container(data)
        if container_name and container:
            chosen_container_name = container_name
            chosen_container = container
            break

        last_note = f"No ranked war data in selection '{selection}'. Raw keys: {list(data.keys())}"

    if not chosen_container:
        return {
            "ok": True,
            "wars": [],
            "source_ok": False,
            "source_note": last_note or "No war container found.",
        }

    wars: List[Dict[str, Any]] = []

    for war_id, war in chosen_container.items():
        if not isinstance(war, dict):
            continue

        factions_raw = _extract_factions_from_war(war)
        parsed_factions = []

        if isinstance(factions_raw, dict):
            for fid, fdata in factions_raw.items():
                if not isinstance(fdata, dict):
                    continue
                parsed_factions.append(
                    {
                        "faction_id": str(fid),
                        "faction_name": _side_name(fdata),
                        "score": _side_score(fdata),
                        "chain": _side_chain(fdata),
                        "raw": fdata,
                    }
                )

        wars.append(
            {
                "war_id": str(war_id),
                "war_type": str(war.get("war_type") or chosen_container_name),
                "status_text": str(war.get("status") or war.get("state") or ""),
                "active": _is_active_war(war),
                "start": _to_int(war.get("start") or war.get("start_time") or war.get("started"), 0),
                "end": _to_int(war.get("end") or war.get("end_time") or war.get("ends"), 0),
                "target_score": _to_int(
                    war.get("target")
                    or war.get("target_score")
                    or war.get("goal")
                    or war.get("score_target"),
                    0,
                ),
                "factions": parsed_factions,
                "raw": war,
            }
        )

    wars.sort(key=lambda x: (not bool(x["active"]), -(x["start"] or 0), x["war_id"]))
    return {
        "ok": True,
        "wars": wars,
        "source_ok": True,
        "source_note": f"Loaded from faction {chosen_container_name}.",
    }


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    default = {
        "ok": True,
        "active": False,
        "war_id": "",
        "war_type": "",
        "my_faction_id": str(my_faction_id or ""),
        "my_faction_name": str(my_faction_name or ""),
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "enemy_members": [],
        "score_us": 0,
        "score_them": 0,
        "lead": 0,
        "target_score": 0,
        "remaining_to_target": 0,
        "chain_us": 0,
        "chain_them": 0,
        "start": 0,
        "end": 0,
        "status_text": "Currently not in war",
        "source_ok": False,
        "source_note": "Ranked war endpoint not available or no active war found.",
    }

    wars_res = faction_wars(api_key)
    if not wars_res.get("ok"):
        out = dict(default)
        out["source_note"] = wars_res.get("error", out["source_note"])
        return out

    wars = wars_res.get("wars") or []
    active_war = None
    my_faction_id = str(my_faction_id or "")

    for war in wars:
        factions = war.get("factions") or []
        if not factions:
            continue

        if my_faction_id:
            faction_ids = [str(x.get("faction_id") or "") for x in factions]
            if my_faction_id in faction_ids and bool(war.get("active")):
                active_war = war
                break
        elif bool(war.get("active")):
            active_war = war
            break

    if not active_war:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = wars_res.get("source_note", out["source_note"])
        return out

    factions = active_war.get("factions") or []
my_side = None
enemy_side = None

my_faction_id = str(my_faction_id or "").strip()

# First: find my exact side
if my_faction_id:
    for f in factions:
        fid = str(f.get("faction_id") or "").strip()
        if fid == my_faction_id:
            my_side = f
            break

# Second: enemy must be a DIFFERENT faction id
if my_side:
    my_id_check = str(my_side.get("faction_id") or "").strip()
    for f in factions:
        fid = str(f.get("faction_id") or "").strip()
        if fid and fid != my_id_check:
            enemy_side = f
            break

# Last fallback only if exact match failed
if my_side is None and len(factions) >= 2:
    first_id = str(factions[0].get("faction_id") or "").strip()
    second_id = str(factions[1].get("faction_id") or "").strip()

    if my_faction_id and first_id == my_faction_id:
        my_side = factions[0]
        enemy_side = factions[1]
    elif my_faction_id and second_id == my_faction_id:
        my_side = factions[1]
        enemy_side = factions[0]
    else:
        my_side = factions[0]
        enemy_side = factions[1]

elif my_side is None and len(factions) == 1:
    my_side = factions[0]

# Safety guard: never allow same faction on both sides
if my_side and enemy_side:
    my_id_check = str(my_side.get("faction_id") or "").strip()
    enemy_id_check = str(enemy_side.get("faction_id") or "").strip()
    if my_id_check == enemy_id_check:
        enemy_side = None
        for f in factions:
            fid = str(f.get("faction_id") or "").strip()
            if fid and fid != my_id_check:
                enemy_side = f
                break

    my_id = str((my_side or {}).get("faction_id") or my_faction_id or "")
    my_name = str((my_side or {}).get("faction_name") or my_faction_name or "")
    enemy_id = str((enemy_side or {}).get("faction_id") or "")
    enemy_name = str((enemy_side or {}).get("faction_name") or "")

    score_us = _to_int((my_side or {}).get("score"), 0)
    score_them = _to_int((enemy_side or {}).get("score"), 0)
    chain_us = _to_int((my_side or {}).get("chain"), 0)
    chain_them = _to_int((enemy_side or {}).get("chain"), 0)
    lead = score_us - score_them

    target_score = _to_int(active_war.get("target_score"), 0)
    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    enemy_members: List[Dict[str, Any]] = []
    if enemy_id:
        enemy_faction = faction_basic(api_key, faction_id=enemy_id)
        if enemy_faction.get("ok"):
            enemy_name = enemy_faction.get("faction_name") or enemy_name
            enemy_members = enemy_faction.get("members", [])

    if not enemy_name and enemy_id:
        enemy_name = f"Faction {enemy_id}"
    if not my_name and my_id:
        my_name = f"Faction {my_id}"

    return {
        "ok": True,
        "active": bool(active_war.get("active")),
        "war_id": str(active_war.get("war_id") or ""),
        "war_type": str(active_war.get("war_type") or ""),
        "my_faction_id": my_id,
        "my_faction_name": my_name,
        "enemy_faction_id": enemy_id,
        "enemy_faction_name": enemy_name,
        "enemy_members": enemy_members,
        "score_us": score_us,
        "score_them": score_them,
        "lead": lead,
        "target_score": target_score,
        "remaining_to_target": remaining_to_target,
        "chain_us": chain_us,
        "chain_them": chain_them,
        "start": _to_int(active_war.get("start"), 0),
        "end": _to_int(active_war.get("end"), 0),
        "status_text": str(active_war.get("status_text") or "Active war"),
        "source_ok": bool(wars_res.get("source_ok")),
        "source_note": wars_res.get("source_note", ""),
    }

    wars_res = faction_wars(api_key)
    if not wars_res.get("ok"):
        out = dict(default)
        out["source_note"] = wars_res.get("error", out["source_note"])
        return out

    wars = wars_res.get("wars") or []
    active_war = None

    my_faction_id = str(my_faction_id or "")

    for war in wars:
        factions = war.get("factions") or []
        if not factions:
            continue

        if my_faction_id:
            faction_ids = [str(x.get("faction_id") or "") for x in factions]
            if my_faction_id in faction_ids and bool(war.get("active")):
                active_war = war
                break
        else:
            if bool(war.get("active")):
                active_war = war
                break

    if not active_war:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = wars_res.get("source_note", out["source_note"])
        return out

    factions = active_war.get("factions") or []
    my_side = None
    enemy_side = None

    if my_faction_id:
        for f in factions:
            if str(f.get("faction_id") or "") == my_faction_id:
                my_side = f
                break

    if my_side:
        for f in factions:
            if str(f.get("faction_id") or "") != str(my_side.get("faction_id") or ""):
                enemy_side = f
                break
    else:
        if len(factions) >= 2:
            my_side = factions[0]
            enemy_side = factions[1]
        elif len(factions) == 1:
            my_side = factions[0]

    my_id = str((my_side or {}).get("faction_id") or my_faction_id or "")
    my_name = str((my_side or {}).get("faction_name") or my_faction_name or "")
    enemy_id = str((enemy_side or {}).get("faction_id") or "")
    enemy_name = str((enemy_side or {}).get("faction_name") or "")

    score_us = _to_int((my_side or {}).get("score"), 0)
    score_them = _to_int((enemy_side or {}).get("score"), 0)
    chain_us = _to_int((my_side or {}).get("chain"), 0)
    chain_them = _to_int((enemy_side or {}).get("chain"), 0)
    lead = score_us - score_them

    target_score = _to_int(active_war.get("target_score"), 0)
    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    enemy_members: List[Dict[str, Any]] = []
    if enemy_id:
        enemy_faction = faction_basic(api_key, faction_id=enemy_id)
        if enemy_faction.get("ok"):
            enemy_name = enemy_faction.get("faction_name") or enemy_name
            enemy_members = enemy_faction.get("members", [])

    if not enemy_name and enemy_id:
        enemy_name = f"Faction {enemy_id}"
    if not my_name and my_id:
        my_name = f"Faction {my_id}"

    return {
        "ok": True,
        "active": bool(active_war.get("active")),
        "war_id": str(active_war.get("war_id") or ""),
        "war_type": str(active_war.get("war_type") or ""),
        "my_faction_id": my_id,
        "my_faction_name": my_name,
        "enemy_faction_id": enemy_id,
        "enemy_faction_name": enemy_name,
        "enemy_members": enemy_members,
        "score_us": score_us,
        "score_them": score_them,
        "lead": lead,
        "target_score": target_score,
        "remaining_to_target": remaining_to_target,
        "chain_us": chain_us,
        "chain_them": chain_them,
        "start": _to_int(active_war.get("start"), 0),
        "end": _to_int(active_war.get("end"), 0),
        "status_text": str(active_war.get("status_text") or "Active war"),
        "source_ok": bool(wars_res.get("source_ok")),
        "source_note": wars_res.get("source_note", ""),
    }
