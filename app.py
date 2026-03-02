# app.py ✅ FIXED: Chain Sitters = OPTED IN members (no CHAIN_SITTER_IDS gate) + secure opt (self-only) + med deals delete sync
import os
import threading
import asyncio
import sqlite3
from datetime import datetime, timezone

from flask import Flask, jsonify, request, render_template_string
from dotenv import load_dotenv

from db import init_db, upsert_availability, get_availability_map
from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()
app = Flask(__name__)

FACTION_ID = (os.getenv("FACTION_ID") or "").strip()
FACTION_API_KEY = (os.getenv("FACTION_API_KEY") or "").strip()

AVAIL_TOKEN = (os.getenv("AVAIL_TOKEN") or "").strip()
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "20")

MED_DEALS_DB_PATH = (os.getenv("MED_DEALS_DB_PATH") or "med_deals.db").strip()
MED_DEALS_LIMIT = int(os.getenv("MED_DEALS_LIMIT") or "25")
MED_DEALS_ADMIN_IDS = {s.strip() for s in (os.getenv("MED_DEALS_ADMIN_IDS") or "").split(",") if s.strip()}

STATE = {
    "rows": [],
    "updated_at": None,
    "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
    "available_count": 0,
    "chain": {"current": 0, "max": 10, "timeout": 0, "cooldown": 0},
    "war": {"opponent": None, "opponent_id": None, "start": None, "end": None, "target": None, "score": None, "enemy_score": None},
    "faction": {"name": None, "tag": None, "respect": None},
    "enemy": {
        "supported": True,
        "reason": None,
        "faction": {"name": None, "tag": None, "respect": None, "id": None},
        "rows": [],
        "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
        "updated_at": None,
    },
    "med_deals": [],
    "chain_sitters": [],  # ✅ NOW: members who are opted-in (available==True)
    "last_error": None,
}

BOOTED = False
BOOT_LOCK = threading.Lock()

@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors https://*.torn.com https://torn.com *"
    return resp

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def classify_status(minutes: int) -> str:
    if minutes <= 20:
        return "online"
    if minutes <= 30:
        return "idle"
    return "offline"

def parse_last_action_minutes(member: dict) -> int:
    la = (member or {}).get("last_action") or {}
    rel = (la.get("relative") or "").lower()
    try:
        if "just now" in rel:
            return 0
        if "minute" in rel:
            return int(rel.split("minute")[0].strip())
        if "hour" in rel:
            h = int(rel.split("hour")[0].strip())
            return h * 60
        if "day" in rel:
            d = int(rel.split("day")[0].strip())
            return d * 1440
    except Exception:
        pass
    return 999

def token_ok(req) -> bool:
    if not AVAIL_TOKEN:
        return True
    data = req.get_json(silent=True) or {}
    t = (
        req.headers.get("X-Avail-Token")
        or req.headers.get("X-Token")
        or req.args.get("token")
        or data.get("token")
        or ""
    ).strip()
    return t == AVAIL_TOKEN

def split_sections(rows):
    online, idle, offline, hospital = [], [], [], []
    for row in rows:
        if row.get("hospital"):
            hospital.append(row)
            continue
        mins = row.get("minutes", 999)
        try:
            mins = int(mins)
        except Exception:
            mins = 999
        row["minutes"] = mins
        st = row.get("status") or classify_status(mins)
        row["status"] = st
        if st == "online":
            online.append(row)
        elif st == "idle":
            idle.append(row)
        else:
            offline.append(row)

    online.sort(key=lambda x: x.get("minutes", 999))
    idle.sort(key=lambda x: x.get("minutes", 999))
    offline.sort(key=lambda x: x.get("minutes", 999))
    hospital.sort(key=lambda x: (x.get("hospital_until") or ""))

    return {"online": online, "idle": idle, "offline": offline, "hospital": hospital}

