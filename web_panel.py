# web_panel.py
import os
from flask import Flask, jsonify, render_template_string, request

app = Flask(__name__)

# Shared secret (set same value in BOTH Render services / userscript)
WEB_SHARED_SECRET = (os.getenv("WEB_SHARED_SECRET") or "").strip()

# Optional debug (set DEBUG=1 on Render Web service if you want logs)
DEBUG = (os.getenv("DEBUG") or "").strip() == "1"

STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
}

@app.after_request
def headers(resp):
    # Allow Torn iframe embedding
    resp.headers.pop("X-Frame-Options", None)
    resp.headers["Content-Security-Policy"] = "frame-ancestors https://www.torn.com https://torn.com *"

    # CORS (Tampermonkey GM_xmlhttpRequest usually bypasses CORS, but keep correct anyway)
    origin = request.headers.get("Origin", "")
    allowed = {"https://www.torn.com", "https://torn.com"}
    if origin in allowed:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    else:
        resp.headers["Access-Control-Allow-Origin"] = "*"

    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    # IMPORTANT: include your secret header so preflight is happy if ever needed
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, X-STATE-SECRET"
    resp.headers["Access-Control-Max-Age"] = "86400"
    return resp

HTML = """<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Torn War Dashboard</title>
  <style>
    body { font-family:-apple-system,system-ui,Arial; padding:12px; background:#0f172a; color:#fff; }
    .meta { opacity:.95; font-size:14px; margin-bottom:10px; color:#fff; }
    .big { font-size:16px; font-weight:800; color:#fff; }
    .muted { opacity:.80; color:#fff; }
    .card { border:1px solid #334155; background:#1e293b; border-radius:12px; padding:10px; margin:10px 0; color:#fff; }
    table { border-collapse:collapse; width:100%; color:#fff; }
    th, td { border-bottom:1px solid #334155; padding:10px 8px; text-align:left; vertical-align:top; color:#fff !important; }
    th { position:sticky; top:0; background:#111827; color:#fff !important; z-index:2; }
    .chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:800;border:1px solid #334155;background:rgba(255,255,255,0.06);margin-right:6px;white-space:nowrap;}
    .chip-online{border-color:rgba(34,197,94,0.7);background:rgba(34,197,94,0.12);}
    .chip-idle{border-color:rgba(234,179,8,0.7);background:rgba(234,179,8,0.12);}
    .chip-offline{border-color:rgba(220,38,38,0.7);background:rgba(220,38,38,0.12);}
    .tag{padding:4px 10px;border-radius:999px;font-size:12px;display:inline-block;font-weight:900;white-space:nowrap;min-width:76px;text-align:center;border:1px solid rgba(51,65,85,1);}
    .tag-online{background:#16a34a;color:#fff !important;}
    .tag-idle{background:#eab308;color:#000 !important;}
    .tag-offline{background:#dc2626;color:#fff !important;}
    #err{display:none;margin:10px 0;padding:10px 12px;border-radius:12px;background:rgba(220,38,38,0.20);border:1px solid rgba(220,38,38,0.5);color:#fff;font-weight:700;white-space:pre-wrap;}
  </style>
</head>
<body>
  <div class="meta">
    <div class="big">Torn War Dashboard</div>
    <div>Last update: <span id="ts">{{updated_at}}</span></div>
    <div class="muted">Auto-refresh every 25s (PDA-friendly).</div>
  </div>

  <div class="card">
    <div><b>Chain</b>: <span id="chainText">—</span></div>
    <div class="muted">Timeout: <span id="chainTimeout">—</span> • Cooldown: <span id="chainCooldown">—</span></div>
  </div>

  <div class="card">
    <div><b>Next Ranked War</b>: <span id="warText">—</span></div>
    <div><b>Countdown</b>: <span id="warCountdown">—</span></div>
    <div class="muted">
      <span class="chip chip-online">Online: <span id="onlineCount">0</span></span>
      <span class="chip chip-idle">Idle: <span id="idleCount">0</span></span>
      <span class="chip chip-offline">Offline: <span id="offlineCount">0</span></span>
    </div>
  </div>

  <div id="err"></div>

  <table>
    <thead>
      <tr>
        <th>Member</th>
        <th>Online</th>
        <th>Status</th>
        <th>Hosp</th>
        <th>Timezone</th>
        <th>Energy</th>
        <th>Last Action</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

<script>
function fmtUTC(epoch){ if(!epoch) return "—"; return new Date(epoch*1000).toUTCString(); }
function fmtCountdown(seconds){
  if(seconds<=0) return "LIVE / STARTED";
  const d=Math.floor(seconds/86400); seconds%=86400;
  const h=Math.floor(seconds/3600); seconds%=3600;
  const m=Math.floor(seconds/60); const s=seconds%60;
  return (d>0?`${d}d `:"")+`${h}h ${m}m ${s}s`;
}
function showErr(msg){ const el=document.getElementById("err"); el.style.display="block"; el.textContent=msg; }
function clearErr(){ const el=document.getElementById("err"); el.style.display="none"; el.textContent=""; }

function lastActionMinutes(text){
  const t=String(text||"").toLowerCase().trim();
  const m=t.match(/(\\d+)\\s*(minute|minutes|hour|hours|day|days)\\s*ago/);
  if(!m) return 999999;
  const n=parseInt(m[1],10); const unit=m[2];
  if(unit.startsWith("minute")) return n;
  if(unit.startsWith("hour")) return n*60;
  if(unit.startsWith("day")) return n*1440;
  return 999999;
}
const ONLINE_MAX_MIN=15, IDLE_MAX_MIN=60;
function bucketStatus(row){
  const mins=lastActionMinutes(row.last_action_text);
  if(mins<=ONLINE_MAX_MIN) return 0;
  if(mins<=IDLE_MAX_MIN) return 1;
  return 2;
}
function statusLabel(row){
  const b=bucketStatus(row);
  if(b===0) return {text:"ONLINE", cls:"tag tag-online"};
  if(b===1) return {text:"IDLE", cls:"tag tag-idle"};
  return {text:"OFFLINE", cls:"tag tag-offline"};
}

async function refresh(){
  try{
    const res=await fetch("/api/sheet",{cache:"no-store"});
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data=await res.json();
    clearErr();

    document.getElementById("ts").textContent=data.updated_at||"—";

    if(data.chain && data.chain.current!=null){
      document.getElementById("chainText").textContent=`${data.chain.current} / ${(data.chain.max ?? "—")}`;
      document.getElementById("chainTimeout").textContent=fmtUTC(data.chain.timeout);
      document.getElementById("chainCooldown").textContent=fmtUTC(data.chain.cooldown);
    }else{
      document.getElementById("chainText").textContent="—";
      document.getElementById("chainTimeout").textContent="—";
      document.getElementById("chainCooldown").textContent="—";
    }

    if(data.war && data.war.start){
      const opp=data.war.opponent||"Unknown";
      document.getElementById("warText").textContent=`vs ${opp} • Starts: ${fmtUTC(data.war.start)}`;
      const now=Math.floor(Date.now()/1000);
      document.getElementById("warCountdown").textContent=fmtCountdown(data.war.start-now);
    }else{
      document.getElementById("warText").textContent="No upcoming ranked war found";
      document.getElementById("warCountdown").textContent="—";
    }

    const rows=Array.isArray(data.rows)?data.rows.slice():[];

    let online=0,idle=0,offline=0;
    for(const r of rows){
      const b=bucketStatus(r);
      if(b===0) online++; else if(b===1) idle++; else offline++;
    }
    document.getElementById("onlineCount").textContent=online;
    document.getElementById("idleCount").textContent=idle;
    document.getElementById("offlineCount").textContent=offline;

    rows.sort((a,b)=>{
      const pa=bucketStatus(a), pb=bucketStatus(b);
      if(pa!==pb) return pa-pb;
      const la=lastActionMinutes(a.last_action_text), lb=lastActionMinutes(b.last_action_text);
      if(la!==lb) return la-lb;
      return String(a.name||"").localeCompare(String(b.name||""));
    });

    const tbody=document.getElementById("tbody");
    tbody.innerHTML="";
    for(const r of rows){
      const tr=document.createElement("tr");
      const st=statusLabel(r);
      tr.innerHTML=`
        <td>${r.name||""} <span class="muted">[${r.torn_id ?? ""}]</span></td>
        <td><span class="${st.cls}">${st.text}</span></td>
        <td>${r.status||""}</td>
        <td>${r.hospitalized ? "YES":"NO"}</td>
        <td>${r.timezone||"—"}</td>
        <td>${r.energy_text||"—"}</td>
        <td>${r.last_action_text||""}</td>
      `;
      tbody.appendChild(tr);
    }
  }catch(e){
    showErr("Dashboard refresh failed: "+(e && e.message ? e.message : String(e)));
  }
}

refresh();
setInterval(refresh, 25000);
</script>

</body>
</html>
"""

