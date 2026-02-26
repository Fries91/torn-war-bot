# web_panel.py
from flask import Flask, jsonify, render_template_string, request

app = Flask(__name__)

# -----------------------------
# Security + Embed + CORS Headers
# -----------------------------
@app.after_request
def headers(resp):
    # ---- Allow embedding in iframes (Torn / PDA overlays) ----
    # Remove any existing X-Frame-Options that could block embedding
    resp.headers.pop("X-Frame-Options", None)

    # Modern browsers use CSP frame-ancestors for iframe rules
    resp.headers["Content-Security-Policy"] = (
        "frame-ancestors https://www.torn.com https://torn.com *"
    )

    # ---- CORS: allow Torn.com pages (Tampermonkey fetch) to call /api/* ----
    origin = request.headers.get("Origin", "")
    allowed = {"https://www.torn.com", "https://torn.com"}

    if origin in allowed:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    else:
        # Optional: allow direct/no-origin requests & other clients
        resp.headers["Access-Control-Allow-Origin"] = "*"

    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Max-Age"] = "86400"

    return resp


# -----------------------------
# In-memory state (your bot updates this elsewhere)
# -----------------------------
STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0,
}


# -----------------------------
# Dashboard Page (renders table via JS calling /api/sheet)
# -----------------------------
HTML = """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Torn War Dashboard</title>

  <style>
    body {
      font-family: -apple-system, system-ui, Arial;
      padding: 12px;
      background: #0f172a;
      color: #ffffff;
    }

    .meta { opacity: 0.95; font-size: 14px; margin-bottom: 10px; color: #ffffff; }
    .big { font-size: 16px; font-weight: 800; color: #ffffff; }
    .muted { opacity: .80; color: #ffffff; }

    .card {
      border: 1px solid #334155;
      background: #1e293b;
      border-radius: 12px;
      padding: 10px;
      margin: 10px 0;
      color: #ffffff;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      color: #ffffff;
    }

    th, td {
      border-bottom: 1px solid #334155;
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
      color: #ffffff !important;
    }

    th {
      position: sticky;
      top: 0;
      background: #111827;
      color: #ffffff !important;
      z-index: 2;
    }

    .tag {
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      display: inline-block;
      color: #ffffff !important;
      font-weight: 700;
    }

    .ok { background: #16a34a; }
    .no { background: #dc2626; }

    #err {
      display:none;
      margin: 10px 0;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(220,38,38,0.20);
      border: 1px solid rgba(220,38,38,0.5);
      color: #fff;
      font-weight: 700;
      white-space: pre-wrap;
    }
  </style>
</head>

<body>
  <div class="meta">
    <div class="big">Torn War Dashboard</div>
    <div>Last update: <span id="ts">{{updated_at}}</span></div>
    <div class="muted">Auto-refresh every 20s (PDA-friendly).</div>
  </div>

  <div class="card">
    <div><b>Chain</b>: <span id="chainText">—</span></div>
    <div class="muted">Timeout: <span id="chainTimeout">—</span> • Cooldown: <span id="chainCooldown">—</span></div>
  </div>

  <div class="card">
    <div><b>Next Ranked War</b>: <span id="warText">—</span></div>
    <div><b>Countdown</b>: <span id="warCountdown">—</span></div>
    <div class="muted">Available now: <span id="availCount">{{available_count}}</span></div>
  </div>

  <div id="err"></div>

  <table>
    <thead>
      <tr>
        <th>Member</th>
        <th>Status</th>
        <th>Hosp</th>
        <th>Timezone</th>
        <th>Avail Now</th>
        <th>Energy</th>
        <th>Last Action</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

<script>
function fmtUTC(epoch) {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toUTCString();
}

function fmtCountdown(seconds) {
  if (seconds <= 0) return "LIVE / STARTED";
  const d = Math.floor(seconds / 86400); seconds %= 86400;
  const h = Math.floor(seconds / 3600); seconds %= 3600;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (d>0 ? `${d}d ` : "") + `${h}h ${m}m ${s}s`;
}

function showErr(msg){
  const el = document.getElementById("err");
  el.style.display = "block";
  el.textContent = msg;
}
function clearErr(){
  const el = document.getElementById("err");
  el.style.display = "none";
  el.textContent = "";
}

async function refresh() {
  try{
    const res = await fetch("/api/sheet", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    clearErr();

    document.getElementById("ts").textContent = data.updated_at || "—";
    document.getElementById("availCount").textContent = (data.available_count ?? "—");

    if (data.chain && data.chain.current != null) {
      document.getElementById("chainText").textContent = `${data.chain.current} / ${(data.chain.max ?? "—")}`;
      document.getElementById("chainTimeout").textContent = fmtUTC(data.chain.timeout);
      document.getElementById("chainCooldown").textContent = fmtUTC(data.chain.cooldown);
    } else {
      document.getElementById("chainText").textContent = "—";
      document.getElementById("chainTimeout").textContent = "—";
      document.getElementById("chainCooldown").textContent = "—";
    }

    if (data.war && data.war.start) {
      const opp = data.war.opponent || "Unknown";
      document.getElementById("warText").textContent = `vs ${opp} • Starts: ${fmtUTC(data.war.start)}`;
      const now = Math.floor(Date.now()/1000);
      document.getElementById("warCountdown").textContent = fmtCountdown(data.war.start - now);
    } else {
      document.getElementById("warText").textContent = "No upcoming ranked war found";
      document.getElementById("warCountdown").textContent = "—";
    }

    const tbody = document.getElementById("tbody");
    tbody.innerHTML = "";

    for (const r of (data.rows || [])) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.name || ""} <span class="muted">[${r.torn_id ?? ""}]</span></td>
        <td>${r.status || ""}</td>
        <td>${r.hospitalized ? "YES" : "NO"}</td>
        <td>${r.timezone || "—"}</td>
        <td>${r.available_now ? '<span class="tag ok">YES</span>' : '<span class="tag no">NO</span>'}</td>
        <td>${r.energy_text || "—"}</td>
        <td>${r.last_action_text || ""}</td>
      `;
      tbody.appendChild(tr);
    }
  }catch(e){
    showErr("Dashboard refresh failed: " + (e && e.message ? e.message : String(e)));
  }
}

refresh();
setInterval(refresh, 20000);
</script>

</body>
</html>
"""


# -----------------------------
# Routes
# -----------------------------
@app.get("/")
def index():
    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at") or "—",
        available_count=STATE.get("available_count", 0),
    )


@app.route("/api/sheet", methods=["GET", "OPTIONS"])
def api_sheet():
    # Handle CORS preflight
    if request.method == "OPTIONS":
        return ("", 204)
    # Full live data for the dashboard + Tampermonkey overlay
    return jsonify(STATE)


@app.route("/api/status", methods=["GET", "OPTIONS"])
def api_status():
    # Handle CORS preflight
    if request.method == "OPTIONS":
        return ("", 204)

    rows = STATE.get("rows") or []

    online = 0
    for r in rows:
        if r.get("online") is True:
            online += 1
        else:
            s = str(r.get("status", "")).lower()
            if ("online" in s) or ("idle" in s):
                online += 1

    available = sum(1 for r in rows if r.get("available_now") is True)
    not_available = max(len(rows) - available, 0)

    return jsonify({
        "updated_at": STATE.get("updated_at"),
        "online": online,
        "available": available,
        "not_available": not_available,
        "chain": STATE.get("chain") or {},
        "war": STATE.get("war") or {},
    })


# Optional local run (Render can ignore this if using gunicorn)
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
