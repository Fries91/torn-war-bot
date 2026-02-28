import aiohttp

# API v2 base URL
BASE = "https://api.torn.com/v2"

async def torn_get(path: str, params: dict) -> dict:
    url = f"{BASE}{path}"
    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as resp:
            return await resp.json()

async def get_faction_full(faction_id: str, api_key: str) -> dict:
    # v2 should accept these selections without code 23
    return await torn_get(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain", "key": api_key}
    )
