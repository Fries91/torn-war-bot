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
    if not isinstance(obj, dict):
        return None, None

    our = _pick(obj, ["score", "points", "our_score", "faction_score"])
    enemy = _pick(obj, ["enemy_score", "opponent_score", "their_score"])

    if our is None and isinstance(obj.get("factions"), dict):
        vals = list(obj["factions"].values())
        if len(vals) >= 2:
            a = vals[0] if isinstance(vals[0], dict) else {}
            b = vals[1] if isinstance(vals[1], dict) else {}
            our = _pick(a, ["score", "points"])
            enemy = _pick(b, ["score", "points"])

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
        for item in rw:
            if isinstance(item, dict):
                ended = item.get("end") or item.get("ended") or item.get("end_time")
                if not ended:
                    return item
        return rw[0]

    w = raw.get("war")
    if isinstance(w, dict):
        return w

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
    if isinstance(factions, dict):
        # name might exist inside faction objects
        for v in factions.values():
            if isinstance(v, dict):
                nm = _pick(v, ["name", "tag"])
                if nm:
                    return nm

    return None


def _extract_opponent_id_from_factions(blob: dict, our_faction_id: str):
    """
    Best reliable method:
    if blob["factions"] is a dict keyed by faction id:
      opponent_id = the key that isn't our_faction_id
    """
    if not isinstance(blob, dict):
        return None
    factions = blob.get("factions")
    if not isinstance(factions, dict):
        return None

    keys = [str(k) for k in factions.keys()]
    if not keys:
        return None

    # Prefer "other than ours"
    if our_faction_id and str(our_faction_id) in keys:
        for k in keys:
            if k != str(our_faction_id):
                return k

    # Fallback: if we can't match ours, but there are 2, return the first
    return keys[0]


async def get_ranked_war_best_effort(faction_id: str, api_key: str) -> dict:
    """
    IMPORTANT: For opponent_id, we *must* prefer the /rankedwars endpoint,
    because it often includes factions keyed by id.
    """
    try:
        data = await torn_get_v2(f"/faction/{faction_id}/rankedwars", {"key": api_key})
        if isinstance(data, dict) and not data.get("error"):
            return data
    except Exception:
        pass

    try:
        data = await torn_get_v2(f"/faction/{faction_id}", {"selections": "rankedwars", "key": api_key})
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
        "opponent_id": opponent_id,   # ✅ now should populate
        "start": start,
        "end": end,
        "target": target,
        "score": our_score,
        "enemy_score": enemy_score,
        "chain": chain
    }


async def get_ranked_war_best(faction_id: str, api_key: str) -> dict:
    raw = await get_ranked_war_best_effort(faction_id, api_key)
    return _normalize_ranked_war(raw, faction_id)
