import os
import threading
import asyncio
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
CHAIN_SITTER_IDS = [s.strip() for s in (os.getenv("CHAIN_SITTER_IDS") or "").split(",") if s.strip()]
POLL_SECONDS = int(os.getenv("POLL_SECONDS") or "20")

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


def is_chain_sitter(torn_id: str) -> bool:
    return torn_id in set(CHAIN_SITTER_IDS)


def token_ok(req) -> bool:
    """
    Accept token from:
      - Header: X-Avail-Token (old)
      - Header: X-Token (userscript)
      - Query:  ?token=
      - Body:   {token: "..."}
    """
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


HTML = """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>⚔ 7DS*: WRATH WAR PANEL</title>
  <style>
    body { background:#0b0b0b; color:#f2f2f2; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; margin:0; padding:10px; }
    .topbar { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
    .title { font-weight:900; letter-spacing:.6px; font-size:16px; }
    .meta { font-size:12px; opacity:.85; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .pill { display:inline-block; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); font-size:12px; white-space:nowrap; }
    .btn { cursor:pointer; user-select:none; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); font-size:12px; white-space:nowrap; }
    .btn.on { border-color: rgba(0,255,102,.30); }
    .divider { margin:14px 0; height:1px; background:rgba(255,255,255,.10); }
    .section-title { font-weight:900; letter-spacing:.6px; margin-top:10px; margin-bottom:6px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
    .section-title .small { font-size:12px; opacity:.8; font-weight:600; }
    h2 { margin:12px 0 6px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,.08); font-size:14px; letter-spacing:.4px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .member { padding:8px 10px; margin:6px 0; border-radius:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:13px; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06); }
    .left { display:flex; flex-direction:column; gap:2px; min-width:0; }
    .name { font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:68vw; }
    .sub { opacity:.75; font-size:11px; }
    .right { opacity:.9; font-size:12px; white-space:nowrap; }
    .online{ border-left:4px solid #00ff66; } .idle{ border-left:4px solid #ffd000; } .offline{ border-left:4px solid #ff3333; } .hospital{ border-left:4px solid #b06cff; }
    .section-empty { opacity:.7; font-size:12px; padding:8px 2px; }
    .err { margin-top:10px; padding:10px; border-radius:12px; background:rgba(255,80,80,.12); border:1px solid rgba(255,80,80,.25); font-size:12px; white-space:pre-wrap; }
    .warbox { margin-top:10px; padding:10px; border-radius:12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.07); font-size:12px; line-height:1.35; }
    .warrow { display:flex; justify-content:space-between; gap:10px; margin:3px 0; }
    .label { opacity:.75; }

    .optwrap{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .optlabel{ opacity:.85; }
    .optinput{
      width:110px; padding:7px 10px; border-radius:999px;
      background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.10);
      color:#f2f2f2; outline:none; font-size:12px;
    }
    .toast{
      position:fixed; left:50%; bottom:16px; transform:translateX(-50%);
      z-index:999999; padding:10px 12px; border-radius:12px;
      background:rgba(0,0,0,.78); border:1px solid rgba(255,255,255,.10);
      color:#f2f2f2; font-size:12px; opacity:0; pointer-events:none;
      transition:opacity .18s ease;
      max-width:92vw; white-space:pre-wrap;
    }
    .toast.show{ opacity:1; }
  </style>
</head>
<body>

  <div class="topbar">
    <div class="title">⚔ 7DS*: WRATH WAR PANEL</div>
    <div class="meta">
      <span id="rt-updated">Updated: —</span>
      <span class="pill" id="rt-online">🟢 0</span>
      <span class="pill" id="rt-idle">🟡 0</span>
      <span class="pill" id="rt-offline">🔴 0</span>
      <span class="pill" id="rt-hospital">🏥 0</span>
      <span class="pill" id="rt-avail">✅ Avail: 0</span>

      <span class="btn" id="rt-refresh">Refresh now</span>

      <span class="optwrap">
        <span class="optlabel">Your ID:</span>
        <input class="optinput" id="rt-myid" inputmode="numeric" placeholder="e.g. 1234" />
        <span class="btn" id="rt-opt"><span id="rt-opt-text">OPT IN</span></span>
      </span>
    </div>
  </div>

  <div id="rt-error" class="err" style="display:none;"></div>
  <div id="rt-war" style="display:none;" class="warbox"></div>

  <div class="section-title">
    <div>🛡️ YOUR FACTION</div>
    <div class="small" id="rt-you-title">—</div>
  </div>

  <h2>🟢 ONLINE (0–20 mins) <span class="pill" id="rt-you-online-count">0</span></h2>
  <div id="rt-you-online"></div>

  <h2>🟡 IDLE (20–30 mins) <span class="pill" id="rt-you-idle-count">0</span></h2>
  <div id="rt-you-idle"></div>

  <h2>🏥 HOSPITAL <span class="pill" id="rt-you-hosp-count">0</span></h2>
  <div id="rt-you-hosp"></div>

  <h2>🔴 OFFLINE (30+ mins) <span class="pill" id="rt-you-offline-count">0</span></h2>
  <div id="rt-you-offline"></div>

  <div class="divider"></div>

  <div class="section-title">
    <div>🎯 ENEMY FACTION</div>
    <div class="small" id="rt-them-title">Waiting for opponent id…</div>
  </div>

  <div id="rt-enemy-wrap" style="display:none;">
    <h2>🟢 ENEMY ONLINE <span class="pill" id="rt-them-online-count">0</span></h2>
    <div id="rt-them-online"></div>

    <h2>🟡 ENEMY IDLE <span class="pill" id="rt-them-idle-count">0</span></h2>
    <div id="rt-them-idle"></div>

    <h2>🏥 ENEMY HOSPITAL <span class="pill" id="rt-them-hosp-count">0</span></h2>
    <div id="rt-them-hosp"></div>

    <h2>🔴 ENEMY OFFLINE <span class="pill" id="rt-them-offline-count">0</span></h2>
    <div id="rt-them-offline"></div>
  </div>

  <div id="rt-toast" class="toast"></div>

<script>
  const REFRESH_MS = 8000;
  const AVAIL_TOKEN = {{ avail_token_json|safe }};
  const PREFILL_XID = {{ prefill_xid_json|safe }};

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (s ?? "").toString().replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));

  function toast(msg){
    const t = $("rt-toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  function fmtMins(n){
    if (typeof n !== "number") return "—";
    if (n < 60) return `${n}m`;
    const h = Math.floor(n/60), m = n%60;
    return `${h}h ${m}m`;
  }

  function hospLeft(until){
    const t = Number(until);
    if (!t) return "in hospital";
    const now = Date.now()/1000;
    const mins = Math.max(0, Math.round((t - now)/60));
    if (mins <= 0) return "in hospital";
    if (mins < 60) return `${mins}m left`;
    const h = Math.floor(mins/60), m = mins%60;
    return `${h}h ${m}m left`;
  }

  function memberHTML(r, st){
    const name = esc(r.name || r.id || "Unknown");
    const id = esc(r.id || "");
    const right = st === "hospital" ? hospLeft(r.hospital_until) : fmtMins(r.minutes);
    const avail = !!r.available;
    const a = avail ? " ✅ OPTED" : "";
    return `
      <div class="member ${st}">
        <div class="left">
          <div class="name">${name}${a}</div>
          <div class="sub">ID: ${id}</div>
        </div>
        <div class="right">${esc(right)}</div>
      </div>
    `;
  }

  function split(rows){
    const online=[], idle=[], offline=[], hosp=[];
    for (const r of (rows||[])){
      const isHosp = !!r.hospital || r.status === "hospital";
      if (isHosp) { hosp.push(r); continue; }
      if (r.status === "online") online.push(r);
      else if (r.status === "idle") idle.push(r);
      else offline.push(r);
    }
    online.sort((a,b)=>(a.minutes??999999)-(b.minutes??999999));
    idle.sort((a,b)=>(a.minutes??999999)-(b.minutes??999999));
    offline.sort((a,b)=>(a.minutes??999999)-(b.minutes??999999));
    hosp.sort((a,b)=>(Number(a.hospital_until)||9999999999)-(Number(b.hospital_until)||9999999999));
    return {online,idle,offline,hosp};
  }

  function setList(el, arr, st, emptyText){
    el.innerHTML = "";
    if (!arr.length){
      el.innerHTML = `<div class="section-empty">${esc(emptyText)}</div>`;
      return;
    }
    for (const r of arr){
      el.insertAdjacentHTML("beforeend", memberHTML(r, st));
    }
  }

  function getMyId(){
    return ($("rt-myid").value || "").trim();
  }
  function setMyId(v){
    $("rt-myid").value = (v || "").trim();
  }

  function findMyAvail(state, myId){
    if (!myId) return false;
    const rows = state.rows || [];
    const hit = rows.find(r => String(r.id) === String(myId));
    return !!(hit && hit.available);
  }

  function syncOptUI(isOn){
    const b = $("rt-opt");
    const t = $("rt-opt-text");
    b.classList.toggle("on", !!isOn);
    t.textContent = isOn ? "OPTED IN" : "OPT IN";
  }

  function render(state){
    const err = $("rt-error");
    if (state.last_error){
      err.style.display = "block";
      err.textContent = "Last error:\\n" + JSON.stringify(state.last_error, null, 2);
    } else {
      err.style.display = "none";
      err.textContent = "";
    }

    const c = state.counts || {};
    $("rt-updated").textContent = `Updated: ${state.updated_at || "—"}`;
    $("rt-online").textContent = `🟢 ${c.online ?? 0}`;
    $("rt-idle").textContent = `🟡 ${c.idle ?? 0}`;
    $("rt-offline").textContent = `🔴 ${c.offline ?? 0}`;
    $("rt-hospital").textContent = `🏥 ${c.hospital ?? 0}`;
    $("rt-avail").textContent = `✅ Avail: ${state.available_count ?? 0}`;

    const f = state.faction || {};
    $("rt-you-title").textContent = `${(f.tag?`[${f.tag}] `:"")}${f.name || ""}`.trim() || "—";

    const w = state.war || {};
    const warShow = (w.opponent || w.target || w.score !== null || w.enemy_score !== null);
    const warEl = $("rt-war");
    warEl.style.display = warShow ? "block" : "none";
    if (warShow){
      warEl.innerHTML = `
        <div class="warrow"><div class="label">Opponent</div><div>${esc(w.opponent || "—")}</div></div>
        <div class="warrow"><div class="label">Opponent ID</div><div>${esc(w.opponent_id || "—")}</div></div>
        <div class="warrow"><div class="label">Our Score</div><div>${esc(w.score ?? "—")}</div></div>
        <div class="warrow"><div class="label">Enemy Score</div><div>${esc(w.enemy_score ?? "—")}</div></div>
        <div class="warrow"><div class="label">Target</div><div>${esc(w.target ?? "—")}</div></div>
        <div class="warrow"><div class="label">Start</div><div>${esc(w.start || "—")}</div></div>
        <div class="warrow"><div class="label">End</div><div>${esc(w.end || "—")}</div></div>
      `;
    }

    const you = split(state.rows || []);
    $("rt-you-online-count").textContent = you.online.length;
    $("rt-you-idle-count").textContent = you.idle.length;
    $("rt-you-hosp-count").textContent = you.hosp.length;
    $("rt-you-offline-count").textContent = you.offline.length;

    setList($("rt-you-online"), you.online, "online", "No one online right now.");
    setList($("rt-you-idle"), you.idle, "idle", "No one idle right now.");
    setList($("rt-you-hosp"), you.hosp, "hospital", "No one in hospital right now.");
    setList($("rt-you-offline"), you.offline, "offline", "No one offline right now.");

    const enemy = state.enemy || {};
    const ef = enemy.faction || {};
    const hasEnemy = !!ef.name;

    $("rt-enemy-wrap").style.display = hasEnemy ? "block" : "none";
    $("rt-them-title").textContent = hasEnemy
      ? `${(ef.tag?`[${ef.tag}] `:"")}${ef.name} (ID: ${ef.id || "—"})`
      : "Waiting for opponent id…";

    if (hasEnemy){
      const them = split(enemy.rows || []);
      $("rt-them-online-count").textContent = them.online.length;
      $("rt-them-idle-count").textContent = them.idle.length;
      $("rt-them-hosp-count").textContent = them.hosp.length;
      $("rt-them-offline-count").textContent = them.offline.length;

      setList($("rt-them-online"), them.online, "online", "No enemy online right now.");
      setList($("rt-them-idle"), them.idle, "idle", "No enemy idle right now.");
      setList($("rt-them-hosp"), them.hosp, "hospital", "No enemy in hospital right now.");
      setList($("rt-them-offline"), them.offline, "offline", "No enemy offline right now.");
    }

    const myId = getMyId();
    syncOptUI(findMyAvail(state, myId));
  }

  async function refresh(){
    try{
      const r = await fetch("/state?cb=" + Date.now(), { cache: "no-store" });
      const data = await r.json();
      render(data);
    }catch(e){
      const err = $("rt-error");
      err.style.display = "block";
      err.textContent = "Failed to load /state\\n" + (e?.message || e);
    }
  }

  async function postOpt(tornId, available){
    const payload = { torn_id: String(tornId || ""), available: !!available };
    const qs = AVAIL_TOKEN ? ("?token=" + encodeURIComponent(AVAIL_TOKEN)) : "";
    const r = await fetch("/api/availability" + qs, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(AVAIL_TOKEN ? {"X-Token": AVAIL_TOKEN} : {})
      },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, body };
  }

  // 1) Load saved ID
  const saved = localStorage.getItem("wrath_myid") || "";
  if (saved) setMyId(saved);

  // 2) If opened with ?xid=1234, auto-fill and save
  if (PREFILL_XID && /^\d+$/.test(String(PREFILL_XID))) {
    setMyId(String(PREFILL_XID));
    localStorage.setItem("wrath_myid", String(PREFILL_XID));
  }

  $("rt-myid").addEventListener("input", () => {
    localStorage.setItem("wrath_myid", getMyId());
  });

  $("rt-refresh").addEventListener("click", () => refresh());

  $("rt-opt").addEventListener("click", async () => {
    const myId = getMyId();
    if (!myId || !/^\d+$/.test(myId)) {
      toast("Enter your Torn ID first.");
      return;
    }

    const isOn = $("rt-opt").classList.contains("on");
    const next = !isOn;

    // optimistic UI
    syncOptUI(next);

    const res = await postOpt(myId, next);
    if (!res.ok) {
      // rollback
      syncOptUI(!next);

      if (res.status === 403) toast("Not allowed: chain sitters only.");
      else if (res.status === 401) toast("Unauthorized: bad token.");
      else toast("OPT failed: " + (res.body?.error || ("HTTP " + res.status)));

      const err = $("rt-error");
      err.style.display = "block";
      err.textContent = "OPT error:\\n" + JSON.stringify(res.body || {}, null, 2);
      return;
    }

    toast(next ? `✅ OPTED IN (${myId})` : `✅ OPTED OUT (${myId})`);
    await refresh();
  });

  refresh();
  setInterval(refresh, REFRESH_MS);
</script>

</body>
</html>
"""


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
    """
    If userscript opens: https://yourapp/?xid=1234
    then we prefill the input automatically.
    """
    import json
    xid = (request.args.get("xid") or "").strip()
    if xid and not xid.isdigit():
        xid = ""

    return render_template_string(
        HTML,
        avail_token_json=json.dumps(AVAIL_TOKEN or ""),
        prefill_xid_json=json.dumps(xid or "")
    )


