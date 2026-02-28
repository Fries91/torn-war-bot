import aiohttp

BASE = "https://api.torn.com"

async def torn_get(session: aiohttp.ClientSession, path: str, params: dict):
    url = f"{BASE}{path}"

    headers = {
        "Accept": "application/json",
        "User-Agent": "TornWarBot/1.0 (Discord bot; contact: Fries91)"
    }

    async with session.get(
        url,
        params=params,
        headers=headers,
        timeout=aiohttp.ClientTimeout(total=25),
    ) as r:
        text = await r.text()

        # If Torn/Cloudflare returns HTML, this catches it cleanly
        ct = (r.headers.get("Content-Type") or "").lower()
        if "application/json" not in ct:
            raise RuntimeError(
                f"Torn API returned non-JSON (HTTP {r.status}, CT={ct})\n"
                f"URL: {str(r.url)}\n"
                f"Body head: {text[:350]}"
            )

        data = await r.json(content_type=None)

        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(f"Torn API error: {data['error']}")

        return data

async def get_faction_overview(session, faction_id: str, faction_key: str):
    return await torn_get(session, f"/faction/{faction_id}", {
        "selections": "basic,members,chain,rankedwars",
        "key": faction_key
    })

async def get_user_energy(session, torn_id: int, api_key: str):
    return await torn_get(session, f"/user/{torn_id}", {
        "selections": "bars",
        "key": api_key
    })
