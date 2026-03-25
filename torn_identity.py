from typing import Any, Dict

from torn_shared import API_BASE, safe_get


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

    res = safe_get(
        f"{API_BASE}/user",
        {"selections": "profile", "key": api_key},
        cache_seconds=0,
        cache_prefix="",
    )
    if not res.get("ok"):
        res = safe_get(
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
