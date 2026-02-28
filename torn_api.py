import aiohttp

BASE = "https://api.torn.com"

async def torn_get(path: str, params: dict) -> dict:
    url = f"{BASE}{path}"
    timeout = aiohttp.ClientTimeout(total=25)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as resp:
            return await resp.json()

async def get_faction_full(faction_id: str, api_key: str) -> dict:
    # Use v1-safe selections only (prevents error code 23)
    return await torn_get(
        f"/faction/{faction_id}",
        {"selections": "basic,members,chain", "key": api_key}
    )
