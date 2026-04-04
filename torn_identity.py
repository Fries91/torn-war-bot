from typing import Any, Dict

from torn_shared import API_BASE, safe_get


def me_basic(api_key: str) -> Dict[str, Any]:
    api_key = str(api_key or "").strip()

    empty = {
        "ok": False,
        "error": "Missing API key.",
        "user_id": "",
        "name": "",
        "level": "",
        "faction_id": "",
        "faction_name": "",
    }

    if not api_key:
        return empty

    attempts = [
        (
            f"{API_BASE}/user",
            {"selections": "profile", "key": api_key},
            "user_profile_direct",
        ),
        (
            f"{API_BASE}/user/",
            {"selections": "profile", "key": api_key},
            "user_profile_fallback",
        ),
    ]

    last_error = "Could not load user profile."

    for url, params, prefix in attempts:
        res = safe_get(
            url,
            params,
            cache_seconds=0,
            cache_prefix=prefix,
        )

        if not res.get("ok"):
            last_error = str(res.get("error") or last_error)
            continue

        data = res.get("data") or {}
        if not isinstance(data, dict):
            last_error = "Invalid user profile payload."
            continue

        faction = data.get("faction") if isinstance(data.get("faction"), dict) else {}

        player_id = str(
            data.get("player_id")
            or data.get("playerID")
            or data.get("user_id")
            or data.get("id")
            or ""
        ).strip()

        if not player_id:
            last_error = "Could not resolve player_id from Torn response."
            continue

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
        }

    return {
        "ok": False,
        "error": last_error,
        "user_id": "",
        "name": "",
        "level": "",
        "faction_id": "",
        "faction_name": "",
    }
