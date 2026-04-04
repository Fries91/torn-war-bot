import time
from typing import Any, Dict, List, Optional

from torn_shared import (
    API_BASE,
    CACHE_TTL_WAR_SUMMARY,
    as_dict,
    safe_get,
    stringify_lower,
    to_int,
)


def _extract_side_id(side: Dict[str, Any]) -> str:
    candidates = [
        side.get("faction_id"),
        side.get("ID"),
        side.get("id"),
        side.get("factionID"),
        as_dict(side.get("faction")).get("faction_id"),
        as_dict(side.get("faction")).get("ID"),
        as_dict(side.get("faction")).get("id"),
    ]
    for value in candidates:
        s = str(value or "").strip()
        if s:
            return s
    return ""


def _extract_side_name(side: Dict[str, Any]) -> str:
    candidates = [
        side.get("name"),
        side.get("faction_name"),
        side.get("factionName"),
        as_dict(side.get("faction")).get("name"),
        as_dict(side.get("faction")).get("faction_name"),
    ]
    for value in candidates:
        s = str(value or "").strip()
        if s:
            return s
    return ""


def _extract_side_score(side: Dict[str, Any]) -> int:
    candidates = [
        side.get("score"),
        side.get("points"),
        side.get("war_score"),
        as_dict(side.get("stats")).get("score"),
        as_dict(side.get("war")).get("score"),
    ]
    for value in candidates:
        if value not in (None, ""):
            return to_int(value, 0)
    return 0


def _extract_side_chain(side: Dict[str, Any]) -> int:
    candidates = [
        side.get("chain"),
        side.get("best_chain"),
        side.get("current_chain"),
        as_dict(side.get("stats")).get("chain"),
        as_dict(side.get("war")).get("chain"),
    ]
    for value in candidates:
        if value not in (None, ""):
            return to_int(value, 0)
    return 0


def _extract_phase(payload: Dict[str, Any]) -> str:
    war_node = as_dict(payload.get("war"))
    candidates = [
        payload.get("phase"),
        payload.get("state"),
        payload.get("status"),
        payload.get("war_status"),
        war_node.get("phase"),
        war_node.get("state"),
        war_node.get("status"),
    ]
    for value in candidates:
        s = str(value or "").strip().lower()
        if s:
            return s
    return "none"


def _extract_war_type(payload: Dict[str, Any]) -> str:
    war_node = as_dict(payload.get("war"))
    candidates = [
        payload.get("war_type"),
        payload.get("type"),
        payload.get("mode"),
        war_node.get("war_type"),
        war_node.get("type"),
        war_node.get("mode"),
    ]
    for value in candidates:
        s = str(value or "").strip().lower()
        if s:
            return s
    return ""


