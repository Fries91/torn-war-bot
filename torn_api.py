import aiohttp
from datetime import datetime, timezone

BASE_V2 = "https://api.torn.com/v2"


async def torn_get_v2(path: str, params: dict) -> dict:
    url = f"{BASE_V2}{path}"
    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as resp:
            return await resp.json()


async def get_faction_core(faction_id: str, api_key: str) -> dict:
    # Core data (works for your setup now)
    return await torn_get_v2(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain", "key": api_key}
    )


async def get_ranked_war_best_effort(faction_id: str, api_key: str) -> dict:
    """
    Ranked war info varies; try a couple v2 shapes safely.
    If it fails, return {} and the app will ignore it.
    """
    # Try endpoint form 1
    try:
        data = await torn_get_v2(f"/faction/{faction_id}/rankedwars", {"key": api_key})
        if isinstance(data, dict) and not data.get("error"):
            return data
    except Exception:
        pass

    # Try selection form
    try:
        data = await torn_get_v2(f"/faction/{faction_id}", {"selections": "rankedwars", "key": api_key})
        if isinstance(data, dict) and not data.get("error"):
            return data
    except Exception:
        pass

    return {}


def _to_int(x, default=None):
    try:
        if x is None:
            return default
        return int(x)
    except Exception:
        return default


def _pick(d: dict, keys: list):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] is not None:
            return d[k]
    return None


def _extract_score(obj: dict):
    """
    Try to find 'our' and 'enemy' scores from unknown shapes.
    Returns (our_score, enemy_score) or (None, None).
    """
    if not isinstance(obj, dict):
        return None, None

    # Common direct keys
    our = _pick(obj, ["score", "points", "our_score", "faction_score"])
    enemy = _pick(obj, ["enemy_score", "opponent_score", "their_score"])

    # Some shapes nest score objects
    if our is None and isinstance(obj.get("factions"), dict):
        # factions: { "<id>": {...}, "<enemyid>": {...} }
        # We'll just try to pick the top 2 and use their 'score/points'
        vals = list(obj["factions"].values())
        if len(vals) >= 2:
            a = vals[0] if isinstance(vals[0], dict) else {}
            b = vals[1] if isinstance(vals[1], dict) else {}
            our = _pick(a, ["score", "points"])
            enemy = _pick(b, ["score", "points"])

    return _to_int(our), _to_int(enemy)


def _extract_opponent(obj: dict):
    """
    Returns opponent name if we can find it.
    """
    if not isinstance(obj, dict):
        return None

    # direct keys
    opp = _pick(obj, ["opponent", "enemy", "opponent_name", "enemy_name"])
    if isinstance(opp, dict):
        return _pick(opp, ["name", "tag"])
    if isinstance(opp, str):
        return opp

    # nested factions list/dict
    factions = obj.get("factions")
    if isinstance(factions, list):
        for f in factions:
            if isinstance(f, dict):
                name = _pick(f, ["name", "tag"])
                if name:
                    return name
    if isinstance(factions, dict):
        for f in factions.values():
            if isinstance(f, dict):
                name = _pick(f, ["name", "tag"])
                if name:
                    return name

    return None


def _extract_time(obj: dict, key_candidates: list):
    """
    Attempts to pull an ISO-ish or unix-ish timestamp.
    Returns value as-is (string/int) because app.py can display it raw.
    """
    if not isinstance(obj, dict):
        return None

    val = _pick(obj, key_candidates)
    if val is None:
        return None

    # If it looks like a dict {start:..., end:...} ignore (wrong shape)
    if isinstance(val, dict):
        return None

    return val


def _extract_chain(obj: dict):
    """
    Tries to find chain fields if present.
    """
    if not isinstance(obj, dict):
        return {}

    chain = obj.get("chain")
    if isinstance(chain, dict):
        return {
            "current": chain.get("current"),
            "max": chain.get("max"),
            "timeout": chain.get("timeout"),
            "cooldown": chain.get("cooldown"),
        }

    # Sometimes chain lives under faction selection response
    # e.g. response has 'chain' at top-level already
    return {}


def _find_active_war_blob(raw: dict):
    """
    ranked wars sometimes come back as:
      - { "rankedwars": [...] }
      - { "rankedwars": { ... } }
      - { ... war object directly ... }
    We pick the most 'active-looking' object.
    """
    if not isinstance(raw, dict):
        return None

    # If the response already looks like a war object:
    if any(k in raw for k in ("opponent", "enemy", "start", "end", "target", "score", "factions", "war")):
        # might still be wrapper, but we can handle it
        pass

    rw = raw.get("rankedwars")
    if isinstance(rw, dict):
        return rw
    if isinstance(rw, list) and rw:
        # Prefer an item without an 'end' (active), else the most recent
        active = None
        for item in rw:
            if isinstance(item, dict) and not item.get("end") and not item.get("ended"):
                active = item
                break
        return active or rw[0]

    # Some endpoints might put it under "war"
    w = raw.get("war")
    if isinstance(w, dict):
        return w

    return raw


def _normalize_ranked_war(raw: dict) -> dict:
    """
    Output shape expected by app.py:
      {
        "opponent": str|None,
        "start": any,
        "end": any,
        "target": int|None,
        "score": int|None,
        "enemy_score": int|None,
        "chain": { current,max,timeout,cooldown }
      }
    """
    blob = _find_active_war_blob(raw)
    if not isinstance(blob, dict):
        return {}

    opponent = _extract_opponent(blob)

    # Times (different APIs name these differently)
    start = _extract_time(blob, ["start", "started", "start_time", "begin", "timestamp_start"])
    end = _extract_time(blob, ["end", "ended", "end_time", "finish", "timestamp_end"])

    # Target (takeout target etc.)
    target = _to_int(_pick(blob, ["target", "target_score", "goal", "required", "takeout_target"]), default=None)

    # Scores
    our_score, enemy_score = _extract_score(blob)

    # Chain (sometimes present)
    chain = _extract_chain(blob)

    return {
        "opponent": opponent,
        "start": start,
        "end": end,
        "target": target,
        "score": our_score,
        "enemy_score": enemy_score,
        "chain": chain
    }


# ✅ This is the name your app.py should import/call
async def get_ranked_war_best(faction_id: str, api_key: str) -> dict:
    raw = await get_ranked_war_best_effort(faction_id, api_key)
    return _normalize_ranked_war(raw)
