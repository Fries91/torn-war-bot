from typing import Dict


def score_delta(us: int, them: int) -> Dict:
    lead = us - them

    if lead > 0:
        status = "winning"
    elif lead < 0:
        status = "losing"
    else:
        status = "tied"

    return {
        "lead": lead,
        "status": status
    }
