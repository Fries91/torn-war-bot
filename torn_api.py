# torn_api.py  ✅ v2 API helpers + ranked war normalization (best-effort)
# Fixes:
# ✅ opponent_id extraction works when "factions" is a dict OR a list
# ✅ score/enemy_score extraction works when "factions" is a dict OR a list
# ✅ still supports multiple possible key names returned by Torn

import aiohttp

BASE_V2 = "https://api.torn.com/v2"


async def torn_get_v2(path: str, params: dict) -> dict:
    url = f"{BASE_V2}{path}"
    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as resp:
            return await resp.json()


async def get_faction_core(faction_id: str, api_key: str) -> dict:
    return await torn_get_v2(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain", "key": api_key}
    )


# ---------- ranked war helpers ----------
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
    Returns (our_score, enemy_score) as ints where possible.
    Supports:
      - direct keys on the war blob
      - factions as dict keyed by faction id
      - factions as list of faction objects
    """
    if not isinstance(obj, dict):
        return None, None

    # Direct fields sometimes exist
    our = _pick(obj, ["score", "points", "our_score", "faction_score"])
    enemy = _pick(obj, ["enemy_score", "opponent_score", "their_score"])

    factions = obj.get("factions")

    # Case A: factions is dict keyed by id -> values contain score/points
    if (our is None or enemy is None) and isinstance(factions, dict):
        vals = [v for v in factions.values() if isinstance(v, dict)]
        if len(vals) >= 2:
            if our is None:
                our = _pick(vals[0], ["score", "points"])
            if enemy is None:
                enemy = _pick(vals[1], ["score", "points"])

    # Case B: factions is list of faction objects [{id, score}, ...]
    if (our is None or enemy is None) and isinstance(factions, list):
        vals = [v for v in factions if isinstance(v, dict)]
        if len(vals) >= 2:
            if our is None:
                our = _pick(vals[0], ["score", "points"])
            if enemy is None:
                enemy = _pick(vals[1], ["score", "points"])

    return _to_int(our), _to_int(enemy)


def _extract_time(obj: dict, key_candidates: list):
    if not isinstance(obj, dict):
        return None
    val = _pick(obj, key_candidates)
    if val is None or isinstance(val, dict):
        return None
    return val


def _extract_chain(obj: dict):
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
    return {}


def _find_active_war_blob(raw: dict):
    """
    Accepts:
      { "rankedwars": [ ... ] }  OR  { "rankedwars": { ... } } OR  already a war dict
    Returns the "active" war dict if possible.
    """
    if not isinstance(raw, dict):
        return None

    rw = raw.get("rankedwars")
    if isinstance(rw, dict):
        return rw

    if isinstance(rw, list) and rw:
        # Prefer an unended war if we can detect it
        for item in rw:
            if isinstance(item, dict):
                ended = item.get("end") or item.get("ended") or item.get("end_time")
                if not ended:
                    return item
        return rw[0]

    w = raw.get("war")
    if isinstance(w, dict):
        return w

    # Sometimes the response itself is the blob
    return raw


def _extract_opponent_name(blob: dict):
    if not isinstance(blob, dict):
        return None

    opp = _pick(blob, ["opponent", "enemy"])
    if isinstance(opp, dict):
        return _pick(opp, ["name", "tag"])
    if isinstance(opp, str):
        return opp

    name = _pick(blob, ["opponent_name", "enemy_name"])
    if isinstance(name, str):
        return name

    factions = blob.get("factions")

    # factions as dict
    if isinstance(factions, dict):
        for v in factions.values():
            if isinstance(v, dict):
                nm = _pick(v, ["name", "tag"])
                if nm:
                    return nm

    # factions as list
    if isinstance(factions, list):
        for v in factions:
            if isinstance(v, dict):
                nm = _pick(v, ["name", "tag"])
                if nm:
                    return nm

    return None


def _extract_opponent_id_from_factions(blob: dict, our_faction_id: str):
    """
    Best method:
    - prefer direct opponent_id fields if present
    - else use factions:
      A) dict keyed by faction id
      B) list of faction objects with id/faction_id
    """
    if not isinstance(blob, dict):
        return None

    # Sometimes Torn includes a direct field
    direct = _pick(blob, ["opponent_id", "enemy_id", "their_faction_id"])
    if direct is not None:
        return str(direct)

    factions = blob.get("factions")

    # Case A: dict keyed by faction id
    if isinstance(factions, dict):
        keys = [str(k) for k in factions.keys()]
        if not keys:
            return None

        if our_faction_id and str(our_faction_id) in keys:
            for k in keys:
                if k != str(our_faction_id):
                    return k

        # fallback
        return keys[0]

    # Case B: list of faction objects
    if isinstance(factions, list) and factions:
        ids = []
        for f in factions:
            if isinstance(f, dict):
                fid = _pick(f, ["id", "faction_id"])
                if fid is not None:
                    ids.append(str(fid))

        if not ids:
            return None

        if our_faction_id and str(our_faction_id) in ids:
            for fid in ids:
                if fid != str(our_faction_id):
                    return fid

        return ids[0]

    return None


async def get_ranked_war_best_effort(faction_id: str, api_key: str) -> dict:
    """
    Try the dedicated endpoint first, then fallback to selections=rankedwars.
    """
    try:
        data = await torn_get_v2(f"/faction/{faction_id}/rankedwars", {"key": api_key})
        if isinstance(data, dict) and not data.get("error"):
            return data
    except Exception:
        pass

    try:
        data = await torn_get_v2(
            f"/faction/{faction_id}",
            {"selections": "rankedwars", "key": api_key}
        )
        if isinstance(data, dict) and not data.get("error"):
            return data
    except Exception:
        pass

    return {}


def _normalize_ranked_war(raw: dict, our_faction_id: str) -> dict:
    blob = _find_active_war_blob(raw)
    if not isinstance(blob, dict):
        return {}

    opponent = _extract_opponent_name(blob)
    opponent_id = _extract_opponent_id_from_factions(blob, our_faction_id)

    start = _extract_time(blob, ["start", "started", "start_time", "begin", "timestamp_start"])
    end = _extract_time(blob, ["end", "ended", "end_time", "finish", "timestamp_end"])
    target = _to_int(_pick(blob, ["target", "target_score", "goal", "required", "takeout_target"]), default=None)

    our_score, enemy_score = _extract_score(blob)
    chain = _extract_chain(blob)

    return {
        "opponent": opponent,
        "opponent_id": opponent_id,  # ✅ should populate now
        "start": start,
        "end": end,
        "target": target,
        "score": our_score,
        "enemy_score": enemy_score,
        "chain": chain,
    }


async def get_ranked_war_best(faction_id: str, api_key: str) -> dict:
    raw = await get_ranked_war_best_effort(faction_id, api_key)
    return _normalize_ranked_war(raw, faction_id)
