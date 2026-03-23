import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

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
    if any(x in s for x in ["offline", "away"]):
        return "offline"

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

        for key in ("medical", "med", "hospital", "drug"):
            candidates.append(cooldowns.get(key))

    for key in (
        "medical_cooldown",
        "medicalCooldown",
        "cooldown_medical",
        "med_cooldown",
        "medCooldown",
    ):
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
    last_action = ""
    status_text = ""
    status_detail = ""
    name = str(
        member.get("name")
        or member.get("player_name")
        or member.get("member_name")
        or "Unknown"
    )
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
        status_detail = str(
            status_raw.get("details")
            or status_raw.get("description")
            or ""
        )
    else:
        status_text = str(status_raw or "")

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
    combined_lower = combined

    if not in_hospital:
        if any(x in combined_lower for x in ["jail", "jailed"]):
            online_state = "jail"
        elif any(x in combined_lower for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
            online_state = "travel"
        elif "online" in status_text_lower:
            online_state = "online"
        elif "idle" in status_text_lower:
            online_state = "idle"
        elif "offline" in status_text_lower:
            online_state = "offline"
        elif "okay" in status_text_lower and "offline" not in combined_lower:
            online_state = "online"

    user_id = str(
        uid
        or member.get("user_id")
        or member.get("player_id")
        or member.get("id")
        or ""
    )

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
    api_key = str(api_key or "").strip()
    faction_id = str(faction_id or "").strip()

    def _extract_data_root(payload: Any) -> Dict[str, Any]:
        if isinstance(payload, dict):
            for key in ("faction", "data"):
                node = payload.get(key)
                if isinstance(node, dict) and node:
                    return node
            return payload
        return {}

    def _extract_members_root(payload: Any) -> Any:
        if isinstance(payload, dict):
            for key in ("members", "member", "data"):
                node = payload.get(key)
                if node not in (None, "", [], {}):
                    return node
        return payload

    def _normalize_members_any(payload: Any) -> List[Dict[str, Any]]:
        root = _extract_members_root(payload)
        members: List[Dict[str, Any]] = []

        if isinstance(root, dict):
            for uid, member in root.items():
                if isinstance(member, dict):
                    member_uid = member.get("user_id") or member.get("player_id") or member.get("id") or uid
                    members.append(_normalize_member(member_uid, member))
        elif isinstance(root, list):
            for idx, member in enumerate(root):
                if isinstance(member, dict):
                    member_uid = member.get("user_id") or member.get("player_id") or member.get("id") or str(idx)
                    members.append(_normalize_member(member_uid, member))

        return members

    def _build_result(
        res_obj: Dict[str, Any],
        fallback_faction_id: str = "",
        source: str = "",
        url: str = "",
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        params = params or {}

        if not res_obj.get("ok"):
            return {
                "ok": False,
                "faction_id": fallback_faction_id,
                "faction_name": "",
                "members": [],
                "error": res_obj.get("error", "Could not load faction."),
                "raw": res_obj.get("data") or {},
                "source": source,
                "url": url,
                "params": {k: v for k, v in params.items() if k != "key"},
            }

        data = _extract_data_root(res_obj.get("data") or {})
        members = _normalize_members_any(res_obj.get("data") or {})

        resolved_faction_id = str(
            data.get("ID")
            or data.get("id")
            or data.get("faction_id")
            or data.get("factionID")
            or fallback_faction_id
            or ""
        ).strip()

        resolved_faction_name = str(
            data.get("name")
            or data.get("faction_name")
            or data.get("factionName")
            or ""
        ).strip()

        return {
            "ok": True,
            "faction_id": resolved_faction_id,
            "faction_name": resolved_faction_name,
            "members": members,
            "error": "",
            "raw": res_obj.get("data") or {},
            "source": source,
            "url": url,
            "params": {k: v for k, v in params.items() if k != "key"},
        }

    if not api_key:
        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
            "error": "Missing API key.",
            "debug_attempts": [],
        }

    if faction_id:
        attempts = [
            (
                f"{API_BASE}/v2/faction/{faction_id}/members",
                {"key": api_key, "striptags": "true"},
                "v2_faction_members_direct",
            ),
            (
                f"{API_BASE}/v2/faction/{faction_id}/basic",
                {"key": api_key, "striptags": "true"},
                "v2_faction_basic_direct",
            ),
            (
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "members", "key": api_key, "striptags": "true"},
                "faction_members_direct",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "members", "ID": faction_id, "key": api_key, "striptags": "true"},
                "faction_members_id_upper",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "members", "id": faction_id, "key": api_key, "striptags": "true"},
                "faction_members_id_lower",
            ),
            (
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "basic,members", "key": api_key, "striptags": "true"},
                "faction_basic_members_direct",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "basic,members", "ID": faction_id, "key": api_key, "striptags": "true"},
                "faction_basic_members_id_upper",
            ),
            (
                f"{API_BASE}/faction/",
                {"selections": "basic,members", "id": faction_id, "key": api_key, "striptags": "true"},
                "faction_basic_members_id_lower",
            ),
        ]

        best: Optional[Dict[str, Any]] = None
        best_error = "Could not load faction."
        debug_attempts: List[Dict[str, Any]] = []

        for url, params, prefix in attempts:
            res = _safe_get(
                url,
                params,
                cache_seconds=CACHE_TTL_FACTION_BASIC,
                cache_prefix=prefix,
            )
            built = _build_result(
                res,
                fallback_faction_id=faction_id,
                source=prefix,
                url=url,
                params=params,
            )

            built_faction_id = str(built.get("faction_id") or "").strip()
            built_faction_name = str(built.get("faction_name") or "").strip()
            built_members = built.get("members") or []
            built_error = str(built.get("error") or "")

            debug_attempts.append({
                "source": prefix,
                "ok": bool(built.get("ok")),
                "faction_id": built_faction_id or faction_id,
                "faction_name": built_faction_name,
                "member_count": len(built_members),
                "error": built_error,
                "params": built.get("params") or {},
            })

            if not built.get("ok"):
                if built_error:
                    best_error = built_error
                continue

            if built_faction_id and faction_id and built_faction_id != faction_id:
                best_error = f"{prefix} returned faction_id={built_faction_id} instead of requested {faction_id}"
                continue

            if built_members:
                built["debug_attempts"] = debug_attempts
                return built

            if best is None:
                best = built
            else:
                best_member_count = len(best.get("members") or [])
                built_member_count = len(built_members)
                if built_member_count > best_member_count:
                    best = built
                elif not best.get("faction_name") and built_faction_name:
                    best = built

        if best is not None:
            best["debug_attempts"] = debug_attempts
            if not best.get("error") and best_error:
                best["error"] = best_error
            return best

        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
            "error": best_error,
            "debug_attempts": debug_attempts,
        }

    me = me_basic(api_key)
    if not me.get("ok"):
        return {
            "ok": False,
            "faction_id": "",
            "faction_name": "",
            "members": [],
            "error": me.get("error", "Could not load player."),
            "debug_attempts": [],
        }

    my_faction_id = str(me.get("faction_id") or "")
    if not my_faction_id:
        return {
            "ok": True,
            "faction_id": "",
            "faction_name": "",
            "members": [],
            "debug_attempts": [],
        }

    return faction_basic(api_key, faction_id=my_faction_id)




