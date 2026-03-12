import json
import os
import re
import time
from typing import Any, Dict, List, Tuple

import requests

API_BASE = str(os.getenv("TORN_API_BASE", "https://api.torn.com")).rstrip("/")
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


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _safe_get(
    url: str,
    params: Dict[str, Any],
    cache_seconds: int = 0,
    cache_prefix: str = "",
) -> Dict[str, Any]:
    try:
        key_name = ""
        if cache_seconds > 0 and cache_prefix:
            safe_params = {k: v for k, v in params.items() if k != "key"}
            key_name = _cache_key(cache_prefix, safe_params)
            cached = cache_get(key_name)
            if cached:
                try:
                    data = json.loads(cached)
                    return {"ok": True, "data": data, "cached": True}
                except Exception:
                    pass

        response = requests.get(url, params=params, timeout=TORN_TIMEOUT)
        response.raise_for_status()
        data = response.json()

        if isinstance(data, dict) and data.get("error"):
            err_obj = data.get("error") or {}
            return {
                "ok": False,
                "error": err_obj.get("error", "Torn API error"),
                "data": data,
            }

        if cache_seconds > 0 and cache_prefix and key_name:
            try:
                cache_set(key_name, json.dumps(data), cache_seconds)
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
    name = str(member.get("name") or "Unknown")
    level = member.get("level", "")
    position = member.get("position", "")

    last_action_raw = member.get("last_action")
    if isinstance(last_action_raw, dict):
        last_action = str(
            last_action_raw.get("status")
            or last_action_raw.get("relative")
            or last_action_raw.get("timestamp")
            or ""
        )
    else:
        last_action = str(last_action_raw or "")

    status_raw = member.get("status")
    if isinstance(status_raw, dict):
        status_text = str(
            status_raw.get("state")
            or status_raw.get("description")
            or status_raw.get("color")
            or ""
        )
        status_detail = str(status_raw.get("details") or status_raw.get("description") or "")
    else:
        status_text = str(status_raw or "")

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

    now_ts = int(time.time())
    if hospital_until_ts > now_ts:
        in_hospital = 1
        if hospital_seconds <= 0:
            hospital_seconds = max(0, hospital_until_ts - now_ts)

    online_state = "hospital" if in_hospital else _member_state_from_last_action(last_action)

    status_text_lower = status_text.lower()
    if not in_hospital and "online" in status_text_lower:
        online_state = "online"
    elif not in_hospital and "idle" in status_text_lower:
        online_state = "idle"
    elif not in_hospital and "offline" in status_text_lower:
        online_state = "offline"

    user_id = str(uid or "")

    return {
        "user_id": user_id,
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
        "profile_url": profile_url(user_id),
        "attack_url": attack_url(user_id),
        "bounty_url": bounty_url(user_id),
    }


