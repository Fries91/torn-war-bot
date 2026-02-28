import aiohttp

BASE = "https://api.torn.com"

async def torn_get(path: str, params: dict) -> dict:
    url = f"{BASE}{path}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params, timeout=25) as resp:
            return await resp.json()

async def get_faction_full(faction_id: str, api_key: str) -> dict:
    # Pull: basic + members + chain + rankedwars (war info can vary)
    # If your faction endpoint selections differ, we can adjust.
    return await torn_get(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain,rankedwars", "key": api_key}
    )