def _find_war_container(data: Dict[str, Any]) -> Tuple[str, Any]:
    for key in ("warfare", "rankedwars", "wars"):
        value = data.get(key)
        if isinstance(value, dict) and value:
            return key, value
        if isinstance(value, list) and value:
            return key, value
    return "", {}


def _war_phase(war: Dict[str, Any]) -> str:
    raw = " ".join([
        str(war.get("status") or ""),
        str(war.get("state") or ""),
        str(war.get("phase") or ""),
    ]).strip().lower()

    if any(x in raw for x in ["ended", "finished", "complete", "completed", "expired"]):
        return "finished"
    if any(x in raw for x in ["active", "running", "ongoing", "started", "live", "in progress"]):
        return "active"
    if any(x in raw for x in ["pending", "matching", "matched", "upcoming", "scheduled", "registered", "pair", "paired"]):
        return "registered"

    now_ts = int(time.time())
    start_val = _to_int(
        war.get("start")
        or war.get("start_time")
        or war.get("started")
        or war.get("starts")
        or war.get("begin")
        or 0,
        0,
    )
    end_val = _to_int(
        war.get("end")
        or war.get("end_time")
        or war.get("ended")
        or war.get("ends")
        or 0,
        0,
    )

    if end_val > 0 and end_val <= now_ts:
        return "finished"
    if start_val > now_ts:
        return "registered"
    if start_val > 0 and (end_val == 0 or end_val > now_ts):
        return "active"

    return "unknown"