def me_basic(api_key: str) -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    if not api_key:
        return {
            "ok": False,
            "error": "Missing API key.",
            "user_id": "",
            "name": "",
            "level": "",
            "faction_id": "",
            "faction_name": "",
        }

    res = _safe_get(
        f"{API_BASE}/user",
        {"selections": "profile", "key": api_key},
        cache_seconds=0,
        cache_prefix="",
    )

    if not res.get("ok"):
        res = _safe_get(
            f"{API_BASE}/user/",
            {"selections": "profile", "key": api_key},
            cache_seconds=0,
            cache_prefix="",
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

    player_id = str(data.get("player_id") or data.get("playerID") or data.get("user_id") or "")
    if not player_id:
        return {
            "ok": False,
            "error": "Could not resolve player_id from Torn response.",
            "user_id": "",
            "name": "",
            "level": "",
            "faction_id": "",
            "faction_name": "",
        }

    return {
        "ok": True,
        "user_id": player_id,
        "name": str(data.get("name") or "Unknown"),
        "level": data.get("level") or "",
        "faction_id": str(faction.get("faction_id") or faction.get("ID") or ""),
        "faction_name": str(faction.get("faction_name") or faction.get("name") or ""),
    }


def faction_basic(api_key: str, faction_id: str = "") -> Dict[str, Any]:
    faction_id = str(faction_id or "").strip()

    def _build_result(res_obj: Dict[str, Any], fallback_faction_id: str = "") -> Dict[str, Any]:
        if not res_obj.get("ok"):
            return {
                "ok": False,
                "faction_id": fallback_faction_id,
                "faction_name": "",
                "members": [],
                "error": res_obj.get("error", "Could not load faction."),
            }

        data = res_obj.get("data") or {}
        members_raw = data.get("members") or {}
        members: List[Dict[str, Any]] = []

        if isinstance(members_raw, dict):
            for uid, member in members_raw.items():
                if isinstance(member, dict):
                    members.append(_normalize_member(uid, member))
        elif isinstance(members_raw, list):
            for idx, member in enumerate(members_raw):
                if isinstance(member, dict):
                    uid = member.get("user_id") or member.get("id") or str(idx)
                    members.append(_normalize_member(uid, member))

        return {
            "ok": True,
            "faction_id": str(data.get("ID") or fallback_faction_id or ""),
            "faction_name": str(data.get("name") or ""),
            "members": members,
        }

    if faction_id:
        attempts = [
            (
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "basic", "key": api_key},
                "faction_basic_direct",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "basic", "ID": faction_id, "key": api_key},
                "faction_basic_id_upper",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "basic", "id": faction_id, "key": api_key},
                "faction_basic_id_lower",
            ),
        ]

        best: Optional[Dict[str, Any]] = None

        for url, params, prefix in attempts:
            res = _safe_get(
                url,
                params,
                cache_seconds=CACHE_TTL_FACTION_BASIC,
                cache_prefix=prefix,
            )
            built = _build_result(res, faction_id)

            if built.get("ok") and built.get("members"):
                return built

            if built.get("ok") and best is None:
                best = built

        if best:
            return best

        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
            "error": "Could not load faction.",
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

    my_faction_id = str(me.get("faction_id") or "")
    if not my_faction_id:
        return {
            "ok": True,
            "faction_id": "",
            "faction_name": "",
            "members": [],
        }

    return faction_basic(api_key, faction_id=my_faction_id)


def _find_war_container(data: Dict[str, Any]) -> Tuple[str, Any]:
    for key in ("rankedwars", "wars"):
        value = data.get(key)
        if isinstance(value, dict) and value:
            return key, value
        if isinstance(value, list) and value:
            return key, value
    return "", {}


def _extract_factions_from_war(war: Dict[str, Any]) -> Dict[str, Any]:
    for key in ("factions", "participants", "sides", "teams"):
        factions = war.get(key)
        if isinstance(factions, dict) and factions:
            return factions
    return {}


def _war_phase(war: Dict[str, Any]) -> str:
    raw = " ".join([
        str(war.get("status") or ""),
        str(war.get("state") or ""),
    ]).strip().lower()

    if any(x in raw for x in ["ended", "finished", "complete", "completed", "expired"]):
        return "finished"
    if any(x in raw for x in ["active", "running", "ongoing", "started", "live", "in progress"]):
        return "active"
    if any(x in raw for x in ["pending", "matching", "matched", "upcoming", "scheduled", "registered"]):
        return "registered"

    now_ts = int(time.time())
    start_val = _to_int(war.get("start") or war.get("start_time") or war.get("started"), 0)
    end_val = _to_int(war.get("end") or war.get("end_time") or war.get("ends"), 0)

    if end_val > 0 and end_val <= now_ts:
        return "finished"
    if start_val > now_ts:
        return "registered"
    if start_val > 0 and (end_val == 0 or end_val > now_ts):
        return "active"

    return "unknown"


def _side_name(side_data: Dict[str, Any], fallback: str = "") -> str:
    return str(side_data.get("name") or side_data.get("faction_name") or fallback or "")


def _side_score(side_data: Dict[str, Any]) -> int:
    for key in ("score", "points", "war_score"):
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