def _extract_war_id(payload: Dict[str, Any]) -> str:
    war_node = as_dict(payload.get("war"))
    candidates = [
        payload.get("war_id"),
        payload.get("warID"),
        payload.get("rankedwarid"),
        payload.get("id"),
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


def _extract_target_score(payload: Dict[str, Any]) -> int:
    war_node = as_dict(payload.get("war"))
    candidates = [
        payload.get("target"),
        payload.get("target_score"),
        payload.get("score_target"),
        war_node.get("target"),
        war_node.get("target_score"),
        war_node.get("score_target"),
    ]
    for value in candidates:
        if value not in (None, ""):
            return to_int(value, 0)
    return 0


def _extract_factions(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    roots = [
        payload.get("factions"),
        payload.get("teams"),
        as_dict(payload.get("war")).get("factions"),
        as_dict(payload.get("war")).get("teams"),
    ]

    for raw in roots:
        out: List[Dict[str, Any]] = []

        if isinstance(raw, dict):
            for fallback_key, value in raw.items():
                if not isinstance(value, dict):
                    continue
                out.append({
                    "faction_id": _extract_side_id(value) or str(fallback_key or "").strip(),
                    "name": _extract_side_name(value),
                    "score": _extract_side_score(value),
                    "chain": _extract_side_chain(value),
                })
            if out:
                return out

        if isinstance(raw, list):
            for value in raw:
                if not isinstance(value, dict):
                    continue
                out.append({
                    "faction_id": _extract_side_id(value),
                    "name": _extract_side_name(value),
                    "score": _extract_side_score(value),
                    "chain": _extract_side_chain(value),
                })
            if out:
                return out

    return []


def _extract_ranked_war_payload(payload: Any) -> Optional[Dict[str, Any]]:
    """
    Strict extractor:
    - accepts the payload itself if it contains war/faction structure
    - accepts one nested 'war' dict if that dict contains faction structure
    - accepts one item from 'rankedwars' if present
    No recursive deep crawling.
    """
    if not isinstance(payload, dict):
        return None

    if any(k in payload for k in ("factions", "teams", "war", "phase", "war_id", "rankedwarid")):
        return payload

    rankedwars = payload.get("rankedwars")
    if isinstance(rankedwars, dict):
        for _, node in rankedwars.items():
            if isinstance(node, dict):
                return node

    if isinstance(rankedwars, list):
        for node in rankedwars:
            if isinstance(node, dict):
                return node

    return None


def _build_response(
    payload: Dict[str, Any],
    source_note: str,
    my_faction_id: str = "",
    my_faction_name: str = "",
) -> Dict[str, Any]:
    factions = _extract_factions(payload)
    phase = _extract_phase(payload)
    war_type = _extract_war_type(payload)
    war_id = _extract_war_id(payload)

    my_faction_id = str(my_faction_id or "").strip()
    my_faction_name = str(my_faction_name or "").strip()

    my_side = None
    for side in factions:
        side_id = str(side.get("faction_id") or "").strip()
        side_name = str(side.get("name") or "").strip()

        if my_faction_id and side_id == my_faction_id:
            my_side = side
            break
        if my_faction_name and stringify_lower(side_name) == stringify_lower(my_faction_name):
            my_side = side
            break

    enemy_side = None
    if my_side is not None:
        my_side_id = str(my_side.get("faction_id") or "").strip()
        my_side_name = str(my_side.get("name") or "").strip()

        for side in factions:
            side_id = str(side.get("faction_id") or "").strip()
            side_name = str(side.get("name") or "").strip()

            if my_side_id and side_id and side_id == my_side_id:
                continue
            if my_side_name and side_name and stringify_lower(side_name) == stringify_lower(my_side_name):
                continue

            enemy_side = side
            break

    active = phase in {"active", "ongoing", "attacking", "defending"}
    registered = phase in {"registered", "registering", "confirmed", "prewar", "matchup"}

    start_ts = to_int(
        payload.get("start")
        or payload.get("start_timestamp")
        or as_dict(payload.get("war")).get("start")
        or as_dict(payload.get("war")).get("start_timestamp"),
        0,
    )
    end_ts = to_int(
        payload.get("end")
        or payload.get("end_timestamp")
        or as_dict(payload.get("war")).get("end")
        or as_dict(payload.get("war")).get("end_timestamp"),
        0,
    )

    now_ts = int(time.time())
    if not active and start_ts and start_ts <= now_ts and (not end_ts or end_ts > now_ts):
        active = True

    resolved_my_faction_id = str((my_side or {}).get("faction_id") or my_faction_id or "").strip()
    resolved_my_faction_name = str((my_side or {}).get("name") or my_faction_name or "").strip()
    resolved_enemy_faction_id = str((enemy_side or {}).get("faction_id") or "").strip()
    resolved_enemy_faction_name = str((enemy_side or {}).get("name") or "").strip()

    if resolved_my_faction_id and resolved_enemy_faction_id and resolved_my_faction_id == resolved_enemy_faction_id:
        resolved_enemy_faction_id = ""
        resolved_enemy_faction_name = ""

    if (
        resolved_my_faction_name
        and resolved_enemy_faction_name
        and stringify_lower(resolved_my_faction_name) == stringify_lower(resolved_enemy_faction_name)
    ):
        resolved_enemy_faction_id = ""
        resolved_enemy_faction_name = ""

    return {
        "has_war": bool(war_id or factions),
        "active": bool(active),
        "registered": bool(registered),
        "phase": phase or "none",
        "war_id": war_id,
        "war_type": war_type,
        "my_faction_id": resolved_my_faction_id,
        "my_faction_name": resolved_my_faction_name,
        "enemy_faction_id": resolved_enemy_faction_id,
        "enemy_faction_name": resolved_enemy_faction_name,
        "enemy_members": [],
        "score_us": to_int((my_side or {}).get("score"), 0),
        "score_them": to_int((enemy_side or {}).get("score"), 0),
        "chain_us": to_int((my_side or {}).get("chain"), 0),
        "chain_them": to_int((enemy_side or {}).get("chain"), 0),
        "target_score": _extract_target_score(payload),
        "source_note": source_note,
        "debug_factions": factions,
        "debug_raw_keys": sorted(list(payload.keys())),
        "debug_raw": payload,
    }


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
        attempts.append((
            f"{API_BASE}/v2/faction/{my_faction_id}/rankedwars",
            {"key": api_key, "striptags": "true"},
            "v2_faction_rankedwars_direct",
        ))
        attempts.append((
            f"{API_BASE}/faction/{my_faction_id}",
            {"selections": "rankedwars", "key": api_key, "striptags": "true"},
            "v1_faction_rankedwars_direct_fallback",
        ))

    attempts.append((
        f"{API_BASE}/faction/",
        {"selections": "rankedwars", "key": api_key, "striptags": "true"},
        "v1_faction_rankedwars_self",
    ))

    last_error = "Could not load ranked wars."

    for url, params, prefix in attempts:
        res = safe_get(
            url,
            params,
            cache_seconds=CACHE_TTL_WAR_SUMMARY,
            cache_prefix=prefix,
        )

        if not res.get("ok"):
            last_error = str(res.get("error") or last_error)
            continue

        payload = res.get("data") or {}
        war_payload = _extract_ranked_war_payload(payload)
        if not war_payload:
            last_error = "Ranked war payload not found."
            continue

        built = _build_response(
            war_payload,
            source_note=f"Loaded from {prefix}.",
            my_faction_id=my_faction_id,
            my_faction_name=my_faction_name,
        )

        # Strict validation: if we know our faction, the returned war must include it.
        if my_faction_id and built.get("my_faction_id") and str(built.get("my_faction_id")) != my_faction_id:
            last_error = (
                f"War mismatch: requested faction {my_faction_id}, got {built.get('my_faction_id')}."
            )
            continue

        if my_faction_name and built.get("my_faction_name"):
            if stringify_lower(built.get("my_faction_name")) != stringify_lower(my_faction_name):
                last_error = (
                    f"War mismatch: requested faction name {my_faction_name}, got {built.get('my_faction_name')}."
                )
                continue

        return built

    base["source_note"] = last_error or base["source_note"]
    return base