def _side_score(side_data: Dict[str, Any]) -> int:
    if not isinstance(side_data, dict):
        return 0

    for key in (
        "score",
        "points",
        "war_score",
        "ranked_war_score",
        "faction_score",
        "current_score",
        "total",
    ):
        val = side_data.get(key)
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str) and val.strip().isdigit():
            return int(val.strip())

    score_obj = side_data.get("score_data") or side_data.get("scores") or {}
    if isinstance(score_obj, dict):
        for key in ("score", "current", "total", "points", "war_score"):
            val = score_obj.get(key)
            if isinstance(val, (int, float)):
                return int(val)
            if isinstance(val, str) and val.strip().isdigit():
                return int(val.strip())

    return 0


def _side_chain(side_data: Dict[str, Any]) -> int:
    if not isinstance(side_data, dict):
        return 0

    for key in (
        "chain",
        "chain_count",
        "hits",
        "hit_count",
        "attacks",
        "attack_count",
        "current_chain",
    ):
        val = side_data.get(key)
        if isinstance(val, (int, float)):
            return int(val)
        if isinstance(val, str) and val.strip().isdigit():
            return int(val.strip())

    chain_obj = side_data.get("chain_data") or {}
    if isinstance(chain_obj, dict):
        for key in ("chain", "count", "hits", "current"):
            val = chain_obj.get(key)
            if isinstance(val, (int, float)):
                return int(val)
            if isinstance(val, str) and val.strip().isdigit():
                return int(val.strip())

    return 0


def _normalize_war_side(side: Any, fallback_id: str = "", fallback_name: str = "") -> Dict[str, Any]:
    if not isinstance(side, dict):
        return {
            "faction_id": str(fallback_id or "").strip(),
            "faction_name": str(fallback_name or "").strip(),
            "score": 0,
            "chain": 0,
            "raw": {},
        }

    side_id = str(
        side.get("id")
        or side.get("faction_id")
        or side.get("ID")
        or fallback_id
        or ""
    ).strip()

    side_name = str(
        side.get("name")
        or side.get("faction_name")
        or fallback_name
        or ""
    ).strip()

    return {
        "faction_id": side_id,
        "faction_name": side_name,
        "score": _side_score(side),
        "chain": _side_chain(side),
        "raw": side,
    }


def _coerce_warfare_rows(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]

    if isinstance(payload, dict):
        if "warfare" in payload and isinstance(payload.get("warfare"), list):
            return [x for x in payload.get("warfare") if isinstance(x, dict)]

        rows: List[Dict[str, Any]] = []
        for key, value in payload.items():
            if isinstance(value, dict):
                row = dict(value)
                if "war_id" not in row and "id" not in row:
                    row["_container_key"] = str(key)
                rows.append(row)
        return rows

    return []