def faction_wars(api_key: str, faction_id: str = "") -> Dict[str, Any]:
    faction_id = str(faction_id or "").strip()
    tries = ["rankedwars", "wars"]
    chosen_container_name = ""
    chosen_container: Any = {}
    last_note = ""

    for selection in tries:
        attempts = []

        if faction_id:
            attempts.append((
                f"{API_BASE}/faction/{faction_id}",
                {"selections": selection, "key": api_key},
                f"faction_{selection}_direct_{faction_id}",
            ))

        attempts.append((
            f"{API_BASE}/faction/",
            {"selections": selection, "key": api_key, "ID": faction_id} if faction_id else {"selections": selection, "key": api_key},
            f"faction_{selection}_upper_{faction_id or 'self'}",
        ))

        attempts.append((
            f"{API_BASE}/faction/",
            {"selections": selection, "key": api_key, "id": faction_id} if faction_id else {"selections": selection, "key": api_key},
            f"faction_{selection}_lower_{faction_id or 'self'}",
        ))

        for url, params, prefix in attempts:
            res = _safe_get(
                url,
                params,
                cache_seconds=CACHE_TTL_FACTION_WARS,
                cache_prefix=prefix,
            )
            if not res.get("ok"):
                last_note = str(res.get("error", "Unknown Torn API error"))
                continue

            data = res.get("data") or {}
            container_name, container = _find_war_container(data)
            if container_name and container:
                chosen_container_name = container_name
                chosen_container = container
                break

            last_note = f"No war container in selection '{selection}'. Raw keys: {list(data.keys())}"

        if chosen_container:
            break

    if not chosen_container:
        return {
            "ok": True,
            "wars": [],
            "source_ok": False,
            "source_note": last_note or "No war container found.",
        }

    wars: List[Dict[str, Any]] = []

    if isinstance(chosen_container, dict):
        iterable = chosen_container.items()
    elif isinstance(chosen_container, list):
        iterable = [(str(i), war) for i, war in enumerate(chosen_container)]
    else:
        iterable = []

    for war_id, war in iterable:
        if not isinstance(war, dict):
            continue

        parsed_factions = []
        factions_raw = _extract_factions_from_war(war)

        if isinstance(factions_raw, dict):
            for fid, fdata in factions_raw.items():
                if isinstance(fdata, dict):
                    parsed_factions.append({
                        "faction_id": str(fid),
                        "faction_name": _side_name(fdata),
                        "score": _side_score(fdata),
                        "chain": _side_chain(fdata),
                        "raw": fdata,
                    })

        for key in ("faction_1", "faction1", "team_1", "team1"):
            side = war.get(key)
            if isinstance(side, dict):
                sid = str(side.get("id") or side.get("faction_id") or "")
                if sid and not any(x["faction_id"] == sid for x in parsed_factions):
                    parsed_factions.append({
                        "faction_id": sid,
                        "faction_name": _side_name(side),
                        "score": _side_score(side),
                        "chain": _side_chain(side),
                        "raw": side,
                    })

        for key in ("faction_2", "faction2", "team_2", "team2"):
            side = war.get(key)
            if isinstance(side, dict):
                sid = str(side.get("id") or side.get("faction_id") or "")
                if sid and not any(x["faction_id"] == sid for x in parsed_factions):
                    parsed_factions.append({
                        "faction_id": sid,
                        "faction_name": _side_name(side),
                        "score": _side_score(side),
                        "chain": _side_chain(side),
                        "raw": side,
                    })

        phase = _war_phase(war)

        # be permissive: if a war object exists and isn't finished, treat unknown as registered
        if phase == "unknown":
            phase = "registered"

        wars.append({
            "war_id": str(war.get("id") or war_id),
            "war_type": str(war.get("war_type") or chosen_container_name),
            "status_text": str(war.get("status") or war.get("state") or ""),
            "phase": phase,
            "active": phase == "active",
            "registered": phase in {"registered", "active"},
            "finished": phase == "finished",
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
        })

    wars.sort(
        key=lambda x: (
            0 if x.get("phase") == "active" else 1 if x.get("phase") == "registered" else 2,
            -(x.get("start") or 0),
            x.get("war_id") or "",
        )
    )

    return {
        "ok": True,
        "wars": wars,
        "source_ok": True,
        "source_note": f"Loaded from faction {chosen_container_name}.",
    }


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    me = me_basic(api_key)
    resolved_my_faction_id = str(my_faction_id or me.get("faction_id") or "").strip()
    resolved_my_faction_name = str(my_faction_name or me.get("faction_name") or "").strip()

    default = {
        "ok": True,
        "active": False,
        "registered": False,
        "has_war": False,
        "phase": "none",
        "war_id": "",
        "war_type": "",
        "my_faction_id": resolved_my_faction_id,
        "my_faction_name": resolved_my_faction_name,
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
        "source_note": "No registered or active ranked war found.",
    }

    wars_res = faction_wars(api_key, faction_id=resolved_my_faction_id)
    if not wars_res.get("ok"):
        out = dict(default)
        out["source_note"] = str(wars_res.get("error", out["source_note"]))
        return out

    wars = wars_res.get("wars") or []
    chosen_war = None

    for war in wars:
        phase = str(war.get("phase") or "")
        if phase in {"registered", "active"}:
            chosen_war = war
            break

    if not chosen_war:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = str(wars_res.get("source_note", out["source_note"]))
        return out

    factions = [x for x in (chosen_war.get("factions") or []) if isinstance(x, dict)]

    my_side = None
    enemy_side = None

    my_name_lower = resolved_my_faction_name.lower().strip()

    # 1. Exact match by faction id
    if resolved_my_faction_id:
        for faction in factions:
            fid = str(faction.get("faction_id") or "").strip()
            if fid == resolved_my_faction_id:
                my_side = faction
                break

    # 2. Exact match by faction name
    if not my_side and my_name_lower:
        for faction in factions:
            fname = str(faction.get("faction_name") or "").strip().lower()
            if fname == my_name_lower:
                my_side = faction
                break

    # 3. Pick enemy as first side that is NOT ours
    if my_side:
        my_id = str(my_side.get("faction_id") or "").strip()
        my_name = str(my_side.get("faction_name") or "").strip().lower()

        for faction in factions:
            fid = str(faction.get("faction_id") or "").strip()
            fname = str(faction.get("faction_name") or "").strip().lower()

            if my_id and fid == my_id:
                continue
            if my_name and fname == my_name:
                continue

            enemy_side = faction
            break

    # 4. Safe fallback only when there are exactly 2 different factions
    if not my_side and len(factions) == 2:
        a = factions[0]
        b = factions[1]

        a_id = str(a.get("faction_id") or "").strip()
        b_id = str(b.get("faction_id") or "").strip()
        a_name = str(a.get("faction_name") or "").strip().lower()
        b_name = str(b.get("faction_name") or "").strip().lower()

        if resolved_my_faction_id and a_id == resolved_my_faction_id:
            my_side, enemy_side = a, b
        elif resolved_my_faction_id and b_id == resolved_my_faction_id:
            my_side, enemy_side = b, a
        elif my_name_lower and a_name == my_name_lower:
            my_side, enemy_side = a, b
        elif my_name_lower and b_name == my_name_lower:
            my_side, enemy_side = b, a

    my_id = str((my_side or {}).get("faction_id") or resolved_my_faction_id or "").strip()
    my_name = str((my_side or {}).get("faction_name") or resolved_my_faction_name or "").strip()

    enemy_id = str((enemy_side or {}).get("faction_id") or "").strip()
    enemy_name = str((enemy_side or {}).get("faction_name") or "").strip()

    # Never let enemy equal us
    if enemy_id and my_id and enemy_id == my_id:
        enemy_id = ""
        enemy_name = ""
        enemy_side = None

    if enemy_name and my_name and enemy_name.lower() == my_name.lower():
        enemy_id = ""
        enemy_name = ""
        enemy_side = None

    phase = str(chosen_war.get("phase") or "none")
    is_active = phase == "active"
    is_registered = phase in {"registered", "active"}

    score_us = _to_int((my_side or {}).get("score"), 0)
    score_them = _to_int((enemy_side or {}).get("score"), 0)
    chain_us = _to_int((my_side or {}).get("chain"), 0)
    chain_them = _to_int((enemy_side or {}).get("chain"), 0)
    lead = score_us - score_them

    target_score = _to_int(chosen_war.get("target_score"), 0)
    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    enemy_members: List[Dict[str, Any]] = []
    if enemy_id and is_registered:
        enemy_faction = faction_basic(api_key, faction_id=enemy_id)
        if enemy_faction.get("ok"):
            enemy_name = str(enemy_faction.get("faction_name") or enemy_name)
            enemy_members = enemy_faction.get("members", [])

    if not my_name and my_id:
        my_name = f"Faction {my_id}"
    if not enemy_name and enemy_id:
        enemy_name = f"Faction {enemy_id}"

    status_text = str(chosen_war.get("status_text") or "")
    if not status_text:
        status_text = "War active" if is_active else "War registered"

    return {
        "ok": True,
        "active": is_active,
        "registered": is_registered,
        "has_war": is_registered,
        "phase": phase,
        "war_id": str(chosen_war.get("war_id") or ""),
        "war_type": str(chosen_war.get("war_type") or ""),
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
        "start": _to_int(chosen_war.get("start"), 0),
        "end": _to_int(chosen_war.get("end"), 0),
        "status_text": status_text,
        "source_ok": bool(wars_res.get("source_ok")),
        "source_note": str(wars_res.get("source_note", "")),
    }
