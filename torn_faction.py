from typing import Any, Dict, List

from torn_shared import (
    API_BASE,
    CACHE_TTL_FACTION_BASIC,
    safe_get,
)
from torn_status import normalize_member


def faction_basic(api_key: str, faction_id: str = "") -> Dict[str, Any]:
    """
    Strict faction-only loader.

    Rules:
    - Only uses faction endpoints.
    - Only returns members for the requested faction (or self faction if no faction_id given).
    - No enemy fallback.
    - No war fallback.
    - No mixed-source recovery.
    """

    api_key = str(api_key or "").strip()
    requested_faction_id = str(faction_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "faction_id": requested_faction_id,
            "faction_name": "",
            "members": [],
            "error": "Missing API key.",
            "debug_attempts": [],
        }

    # One primary attempt, one fallback only.
    attempts = []

    if requested_faction_id:
        attempts.append((
            f"{API_BASE}/v2/faction/{requested_faction_id}/members",
            {"key": api_key, "striptags": "true"},
            "v2_faction_members_direct",
        ))
        attempts.append((
            f"{API_BASE}/faction/{requested_faction_id}",
            {"selections": "basic,members", "key": api_key, "striptags": "true"},
            "faction_basic_members_direct_fallback",
        ))
    else:
        attempts.append((
            f"{API_BASE}/faction/",
            {"selections": "basic,members", "key": api_key, "striptags": "true"},
            "faction_self",
        ))

    def _extract_root(payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        if isinstance(payload.get("faction"), dict):
            return payload["faction"]
        return payload

    def _extract_members(payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return []

        raw_members = payload.get("members")
        if not isinstance(raw_members, dict):
            return []

        out: List[Dict[str, Any]] = []
        for uid, member in raw_members.items():
            if not isinstance(member, dict):
                continue
            out.append(normalize_member(uid, member))
        return out

    debug_attempts: List[Dict[str, Any]] = []
    last_error = "Could not load faction."

    for url, params, prefix in attempts:
        res = safe_get(
            url,
            params,
            cache_seconds=CACHE_TTL_FACTION_BASIC,
            cache_prefix=prefix,
        )

        if not res.get("ok"):
            last_error = str(res.get("error") or last_error)
            debug_attempts.append({
                "source": prefix,
                "ok": False,
                "error": last_error,
            })
            continue

        payload = res.get("data") or {}
        root = _extract_root(payload)
        members = _extract_members(payload)

        resolved_faction_id = str(
            root.get("ID")
            or root.get("id")
            or root.get("faction_id")
            or ""
        ).strip()

        resolved_faction_name = str(
            root.get("name")
            or root.get("faction_name")
            or ""
        ).strip()

        debug_attempts.append({
            "source": prefix,
            "ok": True,
            "faction_id": resolved_faction_id,
            "faction_name": resolved_faction_name,
            "member_count": len(members),
        })

        # Strict identity check when a faction_id was explicitly requested.
        if requested_faction_id and resolved_faction_id and resolved_faction_id != requested_faction_id:
            last_error = (
                f"Faction mismatch: requested {requested_faction_id}, got {resolved_faction_id}."
            )
            continue

        if not members:
            last_error = "Faction returned no members."
            continue

        return {
            "ok": True,
            "faction_id": resolved_faction_id or requested_faction_id,
            "faction_name": resolved_faction_name,
            "members": members,
            "error": "",
            "source": prefix,
            "params": {k: v for k, v in params.items() if k != "key"},
            "debug_attempts": debug_attempts,
        }

    return {
        "ok": False,
        "faction_id": requested_faction_id,
        "faction_name": "",
        "members": [],
        "error": last_error,
        "debug_attempts": debug_attempts,
    }