def _extract_warfare_sides(row: Dict[str, Any]) -> List[Dict[str, Any]]:
    sides: List[Dict[str, Any]] = []

    direct_pairs = [
        ("aggressor", "aggressor_name"),
        ("defender", "defender_name"),
        ("attacker", "attacker_name"),
        ("faction_1", "faction_1_name"),
        ("faction_2", "faction_2_name"),
    ]

    for key, name_key in direct_pairs:
        value = row.get(key)
        if isinstance(value, dict):
            sides.append(_normalize_war_side(value, fallback_name=str(row.get(name_key) or "")))

    for key in ("factions", "sides", "teams"):
        value = row.get(key)
        if isinstance(value, dict):
            for fid, obj in value.items():
                if isinstance(obj, dict):
                    sides.append(_normalize_war_side(obj, fallback_id=str(fid)))
        elif isinstance(value, list):
            for obj in value:
                if isinstance(obj, dict):
                    sides.append(_normalize_war_side(obj))

    nested = row.get("war")
    if isinstance(nested, dict):
        for key in ("aggressor", "defender", "attacker", "faction_1", "faction_2"):
            value = nested.get(key)
            if isinstance(value, dict):
                sides.append(_normalize_war_side(value))

        for key in ("factions", "sides", "teams"):
            value = nested.get(key)
            if isinstance(value, dict):
                for fid, obj in value.items():
                    if isinstance(obj, dict):
                        sides.append(_normalize_war_side(obj, fallback_id=str(fid)))
            elif isinstance(value, list):
                for obj in value:
                    if isinstance(obj, dict):
                        sides.append(_normalize_war_side(obj))

    deduped: List[Dict[str, Any]] = []
    seen = set()

    for side in sides:
        sid = str(side.get("faction_id") or "").strip()
        sname = str(side.get("faction_name") or "").strip().lower()
        key = sid or sname
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(side)

    return deduped


def _build_war_entry(war_id: str, row: Dict[str, Any], war_type: str = "") -> Dict[str, Any]:
    raw_war = row.get("war") if isinstance(row.get("war"), dict) else {}
    merged: Dict[str, Any] = {}
    if isinstance(raw_war, dict):
        merged.update(raw_war)
    merged.update(row)

    phase = _war_phase(merged)
    start_ts = _to_int(
        merged.get("start")
        or merged.get("start_time")
        or merged.get("started")
        or merged.get("starts")
        or 0,
        0,
    )
    end_ts = _to_int(
        merged.get("end")
        or merged.get("end_time")
        or merged.get("ended")
        or merged.get("ends")
        or 0,
        0,
    )

    return {
        "war_id": str(
            war_id
            or merged.get("war_id")
            or merged.get("id")
            or row.get("_container_key")
            or ""
        ).strip(),
        "war_type": str(
            war_type
            or merged.get("war_type")
            or merged.get("type")
            or merged.get("category")
            or "ranked"
        ).strip(),
        "phase": phase,
        "active": phase == "active",
        "registered": phase in {"registered", "active"},
        "finished": phase == "finished",
        "start": start_ts,
        "end": end_ts,
        "target_score": _to_int(
            merged.get("target")
            or merged.get("target_score")
            or merged.get("goal")
            or merged.get("score_target")
            or 0,
            0,
        ),
        "factions": _extract_warfare_sides(merged),
        "raw": merged,
        "status_text": str(merged.get("status") or merged.get("state") or "").strip(),
    }