@app.route("/api/availability", methods=["POST"])
def api_availability():
    if not token_ok(request):
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(force=True, silent=True) or {}
    torn_id = str(data.get("torn_id") or data.get("id") or "").strip()
    available = bool(data.get("available", False))

    if not torn_id:
        return jsonify({"ok": False, "error": "missing id"}), 400

    if CHAIN_SITTER_IDS and (not is_chain_sitter(torn_id)):
        return jsonify({"ok": False, "error": "not chain sitter"}), 403

    upsert_availability(torn_id, available)
    return jsonify({"ok": True, "id": torn_id, "available": available})


async def poll_once():
    if not FACTION_ID or not FACTION_API_KEY:
        raise RuntimeError("Missing FACTION_ID or FACTION_API_KEY env vars.")

    avail_map = get_availability_map()

    # OUR FACTION
    our_payload = await get_faction_core(FACTION_ID, FACTION_API_KEY)
    if isinstance(our_payload, dict) and our_payload.get("error"):
        raise RuntimeError(f"Torn API error (core): {our_payload.get('error')}")

    rows, counts, available_count, header, chain = normalize_faction_rows(our_payload, avail_map=avail_map)

    STATE["rows"] = rows
    STATE["counts"] = counts
    STATE["available_count"] = available_count
    STATE["faction"] = header
    STATE["chain"] = chain

    # WAR
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

    # ENEMY FACTION (needs opponent_id)
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
    if BOOTED:
        return
    with BOOT_LOCK:
        if BOOTED:
            return
        init_db()
        start_poll_thread()
        BOOTED = True


if __name__ == "__main__":
    init_db()
    start_poll_thread()
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
