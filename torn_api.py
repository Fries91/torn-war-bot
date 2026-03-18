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

        resolved_faction_id = str(
            data.get("ID")
            or data.get("id")
            or data.get("faction_id")
            or fallback_faction_id
            or ""
        ).strip()

        resolved_faction_name = str(
            data.get("name")
            or data.get("faction_name")
            or ""
        ).strip()

        return {
            "ok": True,
            "faction_id": resolved_faction_id,
            "faction_name": resolved_faction_name,
            "members": members,
        }

    if faction_id:
        attempts = [
            (
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "members", "key": api_key, "striptags": "true"},
                "faction_members_direct",
            ),
            (
                f"{API_BASE}/faction/{faction_id}",
                {"selections": "basic,members", "key": api_key, "striptags": "true"},
                "faction_basic_members_,
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
        mismatch_notes: List[str] = []

        for url, params, prefix in attempts:
            res = _safe_get(
                url,
                params,
                cache_seconds=CACHE_TTL_FACTION_BASIC,
                cache_prefix=prefix,
            )
            built = _build_result(res, faction_id)

            if not built.get("ok"):
                continue

            built_faction_id = str(built.get("faction_id") or "").strip()

            # Critical fix: reject "successful" responses for the wrong faction
            if built_faction_id and built_faction_id != faction_id:
                mismatch_notes.append(
                    f"{prefix} returned faction_id={built_faction_id} instead of requested {faction_id}"
                )
                continue

            if built.get("ok") and built.get("members"):
                return built

            if best is None:
                best = built
            else:
                best_member_count = len(best.get("members") or [])
                built_member_count = len(built.get("members") or [])
                if built_member_count > best_member_count:
                    best = built
                elif not best.get("faction_name") and built.get("faction_name"):
                    best = built

        if best:
            return best

        return {
            "ok": False,
            "faction_id": faction_id,
            "faction_name": "",
            "members": [],
            "error": "; ".join(mismatch_notes) if mismatch_notes else "Could not load faction.",
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


def _extract_factions_from_war(war: Dict[str, Any]) -> Any:
    for key in ("factions", "sides", "teams"):
        factions = war.get(key)
        if isinstance(factions, dict) and factions:
            return factions
        if isinstance(factions, list) and factions:
            return factions

        nested_war = war.get("war")
        if isinstance(nested_war, dict):
            for nested_key in ("factions", "sides", "teams"):
                nested_factions = nested_war.get(nested_key)
                if isinstance(nested_factions, dict) and nested_factions:
                    return nested_factions
                if isinstance(nested_factions, list) and nested_factions:
                    return nested_factions

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

        parsed_factions: List[Dict[str, Any]] = []

        def add_side(fid: Any, fdata: Dict[str, Any], fallback_name: str = ""):
            if not isinstance(fdata, dict):
                return

            side_id = str(
                fdata.get("id")
                or fdata.get("faction_id")
                or fdata.get("ID")
                or fid
                or ""
            ).strip()

            side_name = str(
                fdata.get("name")
                or fdata.get("faction_name")
                or fallback_name
                or ""
            ).strip()

            score = _side_score(fdata)
            chain = _side_chain(fdata)

            if not side_id and not side_name:
                return

            for existing in parsed_factions:
                ex_id = str(existing.get("faction_id") or "").strip()
                ex_name = str(existing.get("faction_name") or "").strip().lower()

                if side_id and ex_id and side_id == ex_id:
                    existing["score"] = score if score else existing.get("score", 0)
                    existing["chain"] = chain if chain else existing.get("chain", 0)

                    existing_raw = existing.get("raw") or {}
                    merged_raw = dict(existing_raw) if isinstance(existing_raw, dict) else {}
                    merged_raw.update(fdata)
                    existing["raw"] = merged_raw

                    if side_name and not existing.get("faction_name"):
                        existing["faction_name"] = side_name
                    return

                if side_name and ex_name and side_name.lower() == ex_name:
                    existing["score"] = score if score else existing.get("score", 0)
                    existing["chain"] = chain if chain else existing.get("chain", 0)

                    existing_raw = existing.get("raw") or {}
                    merged_raw = dict(existing_raw) if isinstance(existing_raw, dict) else {}
                    merged_raw.update(fdata)
                    existing["raw"] = merged_raw

                    if side_id and not existing.get("faction_id"):
                        existing["faction_id"] = side_id
                    return

            parsed_factions.append({
                "faction_id": side_id,
                "faction_name": side_name,
                "score": score,
                "chain": chain,
                "raw": fdata,
            })

        factions_raw = _extract_factions_from_war(war)

        if isinstance(factions_raw, dict):
            for fid, fdata in factions_raw.items():
                if isinstance(fdata, dict):
                    add_side(fid, fdata)
        elif isinstance(factions_raw, list):
            for idx, fdata in enumerate(factions_raw):
                if isinstance(fdata, dict):
                    fid = fdata.get("faction_id") or fdata.get("id") or str(idx)
                    add_side(fid, fdata)

        raw_war = war.get("war") if isinstance(war.get("war"), dict) else {}

        for key in ("faction_1", "faction1", "team_1", "team1", "attacker", "attackers", "red", "side_1", "side1"):
            side = war.get(key)
            if isinstance(side, dict):
                add_side(None, side)
            nested_side = raw_war.get(key)
            if isinstance(nested_side, dict):
                add_side(None, nested_side)

        for key in ("faction_2", "faction2", "team_2", "team2", "defender", "defenders", "blue", "side_2", "side2"):
            side = war.get(key)
            if isinstance(side, dict):
                add_side(None, side)
            nested_side = raw_war.get(key)
            if isinstance(nested_side, dict):
                add_side(None, nested_side)

        attacker_id = str(
            war.get("attacker_id")
            or war.get("attacking_faction")
            or raw_war.get("attacker_id")
            or raw_war.get("attacking_faction")
            or ""
        ).strip()
        attacker_name = str(
            war.get("attacker_name")
            or war.get("attacking_faction_name")
            or raw_war.get("attacker_name")
            or raw_war.get("attacking_faction_name")
            or ""
        ).strip()
        defender_id = str(
            war.get("defender_id")
            or war.get("defending_faction")
            or raw_war.get("defender_id")
            or raw_war.get("defending_faction")
            or ""
        ).strip()
        defender_name = str(
            war.get("defender_name")
            or war.get("defending_faction_name")
            or raw_war.get("defender_name")
            or raw_war.get("defending_faction_name")
            or ""
        ).strip()

        if attacker_id or attacker_name:
            add_side(attacker_id, {
                "faction_id": attacker_id,
                "name": attacker_name,
                "score": war.get("attacker_score") or raw_war.get("attacker_score"),
                "chain": war.get("attacker_chain") or raw_war.get("attacker_chain"),
            }, attacker_name)

        if defender_id or defender_name:
            add_side(defender_id, {
                "faction_id": defender_id,
                "name": defender_name,
                "score": war.get("defender_score") or raw_war.get("defender_score"),
                "chain": war.get("defender_chain") or raw_war.get("defender_chain"),
            }, defender_name)

        phase = _war_phase(war)

        winner = raw_war.get("winner") or war.get("winner")
        end_ts = _to_int(
            war.get("end")
            or war.get("end_time")
            or war.get("ends")
            or raw_war.get("end")
            or raw_war.get("end_time")
            or 0,
            0,
        )
        start_ts = _to_int(
            war.get("start")
            or war.get("start_time")
            or war.get("started")
            or raw_war.get("start")
            or raw_war.get("start_time")
            or 0,
            0,
        )
        now_ts = int(time.time())

        if winner or (end_ts and end_ts < now_ts):
            phase = "finished"
        elif phase == "unknown":
            if start_ts and start_ts > now_ts:
                phase = "registered"
            elif start_ts and (end_ts == 0 or start_ts <= now_ts <= end_ts):
                phase = "active"
            elif parsed_factions:
                phase = "active"
            else:
                phase = "finished"

        wars.append({
            "war_id": str(war.get("id") or raw_war.get("id") or war_id),
            "war_type": str(war.get("war_type") or raw_war.get("war_type") or chosen_container_name),
            "status_text": str(war.get("status") or war.get("state") or raw_war.get("status") or raw_war.get("state") or ""),
            "phase": phase,
            "active": phase == "active",
            "registered": phase in {"registered", "active"},
            "finished": phase == "finished",
            "start": start_ts,
            "end": end_ts,
            "target_score": _to_int(
                war.get("target")
                or war.get("target_score")
                or war.get("goal")
                or war.get("score_target")
                or raw_war.get("target")
                or raw_war.get("target_score")
                or raw_war.get("goal")
                or 0,
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
    my_faction_id = str(my_faction_id or "").strip()
    my_faction_name = str(my_faction_name or "").strip()

    me = {}
    if not my_faction_id or not my_faction_name:
        me = me_basic(api_key) or {}

    resolved_my_faction_id = str(my_faction_id or me.get("faction_id") or "").strip()
    resolved_my_faction_name = str(my_faction_name or me.get("faction_name") or "").strip()
    my_name_lower = resolved_my_faction_name.lower().strip()

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
        "debug_factions": [],
        "debug_raw_keys": [],
        "debug_raw": {},
        "debug_enemy_members_count": 0,
        "debug_enemy_fetch": {},
    }

    wars_res = faction_wars(api_key, faction_id=resolved_my_faction_id)
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

    def _fid(side: Dict[str, Any]) -> str:
        return str((side or {}).get("faction_id") or "").strip()

    def _fname(side: Dict[str, Any]) -> str:
        return str((side or {}).get("faction_name") or "").strip()

    def _fname_lower(side: Dict[str, Any]) -> str:
        return _fname(side).lower()

    def _same_side(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        a_id = _fid(a)
        b_id = _fid(b)
        if a_id and b_id and a_id == b_id:
            return True
        a_name = _fname_lower(a)
        b_name = _fname_lower(b)
        return bool(a_name and b_name and a_name == b_name)

    def _is_me(side: Dict[str, Any]) -> bool:
        sid = _fid(side)
        sname = _fname_lower(side)
        if resolved_my_faction_id and sid and sid == resolved_my_faction_id:
            return True
        if my_name_lower and sname and sname == my_name_lower:
            return True
        return False

    def _raw_side(
        raw: Dict[str, Any],
        key_names: List[str],
        id_keys: List[str],
        name_keys: List[str],
        score_keys: List[str],
        chain_keys: List[str],
    ) -> Dict[str, Any]:
        for key in key_names:
            obj = raw.get(key)
            if isinstance(obj, dict) and obj:
                score = _side_score(obj)
                chain = _side_chain(obj)

                if not score:
                    for sk in score_keys:
                        score = _to_int(raw.get(sk), score)
                        if score:
                            break

                if not chain:
                    for ck in chain_keys:
                        chain = _to_int(raw.get(ck), chain)
                        if chain:
                            break

                return {
                    "faction_id": str(obj.get("id") or obj.get("faction_id") or obj.get("ID") or "").strip(),
                    "faction_name": str(obj.get("name") or obj.get("faction_name") or "").strip(),
                    "score": score,
                    "chain": chain,
                    "raw": obj,
                }

        nested_war = raw.get("war") if isinstance(raw.get("war"), dict) else {}
        for key in key_names:
            obj = nested_war.get(key)
            if isinstance(obj, dict) and obj:
                return {
                    "faction_id": str(obj.get("id") or obj.get("faction_id") or obj.get("ID") or "").strip(),
                    "faction_name": str(obj.get("name") or obj.get("faction_name") or "").strip(),
                    "score": _side_score(obj),
                    "chain": _side_chain(obj),
                    "raw": obj,
                }

        out = {
            "faction_id": "",
            "faction_name": "",
            "score": 0,
            "chain": 0,
            "raw": {},
        }

        all_id_keys = list(id_keys)
        all_name_keys = list(name_keys)
        all_score_keys = list(score_keys)
        all_chain_keys = list(chain_keys)

        for key in all_id_keys:
            val = raw.get(key)
            if val not in (None, ""):
                out["faction_id"] = str(val).strip()
                break

        if not out["faction_id"]:
            for key in all_id_keys:
                val = nested_war.get(key)
                if val not in (None, ""):
                    out["faction_id"] = str(val).strip()
                    break

        for key in all_name_keys:
            val = raw.get(key)
            if val not in (None, ""):
                out["faction_name"] = str(val).strip()
                break

        if not out["faction_name"]:
            for key in all_name_keys:
                val = nested_war.get(key)
                if val not in (None, ""):
                    out["faction_name"] = str(val).strip()
                    break

        for key in all_score_keys:
            out["score"] = _to_int(raw.get(key), out["score"])
            if out["score"]:
                break

        if not out["score"]:
            for key in all_score_keys:
                out["score"] = _to_int(nested_war.get(key), out["score"])
                if out["score"]:
                    break

        for key in all_chain_keys:
            out["chain"] = _to_int(raw.get(key), out["chain"])
            if out["chain"]:
                break

        if not out["chain"]:
            for key in all_chain_keys:
                out["chain"] = _to_int(nested_war.get(key), out["chain"])
                if out["chain"]:
                    break

        return out

    def _raw_factions_map_sides(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []

        for fmap in [
            raw.get("factions"),
            (raw.get("war") or {}).get("factions") if isinstance(raw.get("war"), dict) else {},
        ]:
            if not isinstance(fmap, dict):
                continue

            for fid, obj in fmap.items():
                if not isinstance(obj, dict):
                    continue

                side = {
                    "faction_id": str(obj.get("id") or obj.get("faction_id") or fid or "").strip(),
                    "faction_name": str(obj.get("name") or obj.get("faction_name") or "").strip(),
                    "score": _side_score(obj),
                    "chain": _side_chain(obj),
                    "raw": obj,
                }

                duplicate = False
                for existing in out:
                    if _same_side(existing, side):
                        duplicate = True
                        if _side_score(side) > _side_score(existing):
                            existing["score"] = _side_score(side)
                        if _side_chain(side) > _side_chain(existing):
                            existing["chain"] = _side_chain(side)
                        if side.get("faction_id") and not existing.get("faction_id"):
                            existing["faction_id"] = side.get("faction_id")
                        if side.get("faction_name") and not existing.get("faction_name"):
                            existing["faction_name"] = side.get("faction_name")
                        break

                if not duplicate:
                    out.append(side)

        return out

    def _find_pairing_side(raw: Dict[str, Any], parsed_factions: List[Dict[str, Any]]):
        attacker = _raw_side(
            raw,
            ["attacker", "attackers", "faction1", "faction_1", "team1", "team_1", "side1", "side_1", "red"],
            ["attacker_id", "attacking_faction"],
            ["attacker_name", "attacking_faction_name"],
            ["attacker_score"],
            ["attacker_chain"],
        )
        defender = _raw_side(
            raw,
            ["defender", "defenders", "faction2", "faction_2", "team2", "team_2", "side2", "side_2", "blue"],
            ["defender_id", "defending_faction"],
            ["defender_name", "defending_faction_name"],
            ["defender_score"],
            ["defender_chain"],
        )

        raw_map_sides = _raw_factions_map_sides(raw)

        if (not attacker.get("faction_id") and not attacker.get("faction_name")) and raw_map_sides:
            attacker = dict(raw_map_sides[0])

        if (not defender.get("faction_id") and not defender.get("faction_name")) and len(raw_map_sides) > 1:
            defender = dict(raw_map_sides[1])

        if not attacker.get("faction_id") and not attacker.get("faction_name") and len(parsed_factions) > 0:
            attacker = dict(parsed_factions[0])

        if not defender.get("faction_id") and not defender.get("faction_name") and len(parsed_factions) > 1:
            defender = dict(parsed_factions[1])

        return attacker, defender, raw_map_sides

    def _war_has_my_faction(war: Dict[str, Any]) -> bool:
        factions = [x for x in (war.get("factions") or []) if isinstance(x, dict)]
        raw_local = war.get("raw") or {}

        for faction in factions:
            if _is_me(faction):
                return True

        attacker, defender, raw_map = _find_pairing_side(raw_local, factions)

        for side in [attacker, defender] + raw_map:
            if _is_me(side):
                return True

        return False

    def _war_priority(war: Dict[str, Any]) -> tuple:
        phase = str(war.get("phase") or "").lower()
        raw_local = war.get("raw") or {}
        raw_war_local = raw_local.get("war") if isinstance(raw_local.get("war"), dict) else {}
        winner = raw_war_local.get("winner") or raw_local.get("winner")
        start_ts = _to_int(war.get("start"), 0)
        end_ts = _to_int(war.get("end"), 0)

        if winner:
            phase_rank = 3
        elif phase == "active":
            phase_rank = 0
        elif phase == "registered":
            phase_rank = 1
        else:
            phase_rank = 2

        return (
            0 if _war_has_my_faction(war) else 1,
            phase_rank,
            -start_ts,
            -end_ts,
            str(war.get("war_id") or ""),
        )

    chosen_war = sorted(wars, key=_war_priority)[0]
    factions = [x for x in (chosen_war.get("factions") or []) if isinstance(x, dict)]
    raw = chosen_war.get("raw") or {}
    raw_war = raw.get("war") if isinstance(raw.get("war"), dict) else {}

    attacker_side, defender_side, raw_map_sides = _find_pairing_side(raw, factions)

    candidate_sides: List[Dict[str, Any]] = []
    for side in [attacker_side, defender_side] + raw_map_sides + factions:
        if not isinstance(side, dict):
            continue

        sid = _fid(side)
        sname = _fname_lower(side)

        duplicate = False
        for existing in candidate_sides:
            if _same_side(existing, side):
                duplicate = True
                if _side_score(side) > _side_score(existing):
                    existing["score"] = _side_score(side)
                if _side_chain(side) > _side_chain(existing):
                    existing["chain"] = _side_chain(side)
                if sid and not _fid(existing):
                    existing["faction_id"] = sid
                if sname and not _fname_lower(existing):
                    existing["faction_name"] = _fname(side)
                existing_raw = existing.get("raw") or {}
                merged_raw = dict(existing_raw) if isinstance(existing_raw, dict) else {}
                side_raw = side.get("raw") or {}
                if isinstance(side_raw, dict):
                    merged_raw.update(side_raw)
                existing["raw"] = merged_raw
                break

        if not duplicate and (sid or sname):
            candidate_sides.append(dict(side))

    def _pick_best_my_side(candidates: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        matches = [x for x in candidates if _is_me(x)]
        if not matches:
            return None
        matches.sort(
            key=lambda x: (
                0 if _fid(x) == resolved_my_faction_id and resolved_my_faction_id else 1,
                0 if _fname_lower(x) == my_name_lower and my_name_lower else 1,
                -_side_score(x),
                -_side_chain(x),
            )
        )
        return matches[0]

    def _pick_best_enemy_side(candidates: List[Dict[str, Any]], my_side_local: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        enemy_candidates: List[Dict[str, Any]] = []

        for side in candidates:
            if not isinstance(side, dict):
                continue
            if _is_me(side):
                continue
            if my_side_local and _same_side(side, my_side_local):
                continue
            if _fid(side) or _fname(side):
                enemy_candidates.append(side)

        if not enemy_candidates:
            return None

        def _enemy_rank(side: Dict[str, Any]) -> tuple:
            sid = _fid(side)
            sname = _fname_lower(side)
            return (
                0 if sid else 1,
                0 if sname else 1,
                -_side_score(side),
                -_side_chain(side),
                sname,
                sid,
            )

        enemy_candidates.sort(key=_enemy_rank)
        return enemy_candidates[0]

    my_side = _pick_best_my_side(candidate_sides)
    enemy_side = _pick_best_enemy_side(candidate_sides, my_side)

    if not enemy_side and my_side and len(candidate_sides) == 2:
        other = [x for x in candidate_sides if not _same_side(x, my_side)]
        if other:
            enemy_side = other[0]

    if not my_side and resolved_my_faction_id:
        my_side = {
            "faction_id": resolved_my_faction_id,
            "faction_name": resolved_my_faction_name,
            "score": 0,
            "chain": 0,
            "raw": {},
        }

    my_id = str((my_side or {}).get("faction_id") or resolved_my_faction_id or "").strip()
    my_name = str((my_side or {}).get("faction_name") or resolved_my_faction_name or "").strip()
    enemy_id = str((enemy_side or {}).get("faction_id") or "").strip()
    enemy_name = str((enemy_side or {}).get("faction_name") or "").strip()

    score_us = _side_score(my_side or {})
    score_them = _side_score(enemy_side or {})
    chain_us = _side_chain(my_side or {})
    chain_them = _side_chain(enemy_side or {})

    if my_side is None and len(candidate_sides) == 2 and enemy_side:
        for side in candidate_sides:
            if not _same_side(side, enemy_side):
                my_side = side
                my_id = str(side.get("faction_id") or my_id or "").strip()
                my_name = str(side.get("faction_name") or my_name or "").strip()
                score_us = _side_score(side)
                chain_us = _side_chain(side)
                break

    if my_side and ((not enemy_id and not enemy_name) or (enemy_id and my_id and enemy_id == my_id)):
        other_sides = [x for x in candidate_sides if not _same_side(x, my_side)]
        if other_sides:
            fallback_enemy = other_sides[0]
            fallback_enemy_id = str(fallback_enemy.get("faction_id") or "").strip()
            fallback_enemy_name = str(fallback_enemy.get("faction_name") or "").strip()
            if fallback_enemy_id and not enemy_id:
                enemy_id = fallback_enemy_id
            if fallback_enemy_name and not enemy_name:
                enemy_name = fallback_enemy_name

    if enemy_id and my_id and enemy_id == my_id:
        enemy_id = ""
        if enemy_name and my_name and enemy_name.lower() == my_name.lower():
            enemy_name = ""

    if enemy_name and my_name and enemy_name.lower() == my_name.lower() and not enemy_id:
        keep_name = False
        if my_side:
            for side in candidate_sides:
                if _same_side(side, my_side):
                    continue
                if _fname(side) and _fname_lower(side) == enemy_name.lower():
                    keep_name = True
                    break
        if not keep_name:
            enemy_name = ""

    if not my_id:
        my_id = resolved_my_faction_id
    if not my_name:
        my_name = resolved_my_faction_name

    lead = score_us - score_them
    target_score = _to_int(chosen_war.get("target_score"), 0)
    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    winner = raw_war.get("winner") or raw.get("winner")
    phase = str(chosen_war.get("phase") or "").lower()
    if winner:
        phase = "finished"
    elif phase not in {"active", "registered"}:
        phase = "registered" if (enemy_id or enemy_name) else "none"

    is_active = phase == "active"
    is_registered = phase in {"registered", "active"}

    enemy_members: List[Dict[str, Any]] = []
    debug_enemy_fetch = {
        "enemy_id": enemy_id,
        "enemy_name": enemy_name,
        "enemy_fetch_ok": False,
        "enemy_fetch_member_count": 0,
        "enemy_fetch_error": "",
        "enemy_fetch_faction_id": "",
        "enemy_fetch_faction_name": "",
    }

    if not enemy_id and my_side and len(candidate_sides) == 2:
        other_sides = [x for x in candidate_sides if not _same_side(x, my_side)]
        if other_sides:
            fallback_enemy = other_sides[0]
            fallback_enemy_id = str(fallback_enemy.get("faction_id") or "").strip()
            fallback_enemy_name = str(fallback_enemy.get("faction_name") or "").strip()
            if fallback_enemy_id:
                enemy_id = fallback_enemy_id
            if fallback_enemy_name and not enemy_name:
                enemy_name = fallback_enemy_name
            debug_enemy_fetch["enemy_id"] = enemy_id
            debug_enemy_fetch["enemy_name"] = enemy_name

    if not enemy_id or (my_id and enemy_id == my_id):
        enemy_id = ""
        enemy_name = ""
        enemy_members = []
        debug_enemy_fetch["enemy_id"] = enemy_id
        debug_enemy_fetch["enemy_name"] = enemy_name
        debug_enemy_fetch["enemy_fetch_error"] = "Enemy faction not resolved or matched own faction."
    elif is_registered:
        enemy_faction = faction_basic(api_key, faction_id=enemy_id)
        debug_enemy_fetch["enemy_fetch_ok"] = bool(enemy_faction.get("ok"))
        debug_enemy_fetch["enemy_fetch_error"] = str(enemy_faction.get("error") or "")
        debug_enemy_fetch["enemy_fetch_member_count"] = len(enemy_faction.get("members") or [])
        debug_enemy_fetch["enemy_fetch_faction_id"] = str(enemy_faction.get("faction_id") or "")
        debug_enemy_fetch["enemy_fetch_faction_name"] = str(enemy_faction.get("faction_name") or "")

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
        else:
            enemy_members = []

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

    selections = "bars,profile,personalstats"
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

        return {
            "ok": True,
            "user_id": resolved_user_id,
            "name": str(data.get("name") or ""),
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
        "bars": {},
        "states": {},
        "status": {},
    }
