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

    url = f"{API_BASE}/user"
    params = {"selections": "profile", "key": api_key}
    source = "user_profile_direct"

    res = safe_get(
        url,
        params,
        cache_seconds=0,
        cache_prefix=source,
    )

    if not res.get("ok"):
        return {
            "ok": False,
            "error": str(res.get("error") or "Could not load user profile."),
            "user_id": "",
            "name": "",
            "level": "",
            "faction_id": "",
            "faction_name": "",
        }

    data = res.get("data") or {}
    if not isinstance(data, dict):
        return {
            "ok": False,
            "error": "Invalid user profile payload.",
            "user_id": "",
            "name": "",
            "level": "",
            "faction_id": "",
            "faction_name": "",
        }

    faction = data.get("faction") if isinstance(data.get("faction"), dict) else {}

    player_id = str(
        data.get("player_id")
        or data.get("playerID")
        or data.get("user_id")
        or data.get("id")
        or ""
    ).strip()

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
        "error": "",
        "user_id": player_id,
        "name": str(data.get("name") or "Unknown").strip() or "Unknown",
        "level": data.get("level") or "",
        "faction_id": str(
            faction.get("faction_id")
            or faction.get("ID")
            or faction.get("id")
            or ""
        ).strip(),
        "faction_name": str(
            faction.get("faction_name")
            or faction.get("name")
            or ""
        ).strip(),
        "source": source,
    }