@app.get("/")
def index():
    return render_template_string(HTML, updated_at=STATE.get("updated_at") or "—")

# ✅ Option B: Browser/Tampermonkey pushes state here
@app.route("/api/push_state", methods=["POST", "OPTIONS"])
def push_state():
    if request.method == "OPTIONS":
        return ("", 204)

    secret = request.headers.get("X-STATE-SECRET", "")
    if not WEB_SHARED_SECRET or secret != WEB_SHARED_SECRET:
        return jsonify({"ok": False, "error": "forbidden"}), 403

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "bad json"}), 400

    # --- light debug so you can confirm the push is landing ---
    if DEBUG:
        try:
            rows_len = len(data.get("rows") or [])
        except Exception:
            rows_len = -1
        print("DEBUG push_state ok:",
              "rows=", rows_len,
              "available_count=", data.get("available_count"),
              "updated_at=", data.get("updated_at"))

    # update only provided keys
    for k in ("rows", "updated_at", "chain", "war", "available_count"):
        if k in data:
            STATE[k] = data[k]

    # normalize
    STATE["rows"] = STATE.get("rows") or []
    STATE["available_count"] = int(STATE.get("available_count", 0) or 0)

    # normalize chain/war objects
    if not isinstance(STATE.get("chain"), dict):
        STATE["chain"] = {"current": None, "max": None, "timeout": None, "cooldown": None}
    if not isinstance(STATE.get("war"), dict):
        STATE["war"] = {"opponent": None, "start": None, "end": None, "target": None}

    return jsonify({"ok": True})

