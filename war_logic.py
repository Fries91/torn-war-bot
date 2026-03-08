from typing import List, Dict


def smart_target_rank(players: List[Dict]) -> List[Dict]:
    """
    Rank enemies based on usefulness as targets.
    """
    ranked = []

    for p in players:
        score = 0

        if p.get("online_state") == "online":
            score += 50

        if p.get("online_state") == "idle":
            score += 30

        if p.get("hospital_seconds", 0) > 0:
            score -= 40

        level = int(p.get("level") or 0)
        score += max(0, 100 - level)

        p["target_score"] = score
        ranked.append(p)

    ranked.sort(key=lambda x: x["target_score"], reverse=True)
    return ranked


def hospital_sorted(players: List[Dict]) -> List[Dict]:
    return sorted(
        [p for p in players if p.get("hospital_seconds", 0) > 0],
        key=lambda x: x.get("hospital_seconds", 999999),
    )


def online_sorted(players: List[Dict]) -> List[Dict]:
    return sorted(
        players,
        key=lambda x: (
            0 if x.get("online_state") == "online" else 1,
            x.get("hospital_seconds", 0),
        ),
    )
