import aiohttp

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
