import aiohttp

BASE = "https://api.torn.com"

async def torn_get(session: aiohttp.ClientSession, path: str, params: dict):
    async with session.get(f"{BASE}{path}", params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
        # Torn sometimes returns non-json on errors; guard it.
        ct = (r.headers.get("Content-Type") or "").lower()
        if "application/json" not in ct:
            text = await r.text()
            raise RuntimeError(f"Torn API non-JSON response (HTTP {r.status}): {text[:250]}")
        data = await r.json()

        if isinstance(data, dict) and "error" in data:
            # Torn error object is usually {error: {code, error}}
            raise RuntimeError(f"Torn API error: {data['error']}")

        return data

async def get_faction_overview(session: aiohttp.ClientSession, faction_id: str, faction_key: str):
    # ✅ IMPORTANT: include 'members' or you will get rows=[]
    return await torn_get(session, f"/faction/{faction_id}", {
        "selections": "basic,members,chain,rankedwars",
        "key": faction_key
    })

async def get_user_energy(session: aiohttp.ClientSession, torn_id: int, api_key: str):
    return await torn_get(session, f"/user/{torn_id}", {
        "selections": "bars",
        "key": api_key
    })
