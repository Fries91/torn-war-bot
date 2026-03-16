from typing import Any, Dict, List


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def smart_target_rank(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Rank enemies based on usefulness as targets.
    Higher score = better target.
    """
    ranked: List[Dict[str, Any]] = []

    for player in players:
        p = dict(player)
        score = 0

        online_state = str(p.get("online_state") or "").lower()
        hospital_seconds = _to_int(p.get("hospital_seconds"), 0)
        level = _to_int(p.get("level"), 0)

        if online_state == "online":
            score += 50
        elif online_state == "idle":
            score += 30

        if hospital_seconds > 0:
            score -= 40

        score += max(0, 100 - level)

        p["target_score"] = score
        ranked.append(p)

    ranked.sort(key=lambda x: _to_int(x.get("target_score"), 0), reverse=True)
    return ranked


def hospital_sorted(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        [dict(p) for p in players if _to_int(p.get("hospital_seconds"), 0) > 0],
        key=lambda x: _to_int(x.get("hospital_seconds"), 999999),
    )


def online_sorted(players: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _online_rank(p: Dict[str, Any]) -> int:
        state = str(p.get("online_state") or "").lower()
        if state == "online":
            return 0
        if state == "idle":
            return 1
        return 2

    return sorted(
        [dict(p) for p in players],
        key=lambda x: (
            _online_rank(x),
            _to_int(x.get("hospital_seconds"), 0),
        ),
    )
