import aiohttp

BASE = "https://api.torn.com/v2"


async def torn_get(path, params):
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{BASE}{path}", params=params) as resp:
            return await resp.json()


async def get_faction_core(faction_id, api_key):
    return await torn_get(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain", "key": api_key}
    )


async def get_ranked_war_best(faction_id, api_key):
    try:
        data = await torn_get(
            f"/faction/{faction_id}/rankedwars",
            {"key": api_key}
        )
        return data
    except:
        return {}
