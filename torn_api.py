import aiohttp

BASE = "https://api.torn.com"

# One shared timeout object (more reliable than a bare int)
TIMEOUT = aiohttp.ClientTimeout(total=45)

async def torn_get(session: aiohttp.ClientSession, path: str, params: dict):
    url = f"{BASE}{path}"
    async with session.get(url, params=params, timeout=TIMEOUT) as r:
        # If Torn or a proxy returns HTML, this avoids crashing with JSON decode errors
        ctype = (r.headers.get("Content-Type") or "").lower()
        if r.status != 200:
            text = await r.text()
            raise RuntimeError(f"Torn HTTP {r.status} for {path}: {text[:200]}")

        if "application/json" in ctype:
            data = await r.json()
        else:
            text = await r.text()
            raise RuntimeError(f"Non-JSON response from Torn for {path}: {text[:200]}")

        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(f"Torn API error: {data['error']}")
        return data

async def get_faction_overview(session: aiohttp.ClientSession, faction_id: str, faction_key: str):
    # ✅ IMPORTANT: include "members" so your dashboard can show faction members
    return await torn_get(session, f"/faction/{faction_id}", {
        "selections": "basic,members,chain,rankedwars",
        "key": faction_key
    })

async def get_user_energy(session: aiohttp.ClientSession, torn_id: int, api_key: str):
    return await torn_get(session, f"/user/{torn_id}", {
        "selections": "bars",
        "key": api_key
    })
