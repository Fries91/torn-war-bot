import time
from typing import Any, Dict, List

from torn_shared import (
    API_BASE,
    CACHE_TTL_WAR_SUMMARY,
    as_dict,
    as_list,
    safe_get,
    stringify_lower,
    to_int,
)


def extract_nested_int(node: Dict[str, Any], keys: List[str], default: int = 0) -> int:
    for key in keys:
        value = node.get(key)
        if value not in (None, ""):
            return to_int(value, default)
    return default


def extract_side_score(side: Dict[str, Any]) -> int:
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


def extract_side_chain(side: Dict[str, Any]) -> int:
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


def extract_side_id(side: Dict[str, Any], fallback_key: str = "") -> str:
    candidates = [
        side.get("faction_id"),
        side.get("ID"),
        side.get("id"),
        side.get("factionID"),
        as_dict(side.get("faction")).get("faction_id"),
        as_dict(side.get("faction")).get("ID"),
        as_dict(side.get("faction")).get("id"),
        fallback_key,
    ]
    for value in candidates:
        s = str(value or "").strip()
        if s:
            return s
    return ""


def extract_side_name(side: Dict[str, Any]) -> str:
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


def candidate_war_nodes(payload: Any) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []

    def walk(node: Any):
        if isinstance(node, dict):
            if any(k in node for k in ["war", "war_id", "warID", "rankedwarid", "factions", "teams", "phase", "war_type"]):
                found.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(payload)
    return found


def parse_war_factions(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    possible_roots = [
        node.get("factions"),
        node.get("teams"),
        as_dict(node.get("war")).get("factions"),
        as_dict(node.get("war")).get("teams"),
    ]

    out: List[Dict[str, Any]] = []

    for raw in possible_roots:
        if isinstance(raw, dict):
            for key, value in raw.items():
                if isinstance(value, dict):
                    out.append({
                        "faction_id": extract_side_id(value, fallback_key=key),
                        "name": extract_side_name(value),
                        "score": extract_side_score(value),
                        "chain": extract_side_chain(value),
                        "raw": value,
                    })
            if out:
                return out

        if isinstance(raw, list):
            for value in raw:
                if isinstance(value, dict):
                    out.append({
                        "faction_id": extract_side_id(value),
                        "name": extract_side_name(value),
                        "score": extract_side_score(value),
                        "chain": extract_side_chain(value),
                        "raw": value,
                    })
            if out:
                return out

    return out


def extract_node_phase(node: Dict[str, Any]) -> str:
    war_node = as_dict(node.get("war"))
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


def extract_node_war_type(node: Dict[str, Any]) -> str:
    war_node = as_dict(node.get("war"))
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


def extract_node_war_id(node: Dict[str, Any]) -> str:
    war_node = as_dict(node.get("war"))
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


def extract_node_target_score(node: Dict[str, Any]) -> int:
    war_node = as_dict(node.get("war"))
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
            return to_int(value, 0)
    return 0


def is_current_ranked_war(node: Dict[str, Any], my_faction_id: str = "", my_faction_name: str = "") -> bool:
    phase = extract_node_phase(node)
    war_type = extract_node_war_type(node)
    text = f"{phase} {war_type}".lower()

    factions = parse_war_factions(node)

    if my_faction_id and factions and not any(str(x.get("faction_id") or "") == my_faction_id for x in factions):
        return False
    if my_faction_name and factions and not any(stringify_lower(x.get("name")) == stringify_lower(my_faction_name) for x in factions):
        return False

    if any(flag in text for flag in ["ranked", "active", "attacking", "defending", "ongoing", "confirmed", "register", "registered", "prewar", "matchup"]):
        return True

    start = to_int(node.get("start") or node.get("start_timestamp") or node.get("starts"), 0)
    end = to_int(node.get("end") or node.get("end_timestamp") or node.get("ends"), 0)
    war_node = as_dict(node.get("war"))
    if not start:
        start = to_int(war_node.get("start") or war_node.get("start_timestamp") or war_node.get("starts"), 0)
    if not end:
        end = to_int(war_node.get("end") or war_node.get("end_timestamp") or war_node.get("ends"), 0)

    now_ts = int(time.time())
    if start and start <= now_ts and (not end or end > now_ts):
        return True

    if len(factions) >= 2 and (my_faction_id or my_faction_name):
        return True

    return False


def build_ranked_war_response(node: Dict[str, Any], source_note: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    factions = parse_war_factions(node)
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
            (x for x in factions if stringify_lower(x.get("name")) == stringify_lower(my_faction_name)),
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
            if my_side_name and candidate_name and stringify_lower(candidate_name) == stringify_lower(my_side_name):
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
        elif first_name and second_name and stringify_lower(first_name) != stringify_lower(second_name):
            my_side = first
            enemy_side = second

    phase = extract_node_phase(node)
    war_type = extract_node_war_type(node) or ("rankedwars" if "ranked" in source_note.lower() else "")
    war_id = extract_node_war_id(node)
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

    if resolved_my_faction_name and resolved_enemy_faction_name and stringify_lower(resolved_my_faction_name) == stringify_lower(resolved_enemy_faction_name):
        resolved_enemy_faction_id = ""
        resolved_enemy_faction_name = ""
        enemy_side = None

    return {
        "has_war": bool(factions or node),
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
        "target_score": extract_node_target_score(node),
        "source_note": source_note,
        "debug_factions": [{k: v for k, v in x.items() if k != "raw"} for x in factions],
        "debug_raw_keys": sorted(list(node.keys())),
        "debug_raw": node,
    }


def war_quality_score(war: Dict[str, Any], my_faction_id: str = "", my_faction_name: str = "") -> int:
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
    if my_faction_name and stringify_lower(war.get("my_faction_name")) == stringify_lower(my_faction_name):
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
        res = safe_get(url, params, cache_seconds=CACHE_TTL_WAR_SUMMARY, cache_prefix=prefix)
        if not res.get("ok"):
            best_error = str(res.get("error") or best_error)
            continue

        payload = res.get("data") or {}
        nodes = candidate_war_nodes(payload)
        if not nodes and isinstance(payload, dict):
            nodes = [payload]

        for node in nodes:
            if not isinstance(node, dict):
                continue
            if not is_current_ranked_war(node, my_faction_id=my_faction_id, my_faction_name=my_faction_name):
                continue

            built = build_ranked_war_response(
                node,
                source_note=f"Loaded from {prefix}.",
                my_faction_id=my_faction_id,
                my_faction_name=my_faction_name,
            )

            quality = war_quality_score(built, my_faction_id=my_faction_id, my_faction_name=my_faction_name)

            if quality > best_score:
                best_score = quality
                best_match = built

            if built.get("enemy_faction_id") and (built.get("registered") or built.get("active") or built.get("war_id")):
                return built

    if best_match:
        return best_match

    base["source_note"] = best_error or base["source_note"]
    return base
