from typing import Any, Dict

from torn_shared import API_BASE, safe_get, to_int
from torn_status import extract_medical_cooldown_seconds


def member_live_bars(api_key: str, user_id: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    user_id = str(user_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "error": "Missing API key.",
            "user_id": user_id,
            "bars": {},
            "status": {},
            "last_action": {},
        }

    selections = "bars,profile,personalstats,cooldowns"
    attempts = []

    if user_id:
        attempts.extend([
            (
                f"{API_BASE}/user/{user_id}",
                {"selections": selections, "key": api_key},
                f"user_live_direct_{user_id}",
            ),
            (
                f"{API_BASE}/user/",
                {"selections": selections, "ID": user_id, "key": api_key},
                f"user_live_upper_{user_id}",
            ),
            (
                f"{API_BASE}/user/",
                {"selections": selections, "id": user_id, "key": api_key},
                f"user_live_lower_{user_id}",
            ),
        ])
    else:
        attempts.append((
            f"{API_BASE}/user/",
            {"selections": selections, "key": api_key},
            "user_live_self",
        ))

    last_error = "Could not load user live bars."

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
        bars = data.get("bars") or {}

        life = bars.get("life") if isinstance(bars, dict) else {}
        energy = bars.get("energy") if isinstance(bars, dict) else {}
        nerve = bars.get("nerve") if isinstance(bars, dict) else {}
        happy = bars.get("happy") if isinstance(bars, dict) else {}

        status = data.get("status") or {}
        last_action = data.get("last_action") or {}
        resolved_user_id = str(
            data.get("player_id")
            or data.get("playerID")
            or data.get("user_id")
            or ""
        ).strip()

        if user_id and resolved_user_id and resolved_user_id != user_id:
            last_error = f"API key/user mismatch. Requested {user_id}, got {resolved_user_id}."
            continue

        resolved_user_id = user_id or resolved_user_id
        medical_cooldown = extract_medical_cooldown_seconds(data)

        return {
            "ok": True,
            "user_id": resolved_user_id,
            "name": str(data.get("name") or ""),
            "medical_cooldown": to_int(medical_cooldown, 0),
            "bars": {
                "life": {
                    "current": to_int((life or {}).get("current"), 0),
                    "maximum": to_int((life or {}).get("maximum"), 0),
                },
                "energy": {
                    "current": to_int((energy or {}).get("current"), 0),
                    "maximum": to_int((energy or {}).get("maximum"), 0),
                },
                "nerve": {
                    "current": to_int((nerve or {}).get("current"), 0),
                    "maximum": to_int((nerve or {}).get("maximum"), 0),
                },
                "happy": {
                    "current": to_int((happy or {}).get("current"), 0),
                    "maximum": to_int((happy or {}).get("maximum"), 0),
                },
            },
            "status": status if isinstance(status, dict) else {},
            "last_action": last_action if isinstance(last_action, dict) else {},
        }

    return {
        "ok": False,
        "error": last_error,
        "user_id": user_id,
        "bars": {},
        "status": {},
        "last_action": {},
    }