def faction_wars(api_key: str, faction_id: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    faction_id = str(faction_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "wars": [],
            "source_ok": False,
            "source_note": "Missing API key.",
            "error": "Missing API key.",
        }

    attempts: List[Tuple[str, str, Dict[str, Any], str]] = []

    if faction_id:
        attempts.extend([
            (
                "warfare",
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "warfare", "key": api_key},
                f"faction_warfare_direct_{faction_id}",
            ),
            (
                "warfare",
                f"{API_BASE}/faction/",
                {"selections": "warfare", "key": api_key, "ID": faction_id},
                f"faction_warfare_upper_{faction_id}",
            ),
            (
                "warfare",
                f"{API_BASE}/faction/",
                {"selections": "warfare", "key": api_key, "id": faction_id},
                f"faction_warfare_lower_{faction_id}",
            ),
        ])

    attempts.extend([
        (
            "warfare",
            f"{API_BASE}/faction/",
            {"selections": "warfare", "key": api_key},
            "faction_warfare_self",
        ),
        (
            "rankedwars",
            f"{API_BASE}/faction/{faction_id}" if faction_id else f"{API_BASE}/faction/",
            {"selections": "rankedwars", "key": api_key},
            f"faction_rankedwars_direct_{faction_id or 'self'}",
        ),
        (
            "wars",
            f"{API_BASE}/faction/{faction_id}" if faction_id else f"{API_BASE}/faction/",
            {"selections": "wars", "key": api_key},
            f"faction_wars_direct_{faction_id or 'self'}",
        ),
    ])

    chosen_source = ""
    chosen_rows: List[Dict[str, Any]] = []
    last_note = ""

    for selection, url, params, prefix in attempts:
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

        if selection == "warfare":
            rows = _coerce_warfare_rows(data.get("warfare") if isinstance(data, dict) and "warfare" in data else data)
            if rows:
                chosen_rows = rows
                chosen_source = "warfare"
                break
            last_note = f"No warfare rows found. Raw keys: {list(data.keys()) if isinstance(data, dict) else []}"
            continue

        container_name, container = _find_war_container(data)
        if container_name and container:
            if isinstance(container, dict):
                rows = []
                for war_id, war in container.items():
                    if isinstance(war, dict):
                        row = dict(war)
                        if "war_id" not in row and "id" not in row:
                            row["_container_key"] = str(war_id)
                        rows.append(row)
            elif isinstance(container, list):
                rows = [x for x in container if isinstance(x, dict)]
            else:
                rows = []

            if rows:
                chosen_rows = rows
                chosen_source = container_name
                break

        last_note = f"No war container in selection '{selection}'. Raw keys: {list(data.keys()) if isinstance(data, dict) else []}"

    if not chosen_rows:
        return {
            "ok": True,
            "wars": [],
            "source_ok": False,
            "source_note": last_note or "No war container found.",
        }

    wars: List[Dict[str, Any]] = []
    for idx, row in enumerate(chosen_rows):
        war_id = str(row.get("war_id") or row.get("id") or row.get("_container_key") or idx)
        wars.append(_build_war_entry(war_id, row, war_type="ranked"))

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
        "source_note": f"Loaded from faction {chosen_source}.",
    }


