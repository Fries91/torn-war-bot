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
    - For the logged-in user's own faction, use /faction/ with the user's key.
    - Validate returned faction_id against requested faction_id when provided.
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

    url = f"{API_BASE}/faction/"
    params = {"selections": "basic,members", "key": api_key, "striptags": "true"}
    source = "faction_self_members_direct"

    def _extract_root(payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        if isinstance(payload.get("faction"), dict):
            return payload["faction"]
        return payload

    def _extract_raw_members(payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        if isinstance(payload.get("members"), dict):
            return payload.get("members") or {}
        faction_root = payload.get("faction")
        if isinstance(faction_root, dict) and isinstance(faction_root.get("members"), dict):
            return faction_root.get("members") or {}
        return {}

    def _extract_members(payload: Any) -> List[Dict[str, Any]]:
        raw_members = _extract_raw_members(payload)
        out: List[Dict[str, Any]] = []
        for uid, member in raw_members.items():
            if not isinstance(member, dict):
                continue
            out.append(normalize_member(uid, member))
        return out

    res = safe_get(url, params, cache_seconds=CACHE_TTL_FACTION_BASIC, cache_prefix=source)
    if not res.get("ok"):
        last_error = str(res.get("error") or "Could not load faction.")
        return {
            "ok": False,
            "faction_id": requested_faction_id,
            "faction_name": "",
            "members": [],
            "error": last_error,
            "debug_attempts": [{"source": source, "ok": False, "error": last_error}],
        }

    payload = res.get("data") or {}
    root = _extract_root(payload)
    members = _extract_members(payload)
    resolved_faction_id = str(root.get("ID") or root.get("id") or root.get("faction_id") or "").strip()
    resolved_faction_name = str(root.get("name") or root.get("faction_name") or "").strip()

    debug_attempts = [{
        "source": source,
        "ok": True,
        "requested_faction_id": requested_faction_id,
        "resolved_faction_id": resolved_faction_id,
        "faction_name": resolved_faction_name,
        "member_count": len(members),
        "payload_keys": sorted(list(payload.keys())) if isinstance(payload, dict) else [],
    }]

    if requested_faction_id and resolved_faction_id and resolved_faction_id != requested_faction_id:
        return {
            "ok": False,
            "faction_id": requested_faction_id,
            "faction_name": "",
            "members": [],
            "error": f"Faction mismatch: requested {requested_faction_id}, got {resolved_faction_id}.",
            "debug_attempts": debug_attempts,
        }

    return {
        "ok": True,
        "faction_id": resolved_faction_id or requested_faction_id,
        "faction_name": resolved_faction_name,
        "members": members,
        "error": "" if members else "Faction returned no members.",
        "source": source,
        "params": {k: v for k, v in params.items() if k != "key"},
        "debug_attempts": debug_attempts,
    }
