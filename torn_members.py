from typing import Any, Dict

from torn_shared import API_BASE, safe_get, to_int
from torn_status import extract_medical_cooldown_seconds


def _extract_booster_cooldown_seconds(data: Dict[str, Any]) -> int:
    data = data or {}
    cooldowns = data.get("cooldowns") or {}

    candidates = [
        cooldowns.get("booster"),
        cooldowns.get("drug"),
        cooldowns.get("boosters"),
        cooldowns.get("drugs"),
        data.get("booster_cooldown"),
        data.get("drug_cooldown"),
    ]

    for value in candidates:
        if isinstance(value, dict):
            for subkey in ("remaining", "cooldown", "seconds", "time", "until"):
                subval = value.get(subkey)
                if isinstance(subval, (int, float)):
                    n = int(subval)
                    if n > 0:
                        return n
                elif isinstance(subval, str) and subval.strip().isdigit():
                    n = int(subval.strip())
                    if n > 0:
                        return n
        else:
            try:
                n = int(value or 0)
                if n > 0:
                    return n
            except Exception:
                pass

    return 0


def _first_int(source: Dict[str, Any], *keys: str) -> int:
    if not isinstance(source, dict):
        return 0
    for key in keys:
        value = source.get(key)
        if value in (None, ""):
            continue
        try:
            return int(value)
        except Exception:
            pass
    return 0


def _extract_bar_any(bar: Dict[str, Any]) -> Dict[str, int]:
    bar = bar if isinstance(bar, dict) else {}

    current = _first_int(
        bar,
        "current",
        "amount",
        "value",
        "used",
        "filled",
        "full",
    )
    maximum = _first_int(
        bar,
        "maximum",
        "max",
        "total",
        "cap",
        "full",
        "available",
    )

    if maximum <= 0 and current > 0:
        maximum = current

    return {
        "current": current,
        "maximum": maximum,
    }


def member_live_bars(api_key: str, user_id: str = "") -> Dict[str, Any]:
    api_key = str(api_key or "").strip()
    requested_user_id = str(user_id or "").strip()

    if not api_key:
        return {
            "ok": False,
            "error": "Missing API key.",
            "user_id": requested_user_id,
            "bars": {},
            "status": {},
            "last_action": {},
            "cooldowns": {},
            "medical_cooldown": 0,
            "booster_cooldown": 0,
            "name": "",
            "debug": {"step": "missing_api_key"},
        }

    selections = "bars,profile,personalstats,cooldowns"
    if requested_user_id:
        url = f"{API_BASE}/user/{requested_user_id}"
        params = {"selections": selections, "key": api_key}
        source = f"user_live_direct_{requested_user_id}"
    else:
        url = f"{API_BASE}/user/"
        params = {"selections": selections, "key": api_key}
        source = "user_live_self"

    res = safe_get(url, params, cache_seconds=0, cache_prefix=source)
    if not res.get("ok"):
        return {
            "ok": False,
            "error": str(res.get("error") or "Could not load user live bars."),
            "user_id": requested_user_id,
            "bars": {},
            "status": {},
            "last_action": {},
            "cooldowns": {},
            "medical_cooldown": 0,
            "booster_cooldown": 0,
            "name": "",
            "debug": {
                "step": "safe_get_failed",
                "source": source,
                "error": str(res.get("error") or ""),
            },
        }

    data = res.get("data") or {}
    if not isinstance(data, dict):
        return {
            "ok": False,
            "error": "Invalid user payload.",
            "user_id": requested_user_id,
            "bars": {},
            "status": {},
            "last_action": {},
            "cooldowns": {},
            "medical_cooldown": 0,
            "booster_cooldown": 0,
            "name": "",
            "debug": {
                "step": "invalid_payload",
                "source": source,
                "payload_type": str(type(data).__name__),
            },
        }

    resolved_user_id = str(
        data.get("player_id") or data.get("playerID") or data.get("user_id") or data.get("id") or ""
    ).strip()
    if requested_user_id and resolved_user_id and resolved_user_id != requested_user_id:
        return {
            "ok": False,
            "error": f"API key/user mismatch. Requested {requested_user_id}, got {resolved_user_id}.",
            "user_id": requested_user_id,
            "bars": {},
            "status": {},
            "last_action": {},
            "cooldowns": {},
            "medical_cooldown": 0,
            "booster_cooldown": 0,
            "name": "",
            "debug": {
                "step": "user_mismatch",
                "source": source,
                "requested_user_id": requested_user_id,
                "resolved_user_id": resolved_user_id,
            },
        }

    bars = data.get("bars") if isinstance(data.get("bars"), dict) else {}
    status = data.get("status") if isinstance(data.get("status"), dict) else {}
    last_action = data.get("last_action") if isinstance(data.get("last_action"), dict) else {}
    cooldowns = data.get("cooldowns") if isinstance(data.get("cooldowns"), dict) else {}

    life = bars.get("life") if isinstance(bars.get("life"), dict) else {}
    energy = bars.get("energy") if isinstance(bars.get("energy"), dict) else {}
    nerve = bars.get("nerve") if isinstance(bars.get("nerve"), dict) else {}
    happy = bars.get("happy") if isinstance(bars.get("happy"), dict) else {}

    medical_cooldown = extract_medical_cooldown_seconds(data)
    booster_cooldown = _extract_booster_cooldown_seconds(data)

    life_out = _extract_bar_any(life)
    energy_out = _extract_bar_any(energy)
    nerve_out = _extract_bar_any(nerve)
    happy_out = _extract_bar_any(happy)

    return {
        "ok": True,
        "error": "",
        "user_id": requested_user_id or resolved_user_id,
        "name": str(data.get("name") or ""),
        "medical_cooldown": to_int(medical_cooldown, 0),
        "booster_cooldown": to_int(booster_cooldown, 0),
        "cooldowns": cooldowns,
        "bars": {
            "life": life_out,
            "energy": energy_out,
            "nerve": nerve_out,
            "happy": happy_out,
        },
        "status": status,
        "last_action": last_action,
        "source": source,
        "debug": {
            "step": "bars_loaded",
            "source": source,
            "requested_user_id": requested_user_id,
            "resolved_user_id": resolved_user_id,
            "top_level_keys": sorted(list(data.keys())),
            "bars_keys": sorted(list(bars.keys())) if isinstance(bars, dict) else [],
            "life_raw": life,
            "energy_raw": energy,
            "nerve_raw": nerve,
            "happy_raw": happy,
            "life_out": life_out,
            "energy_out": energy_out,
            "nerve_out": nerve_out,
            "happy_out": happy_out,
            "cooldowns_keys": sorted(list(cooldowns.keys())) if isinstance(cooldowns, dict) else [],
            "medical_cooldown_raw": medical_cooldown,
            "booster_cooldown_raw": booster_cooldown,
        },
    }
