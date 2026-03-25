import json
import os
import re
import time
from typing import Any, Dict, List, Optional

import requests

API_BASE = str(os.getenv("TORN_API_BASE", "https://api.torn.com")).rstrip("/")
TORN_TIMEOUT = int(os.getenv("TORN_TIMEOUT", "30"))
CACHE_TTL_USER_PROFILE = int(os.getenv("CACHE_TTL_USER_PROFILE", "30"))
CACHE_TTL_FACTION_BASIC = int(os.getenv("CACHE_TTL_FACTION_BASIC", "20"))
CACHE_TTL_WAR_SUMMARY = int(os.getenv("CACHE_TTL_WAR_SUMMARY", "15"))

try:
    from db import cache_get, cache_set
except Exception:
    def cache_get(_cache_key: str):
        return None

    def cache_set(_payload_key: str, _payload_text: str, _ttl_seconds: int):
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


def _safe_get(url: str, params: Dict[str, Any], cache_seconds: int = 0, cache_prefix: str = "") -> Dict[str, Any]:
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
            return {"ok": False, "error": err_obj.get("error", "Torn API error"), "data": data}

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
        candidates.extend([
            status.get("until"),
            status.get("until_timestamp"),
            status.get("timestamp"),
            status.get("time"),
        ])
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
    s = str(last_action_text or "").strip().lower()
    if not s:
        return "offline"
    if any(x in s for x in ["hospital", "rehab"]):
        return "hospital"
    if any(x in s for x in ["jail", "jailed"]):
        return "jail"
    if any(x in s for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
        return "travel"
    if any(x in s for x in ["online", "active", "abroad online"]):
        return "online"
    if any(x in s for x in ["idle", "inactive"]):
        return "idle"
    return "offline"


def _extract_medical_cooldown_seconds(payload: Dict[str, Any]) -> int:
    if not isinstance(payload, dict):
        return 0
    candidates = []
    cooldowns = payload.get("cooldowns")
    if isinstance(cooldowns, dict):
        medical = cooldowns.get("medical")
        if isinstance(medical, dict):
            candidates.extend([
                medical.get("remaining"),
                medical.get("cooldown"),
                medical.get("seconds"),
                medical.get("time"),
                medical.get("until"),
            ])
        else:
            candidates.append(medical)
    for key in ("medical_cooldown", "medicalCooldown", "cooldown_medical", "med_cooldown", "medCooldown"):
        candidates.append(payload.get(key))
    for value in candidates:
        if isinstance(value, dict):
            for subkey in ("remaining", "cooldown", "seconds", "time", "until"):
                subval = value.get(subkey)
                if isinstance(subval, (int, float)) and int(subval) >= 0:
                    return int(subval)
                if isinstance(subval, str) and subval.strip().isdigit():
                    return int(subval.strip())
        elif isinstance(value, (int, float)) and int(value) >= 0:
            return int(value)
        elif isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    return 0


def _normalize_member(uid: Any, member: Dict[str, Any]) -> Dict[str, Any]:
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
        status_text = str(status_raw.get("state") or status_raw.get("description") or status_raw.get("color") or "")
        status_detail = str(status_raw.get("details") or status_raw.get("description") or "")
    else:
        status_text = str(status_raw or "")
        status_detail = ""

    combined = " ".join([status_text, status_detail, last_action]).strip().lower()
    hospital_seconds = _extract_hospital_seconds_from_text(combined)
    hospital_until_ts = _extract_hospital_until_ts(member, hospital_seconds)
    now_ts = int(time.time())
    in_hospital = 1 if ("hospital" in combined or "rehab" in combined or hospital_until_ts > now_ts) else 0
    if hospital_until_ts > now_ts and hospital_seconds <= 0:
        hospital_seconds = max(0, hospital_until_ts - now_ts)

    online_state = "hospital" if in_hospital else _member_state_from_last_action(last_action)
    if not in_hospital:
        if any(x in combined for x in ["jail", "jailed"]):
            online_state = "jail"
        elif any(x in combined for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
            online_state = "travel"
        elif "online" in combined:
            online_state = "online"
        elif "idle" in combined:
            online_state = "idle"

    user_id = str(uid or member.get("user_id") or member.get("player_id") or member.get("id") or "")
    return {
        "user_id": user_id,
        "name": str(member.get("name") or member.get("player_name") or member.get("member_name") or "Unknown"),
        "level": member.get("level", ""),
        "position": member.get("position", ""),
        "status": status_text,
        "status_detail": status_detail,
        "last_action": last_action,
        "online_state": online_state,
        "in_hospital": in_hospital,
        "hospital_seconds": hospital_seconds,
        "hospital_until_ts": hospital_until_ts,
        "profile_url": profile_url(user_id),
        "attack_url": attack_url(user_id),
        "bounty_url": bounty_url(user_id),
    }


def hospital_members_from_enemies(enemies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for member in list(enemies or []):
        if not isinstance(member, dict):
            continue
        user_id = str(member.get("user_id") or member.get("player_id") or member.get("id") or "").strip()
        if not user_id or user_id in seen:
            continue
        in_hospital = bool(member.get("in_hospital")) or str(member.get("online_state") or "").strip().lower() == "hospital"
        hospital_until_ts = _to_int(member.get("hospital_until_ts"), 0)
        hospital_seconds = _to_int(member.get("hospital_seconds"), 0)
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

    res = _safe_get(f"{API_BASE}/user", {"selections": "profile", "key": api_key}, cache_seconds=0, cache_prefix="")
    if not res.get("ok"):
        res = _safe_get(f"{API_BASE}/user/", {"selections": "profile", "key": api_key}, cache_seconds=0, cache_prefix="")
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
    api_key = str(api_key or "").strip()
    faction_id = str(faction_id or "").strip()
    if not api_key:
        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
            "error": "Missing API key.",
            "debug_attempts": [],
        }

    attempts = []
    if faction_id:
        attempts.extend([
            (f"{API_BASE}/v2/faction/{faction_id}/members", {"key": api_key, "striptags": "true"}, "v2_faction_members_direct"),
            (f"{API_BASE}/v2/faction/{faction_id}/basic", {"key": api_key, "striptags": "true"}, "v2_faction_basic_direct"),
            (f"{API_BASE}/faction/{faction_id}", {"selections": "members", "key": api_key, "striptags": "true"}, "faction_members_direct"),
            (f"{API_BASE}/faction/", {"selections": "members", "ID": faction_id, "key": api_key, "striptags": "true"}, "faction_members_id_upper"),
            (f"{API_BASE}/faction/", {"selections": "members", "id": faction_id, "key": api_key, "striptags": "true"}, "faction_members_id_lower"),
            (f"{API_BASE}/faction/{faction_id}", {"selections": "basic,members", "key": api_key, "striptags": "true"}, "faction_basic_members_direct"),
        ])
    else:
        attempts.append((f"{API_BASE}/faction/", {"selections": "basic,members", "key": api_key, "striptags": "true"}, "faction_self"))

    def _extract_root(payload: Any) -> Dict[str, Any]:
        if isinstance(payload, dict):
            for key in ("faction", "data"):
                node = payload.get(key)
                if isinstance(node, dict) and node:
                    return node
            return payload
        return {}

    def _extract_members(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            for key in ("members", "member", "data"):
                node = payload.get(key)
                if isinstance(node, dict):
                    return [_normalize_member(uid, member) for uid, member in node.items() if isinstance(member, dict)]
                if isinstance(node, list):
                    out = []
                    for idx, member in enumerate(node):
                        if isinstance(member, dict):
                            out.append(_normalize_member(member.get("user_id") or member.get("player_id") or member.get("id") or str(idx), member))
                    return out
        return []

    best = None
    best_error = "Could not load faction."
    debug_attempts = []

    for url, params, prefix in attempts:
        res = _safe_get(url, params, cache_seconds=CACHE_TTL_FACTION_BASIC, cache_prefix=prefix)
        if not res.get("ok"):
            best_error = str(res.get("error") or best_error)
            debug_attempts.append({"source": prefix, "ok": False, "error": best_error})
            continue

        payload = res.get("data") or {}
        root = _extract_root(payload)
        members = _extract_members(payload)
        resolved_faction_id = str(
            root.get("ID") or root.get("id") or root.get("faction_id") or root.get("factionID") or faction_id or ""
        ).strip()
        resolved_faction_name = str(root.get("name") or root.get("faction_name") or root.get("factionName") or "").strip()

        built = {
            "ok": True,
            "faction_id": resolved_faction_id,
            "faction_name": resolved_faction_name,
            "members": members,
            "error": "",
            "source": prefix,
            "params": {k: v for k, v in params.items() if k != "key"},
        }

        debug_attempts.append({
            "source": prefix,
            "ok": True,
            "faction_id": resolved_faction_id,
            "faction_name": resolved_faction_name,
            "member_count": len(members),
        })

        if resolved_faction_id and faction_id and resolved_faction_id != faction_id:
            continue

        if members:
            built["debug_attempts"] = debug_attempts
            return built

        if best is None:
            best = built

    if best is not None:
        best["debug_attempts"] = debug_attempts
        return best

    return {
        "ok": False,
        "faction_id": faction_id,
        "faction_name": "",
        "members": [],
        "error": best_error,
        "debug_attempts": debug_attempts,
    }


def _stringify_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _extract_nested_int(node: Dict[str, Any], keys: List[str], default: int = 0) -> int:
    current: Any = node
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return _to_int(current, default)


def _extract_side_score(value: Dict[str, Any]) -> int:
    value = _as_dict(value)

    direct_keys = [
        "score",
        "points",
        "respect",
        "faction_score",
        "war_score",
        "current_score",
    ]
    for key in direct_keys:
        score = _to_int(value.get(key), None)
        if score is not None:
            return score

    nested_paths = [
        ["score", "current"],
        ["score", "value"],
        ["points", "current"],
        ["stats", "score"],
        ["stats", "points"],
        ["stats", "respect"],
    ]
    for path in nested_paths:
        score = _extract_nested_int(value, path, default=None)
        if score is not None:
            return score

    return 0


def _extract_side_chain(value: Dict[str, Any]) -> int:
    value = _as_dict(value)

    direct_keys = [
        "chain",
        "chain_count",
        "current_chain",
        "chainCount",
    ]
    for key in direct_keys:
        chain = _to_int(value.get(key), None)
        if chain is not None:
            return chain

    nested_paths = [
        ["chain", "current"],
        ["chain", "value"],
        ["stats", "chain"],
    ]
    for path in nested_paths:
        chain = _extract_nested_int(value, path, default=None)
        if chain is not None:
            return chain

    return 0


def _extract_side_id(value: Dict[str, Any], fallback_key: Any = "") -> str:
    value = _as_dict(value)
    return str(
        value.get("id")
        or value.get("faction_id")
        or value.get("factionID")
        or value.get("team_id")
        or fallback_key
        or ""
    ).strip()


def _extract_side_name(value: Dict[str, Any]) -> str:
    value = _as_dict(value)
    return str(
        value.get("name")
        or value.get("faction_name")
        or value.get("factionName")
        or value.get("team_name")
        or ""
    ).strip()


def _candidate_war_nodes(payload: Any) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []

    def walk(node: Any):
        if isinstance(node, dict):
            lowered_keys = {str(k).lower() for k in node.keys()}
            has_war_shape = (
                any(k in lowered_keys for k in {"war_id", "warid", "start", "end", "target", "winner", "ranked", "rankedwarid"})
                or ("factions" in lowered_keys)
                or ("teams" in lowered_keys)
                or ("war" in lowered_keys)
                or ("rankedwars" in lowered_keys)
                or ("ranked_wars" in lowered_keys)
            )
            if has_war_shape:
                found.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found


def _parse_war_factions(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    possible_roots = [
        node.get("factions"),
        node.get("teams"),
        _as_dict(node.get("war")).get("factions"),
        _as_dict(node.get("war")).get("teams"),
    ]

    out: List[Dict[str, Any]] = []

    for raw in possible_roots:
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(value, dict):
                    out.append({
                        "faction_id": _extract_side_id(value, fallback_key=key),
                        "name": _extract_side_name(value),
                        "score": _extract_side_score(value),
                        "chain": _extract_side_chain(value),
                        "raw": value,
                    })
            if out:
                return out

        if isinstance(raw, list):
            for value in raw:
                if isinstance(value, dict):
                    out.append({
                        "faction_id": _extract_side_id(value),
                        "name": _extract_side_name(value),
                        "score": _extract_side_score(value),
                        "chain": _extract_side_chain(value),
                        "raw": value,
                    })
            if out:
                return out

    return out


def _extract_node_phase(node: Dict[str, Any]) -> str:
    war_node = _as_dict(node.get("war"))
    candidates = [
        node.get("phase"),
        node.get("state"),
        node.get("status"),
        node.get("war_status"),
        war_node.get("phase"),
        war_node.get("state"),
        war_node.get("status"),
    ]
    for value in candidates:
        s = str(value or "").strip().lower()
        if s:
            return s
    return "none"


def _extract_node_war_type(node: Dict[str, Any]) -> str:
    war_node = _as_dict(node.get("war"))
    candidates = [
        node.get("war_type"),
        node.get("type"),
        node.get("mode"),
        war_node.get("war_type"),
        war_node.get("type"),
        war_node.get("mode"),
    ]
    for value in candidates:
        s = str(value or "").strip().lower()
        if s:
            return s
    return ""


def _extract_node_war_id(node: Dict[str, Any]) -> str:
    war_node = _as_dict(node.get("war"))
    candidates = [
        node.get("war_id"),
        node.get("warID"),
        node.get("rankedwarid"),
        node.get("id"),
        war_node.get("war_id"),
        war_node.get("warID"),
        war_node.get("rankedwarid"),
        war_node.get("id"),
    ]
    for value in candidates:
        s = str(value or "").strip()
        if s:
            return s
    return ""


def _extract_node_target_score(node: Dict[str, Any]) -> int:
    war_node = _as_dict(node.get("war"))
    candidates = [
        node.get("target"),
        node.get("target_score"),
        node.get("score_target"),
        war_node.get("target"),
        war_node.get("target_score"),
        war_node.get("score_target"),
    ]
    for value in candidates:
        if value not in (None, ""):
            return _to_int(value, 0)
    return 0


def _is_current_ranked_war(node: Dict[str, Any], my_faction_id: str = "", my_faction_name: str = "") -> bool:
    phase = _extract_node_phase(node)
    war_type = _extract_node_war_type(node)
    text = f"{phase} {war_type}".lower()

    factions = _parse_war_factions(node)

    if my_faction_id and factions and not any(str(x.get("faction_id") or "") == my_faction_id for x in factions):
        return False
    if my_faction_name and factions and not any(_stringify_lower(x.get("name")) == _stringify_lower(my_faction_name) for x in factions):
        return False

    if any(flag in text for flag in ["ranked", "active", "attacking", "defending", "ongoing", "confirmed", "register", "registered", "prewar", "matchup"]):
        return True

    start = _to_int(node.get("start") or node.get("start_timestamp") or node.get("starts"), 0)
    end = _to_int(node.get("end") or node.get("end_timestamp") or node.get("ends"), 0)
    war_node = _as_dict(node.get("war"))
    if not start:
        start = _to_int(war_node.get("start") or war_node.get("start_timestamp") or war_node.get("starts"), 0)
    if not end:
        end = _to_int(war_node.get("end") or war_node.get("end_timestamp") or war_node.get("ends"), 0)

    now_ts = int(time.time())
    if start and start <= now_ts and (not end or end > now_ts):
        return True

    if len(factions) >= 2 and (my_faction_id or my_faction_name):
        return True

    return False


def _build_ranked_war_response(node: Dict[str, Any], source_note: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    factions = _parse_war_factions(node)
    my_faction_id = str(my_faction_id or "").strip()
    my_faction_name = str(my_faction_name or "").strip()

    my_side = None
    enemy_side = None

    if my_faction_id:
        my_side = next(
            (x for x in factions if str(x.get("faction_id") or "").strip() == my_faction_id),
            None,
        )

    if my_side is None and my_faction_name:
        my_side = next(
            (x for x in factions if _stringify_lower(x.get("name")) == _stringify_lower(my_faction_name)),
            None,
        )

    if my_side is not None:
        my_side_id = str(my_side.get("faction_id") or "").strip()
        my_side_name = str(my_side.get("name") or "").strip()

        enemy_candidates = []
        for x in factions:
            if x is my_side:
                continue

            candidate_id = str(x.get("faction_id") or "").strip()
            candidate_name = str(x.get("name") or "").strip()

            if my_side_id and candidate_id and candidate_id == my_side_id:
                continue
            if my_side_name and candidate_name and _stringify_lower(candidate_name) == _stringify_lower(my_side_name):
                continue

            enemy_candidates.append(x)

        enemy_side = enemy_candidates[0] if enemy_candidates else None
    elif len(factions) >= 2:
        first = factions[0]
        second = factions[1]

        first_id = str(first.get("faction_id") or "").strip()
        second_id = str(second.get("faction_id") or "").strip()
        first_name = str(first.get("name") or "").strip()
        second_name = str(second.get("name") or "").strip()

        if first_id and second_id and first_id != second_id:
            my_side = first
            enemy_side = second
        elif first_name and second_name and _stringify_lower(first_name) != _stringify_lower(second_name):
            my_side = first
            enemy_side = second

    phase = _extract_node_phase(node)
    war_type = _extract_node_war_type(node) or ("rankedwars" if "ranked" in source_note.lower() else "")
    war_id = _extract_node_war_id(node)
    active = phase in {"active", "ongoing", "attacking", "defending"} or "active" in phase or "ongoing" in phase
    registered = phase in {"registered", "registering", "confirmed", "prewar"} or "register" in phase or "confirm" in phase or "prewar" in phase

    if not active and not registered:
        combined = f"{phase} {war_type}".lower()
        active = any(x in combined for x in ["active", "ongoing"])
        registered = any(x in combined for x in ["register", "confirmed", "prewar", "matchup"])

    resolved_my_faction_id = str((my_side or {}).get("faction_id") or my_faction_id or "").strip()
    resolved_my_faction_name = str((my_side or {}).get("name") or my_faction_name or "").strip()
    resolved_enemy_faction_id = str((enemy_side or {}).get("faction_id") or "").strip()
    resolved_enemy_faction_name = str((enemy_side or {}).get("name") or "").strip()

    if resolved_my_faction_id and resolved_enemy_faction_id and resolved_my_faction_id == resolved_enemy_faction_id:
        resolved_enemy_faction_id = ""
        resolved_enemy_faction_name = ""
        enemy_side = None

    if resolved_my_faction_name and resolved_enemy_faction_name and _stringify_lower(resolved_my_faction_name) == _stringify_lower(resolved_enemy_faction_name):
        resolved_enemy_faction_id = ""
        resolved_enemy_faction_name = ""
        enemy_side = None

    return {
        "has_war": bool(factions or node),
        "active": bool(active),
        "registered": bool(registered),
        "phase": phase or "none",
        "war_id": war_id,
        "war_type": war_type or "rankedwars",
        "my_faction_id": resolved_my_faction_id,
        "my_faction_name": resolved_my_faction_name,
        "enemy_faction_id": resolved_enemy_faction_id,
        "enemy_faction_name": resolved_enemy_faction_name,
        "enemy_members": [],
        "score_us": _to_int((my_side or {}).get("score"), 0),
        "score_them": _to_int((enemy_side or {}).get("score"), 0),
        "chain_us": _to_int((my_side or {}).get("chain"), 0),
        "chain_them": _to_int((enemy_side or {}).get("chain"), 0),
        "target_score": _extract_node_target_score(node),
        "source_note": source_note,
        "debug_factions": [{k: v for k, v in x.items() if k != "raw"} for x in factions],
        "debug_raw_keys": sorted(list(node.keys())),
        "debug_raw": node,
    }


def _war_quality_score(war: Dict[str, Any], my_faction_id: str = "", my_faction_name: str = "") -> int:
    score = 0

    if war.get("enemy_faction_id"):
        score += 100
    if war.get("enemy_faction_name"):
        score += 60
    if war.get("war_id"):
        score += 20
    if war.get("active"):
        score += 25
    if war.get("registered"):
        score += 15
    if war.get("score_us") or war.get("score_them"):
        score += 10
    if war.get("chain_us") or war.get("chain_them"):
        score += 10

    if my_faction_id and str(war.get("my_faction_id") or "") == my_faction_id:
        score += 25
    if my_faction_name and _stringify_lower(war.get("my_faction_name")) == _stringify_lower(my_faction_name):
        score += 15

    return score


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    my_faction_id = str(my_faction_id or "").strip()
    my_faction_name = str(my_faction_name or "").strip()

    base = {
        "has_war": False,
        "active": False,
        "registered": False,
        "phase": "none",
        "war_id": "",
        "war_type": "",
        "my_faction_id": my_faction_id,
        "my_faction_name": my_faction_name,
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "enemy_members": [],
        "score_us": 0,
        "score_them": 0,
        "chain_us": 0,
        "chain_them": 0,
        "target_score": 0,
        "source_note": "No current registered or active ranked war found.",
        "debug_factions": [],
        "debug_raw_keys": [],
        "debug_raw": {},
    }

    if not api_key:
        base["source_note"] = "Missing API key."
        return base

    attempts = []
    if my_faction_id:
        attempts.extend([
            (f"{API_BASE}/v2/faction/{my_faction_id}/rankedwars", {"key": api_key, "striptags": "true"}, "v2_faction_rankedwars_direct"),
            (f"{API_BASE}/faction/{my_faction_id}", {"selections": "rankedwars", "key": api_key, "striptags": "true"}, "v1_faction_rankedwars_direct"),
            (f"{API_BASE}/faction/", {"selections": "rankedwars", "ID": my_faction_id, "key": api_key, "striptags": "true"}, "v1_faction_rankedwars_id_upper"),
            (f"{API_BASE}/faction/", {"selections": "rankedwars", "id": my_faction_id, "key": api_key, "striptags": "true"}, "v1_faction_rankedwars_id_lower"),
        ])
    attempts.append((f"{API_BASE}/faction/", {"selections": "rankedwars", "key": api_key, "striptags": "true"}, "v1_faction_rankedwars_self"))

    best_error = "Could not load ranked wars."
    best_match = None
    best_score = -1

    for url, params, prefix in attempts:
        res = _safe_get(url, params, cache_seconds=CACHE_TTL_WAR_SUMMARY, cache_prefix=prefix)
        if not res.get("ok"):
            best_error = str(res.get("error") or best_error)
            continue

        payload = res.get("data") or {}
        nodes = _candidate_war_nodes(payload)
        if not nodes and isinstance(payload, dict):
            nodes = [payload]

        for node in nodes:
            if not isinstance(node, dict):
                continue
            if not _is_current_ranked_war(node, my_faction_id=my_faction_id, my_faction_name=my_faction_name):
                continue

            built = _build_ranked_war_response(
                node,
                source_note=f"Loaded from {prefix}.",
                my_faction_id=my_faction_id,
                my_faction_name=my_faction_name,
            )

            quality = _war_quality_score(built, my_faction_id=my_faction_id, my_faction_name=my_faction_name)

            if quality > best_score:
                best_score = quality
                best_match = built

            if built.get("enemy_faction_id") and (built.get("registered") or built.get("active") or built.get("war_id")):
                return built

    if best_match:
        return best_match

    base["source_note"] = best_error or base["source_note"]
    return base


def member_live_bars(api_key: str, user_id: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    user_id = str(user_id or "").strip()
    if not api_key:
        return {"ok": False, "error": "Missing API key.", "user_id": user_id, "bars": {}, "status": {}, "last_action": {}}

    selections = "bars,profile,personalstats,cooldowns"
    attempts = []
    if user_id:
        attempts.extend([
            (f"{API_BASE}/user/{user_id}", {"selections": selections, "key": api_key}, f"user_live_direct_{user_id}"),
            (f"{API_BASE}/user/", {"selections": selections, "ID": user_id, "key": api_key}, f"user_live_upper_{user_id}"),
            (f"{API_BASE}/user/", {"selections": selections, "id": user_id, "key": api_key}, f"user_live_lower_{user_id}"),
        ])
    else:
        attempts.append((f"{API_BASE}/user/", {"selections": selections, "key": api_key}, "user_live_self"))

    last_error = "Could not load user live bars."
    for url, params, prefix in attempts:
        res = _safe_get(url, params, cache_seconds=0, cache_prefix=prefix)
        if not res.get("ok"):
            last_error = str(res.get("error") or last_error)
            continue

        data = res.get("data") or {}
        bars = data.get("bars") or {}
        life = bars.get("life") if isinstance(bars, dict) else {}
        energy = bars.get("energy") if isinstance(bars, dict) else {}
        nerve = bars.get("nerve") if isinstance(bars, dict) else {}
        happy = bars.get("happy") if isinstance(bars, dict) else {}
        status = data.get("status") or {}
        last_action = data.get("last_action") or {}
        resolved_user_id = str(data.get("player_id") or data.get("playerID") or data.get("user_id") or "").strip()

        if user_id and resolved_user_id and resolved_user_id != user_id:
            last_error = f"API key/user mismatch. Requested {user_id}, got {resolved_user_id}."
            continue

        resolved_user_id = user_id or resolved_user_id
        medical_cooldown = _extract_medical_cooldown_seconds(data)

        return {
            "ok": True,
            "user_id": resolved_user_id,
            "name": str(data.get("name") or ""),
            "medical_cooldown": _to_int(medical_cooldown, 0),
            "bars": {
                "life": {
                    "current": _to_int((life or {}).get("current"), 0),
                    "maximum": _to_int((life or {}).get("maximum"), 0),
                },
                "energy": {
                    "current": _to_int((energy or {}).get("current"), 0),
                    "maximum": _to_int((energy or {}).get("maximum"), 0),
                },
                "nerve": {
                    "current": _to_int((nerve or {}).get("current"), 0),
                    "maximum": _to_int((nerve or {}).get("maximum"), 0),
                },
                "happy": {
                    "current": _to_int((happy or {}).get("current"), 0),
                    "maximum": _to_int((happy or {}).get("maximum"), 0),
                },
            },
            "status": status if isinstance(status, dict) else {},
            "last_action": last_action if isinstance(last_action, dict) else {},
        }

    return {"ok": False, "error": last_error, "user_id": user_id, "bars": {}, "status": {}, "last_action": {}}
