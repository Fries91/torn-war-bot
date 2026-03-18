import os
from typing import Any, Dict, List, Optional

from db import (
    PAYMENT_KIND,
    PAYMENT_NOTIFY_USER_ID,
    PAYMENT_PLAYER,
    PAYMENT_XANAX_PER_MEMBER,
    add_audit_log,
    add_notification,
    calc_faction_renewal_cost,
    compute_faction_license_status,
    get_faction_member_access,
    get_faction_payment_history,
    get_faction_license_for_member,
    get_member_access_record,
    get_owner_faction_dashboard,
    get_user,
    list_all_faction_licenses,
    list_faction_members,
    recalc_faction_license,
    renew_faction_after_payment,
    set_faction_member_enabled,
    upsert_faction_member_access,
    delete_faction_member_access,
)

OWNER_USER_ID = str(os.getenv("OWNER_USER_ID", "3679030")).strip() or "3679030"
OWNER_NAME = str(os.getenv("OWNER_NAME", "Fries91")).strip() or "Fries91"


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return int(default)
        return int(value)
    except Exception:
        return int(default)


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    s = str(value or "").strip().lower()
    return s in {"1", "true", "yes", "y", "on", "enabled"}


def payment_config() -> Dict[str, Any]:
    return {
        "payment_player": PAYMENT_PLAYER,
        "payment_notify_user_id": PAYMENT_NOTIFY_USER_ID,
        "payment_kind": PAYMENT_KIND,
        "payment_per_member": PAYMENT_XANAX_PER_MEMBER,
        "owner_user_id": OWNER_USER_ID,
        "owner_name": OWNER_NAME,
    }


def build_payment_instruction(enabled_member_count: int) -> str:
    total_amount = int(enabled_member_count or 0) * int(PAYMENT_XANAX_PER_MEMBER)
    return f"Send {total_amount} {PAYMENT_KIND} to {PAYMENT_PLAYER} [{PAYMENT_NOTIFY_USER_ID}]."


def get_faction_payment_status(faction_id: str, viewer_user_id: str = "") -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    viewer_user_id = _clean_text(viewer_user_id)

    if not faction_id:
        return {
            "ok": False,
            "error": "Missing faction_id.",
            **payment_config(),
        }

    license_status = compute_faction_license_status(faction_id, viewer_user_id=viewer_user_id) or {}
    enabled_member_count = _to_int(license_status.get("enabled_member_count"), 0)
    renewal_cost = _to_int(
        license_status.get("renewal_cost"),
        calc_faction_renewal_cost(faction_id),
    )

    out = {
        "ok": True,
        "faction_id": faction_id,
        "license": license_status,
        "renewal_cost": renewal_cost,
        "enabled_member_count": enabled_member_count,
        "payment_instruction": build_payment_instruction(enabled_member_count),
        **payment_config(),
    }

    if viewer_user_id:
        member_row = get_faction_member_access(faction_id, viewer_user_id) or {}
        out["viewer_member_access"] = member_row

    return out


def get_member_payment_status(member_user_id: str) -> Dict[str, Any]:
    member_user_id = _clean_text(member_user_id)
    if not member_user_id:
        return {
            "ok": False,
            "error": "Missing member_user_id.",
            **payment_config(),
        }

    member_row = get_member_access_record(member_user_id) or {}
    license_status = get_faction_license_for_member(member_user_id) or {}

    return {
        "ok": True,
        "member_user_id": member_user_id,
        "member_access": member_row,
        "license": license_status,
        **payment_config(),
    }


def list_faction_payment_history_service(faction_id: str, limit: int = 25) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {
            "ok": False,
            "error": "Missing faction_id.",
            "items": [],
            **payment_config(),
        }

    items = get_faction_payment_history(faction_id, limit=int(limit or 25)) or []
    return {
        "ok": True,
        "faction_id": faction_id,
        "items": items,
        **payment_config(),
    }


