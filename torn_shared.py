import json
import os
from typing import Any, Dict, List

import requests

API_BASE = str(os.getenv("TORN_API_BASE", "https://api.torn.com")).rstrip("/")
TORN_TIMEOUT = int(os.getenv("TORN_TIMEOUT", "30"))
CACHE_TTL_USER_PROFILE = int(os.getenv("CACHE_TTL_USER_PROFILE", "30"))
CACHE_TTL_FACTION_BASIC = int(os.getenv("CACHE_TTL_FACTION_BASIC", "20"))
CACHE_TTL_WAR_SUMMARY = int(os.getenv("CACHE_TTL_WAR_SUMMARY", "15"))

DEFAULT_HEADERS = {
    "User-Agent": "WarHub/1.0",
    "Accept": "application/json",
}

try:
    from db import cache_get, cache_set
except Exception:
    def cache_get(_cache_key: str):
        return None

    def cache_set(_payload_key: str, _payload_text: str, _ttl_seconds: int):
        return None


def cache_key(prefix: str, params: Dict[str, Any]) -> str:
    ordered = "&".join(f"{k}={params[k]}" for k in sorted(params.keys()))
    return f"{prefix}:{ordered}"


def to_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except Exception:
        return default


def stringify_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def safe_get(
    url: str,
    params: Dict[str, Any],
    cache_seconds: int = 0,
    cache_prefix: str = "",
) -> Dict[str, Any]:
    key_name = ""

    try:
        if cache_seconds > 0 and cache_prefix:
            safe_params = {k: v for k, v in params.items() if k != "key"}
            key_name = cache_key(cache_prefix, safe_params)
            cached = cache_get(key_name)
            if cached:
                try:
                    data = json.loads(cached)
                    return {"ok": True, "data": data, "cached": True}
                except Exception:
                    pass

        response = requests.get(
            url,
            params=params,
            timeout=TORN_TIMEOUT,
            headers=DEFAULT_HEADERS,
        )
        response.raise_for_status()

        try:
            data = response.json()
        except Exception:
            return {
                "ok": False,
                "error": "Invalid JSON response from Torn API.",
                "data": {},
                "status_code": response.status_code,
            }

        if not isinstance(data, dict):
            return {
                "ok": False,
                "error": "Unexpected Torn API payload shape.",
                "data": data,
                "status_code": response.status_code,
            }

        if data.get("error"):
            err_obj = as_dict(data.get("error"))
            return {
                "ok": False,
                "error": str(err_obj.get("error") or "Torn API error"),
                "error_code": err_obj.get("code"),
                "data": data,
                "status_code": response.status_code,
            }

        if cache_seconds > 0 and cache_prefix and key_name:
            try:
                cache_set(key_name, json.dumps(data), cache_seconds)
            except Exception:
                pass

        return {
            "ok": True,
            "data": data,
            "cached": False,
            "status_code": response.status_code,
        }

    except requests.HTTPError as e:
        status_code = getattr(e.response, "status_code", None)
        return {
            "ok": False,
            "error": f"HTTP error {status_code or ''}".strip(),
            "data": {},
            "status_code": status_code,
        }
    except requests.Timeout:
        return {
            "ok": False,
            "error": "Request timed out.",
            "data": {},
        }
    except requests.RequestException as e:
        return {
            "ok": False,
            "error": str(e),
            "data": {},
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "data": {},
        }


def profile_url(user_id: str) -> str:
    return f"https://www.torn.com/profiles.php?XID={user_id}"


def attack_url(user_id: str) -> str:
    return f"https://www.torn.com/loader.php?sid=attack&user2ID={user_id}"


def bounty_url(user_id: str) -> str:
    return f"https://www.torn.com/bounties.php#/p=add&userID={user_id}"
