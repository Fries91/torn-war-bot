import re
import time
from typing import Any, Dict

from torn_shared import attack_url, bounty_url, profile_url, to_int


def extract_hospital_seconds_from_text(text: str) -> int:
    s = str(text or "").lower().strip()
    if not s:
        return 0

    total = 0
    matches = re.findall(r"(\d+)\s*([dhms])", s)
    if matches:
        for num, unit in matches:
            n = int(num)
            if unit == "d":
                total += n * 86400
            elif unit == "h":
                total += n * 3600
            elif unit == "m":
                total += n * 60
            elif unit == "s":
                total += n
        return total

    maybe_digits = re.findall(r"\d+", s)
    if maybe_digits and ("hospital" in s or "rehab" in s):
        return int(maybe_digits[0]) * 60

    return 0


def extract_hospital_until_ts(member: Dict[str, Any], fallback_seconds: int = 0) -> int:
    candidates = [
        member.get("until"),
        member.get("hospital_until"),
        member.get("hospital_timestamp"),
        member.get("hospital_time"),
        member.get("timestamp"),
    ]

    status = member.get("status")
    if isinstance(status, dict):
        candidates.extend([
            status.get("until"),
            status.get("until_timestamp"),
            status.get("timestamp"),
            status.get("time"),
        ])

    now = int(time.time())
    for value in candidates:
        if isinstance(value, (int, float)):
            ts = int(value)
            if ts > now - 3600:
                return ts
        elif isinstance(value, str) and value.strip().isdigit():
            ts = int(value.strip())
            if ts > now - 3600:
                return ts

    if fallback_seconds > 0:
        return now + int(fallback_seconds)

    return 0


def member_state_from_last_action(last_action_text: str) -> str:
    s = str(last_action_text or "").strip().lower()
    if not s:
        return "offline"
    if any(x in s for x in ["hospital", "rehab"]):
        return "hospital"
    if any(x in s for x in ["jail", "jailed"]):
        return "jail"
    if any(x in s for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
        return "travel"
    if any(x in s for x in ["online", "active"]):
        return "online"
    if any(x in s for x in ["idle", "inactive"]):
        return "idle"
    return "offline"


def extract_medical_cooldown_seconds(payload: Dict[str, Any]) -> int:
    if not isinstance(payload, dict):
        return 0

    candidates = []
    cooldowns = payload.get("cooldowns")
    if isinstance(cooldowns, dict):
        medical = cooldowns.get("medical")
        if isinstance(medical, dict):
            candidates.extend([
                medical.get("remaining"),
                medical.get("cooldown"),
                medical.get("seconds"),
                medical.get("time"),
                medical.get("until"),
            ])
        else:
            candidates.append(medical)

    for key in ("medical_cooldown", "medicalCooldown", "cooldown_medical", "med_cooldown", "medCooldown"):
        candidates.append(payload.get(key))

    for value in candidates:
        if isinstance(value, dict):
            for subkey in ("remaining", "cooldown", "seconds", "time", "until"):
                subval = value.get(subkey)
                if isinstance(subval, (int, float)) and int(subval) >= 0:
                    return int(subval)
                if isinstance(subval, str) and subval.strip().isdigit():
                    return int(subval.strip())
        elif isinstance(value, (int, float)) and int(value) >= 0:
            return int(value)
        elif isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())

    return 0


def _extract_bar(payload: Dict[str, Any], keys: list[str]) -> Dict[str, Any]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            current = to_int(value.get("current", value.get("amount", value.get("full", 0))), 0)
            maximum = to_int(value.get("maximum", value.get("max", value.get("total", value.get("full", 0)))), 0)
            return {
                "current": current,
                "maximum": maximum,
            }

    bars = payload.get("bars")
    if isinstance(bars, dict):
        for key in keys:
            value = bars.get(key)
            if isinstance(value, dict):
                current = to_int(value.get("current", value.get("amount", value.get("full", 0))), 0)
                maximum = to_int(value.get("maximum", value.get("max", value.get("total", value.get("full", 0)))), 0)
                return {
                    "current": current,
                    "maximum": maximum,
                }

    return {}


def normalize_member(uid: Any, member: Dict[str, Any]) -> Dict[str, Any]:
    member = member if isinstance(member, dict) else {}

    last_action_raw = member.get("last_action")
    if isinstance(last_action_raw, dict):
        last_action = str(
            last_action_raw.get("status")
            or last_action_raw.get("relative")
            or last_action_raw.get("timestamp")
            or ""
        )
    else:
        last_action = str(last_action_raw or "")

    status_raw = member.get("status")
    if isinstance(status_raw, dict):
        status_text = str(
            status_raw.get("state")
            or status_raw.get("description")
            or status_raw.get("color")
            or ""
        )
        status_detail = str(
            status_raw.get("details")
            or status_raw.get("description")
            or ""
        )
    else:
        status_text = str(status_raw or "")
        status_detail = ""

    combined = " ".join([status_text, status_detail, last_action]).strip().lower()

    hospital_seconds = extract_hospital_seconds_from_text(combined)
    hospital_until_ts = extract_hospital_until_ts(member, hospital_seconds)
    now_ts = int(time.time())

    in_hospital = 1 if ("hospital" in combined or "rehab" in combined or hospital_until_ts > now_ts) else 0
    if hospital_until_ts > now_ts and hospital_seconds <= 0:
        hospital_seconds = max(0, hospital_until_ts - now_ts)

    online_state = "hospital" if in_hospital else member_state_from_last_action(last_action)

    if not in_hospital:
        if any(x in combined for x in ["jail", "jailed"]):
            online_state = "jail"
        elif any(x in combined for x in ["abroad", "traveling", "travelling", "travel", "flying"]):
            online_state = "travel"
        elif "online" in combined or "active" in combined:
            online_state = "online"
        elif "idle" in combined:
            online_state = "idle"

    user_id = str(uid or member.get("user_id") or member.get("player_id") or member.get("id") or "").strip()

    energy = _extract_bar(member, ["energy"])
    life = _extract_bar(member, ["life", "hp"])
    nerve = _extract_bar(member, ["nerve"])
    happy = _extract_bar(member, ["happy"])
    medical_cooldown = extract_medical_cooldown_seconds(member)

    return {
        **member,
        "user_id": user_id,
        "name": str(member.get("name") or member.get("player_name") or member.get("member_name") or "Unknown"),
        "level": member.get("level", ""),
        "position": member.get("position", ""),
        "status": status_text,
        "status_detail": status_detail,
        "last_action": last_action,
        "online_state": online_state,
        "in_hospital": in_hospital,
        "hospital_seconds": hospital_seconds,
        "hospital_until_ts": hospital_until_ts,
        "energy": energy or member.get("energy") or {},
        "life": life or member.get("life") or {},
        "nerve": nerve or member.get("nerve") or {},
        "happy": happy or member.get("happy") or {},
        "medical_cooldown": medical_cooldown,
        "profile_url": profile_url(user_id),
        "attack_url": attack_url(user_id),
        "bounty_url": bounty_url(user_id),
    }


def coerce_hospital_member(member: Dict[str, Any]) -> Dict[str, Any]:
    user_id = str(member.get("user_id") or member.get("player_id") or member.get("id") or "").strip()
    hospital_until_ts = to_int(member.get("hospital_until_ts"), 0)
    hospital_seconds = to_int(member.get("hospital_seconds"), 0)

    return {
        **member,
        "user_id": user_id,
        "in_hospital": 1,
        "hospital_until_ts": hospital_until_ts,
        "hospital_seconds": hospital_seconds,
    }
