from typing import Any, Dict, List

from torn_shared import (
    API_BASE,
    CACHE_TTL_FACTION_BASIC,
    safe_get,
)
from torn_status import normalize_member


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
        ])
    else:
        attempts.append((
            f"{API_BASE}/faction/",
            {"selections": "basic,members", "key": api_key, "striptags": "true"},
            "faction_self",
        ))

    def extract_root(payload: Any) -> Dict[str, Any]:
        if isinstance(payload, dict):
            for key in ("faction", "data"):
                node = payload.get(key)
                if isinstance(node, dict) and node:
                    return node
            return payload
        return {}

    def extract_members(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, dict):
            for key in ("members", "member", "data"):
                node = payload.get(key)

                if isinstance(node, dict):
                    return [
                        normalize_member(uid, member)
                        for uid, member in node.items()
                        if isinstance(member, dict)
                    ]

                if isinstance(node, list):
                    out: List[Dict[str, Any]] = []
                    for idx, member in enumerate(node):
                        if isinstance(member, dict):
                            out.append(
                                normalize_member(
                                    member.get("user_id")
                                    or member.get("player_id")
                                    or member.get("id")
                                    or str(idx),
                                    member,
                                )
                            )
                    return out

        return []

    best = None
    best_error = "Could not load faction."
    debug_attempts = []

    for url, params, prefix in attempts:
        res = safe_get(
            url,
            params,
            cache_seconds=CACHE_TTL_FACTION_BASIC,
            cache_prefix=prefix,
        )

        if not res.get("ok"):
            best_error = str(res.get("error") or best_error)
            debug_attempts.append({
                "source": prefix,
                "ok": False,
                "error": best_error,
            })
            continue

        payload = res.get("data") or {}
        root = extract_root(payload)
        members = extract_members(payload)

        resolved_faction_id = str(
            root.get("ID")
            or root.get("id")
            or root.get("faction_id")
            or root.get("factionID")
            or faction_id
            or ""
        ).strip()

        resolved_faction_name = str(
            root.get("name")
            or root.get("faction_name")
            or root.get("factionName")
            or ""
        ).strip()

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