def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    my_faction_id = str(my_faction_id or "").strip()
    my_faction_name = str(my_faction_name or "").strip()

    me = {}
    if not my_faction_id or not my_faction_name:
        me = me_basic(api_key) or {}

    my_id = str(my_faction_id or me.get("faction_id") or "").strip()
    my_name = str(my_faction_name or me.get("faction_name") or "").strip()
    my_name_lower = my_name.lower().strip()

    default = {
        "ok": True,
        "active": False,
        "registered": False,
        "has_war": False,
        "phase": "none",
        "war_id": "",
        "war_type": "",
        "my_faction_id": my_id,
        "my_faction_name": my_name,
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
        "debug_factions": [],
        "debug_raw_keys": [],
        "debug_raw": {},
        "debug_enemy_members_count": 0,
        "debug_enemy_fetch": {},
    }

    wars_res = faction_wars(api_key, faction_id=my_id)
    if not wars_res.get("ok"):
        out = dict(default)
        out["source_note"] = str(wars_res.get("error", out["source_note"]))
        return out

    wars = wars_res.get("wars") or []
    if not wars:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = str(wars_res.get("source_note") or out["source_note"])
        return out

    chosen_war = None
    for war in wars:
        sides = [x for x in (war.get("factions") or []) if isinstance(x, dict)]
        if not sides:
            continue

        matched = False
        for side in sides:
            sid = str(side.get("faction_id") or "").strip()
            sname = str(side.get("faction_name") or "").strip().lower()
            if my_id and sid == my_id:
                matched = True
                break
            if my_name_lower and sname and sname == my_name_lower:
                matched = True
                break

        if matched:
            chosen_war = war
            break

    if not chosen_war:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = str(wars_res.get("source_note") or out["source_note"])
        return out

    candidate_sides = [x for x in (chosen_war.get("factions") or []) if isinstance(x, dict)]
    raw = chosen_war.get("raw") or {}

    my_side: Dict[str, Any] = {}
    enemy_side: Dict[str, Any] = {}

    for side in candidate_sides:
        side_id = str(side.get("faction_id") or "").strip()
        side_name = str(side.get("faction_name") or "").strip()
        if my_id and side_id == my_id:
            my_side = side
        elif my_name_lower and side_name.lower() == my_name_lower:
            my_side = side

    for side in candidate_sides:
        if my_side and side is my_side:
            continue
        side_id = str(side.get("faction_id") or "").strip()
        side_name = str(side.get("faction_name") or "").strip().lower()
        if my_id and side_id == my_id:
            continue
        if my_name_lower and side_name == my_name_lower:
            continue
        enemy_side = side
        break

    enemy_id = str(enemy_side.get("faction_id") or "").strip()
    enemy_name = str(enemy_side.get("faction_name") or "").strip()

    score_us = _to_int(my_side.get("score"), 0)
    score_them = _to_int(enemy_side.get("score"), 0)
    chain_us = _to_int(my_side.get("chain"), 0)
    chain_them = _to_int(enemy_side.get("chain"), 0)
    target_score = _to_int(chosen_war.get("target_score"), 0)
    lead = score_us - score_them
    remaining_to_target = max(0, target_score - max(score_us, score_them)) if target_score > 0 else 0
    phase = str(chosen_war.get("phase") or "none")
    is_active = bool(chosen_war.get("active"))
    is_registered = bool(chosen_war.get("registered"))

    debug_enemy_fetch: Dict[str, Any] = {
        "war_source_note": str(wars_res.get("source_note") or ""),
        "matched_by_faction_id": bool(my_id),
        "candidate_sides_count": len(candidate_sides),
        "phase": phase,
    }

    enemy_members: List[Dict[str, Any]] = []
    if enemy_id and enemy_id != my_id:
        enemy_faction = faction_basic(api_key, faction_id=enemy_id) or {}
        debug_enemy_fetch["enemy_fetch_ok"] = bool(enemy_faction.get("ok"))
        debug_enemy_fetch["enemy_fetch_source_faction_id"] = str(enemy_id)

        if enemy_faction.get("ok"):
            fetched_enemy_id = str(enemy_faction.get("faction_id") or enemy_id or "").strip()
            fetched_enemy_name = str(enemy_faction.get("faction_name") or enemy_name or "").strip()

            if my_id and fetched_enemy_id == my_id:
                enemy_id = ""
                enemy_name = ""
                enemy_members = []
                debug_enemy_fetch["enemy_fetch_error"] = "Fetched enemy faction matched own faction."
            else:
                enemy_id = fetched_enemy_id or enemy_id
                enemy_name = fetched_enemy_name or enemy_name
                enemy_members = enemy_faction.get("members") or []
                debug_enemy_fetch["enemy_id"] = enemy_id
                debug_enemy_fetch["enemy_name"] = enemy_name
                debug_enemy_fetch["enemy_fetch_member_count"] = len(enemy_members)

    status_text = str(chosen_war.get("status_text") or "")
    if not status_text:
        status_text = "War active" if is_active else "War registered" if is_registered else "Currently not in war"

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
        "source_note": str(wars_res.get("source_note") or ""),
        "debug_factions": candidate_sides,
        "debug_raw_keys": list(raw.keys()) if isinstance(raw, dict) else [],
        "debug_raw": raw,
        "debug_enemy_members_count": len(enemy_members),
        "debug_enemy_fetch": debug_enemy_fetch,
    }


