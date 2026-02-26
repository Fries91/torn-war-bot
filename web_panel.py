# web_panel.py
from flask import Flask, jsonify, render_template_string

app = Flask(__name__)

@app.after_request
def allow_iframe(resp):
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
    return resp

STATE = {
    "rows": [],
    "updated_at": None,
    "chain": {"current": None, "max": None, "timeout": None, "cooldown": None},
    "war": {"opponent": None, "start": None, "end": None, "target": None},
    "available_count": 0
}

HTML = """
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Torn War Dashboard</title>

  <style>
    /* ===== Shield Dark Mode + White Font (screenshot readable) ===== */
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
      color: #ffffff !important;  /* FORCE WHITE */
    }

    th {
      position: sticky;
      top: 0;
      background: #111827;        /* DARK HEADER */
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

    .ok { background: #16a34a; }  /* green */
    .no { background: #dc2626; }  /* red */
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

async function refresh() {
  const res = await fetch("/api/sheet");
  const data = await res.json();

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
      <td>${r.name} <span class="muted">[${r.torn_id}]</span></td>
      <td>${r.status || ""}</td>
      <td>${r.hospitalized ? "YES" : "NO"}</td>
      <td>${r.timezone || "—"}</td>
      <td>${r.available_now ? '<span class="tag ok">YES</span>' : '<span class="tag no">NO</span>'}</td>
      <td>${r.energy_text || "—"}</td>
      <td>${r.last_action_text || ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

refresh();
setInterval(refresh, 20000);
</script>

</body>
</html>
"""

@app.get("/")
def index():
    return render_template_string(
        HTML,
        updated_at=STATE.get("updated_at") or "—",
        available_count=STATE.get("available_count", 0),
    )

@app.get("/api/sheet")
def api_sheet():
    # Full live data for the dashboard (used by JS + screenshot)
    return jsonify(STATE)

@app.get("/api/status")
def api_status():
    """
    Lightweight status endpoint (optional).
    Counts online + available + not available based on current STATE rows.
    """
    rows = STATE.get("rows") or []

    online = 0
    for r in rows:
        # if you ever store an explicit boolean
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