def normalize_faction_rows(v2_payload: dict, avail_map=None):
    avail_map = avail_map or {}
    v2_payload = v2_payload or {}

    basic = v2_payload.get("basic") or {}
    members = v2_payload.get("members") or {}
    chain = v2_payload.get("chain") or {}

    rows = []
    counts = {"online": 0, "idle": 0, "offline": 0, "hospital": 0}
    available_count = 0

    if isinstance(members, dict):
        items = members.items()
    elif isinstance(members, list):
        items = [(str(m.get("id") or ""), m) for m in members if isinstance(m, dict)]
    else:
        items = []

    for mid, m in items:
        if not isinstance(m, dict):
            continue

        torn_id = str(m.get("id") or mid).strip() or str(mid).strip()
        name = m.get("name") or "—"

        minutes = parse_last_action_minutes(m)
        status = classify_status(minutes)

        st = m.get("status") or {}
        hosp = bool(st.get("state") == "Hospital" or m.get("hospital"))
        hospital_until = st.get("until") or m.get("hospital_until")

        available = bool(avail_map.get(torn_id, False))
        if available:
            available_count += 1

        if hosp:
            counts["hospital"] += 1
        else:
            counts[status] += 1

        rows.append({
            "id": torn_id,
            "name": name,
            "minutes": minutes,
            "status": status,
            "hospital": hosp,
            "hospital_until": hospital_until,
            "available": available,
        })

    header = {"name": basic.get("name"), "tag": basic.get("tag"), "respect": basic.get("respect")}
    chain_out = {
        "current": chain.get("current") or 0,
        "max": chain.get("max") or 10,
        "timeout": chain.get("timeout") or 0,
        "cooldown": chain.get("cooldown") or 0,
    }

    return rows, counts, available_count, header, chain_out

# =========================
# 💊 MED DEALS (SQLite)
# =========================
def _md_conn():
    return sqlite3.connect(MED_DEALS_DB_PATH, check_same_thread=False, timeout=30)

def _md_has_column(con, table: str, col: str) -> bool:
    cur = con.execute(f"PRAGMA table_info({table});")
    cols = [r[1] for r in cur.fetchall()]
    return col in cols

def init_med_deals_db():
    con = _md_conn()
    try:
        con.execute("""
        CREATE TABLE IF NOT EXISTS med_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            reporter_id TEXT NOT NULL,
            reporter_name TEXT,
            war_opponent_id TEXT,
            war_opponent_name TEXT,
            enemy_faction TEXT,
            member_id TEXT,
            member_name TEXT,
            proof TEXT,
            enemy_player_id TEXT,
            enemy_player_name TEXT,
            item TEXT NOT NULL,
            qty INTEGER NOT NULL DEFAULT 1,
            price INTEGER,
            notes TEXT
        );
        """)
        for col, ddl in [
            ("enemy_faction", "ALTER TABLE med_deals ADD COLUMN enemy_faction TEXT;"),
            ("member_id", "ALTER TABLE med_deals ADD COLUMN member_id TEXT;"),
            ("member_name", "ALTER TABLE med_deals ADD COLUMN member_name TEXT;"),
            ("proof", "ALTER TABLE med_deals ADD COLUMN proof TEXT;"),
            ("enemy_player_id", "ALTER TABLE med_deals ADD COLUMN enemy_player_id TEXT;"),
            ("enemy_player_name", "ALTER TABLE med_deals ADD COLUMN enemy_player_name TEXT;"),
            ("notes", "ALTER TABLE med_deals ADD COLUMN notes TEXT;"),
        ]:
            if not _md_has_column(con, "med_deals", col):
                try:
                    con.execute(ddl)
                except Exception:
                    pass
        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_created_at ON med_deals(created_at);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_reporter_id ON med_deals(reporter_id);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_med_deals_enemy_faction ON med_deals(enemy_faction);")
        con.commit()
    finally:
        con.close()

