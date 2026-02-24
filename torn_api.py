import aiohttp

BASE = "https://api.torn.com"

async def torn_get(session: aiohttp.ClientSession, path: str, params: dict):
    async with session.get(f"{BASE}{path}", params=params, timeout=20) as r:
        data = await r.json()
        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(f"Torn API error: {data['error']}")
        return data

async def get_faction_overview(session, faction_id: str, faction_key: str):
    return await torn_get(session, f"/faction/{faction_id}", {
        "selections": "basic,chain,rankedwars",
        "key": faction_key
    })

async def get_user_energy(session, torn_id: int, api_key: str):
    return await torn_get(session, f"/user/{torn_id}", {
        "selections": "bars",
        "key": api_key
    })