@app.route("/api/sheet", methods=["GET", "OPTIONS"])
def api_sheet():
    if request.method == "OPTIONS":
        return ("", 204)
    return jsonify(STATE)

@app.route("/api/status", methods=["GET", "OPTIONS"])
def api_status():
    if request.method == "OPTIONS":
        return ("", 204)

    rows = STATE.get("rows") or []

    import re
    def last_action_minutes(text):
        t = str(text or "").lower().strip()
        m = re.search(r"(\\d+)\\s*(minute|minutes|hour|hours|day|days)\\s*ago", t)
        if not m:
            return 999999
        n = int(m.group(1))
        unit = m.group(2)
        if unit.startswith("minute"):
            return n
        if unit.startswith("hour"):
            return n * 60
        if unit.startswith("day"):
            return n * 1440
        return 999999

    ONLINE_MAX_MIN = 15
    IDLE_MAX_MIN = 60

    online = idle = offline = 0
    for r in rows:
        mins = last_action_minutes((r or {}).get("last_action_text"))
        if mins <= ONLINE_MAX_MIN:
            online += 1
        elif mins <= IDLE_MAX_MIN:
            idle += 1
        else:
            offline += 1

    return jsonify({
        "updated_at": STATE.get("updated_at"),
        "online": online,
        "idle": idle,
        "offline": offline,
        "chain": STATE.get("chain") or {},
        "war": STATE.get("war") or {},
    })

if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
