import os
import asyncio
import threading
from datetime import datetime

from flask import Flask, jsonify, render_template_string
from dotenv import load_dotenv

from torn_api import get_faction_core, get_ranked_war_best

load_dotenv()

FACTION_ID = os.getenv("FACTION_ID")
FACTION_API_KEY = os.getenv("FACTION_API_KEY")

LITE_BG = (os.getenv("LITE_BG") or "/static/wrath-bg.jpg").strip()

app = Flask(__name__)

STATE = {
    "rows": [],
    "war": {},
    "updated_at": None
}


@app.after_request
def allow_iframe(resp):
    # Allows Torn iframe if ever needed
    resp.headers["X-Frame-Options"] = "ALLOWALL"
    resp.headers["Content-Security-Policy"] = "frame-ancestors *"
    return resp


# ==============================
# Background Poller
# ==============================
async def poll_loop():
    global STATE
    while True:
        try:
            core = await get_faction_core(FACTION_ID, FACTION_API_KEY)
            war = await get_ranked_war_best(FACTION_ID, FACTION_API_KEY)

            members = core.get("members", {})

            rows = []
            now = int(datetime.utcnow().timestamp())

            for m in members.values():
                last_action = m.get("last_action", {})
                seconds = last_action.get("seconds", 9999)
                minutes = int(seconds / 60)

                if minutes <= 20:
                    status = "online"
                elif minutes <= 30:
                    status = "idle"
                else:
                    status = "offline"

                rows.append({
                    "name": m.get("name"),
                    "status": status,
                    "minutes": minutes
                })

            rows.sort(key=lambda x: x["minutes"])

            STATE = {
                "rows": rows,
                "war": war,
                "updated_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            print("Poll error:", e)

        await asyncio.sleep(20)


def start_background():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(poll_loop())


threading.Thread(target=start_background, daemon=True).start()


# ==============================
# Routes
# ==============================

@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/state")
def state():
    return jsonify(STATE)


@app.route("/lite")
def lite():
    return render_template_string(f"""
    <html>
    <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
    body {{
        margin:0;
        font-family: Arial;
        color:white;
        background:
            linear-gradient(rgba(0,0,0,.85), rgba(0,0,0,.9)),
            url("{LITE_BG}") center/cover no-repeat fixed;
    }}
    .panel {{
        max-width:900px;
        margin:40px auto;
        background:rgba(0,0,0,.7);
        padding:20px;
        border-radius:12px;
        box-shadow:0 0 30px rgba(255,60,50,.4);
    }}
    .row {{
        display:flex;
        justify-content:space-between;
        padding:6px 0;
        border-bottom:1px solid rgba(255,255,255,.1);
    }}
    .online {{ color:#2cff6f; }}
    .idle {{ color:#ffcc00; }}
    .offline {{ color:#ff4444; }}
    </style>
    </head>
    <body>
        <div class="panel">
            <h2>⚔ 7DS*: WRATH WAR PANEL</h2>
            <div id="war"></div>
            <h2>Members</h2>
            <div id="members"></div>
        </div>

        <script>
        async function load() {{
            const res = await fetch("/state");
            const data = await res.json();

            const war = data.war || {{}};
            document.getElementById("war").innerHTML = `
                <div class="row"><span>Opponent</span><span>${{war.opponent || "None"}}</span></div>
                <div class="row"><span>Target</span><span>${{war.target ?? "-"}}</span></div>
                <div class="row"><span>Your Score</span><span>${{war.score ?? "-"}}</span></div>
                <div class="row"><span>Enemy Score</span><span>${{war.enemy_score ?? "-"}}</span></div>
            `;

            let html = "";
            (data.rows || []).forEach(r => {{
                html += `<div class="row ${{r.status}}">
                            <span>${{r.name}}</span>
                            <span>${{r.status.toUpperCase()}} (${{r.minutes}}m)</span>
                         </div>`;
            }});

            document.getElementById("members").innerHTML = html;
        }}

        load();
        setInterval(load, 15000);
        </script>
    </body>
    </html>
    """)
    

if __name__ == "__main__":
    app.run()
