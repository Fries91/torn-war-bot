from typing import List, Dict


def detect_enemy_out_of_hospital(previous: List[Dict], current: List[Dict]):
    alerts = []

    prev_map = {p["user_id"]: p for p in previous}

    for p in current:
        prev = prev_map.get(p["user_id"])

        if not prev:
            continue

        if prev.get("hospital_seconds", 0) > 0 and p.get("hospital_seconds", 0) == 0:
            alerts.append({
                "kind": "enemy_out",
                "text": f'{p["name"]} left hospital'
            })

    return alerts
