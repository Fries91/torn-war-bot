from typing import Dict


def score_delta(us: int, them: int) -> Dict[str, int | str]:
    us = int(us or 0)
    them = int(them or 0)
    lead = us - them

    if lead > 0:
        status = "winning"
    elif lead < 0:
        status = "losing"
    else:
        status = "tied"

    return {
        "lead": lead,
        "status": status,
    }