def member_live_bars(api_key: str, user_id: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    user_id = str(user_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "error": "Missing API key.",
            "user_id": user_id,
            "bars": {},
            "states": {},
            "status": {},
        }

    selections = "bars,profile,personalstats,cooldowns"
    attempts = []

    if user_id:
        attempts.append((
            f"{API_BASE}/user/{user_id}",
            {"selections": selections, "key": api_key},
            f"user_live_direct_{user_id}",
        ))
        attempts.append((
            f"{API_BASE}/user/",
            {"selections": selections, "ID": user_id, "key": api_key},
            f"user_live_upper_{user_id}",
        ))
        attempts.append((
            f"{API_BASE}/user/",
            {"selections": selections, "id": user_id, "key": api_key},
            f"user_live_lower_{user_id}",
        ))
    else:
        attempts.append((
            f"{API_BASE}/user/",
            {"selections": selections, "key": api_key},
            "user_live_self",
        ))

    last_error = "Could not load user live bars."

    for url, params, prefix in attempts:
        res = _safe_get(
            url,
            params,
            cache_seconds=0,
            cache_prefix=prefix,
        )
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

        resolved_user_id = str(
            user_id
            or data.get("player_id")
            or data.get("playerID")
            or data.get("user_id")
            or ""
        ).strip()

        personalstats = data.get("personalstats") or {}
        cooldowns = data.get("cooldowns") or {}
        medical_cooldown = _extract_medical_cooldown_seconds(data)

        return {
            "ok": True,
            "user_id": resolved_user_id,
            "name": str(data.get("name") or ""),
            "personalstats": personalstats if isinstance(personalstats, dict) else {},
            "cooldowns": cooldowns if isinstance(cooldowns, dict) else {},
            "medical_cooldown": _to_int(medical_cooldown, 0),
            "bars": {
                "life": {
                    "current": _to_int((life or {}).get("current"), 0),
                    "maximum": _to_int((life or {}).get("maximum"), 0),
                    "ticktime": _to_int((life or {}).get("ticktime"), 0),
                    "interval": _to_int((life or {}).get("interval"), 0),
                    "fulltime": _to_int((life or {}).get("fulltime"), 0),
                },
                "energy": {
                    "current": _to_int((energy or {}).get("current"), 0),
                    "maximum": _to_int((energy or {}).get("maximum"), 0),
                    "ticktime": _to_int((energy or {}).get("ticktime"), 0),
                    "interval": _to_int((energy or {}).get("interval"), 0),
                    "fulltime": _to_int((energy or {}).get("fulltime"), 0),
                },
                "nerve": {
                    "current": _to_int((nerve or {}).get("current"), 0),
                    "maximum": _to_int((nerve or {}).get("maximum"), 0),
                    "ticktime": _to_int((nerve or {}).get("ticktime"), 0),
                    "interval": _to_int((nerve or {}).get("interval"), 0),
                    "fulltime": _to_int((nerve or {}).get("fulltime"), 0),
                },
                "happy": {
                    "current": _to_int((happy or {}).get("current"), 0),
                    "maximum": _to_int((happy or {}).get("maximum"), 0),
                    "ticktime": _to_int((happy or {}).get("ticktime"), 0),
                    "interval": _to_int((happy or {}).get("interval"), 0),
                    "fulltime": _to_int((happy or {}).get("fulltime"), 0),
                },
            },
            "states": {
                "status": str((status or {}).get("state") or ""),
                "description": str((status or {}).get("description") or ""),
                "details": str((status or {}).get("details") or ""),
                "color": str((status or {}).get("color") or ""),
                "last_action": str(
                    (last_action or {}).get("status")
                    or (last_action or {}).get("relative")
                    or ""
                ),
            },
            "status": status if isinstance(status, dict) else {},
        }

    return {
        "ok": False,
        "error": last_error,
        "user_id": user_id,
        "personalstats": {},
        "cooldowns": {},
        "medical_cooldown": 0,
        "bars": {},
        "states": {},
        "status": {},
    }
