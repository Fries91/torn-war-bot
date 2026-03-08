def ranked_war_summary(api_key: str, my_faction_id: str = "", my_faction_name: str = "") -> Dict[str, Any]:
    default = {
        "ok": True,
        "active": False,
        "war_id": "",
        "war_type": "",
        "enemy_faction_id": "",
        "enemy_faction_name": "",
        "enemy_members": [],
        "score_us": 0,
        "score_them": 0,
        "lead": 0,
        "target_score": 0,
        "remaining_to_target": 0,
        "chain_us": 0,
        "chain_them": 0,
        "start": 0,
        "end": 0,
        "status_text": "Currently not in war",
        "source_ok": False,
        "source_note": "Ranked war endpoint not available or no active war found.",
    }

    wars_res = faction_wars(api_key)
    if not wars_res.get("ok"):
        out = dict(default)
        out["source_note"] = wars_res.get("error", out["source_note"])
        return out

    wars = wars_res.get("wars") or []
    active_war = None

    for war in wars:
        factions = war.get("factions") or []
        faction_ids = [str(x.get("faction_id") or "") for x in factions]
        if my_faction_id and str(my_faction_id) in faction_ids and bool(war.get("active")):
            active_war = war
            break

    if not active_war:
        out = dict(default)
        out["source_ok"] = bool(wars_res.get("source_ok"))
        out["source_note"] = wars_res.get("source_note", out["source_note"])
        return out

    factions = active_war.get("factions") or []
    my_side = None
    enemy_side = None

    for f in factions:
        fid_s = str(f.get("faction_id") or "")
        if my_faction_id and fid_s == str(my_faction_id):
            my_side = f
            break

    if my_side:
        for f in factions:
            fid_s = str(f.get("faction_id") or "")
            if fid_s != str(my_side.get("faction_id") or ""):
                enemy_side = f
                break

    if my_side is None and factions:
        my_side = factions[0]
        for f in factions[1:]:
            if str(f.get("faction_id") or "") != str(my_side.get("faction_id") or ""):
                enemy_side = f
                break

    my_id = str((my_side or {}).get("faction_id") or my_faction_id or "")
    my_name = str((my_side or {}).get("faction_name") or my_faction_name or "")
    enemy_id = str((enemy_side or {}).get("faction_id") or "")
    enemy_name = str((enemy_side or {}).get("faction_name") or "")

    score_us = _to_int((my_side or {}).get("score"), 0)
    score_them = _to_int((enemy_side or {}).get("score"), 0)
    chain_us = _to_int((my_side or {}).get("chain"), 0)
    chain_them = _to_int((enemy_side or {}).get("chain"), 0)
    lead = score_us - score_them

    target_score = _to_int(active_war.get("target_score"), 0)
    remaining_to_target = max(0, target_score - score_us) if target_score else 0

    enemy_members: List[Dict[str, Any]] = []
    if enemy_id:
        enemy_faction = faction_basic(api_key, faction_id=str(enemy_id))
        if enemy_faction.get("ok"):
            enemy_name = enemy_faction.get("faction_name") or enemy_name
            enemy_members = enemy_faction.get("members", [])

    if not enemy_name and enemy_id:
        enemy_name = f"Faction {enemy_id}"
    if not my_name and my_id:
        my_name = f"Faction {my_id}"

    return {
        "ok": True,
        "active": True,
        "war_id": str(active_war.get("war_id") or ""),
        "war_type": str(active_war.get("war_type") or ""),
        "my_faction_id": my_id,
        "my_faction_name": my_name,
        "enemy_faction_id": enemy_id,
        "enemy_faction_name": enemy_name,
        "enemy_members": enemy_members,
        "score_us": score_us,
        "score_them": score_them,
        "lead": lead,
        "target_score": target_score,
        "remaining_to_target": remaining_to_target,
        "chain_us": chain_us,
        "chain_them": chain_them,
        "start": _to_int(active_war.get("start"), 0),
        "end": _to_int(active_war.get("end"), 0),
        "status_text": str(active_war.get("status_text") or "Active war"),
        "source_ok": bool(wars_res.get("source_ok")),
        "source_note": wars_res.get("source_note", ""),
    }
