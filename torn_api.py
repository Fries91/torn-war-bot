import aiohttp

BASE = "https://api.torn.com"

async def torn_get(session, path, params):
    async with session.get(f"{BASE}{path}", params=params) as r:
        return await r.json()

async def get_faction_overview(session, faction_id, key):
    return await torn_get(session, f"/faction/{faction_id}", {
        "selections": "basic,chain,rankedwars",
        "key": key
    })

async def get_user_energy(session, torn_id, key):
    return await torn_get(session, f"/user/{torn_id}", {
        "selections": "bars",
        "key": key
    })