def get_faction_billing_overview(faction_id: str) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    if not faction_id:
        return {
            "ok": False,
            "error": "Missing faction_id.",
            **payment_config(),
        }

    license_status = compute_faction_license_status(faction_id) or {}
    members = list_faction_members(faction_id) or []
    enabled_members = [m for m in members if _safe_bool(m.get("enabled"))]
    renewal_cost = calc_faction_renewal_cost(faction_id)

    return {
        "ok": True,
        "faction_id": faction_id,
        "license": license_status,
        "members": members,
        "enabled_members": enabled_members,
        "enabled_member_count": len(enabled_members),
        "renewal_cost": renewal_cost,
        "payment_instruction": build_payment_instruction(len(enabled_members)),
        **payment_config(),
    }


def activate_faction_member_for_billing(
    faction_id: str,
    faction_name: str,
    leader_user_id: str,
    leader_name: str,
    member_user_id: str,
    member_name: str = "",
    member_api_key: str = "",
    position: str = "",
    actor_user_id: str = "",
    actor_name: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    faction_name = _clean_text(faction_name)
    leader_user_id = _clean_text(leader_user_id)
    leader_name = _clean_text(leader_name)
    member_user_id = _clean_text(member_user_id)
    member_name = _clean_text(member_name)
    member_api_key = _clean_text(member_api_key)
    position = _clean_text(position)
    actor_user_id = _clean_text(actor_user_id) or leader_user_id
    actor_name = _clean_text(actor_name) or leader_name

    if not faction_id:
        return {"ok": False, "error": "Missing faction_id."}
    if not member_user_id:
        return {"ok": False, "error": "Missing member_user_id."}

    row = upsert_faction_member_access(
        faction_id=faction_id,
        faction_name=faction_name,
        leader_user_id=leader_user_id,
        leader_name=leader_name,
        member_user_id=member_user_id,
        member_name=member_name,
        member_api_key=member_api_key,
        enabled=1,
        position=position,
    )

    recalc_faction_license(faction_id)
    license_status = compute_faction_license_status(faction_id, viewer_user_id=member_user_id) or {}

    try:
        add_notification(
            leader_user_id,
            "payment_member_activated",
            f"{member_name or member_user_id} activated. {PAYMENT_XANAX_PER_MEMBER} {PAYMENT_KIND} added to renewal.",
        )
    except Exception:
        pass

    try:
        add_audit_log(
            actor_user_id=actor_user_id,
            actor_name=actor_name,
            action="payment_member_activated",
            meta_json=f"faction_id={faction_id} member_user_id={member_user_id} amount={PAYMENT_XANAX_PER_MEMBER}",
        )
    except Exception:
        pass

    return {
        "ok": True,
        "message": "Faction member activated for billing.",
        "item": row or {},
        "license": license_status,
        "payment_added": PAYMENT_XANAX_PER_MEMBER,
        "payment_instruction": build_payment_instruction(_to_int(license_status.get("enabled_member_count"), 0)),
        **payment_config(),
    }


def set_member_billing_enabled(
    faction_id: str,
    member_user_id: str,
    enabled: Any,
    changed_by_user_id: str = "",
    changed_by_name: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    member_user_id = _clean_text(member_user_id)
    changed_by_user_id = _clean_text(changed_by_user_id)
    changed_by_name = _clean_text(changed_by_name)

    if not faction_id:
        return {"ok": False, "error": "Missing faction_id."}
    if not member_user_id:
        return {"ok": False, "error": "Missing member_user_id."}

    enabled_flag = 1 if _safe_bool(enabled) else 0

    try:
        row = set_faction_member_enabled(
            faction_id=faction_id,
            member_user_id=member_user_id,
            enabled=enabled_flag,
            changed_by_user_id=changed_by_user_id,
            changed_by_name=changed_by_name,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    license_status = compute_faction_license_status(faction_id, viewer_user_id=member_user_id) or {}
    return {
        "ok": True,
        "message": "Faction member billing updated.",
        "item": row or {},
        "enabled": bool(enabled_flag),
        "license": license_status,
        "payment_instruction": build_payment_instruction(_to_int(license_status.get("enabled_member_count"), 0)),
        **payment_config(),
    }


def remove_member_from_billing(
    faction_id: str,
    member_user_id: str,
    actor_user_id: str = "",
    actor_name: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    member_user_id = _clean_text(member_user_id)
    actor_user_id = _clean_text(actor_user_id)
    actor_name = _clean_text(actor_name)

    if not faction_id:
        return {"ok": False, "error": "Missing faction_id."}
    if not member_user_id:
        return {"ok": False, "error": "Missing member_user_id."}

    existing = get_faction_member_access(faction_id, member_user_id) or {}
    member_name = _clean_text(existing.get("member_name"))

    try:
        delete_faction_member_access(faction_id, member_user_id)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    license_status = compute_faction_license_status(faction_id) or {}

    try:
        add_audit_log(
            actor_user_id=actor_user_id,
            actor_name=actor_name,
            action="payment_member_removed",
            meta_json=f"faction_id={faction_id} member_user_id={member_user_id}",
        )
    except Exception:
        pass

    return {
        "ok": True,
        "message": "Faction member removed from billing.",
        "member_user_id": member_user_id,
        "member_name": member_name,
        "license": license_status,
        "payment_instruction": build_payment_instruction(_to_int(license_status.get("enabled_member_count"), 0)),
        **payment_config(),
    }


def create_manual_renewal_request(
    faction_id: str,
    requested_by_user_id: str = "",
    requested_by_name: str = "",
    note: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    requested_by_user_id = _clean_text(requested_by_user_id)
    requested_by_name = _clean_text(requested_by_name)
    note = _clean_text(note)

    if not faction_id:
        return {"ok": False, "error": "Missing faction_id."}

    license_status = compute_faction_license_status(faction_id, viewer_user_id=requested_by_user_id) or {}
    enabled_member_count = _to_int(license_status.get("enabled_member_count"), 0)
    renewal_cost = _to_int(license_status.get("renewal_cost"), calc_faction_renewal_cost(faction_id))
    leader_user_id = _clean_text(license_status.get("leader_user_id"))

    text = (
        f"Renewal requested by {requested_by_name or requested_by_user_id or 'unknown'} "
        f"for faction {license_status.get('faction_name') or faction_id}. "
        f"Amount due: {renewal_cost} {PAYMENT_KIND}. "
        f"{build_payment_instruction(enabled_member_count)}"
    )
    if note:
        text += f" Note: {note}"

    try:
        if leader_user_id:
            add_notification(leader_user_id, "payment_request", text)
    except Exception:
        pass

    try:
        if PAYMENT_NOTIFY_USER_ID:
            add_notification(PAYMENT_NOTIFY_USER_ID, "payment_request", text)
    except Exception:
        pass

    try:
        add_audit_log(
            actor_user_id=requested_by_user_id,
            actor_name=requested_by_name,
            action="payment_renewal_requested",
            meta_json=f"faction_id={faction_id} renewal_cost={renewal_cost}",
        )
    except Exception:
        pass

    return {
        "ok": True,
        "message": "Renewal request created.",
        "faction_id": faction_id,
        "renewal_cost": renewal_cost,
        "payment_instruction": build_payment_instruction(enabled_member_count),
        "license": license_status,
        **payment_config(),
    }


def confirm_faction_payment_and_renew(
    faction_id: str,
    amount: Any,
    renewed_by: str = "",
    note: str = "",
    payment_player: str = "",
) -> Dict[str, Any]:
    faction_id = _clean_text(faction_id)
    renewed_by = _clean_text(renewed_by) or OWNER_NAME
    note = _clean_text(note)
    payment_player = _clean_text(payment_player) or PAYMENT_PLAYER
    amount_int = _to_int(amount, 0)

    if not faction_id:
        return {"ok": False, "error": "Missing faction_id."}

    row = renew_faction_after_payment(
        faction_id=faction_id,
        amount=amount_int,
        payment_player=payment_player,
        renewed_by=renewed_by,
        note=note,
    )

    license_status = compute_faction_license_status(faction_id) or {}
    return {
        "ok": True,
        "message": "Faction renewed.",
        "item": row or {},
        "license": license_status,
        **payment_config(),
    }


def get_due_factions(limit: int = 250) -> Dict[str, Any]:
    items = list_all_faction_licenses(limit=int(limit or 250)) or []
    due_items: List[Dict[str, Any]] = []

    for item in items:
        lic = item.get("license") or item
        if lic.get("payment_required") or str(lic.get("status") or "").lower() in {"expired", "due"}:
            due_items.append(item)

    return {
        "ok": True,
        "items": due_items,
        "count": len(due_items),
        **payment_config(),
    }


def get_payment_dashboard(limit: int = 250) -> Dict[str, Any]:
    dashboard = get_owner_faction_dashboard(limit=int(limit or 250)) or {}
    items = dashboard.get("factions") or []
    due_items = []

    for item in items:
        lic = item.get("license") or item
        if lic.get("payment_required") or str(lic.get("status") or "").lower() in {"expired", "due"}:
            due_items.append(item)

    return {
        "ok": True,
        "dashboard": dashboard,
        "due_items": due_items,
        "due_count": len(due_items),
        **payment_config(),
    }


def run_payment_warning_scan(limit: int = 500) -> Dict[str, Any]:
    items = list_all_faction_licenses(limit=int(limit or 500)) or []
    warned: List[Dict[str, Any]] = []

    for item in items:
        lic = item.get("license") or item
        faction_id = _clean_text(lic.get("faction_id") or item.get("faction_id"))
        faction_name = _clean_text(lic.get("faction_name") or item.get("faction_name"))
        leader_user_id = _clean_text(lic.get("leader_user_id") or item.get("leader_user_id"))
        payment_required = bool(lic.get("payment_required"))
        status = _clean_text(lic.get("status")).lower()
        renewal_cost = _to_int(lic.get("renewal_cost"), 0)
        enabled_member_count = _to_int(lic.get("enabled_member_count"), 0)

        if not faction_id:
            continue

        if payment_required or status in {"expired", "due"}:
            text = (
                f"Faction payment due for {faction_name or faction_id}. "
                f"Owed: {renewal_cost} {PAYMENT_KIND}. "
                f"{build_payment_instruction(enabled_member_count)}"
            )

            try:
                if leader_user_id:
                    add_notification(leader_user_id, "payment_due", text)
            except Exception:
                pass

            try:
                if PAYMENT_NOTIFY_USER_ID:
                    add_notification(PAYMENT_NOTIFY_USER_ID, "payment_due", text)
            except Exception:
                pass

            warned.append({
                "faction_id": faction_id,
                "faction_name": faction_name,
                "renewal_cost": renewal_cost,
            })

    return {
        "ok": True,
        "message": "Payment warning scan complete.",
        "warned": warned,
        "count": len(warned),
        **payment_config(),
    }


def run_payment_due_scan(limit: int = 500) -> Dict[str, Any]:
    items = list_all_faction_licenses(limit=int(limit or 500)) or []
    due_items: List[Dict[str, Any]] = []

    for item in items:
        lic = item.get("license") or item
        if bool(lic.get("payment_required")) or str(lic.get("status") or "").lower() in {"expired", "due"}:
            due_items.append(item)

    return {
        "ok": True,
        "message": "Payment due scan complete.",
        "items": due_items,
        "count": len(due_items),
        **payment_config(),
    }


def run_payment_auto_match() -> Dict[str, Any]:
    return {
        "ok": True,
        "message": "Auto-match placeholder ready. No live payment feed is connected yet.",
        "matched": [],
        **payment_config(),
    }
