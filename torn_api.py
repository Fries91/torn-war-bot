import requests
from typing import Any, Dict, List

API_BASE = "https://api.torn.com"


def _safe_get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        return {"ok": False, "error": data["error"].get("error", "Torn API error")}
    return {"ok": True, "data": data}


def profile_url(user_id: str) -> str:
    return f"https://www.torn.com/profiles.php?XID={user_id}"


def bounty_url(user_id: str) -> str:
    return f"https://www.torn.com/bounties.php#/p=add&userID={user_id}"


def attack_url(user_id: str) -> str:
    return f"https://www.torn.com/loader.php?sid=attack&user2ID={user_id}"


def me_basic(api_key: str) -> Dict[str, Any]:
    res = _safe_get(
        f"{API_BASE}/user/",
        {
            "selections": "profile",
            "key": api_key,
        },
    )
    if not res["ok"]:
        return res

    data = res["data"]
    faction = data.get("faction") or {}

    return {
        "ok": True,
        "player": {
            "user_id": str(data.get("player_id") or ""),
            "name": data.get("name") or "Unknown",
            "level": data.get("level") or "",
            "faction_id": str(faction.get("faction_id") or ""),
            "faction_name": faction.get("faction_name") or "",
        },
    }


def faction_basic(api_key: str) -> Dict[str, Any]:
    me = me_basic(api_key)
    if not me["ok"]:
        return {"ok": False, "members": [], "error": me.get("error", "Could not load player.")}

    faction_id = me["player"].get("faction_id")
    if not faction_id:
        return {
            "ok": True,
            "faction_id": "",
            "faction_name": "",
            "enemy_faction_name": "",
            "enemy_faction_id": "",
            "members": [],
        }

    res = _safe_get(
        f"{API_BASE}/faction/",
        {
            "selections": "basic",
            "key": api_key,
        },
    )
    if not res["ok"]:
        return {"ok": False, "members": [], "error": res.get("error", "Could not load faction.")}

    data = res["data"]
    members_raw = data.get("members") or {}
    members: List[Dict[str, Any]] = []

    for uid, m in members_raw.items():
        last_action = ""
        la = m.get("last_action")
        if isinstance(la, dict):
            last_action = la.get("status", "") or la.get("relative", "") or ""

        members.append(
            {
                "user_id": str(uid),
                "name": m.get("name", "Unknown"),
                "level": m.get("level", ""),
                "status": m.get("status", ""),
                "position": m.get("position", ""),
                "last_action": last_action,
            }
        )

    members.sort(key=lambda x: (x.get("name") or "").lower())

    return {
        "ok": True,
        "faction_id": str(data.get("ID") or faction_id or ""),
        "faction_name": data.get("name") or me["player"].get("faction_name") or "",
        "enemy_faction_name": "",
        "enemy_faction_id": "",
        "members": members,
    }


def ranked_war_summary(api_key: str) -> Dict[str, Any]:
    """
    Safe placeholder so app.py can import it even if ranked war data
    is not wired in yet.
    """
    return {
        "ok": True,
        "active": False,
        "our_faction_id": "",
        "our_faction_name": "",
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "our_score": 0,
        "enemy_score": 0,
        "lead": 0,
        "start": "",
        "end": "",
        "time_left": "",
        "target": 0,
    }