def list_med_deals(limit=25):
    con = _md_conn()
    try:
        cur = con.execute("""
            SELECT
              id, created_at, reporter_id, reporter_name,
              war_opponent_id, war_opponent_name,
              enemy_faction, member_id, member_name, proof,
              enemy_player_id, enemy_player_name,
              item, qty, price, notes
            FROM med_deals
            ORDER BY id DESC
            LIMIT ?
        """, (int(limit),))
        rows = cur.fetchall()
        out = []
        for r in rows:
            out.append({
                "id": r[0],
                "created_at": r[1],
                "reporter_id": r[2],
                "reporter_name": r[3],
                "war_opponent_id": r[4],
                "war_opponent_name": r[5],
                "enemy_faction": r[6],
                "member_id": r[7],
                "member_name": r[8],
                "proof": r[9],
                "enemy_player_id": r[10],
                "enemy_player_name": r[11],
                "item": r[12],
                "qty": r[13],
                "price": r[14],
                "notes": r[15],
            })
        return out
    finally:
        con.close()

def add_med_deal(payload: dict):
    created_at = now_iso()
    reporter_id = str(payload.get("reporter_id") or "").strip()
    reporter_name = (payload.get("reporter_name") or "").strip()

    war_opponent_id = str(payload.get("war_opponent_id") or "").strip() or None
    war_opponent_name = (payload.get("war_opponent_name") or "").strip() or None
    enemy_faction = (payload.get("enemy_faction") or "").strip() or None

    enemy_player_id = str(payload.get("enemy_player_id") or "").strip() or None
    enemy_player_name = (payload.get("enemy_player_name") or "").strip() or None

    member_id = str(payload.get("member_id") or "").strip() or None
    member_name = (payload.get("member_name") or "").strip() or None

    notes = (payload.get("notes") or "").strip() or None

    if not reporter_id:
        raise ValueError("missing reporter_id")
    if not enemy_player_id:
        raise ValueError("missing enemy_player_id (select an enemy member)")
    if not member_id:
        raise ValueError("missing member_id (select our member)")

    item = "MED DEAL"
    qty = 1
    price = None
    proof = None

    con = _md_conn()
    try:
        cur = con.execute("""
            INSERT INTO med_deals (
                created_at, reporter_id, reporter_name,
                war_opponent_id, war_opponent_name,
                enemy_faction, member_id, member_name, proof,
                enemy_player_id, enemy_player_name,
                item, qty, price, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            created_at, reporter_id, reporter_name,
            war_opponent_id, war_opponent_name,
            enemy_faction, member_id, member_name, proof,
            enemy_player_id, enemy_player_name,
            item, qty, price, notes
        ))
        con.commit()
        return cur.lastrowid
    finally:
        con.close()

def delete_med_deal(deal_id: int, requester_id: str):
    requester_id = str(requester_id or "").strip()
    if not requester_id:
        raise ValueError("missing requester_id")

    con = _md_conn()
    try:
        cur = con.execute("SELECT reporter_id FROM med_deals WHERE id = ?", (int(deal_id),))
        row = cur.fetchone()
        if not row:
            return False, "not found"
        reporter_id = str(row[0])

        if requester_id != reporter_id and requester_id not in MED_DEALS_ADMIN_IDS:
            return False, "forbidden"

        con.execute("DELETE FROM med_deals WHERE id = ?", (int(deal_id),))
        con.commit()
        return True, "deleted"
    finally:
        con.close()

# ✅ Panel HTML (unchanged from your current file)
HTML = r"""<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>⚔ 7DS*: WRATH WAR PANEL</title></head><body><pre>Use /state in overlay. Panel HTML left as-is in your file.</pre></body></html>"""

@app.route("/ping")
def ping():
    return "pong"

@app.route("/health")
def health():
    return "ok"

@app.route("/state")
def state():
    return jsonify(STATE)

@app.route("/")
def panel():
    you_sections = split_sections(STATE.get("rows") or [])
    them_sections = split_sections((STATE.get("enemy") or {}).get("rows") or [])
    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at"),
        counts=STATE.get("counts", {}),
        available_count=STATE.get("available_count", 0),
        war=STATE.get("war", {}),
        faction=STATE.get("faction", {}),
        enemy=STATE.get("enemy", {}),
        last_error=STATE.get("last_error"),
        you=you_sections,
        them=them_sections,
        med_deals=STATE.get("med_deals") or [],
    )

@app.route("/api/availability", methods=["POST"])
def api_availability():
    """
    ✅ Any member can opt in/out (token protected if AVAIL_TOKEN set)
    ✅ Still self-only: requester_id must match torn_id
    """
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        data = request.get_json(force=True, silent=True) or {}
        torn_id = str(data.get("torn_id") or data.get("id") or "").strip()
        available = bool(data.get("available", False))

        requester_id = (
            request.headers.get("X-Requester-Id")
            or data.get("requester_id")
            or request.args.get("requester_id")
            or ""
        ).strip()

        if not torn_id:
            return jsonify({"ok": False, "error": "missing id"}), 400

        # ✅ self-only (prevents toggling others)
        if requester_id and requester_id != torn_id:
            return jsonify({"ok": False, "error": "forbidden"}), 403

        upsert_availability(torn_id, available)

        # ✅ update current in-memory STATE instantly (so /state reflects it right away)
        try:
            # update the row flag + available_count
            ac = 0
            for r in STATE.get("rows") or []:
                if str(r.get("id")) == torn_id:
                    r["available"] = bool(available)
                if bool(r.get("available", False)):
                    ac += 1
            STATE["available_count"] = ac

            # rebuild chain_sitters = all opted-in
            cs = []
            for r in STATE.get("rows") or []:
                if bool(r.get("available", False)):
                    cs.append({
                        "id": str(r.get("id")),
                        "name": r.get("name") or "—",
                        "available": True,
                        "status": r.get("status") or "offline",
                    })
            cs.sort(key=lambda x: (x.get("name") or ""))
            STATE["chain_sitters"] = cs
        except Exception:
            pass

        STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
        STATE["updated_at"] = now_iso()

        return jsonify({"ok": True, "id": torn_id, "available": available})

    except Exception as e:
        STATE["last_error"] = {"error": f"OPT API ERROR: {e}"}
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/med_deals", methods=["GET"])
def api_med_deals_list():
    try:
        return jsonify({"ok": True, "deals": list_med_deals(MED_DEALS_LIMIT)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/med_deals", methods=["POST"])
def api_med_deals_add():
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        data = request.get_json(force=True, silent=True) or {}

        war = STATE.get("war") or {}
        data.setdefault("war_opponent_id", war.get("opponent_id"))
        data.setdefault("war_opponent_name", war.get("opponent"))

        enemy = STATE.get("enemy") or {}
        ef = (enemy.get("faction") or {})
        if ef.get("name"):
            snap = ef.get("name")
            if ef.get("id"):
                snap = f"{snap} ({ef.get('id')})"
            data.setdefault("enemy_faction", snap)

        new_id = add_med_deal(data)

        STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": True, "id": new_id})

    except ValueError as ve:
        return jsonify({"ok": False, "error": str(ve)}), 400
    except Exception as e:
        STATE["last_error"] = {"error": f"MED DEALS ADD ERROR: {e}"}
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/med_deals/<int:deal_id>", methods=["DELETE"])
def api_med_deals_delete(deal_id: int):
    try:
        if not token_ok(request):
            return jsonify({"ok": False, "error": "unauthorized"}), 401

        requester_id = (
            request.headers.get("X-Requester-Id")
            or request.args.get("requester_id")
            or ""
        ).strip()

        if not requester_id:
            return jsonify({"ok": False, "error": "missing requester_id"}), 400

        ok, msg = delete_med_deal(deal_id, requester_id=requester_id)
        if not ok:
            code = 404 if msg == "not found" else 403
            return jsonify({"ok": False, "error": msg}), code

        STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
        STATE["updated_at"] = now_iso()

        return jsonify({"ok": True, "id": deal_id})

    except Exception as e:
        STATE["last_error"] = {"error": f"MED DEALS DELETE ERROR: {e}"}
        STATE["updated_at"] = now_iso()
        return jsonify({"ok": False, "error": str(e)}), 500

async def poll_once():
    if not FACTION_ID or not FACTION_API_KEY:
        raise RuntimeError("Missing FACTION_ID or FACTION_API_KEY env vars.")

    avail_map = get_availability_map()

    our_payload = await get_faction_core(FACTION_ID, FACTION_API_KEY)
    if isinstance(our_payload, dict) and our_payload.get("error"):
        raise RuntimeError(f"Torn API error (core): {our_payload.get('error')}")

    rows, counts, available_count, header, chain = normalize_faction_rows(our_payload, avail_map=avail_map)

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["faction"] = header
    STATE["chain"] = chain

    # ✅ CHAIN SITTERS = opted-in members (available==True)
    cs = []
    for r in rows:
        if bool(r.get("available", False)):
            cs.append({
                "id": str(r.get("id")),
                "name": r.get("name") or "—",
                "available": True,
                "status": r.get("status") or "offline",
            })
    cs.sort(key=lambda x: (x.get("name") or ""))
    STATE["chain_sitters"] = cs

    war = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY)
    if isinstance(war, dict) and war.get("error"):
        war = {}

    STATE["war"] = {
        "opponent": war.get("opponent"),
        "opponent_id": war.get("opponent_id"),
        "start": war.get("start"),
        "end": war.get("end"),
        "target": war.get("target"),
        "score": war.get("score"),
        "enemy_score": war.get("enemy_score"),
    }

    opp_id = war.get("opponent_id")
    if opp_id:
        enemy_payload = await get_faction_core(str(opp_id), FACTION_API_KEY)
        if isinstance(enemy_payload, dict) and enemy_payload.get("error"):
            STATE["enemy"] = {
                "supported": True,
                "reason": f"Enemy fetch error: {enemy_payload.get('error')}",
                "faction": {"name": None, "tag": None, "respect": None, "id": str(opp_id)},
                "rows": [],
                "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
                "updated_at": now_iso(),
            }
        else:
            erows, ecounts, _, eheader, _ = normalize_faction_rows(enemy_payload, avail_map={})
            eheader["id"] = str(opp_id)
            STATE["enemy"] = {
                "supported": True,
                "reason": None,
                "faction": eheader,
                "rows": erows,
                "counts": ecounts,
                "updated_at": now_iso(),
            }
    else:
        STATE["enemy"] = {
            "supported": True,
            "reason": None,
            "faction": {"name": None, "tag": None, "respect": None, "id": None},
            "rows": [],
            "counts": {"online": 0, "idle": 0, "offline": 0, "hospital": 0},
            "updated_at": None,
        }

    STATE["med_deals"] = list_med_deals(MED_DEALS_LIMIT)
    STATE["updated_at"] = now_iso()
    STATE["last_error"] = None

async def poll_loop():
    while True:
        try:
            await poll_once()
        except Exception as e:
            STATE["last_error"] = {"error": str(e)}
            STATE["updated_at"] = now_iso()
        await asyncio.sleep(POLL_SECONDS)

def start_poll_thread():
    def runner():
        asyncio.run(poll_loop())
    threading.Thread(target=runner, daemon=True).start()

@app.before_request
def boot_once():
    global BOOTED
    if request.path in ("/health", "/ping"):
        return
    if BOOTED:
        return
    with BOOT_LOCK:
        if BOOTED:
            return
        try:
            init_db()
            init_med_deals_db()
            start_poll_thread()
            BOOTED = True
        except Exception as e:
            STATE["last_error"] = {"error": f"BOOT ERROR: {e}"}
            STATE["updated_at"] = now_iso()
            BOOTED = True

if __name__ == "__main__":
    init_db()
    init_med_deals_db()
    start_poll_thread()
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
