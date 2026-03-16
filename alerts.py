from typing import Any, Dict, List


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def detect_enemy_out_of_hospital(
    previous: List[Dict[str, Any]],
    current: List[Dict[str, Any]],
) -> List[Dict[str, str]]:
    alerts: List[Dict[str, str]] = []

    prev_map = {
        str(p.get("user_id")): p
        for p in previous
        if p.get("user_id") is not None
    }

    for p in current:
        user_id = str(p.get("user_id") or "").strip()
        if not user_id:
            continue

        prev = prev_map.get(user_id)
        if not prev:
            continue

        prev_hosp = _to_int(prev.get("hospital_seconds"), 0)
        curr_hosp = _to_int(p.get("hospital_seconds"), 0)
        name = str(p.get("name") or f"Enemy {user_id}")

        if prev_hosp > 0 and curr_hosp == 0:
            alerts.append({
                "kind": "enemy_out",
                "text": f"{name} left hospital",
            })

    return alerts
