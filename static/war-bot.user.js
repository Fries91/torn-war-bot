// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      2.1.0
// @description  War Hub by Fries91. Ultimate overlay with restored tabs, draggable icon, draggable overlay, PDA friendly, quick actions, notes, assignments, targets, med deals, hospital view, analytics, notifications, and settings.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @downloadURL  https://torn-war-bot.onrender.com/static/war-bot.user.js
// @updateURL    https://torn-war-bot.onrender.com/static/war-bot.user.js
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      torn-war-bot.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  const BASE_URL = "https://torn-war-bot.onrender.com";

  const K_API_KEY = "warhub_api_key_v2";
  const K_ADMIN_KEY = "warhub_admin_key_v2";
  const K_SESSION = "warhub_session_v2";
  const K_OPEN = "warhub_open_v2";
  const K_TAB = "warhub_tab_v2";
  const K_SHIELD_POS = "warhub_shield_pos_v2";
  const K_OVERLAY_POS = "warhub_overlay_pos_v2";
  const K_REFRESH = "warhub_refresh_ms_v2";
  const K_NOTES = "warhub_notes_v2";
  const K_ASSIGNMENTS = "warhub_assignments_v2";
  const K_LOCAL_TARGETS = "warhub_local_targets_v2";
  const K_LOCAL_MEDS = "warhub_local_meds_v2";
  const K_LOCAL_NOTIFICATIONS = "warhub_local_notifications_v2";

  const TAB_ORDER = [
    ["war", "War"],
    ["members", "Members"],
    ["enemies", "Enemies"],
    ["hospital", "Hospital"],
    ["chain", "Chain"],
    ["meddeals", "Med Deals"],
    ["targets", "Targets"],
    ["assignments", "Assignments"],
    ["notes", "Notes"],
    ["analytics", "Analytics"],
    ["notifications", "Alerts"],
    ["settings", "Settings"],
  ];

  let state = null;
  let analyticsCache = null;
  let overlay = null;
  let shield = null;
  let badge = null;
  let mounted = false;
  let dragMoved = false;
  let isOpen = !!GM_getValue(K_OPEN, false);
  let currentTab = GM_getValue(K_TAB, "war");
  let pollTimer = null;
  let loadInFlight = false;

  const css = `
    #warhub-shield {
      position: fixed !important;
      z-index: 2147483647 !important;
      width: 42px;
      height: 42px;
      border-radius: 12px;
      display: flex !important;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      touch-action: none;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
      border: 1px solid rgba(255,255,255,.10);
      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98));
      color: #fff;
      top: 120px;
      right: 14px;
      left: auto;
      bottom: auto;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
    #warhub-shield.dragging { cursor: grabbing; }
    #warhub-badge {
      position: fixed !important;
      z-index: 2147483647 !important;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 999px;
      background: #ffd54a;
      color: #111;
      font-size: 10px;
      line-height: 16px;
      text-align: center;
      font-weight: 800;
      box-shadow: 0 3px 12px rgba(0,0,0,.45);
      display: none;
      pointer-events: none;
    }
    #warhub-overlay {
      position: fixed !important;
      z-index: 2147483646 !important;
      right: 12px;
      top: 170px;
      width: min(96vw, 500px);
      height: min(86vh, 860px);
      max-height: 86vh;
      overflow: hidden;
      border-radius: 14px;
      background: linear-gradient(180deg, #171717, #0c0c0c);
      color: #f2f2f2;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 16px 38px rgba(0,0,0,.54);
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      left: auto;
      bottom: auto;
      flex-direction: column;
    }
    #warhub-overlay.open { display: flex !important; }
    .warhub-head {
      padding: 10px 12px 9px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20));
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      touch-action: none;
      flex: 0 0 auto;
    }
    .warhub-head.dragging { cursor: grabbing; }
    .warhub-toprow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .warhub-title { font-weight: 800; font-size: 16px; letter-spacing: .2px; }
    .warhub-sub { opacity: .72; font-size: 11px; margin-top: 2px; }
    .warhub-close {
      border: 0;
      border-radius: 9px;
      background: rgba(255,255,255,.08);
      color: #fff;
      padding: 5px 9px;
      font-weight: 700;
      cursor: pointer;
      font-size: 12px;
      flex: 0 0 auto;
    }
    .warhub-tabs {
      display: flex;
      gap: 6px;
      padding: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.02);
      scrollbar-width: thin;
      flex: 0 0 auto;
      -webkit-overflow-scrolling: touch;
    }
    .warhub-tab {
      border: 0;
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      color: #fff;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      flex: 0 0 auto;
    }
    .warhub-tab.active { background: linear-gradient(180deg, #d23333, #831515); }
    .warhub-body {
      padding: 8px;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      flex: 1 1 auto;
    }
    .warhub-status {
      display: none;
      margin-bottom: 8px;
      padding: 8px 10px;
      border-radius: 10px;
      font-size: 12px;
      background: rgba(255,255,255,.06);
    }
    .warhub-status.show { display: block; }
    .warhub-status.err { background: rgba(185,52,52,.22); color: #ffdcdc; }
    .warhub-grid { display: grid; gap: 8px; }
    .warhub-grid.two { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .warhub-grid.three { grid-template-columns: repeat(3, minmax(0,1fr)); }
    .warhub-card {
      border: 1px solid rgba(255,255,255,.07);
      background: rgba(255,255,255,.03);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .warhub-card h3 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: .2px;
    }
    .warhub-metric {
      border-radius: 10px;
      background: rgba(255,255,255,.05);
      padding: 8px;
      min-height: 54px;
    }
    .warhub-metric .k { opacity: .7; font-size: 10px; text-transform: uppercase; letter-spacing: .45px; }
    .warhub-metric .v { font-size: 16px; font-weight: 800; margin-top: 4px; }
    .warhub-list { display: grid; gap: 6px; }
    .warhub-list-item {
      border-radius: 10px;
      background: rgba(255,255,255,.04);
      padding: 8px;
      display: grid;
      gap: 4px;
    }
    .warhub-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }
    .warhub-name { font-weight: 700; }
    .warhub-meta { opacity: .76; font-size: 11px; }
    .warhub-empty { opacity: .75; font-size: 12px; }
    .warhub-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .warhub-btn, .warhub-input, .warhub-select, .warhub-textarea {
      font: inherit;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.05);
      color: #fff;
    }
    .warhub-btn {
      padding: 7px 10px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
    }
    .warhub-btn.primary { background: linear-gradient(180deg, #cc3737, #821616); border-color: rgba(255,255,255,.12); }
    .warhub-btn.good { background: linear-gradient(180deg, #238c52, #15603a); }
    .warhub-btn.warn { background: linear-gradient(180deg, #af7b22, #775114); }
    .warhub-btn.small { padding: 5px 8px; font-size: 11px; }
    .warhub-input, .warhub-select, .warhub-textarea {
      width: 100%;
      padding: 8px 10px;
      box-sizing: border-box;
      font-size: 12px;
    }
    .warhub-textarea { min-height: 94px; resize: vertical; }
    .warhub-label { font-size: 11px; opacity: .74; margin-bottom: 4px; display: block; }
    .warhub-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      font-size: 11px;
      font-weight: 700;
    }
    .warhub-pill.online { background: rgba(40,140,90,.20); color: #b7ffd5; }
    .warhub-pill.idle { background: rgba(197,141,46,.22); color: #ffe3a5; }
    .warhub-pill.offline { background: rgba(113,113,113,.20); color: #dadada; }
    .warhub-pill.hosp { background: rgba(181,62,62,.24); color: #ffd0d0; }
    .warhub-divider { height: 1px; background: rgba(255,255,255,.07); margin: 8px 0; }
    .warhub-mini { font-size: 11px; opacity: .78; }
    .warhub-link {
      color: #fff;
      text-decoration: none;
      border-bottom: 1px dashed rgba(255,255,255,.25);
    }
    @media (max-width: 700px) {
      #warhub-overlay {
        width: min(98vw, 98vw);
        height: min(88vh, 88vh);
        top: 56px;
        left: 1vw;
        right: 1vw;
        border-radius: 12px;
      }
      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr; }
      .warhub-body { padding-bottom: 18px; }
      #warhub-shield { width: 40px; height: 40px; font-size: 21px; }
    }
  `;
  GM_addStyle(css);

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : "—";
  }

  function fmtTime(v) {
    if (v == null || v === "") return "—";
    if (typeof v === "number") return `${v}s`;
    return String(v);
  }

  function fmtTs(v) {
    if (!v) return "—";
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString();
    } catch {
      return String(v);
    }
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function getNotes() { return String(GM_getValue(K_NOTES, "") || ""); }
  function setNotes(v) { GM_setValue(K_NOTES, String(v || "")); }
  function getAssignments() { return arr(GM_getValue(K_ASSIGNMENTS, [])); }
  function setAssignments(v) { GM_setValue(K_ASSIGNMENTS, arr(v)); }
  function getLocalTargets() { return arr(GM_getValue(K_LOCAL_TARGETS, [])); }
  function setLocalTargets(v) { GM_setValue(K_LOCAL_TARGETS, arr(v)); }
  function getLocalMeds() { return arr(GM_getValue(K_LOCAL_MEDS, [])); }
  function setLocalMeds(v) { GM_setValue(K_LOCAL_MEDS, arr(v)); }
  function getLocalNotifications() { return arr(GM_getValue(K_LOCAL_NOTIFICATIONS, [])); }
  function setLocalNotifications(v) { GM_setValue(K_LOCAL_NOTIFICATIONS, arr(v)); }

  function mergedNotifications() {
    return [...arr(state?.notifications), ...getLocalNotifications()].slice(0, 50);
  }

  function unreadCount() {
    return mergedNotifications().length;
  }

  function setStatus(msg, isErr = false) {
    const box = overlay?.querySelector("#warhub-status");
    if (!box) return;
    if (!msg) {
      box.className = "warhub-status";
      box.textContent = "";
      return;
    }
    box.className = `warhub-status show ${isErr ? "err" : ""}`.trim();
    box.textContent = msg;
  }

  function gmXhr(method, path, body) {
    return new Promise((resolve) => {
      const token = GM_getValue(K_SESSION, "");
      const url = `${BASE_URL}${path}`;
      const headers = { "Accept": "application/json" };
      if (token) headers["X-Session-Token"] = token;
      if (body != null) headers["Content-Type"] = "application/json";

      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body != null ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: (res) => {
          let json = null;
          try { json = JSON.parse(res.responseText || "{}"); } catch {}
          resolve({
            ok: res.status >= 200 && res.status < 300 && (!json || json.ok !== false),
            status: res.status,
            data: json,
            error: json?.error || json?.details || (res.status >= 400 ? `HTTP ${res.status}` : "Request failed"),
          });
        },
        onerror: () => resolve({ ok: false, status: 0, data: null, error: "Network error." }),
        ontimeout: () => resolve({ ok: false, status: 0, data: null, error: "Request timed out." }),
      });
    });
  }

  async function login() {
    const apiKey = String(GM_getValue(K_API_KEY, "") || "").trim();
    const adminKey = String(GM_getValue(K_ADMIN_KEY, "") || "").trim();
    if (!apiKey || !adminKey) return false;

    const res = await gmXhr("POST", "/api/auth", { api_key: apiKey, admin_key: adminKey });
    if (!res.ok) {
      setStatus(res.error || "Login failed.", true);
      return false;
    }
    const token = res.data?.token || res.data?.session_token || res.data?.session;
    if (token) GM_setValue(K_SESSION, token);
    return !!token;
  }

  async function req(method, path, body) {
    let res = await gmXhr(method, path, body);
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      const ok = await login();
      if (ok) res = await gmXhr(method, path, body);
    }
    return res;
  }

  function normalizeState(data) {
    const s = data || {};
    const me = s.me || s.user || {};
    const war = s.war || s.war_info || {};
    const faction = s.faction || s.my_faction || {};
    const enemyFaction = s.enemy_faction || s.opponent || war.enemy_faction || {};
    const members = arr(s.members || faction.members || s.member_list);
    const enemies = arr(s.enemies || enemyFaction.members || s.enemy_members);
    const hospital = arr(s.hospital || s.enemy_hospital || s.hospitalized || []).map((x) => ({ side: x.side || "enemy", ...x }));
    const medDeals = arr(s.med_deals || s.medDeals || s.deals);
    const targets = arr(s.targets || s.smart_targets || s.assignable_targets);
    const assignments = arr(s.assignments || s.target_assignments);
    const notifications = arr(s.notifications || s.notes || s.alerts);
    const chainSitters = arr(s.chain_sitters || s.chainSitters || s.chain_helpers);

    return {
      ...s,
      me,
      war,
      faction,
      enemyFaction,
      members,
      enemies,
      hospital,
      medDeals,
      targets,
      assignments,
      notifications,
      chainSitters,
    };
  }

  async function loadState(silent = false) {
    if (loadInFlight) return;
    loadInFlight = true;
    try {
      const res = await req("GET", "/api/state");
      if (!res.ok) {
        if (!silent) setStatus(res.error || "Could not load state.", true);
        return;
      }
      state = normalizeState(res.data || {});
      if (!silent) setStatus("");
      if (overlay && isOpen) renderBody();
      updateBadge();
    } finally {
      loadInFlight = false;
    }
  }

  async function loadAnalytics() {
    const res = await req("GET", "/api/analytics");
    if (res.ok) analyticsCache = res.data || {};
  }

  async function doAction(method, path, body, okMsg, reload = true) {
    const res = await req(method, path, body);
    if (!res.ok) {
      setStatus(res.error || "Action failed.", true);
      return null;
    }
    if (okMsg) setStatus(okMsg);
    if (reload) await loadState(true);
    return res;
  }

  function byStatus(list, status) {
    return list.filter((x) => String(x.status || x.online_status || "").toLowerCase().includes(status));
  }

  function sortHosp(list) {
    return [...list].sort((a, b) => Number(a.hosp_time || a.hospital_time || a.hospital_seconds || 0) - Number(b.hosp_time || b.hospital_time || b.hospital_seconds || 0));
  }

  function memberRow(x, enemy = false) {
    const id = x.user_id || x.id || x.player_id || "";
    const name = x.name || x.player_name || `ID ${id}`;
    const status = String(x.status || x.online_status || "offline").toLowerCase();
    const hosp = x.hosp_time || x.hospital_time || x.hospital_seconds || "";
    const last = x.last_action || x.last_action_relative || x.last || "—";
    const energy = x.energy ?? x.e ?? "—";
    const pill = hosp ? `<span class="warhub-pill hosp">Hosp ${esc(fmtTime(hosp))}</span>` : status.includes("online") ? `<span class="warhub-pill online">Online</span>` : status.includes("idle") ? `<span class="warhub-pill idle">Idle</span>` : `<span class="warhub-pill offline">Offline</span>`;
    const attackUrl = id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` : "#";
    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(name)} ${id ? `<span class="warhub-mini">[${esc(id)}]</span>` : ""}</div>
            <div class="warhub-meta">Energy: ${esc(energy)} • Last: ${esc(last)}</div>
          </div>
          <div class="warhub-actions">
            ${pill}
            ${enemy && id ? `<a class="warhub-btn small primary warhub-link-btn" href="${attackUrl}" target="_blank" rel="noreferrer">Attack</a>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function targetRow(x) {
    const id = x.target_id || x.id || x.user_id || "";
    const name = x.name || x.target_name || `Target ${id}`;
    const reason = x.reason || x.note || x.priority || "";
    const attackUrl = id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` : "#";
    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(name)} ${id ? `<span class="warhub-mini">[${esc(id)}]</span>` : ""}</div>
            <div class="warhub-meta">${esc(reason || "No note")}</div>
          </div>
          <div class="warhub-actions">
            ${id ? `<a class="warhub-btn small primary" href="${attackUrl}" target="_blank" rel="noreferrer">Attack</a>` : ""}
            <button class="warhub-btn small" data-fill-assignment="${esc(String(id))}|${esc(name)}">Assign</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderWarTab() {
    const war = state?.war || {};
    const me = state?.me || {};
    const faction = state?.faction || {};
    const enemyFaction = state?.enemyFaction || {};
    const scoreSelf = war.score || war.our_score || faction.score || 0;
    const scoreEnemy = war.enemy_score || enemyFaction.score || 0;
    const currentWar = war.id || war.war_id || war.start || enemyFaction.id;

    return `
      <div class="warhub-grid two">
        <div class="warhub-card">
          <h3>Overview</h3>
          <div class="warhub-grid two">
            <div class="warhub-metric"><div class="k">You</div><div class="v">${esc(me.name || "—")}</div></div>
            <div class="warhub-metric"><div class="k">Faction</div><div class="v">${esc(faction.name || "—")}</div></div>
            <div class="warhub-metric"><div class="k">Enemy</div><div class="v">${esc(enemyFaction.name || (currentWar ? "Enemy loaded" : "Currently not in a war"))}</div></div>
            <div class="warhub-metric"><div class="k">War ID</div><div class="v">${esc(currentWar || "—")}</div></div>
          </div>
        </div>
        <div class="warhub-card">
          <h3>Score</h3>
          <div class="warhub-grid two">
            <div class="warhub-metric"><div class="k">Our Score</div><div class="v">${fmtNum(scoreSelf)}</div></div>
            <div class="warhub-metric"><div class="k">Enemy Score</div><div class="v">${fmtNum(scoreEnemy)}</div></div>
            <div class="warhub-metric"><div class="k">Chain</div><div class="v">${fmtNum(war.chain || state?.chain || 0)}</div></div>
            <div class="warhub-metric"><div class="k">Cooldown</div><div class="v">${esc(fmtTime(war.cooldown || state?.cooldown || "—"))}</div></div>
          </div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Quick Actions</h3>
        <div class="warhub-actions">
          <button class="warhub-btn good" id="wh-available">Available</button>
          <button class="warhub-btn" id="wh-unavailable">Unavailable</button>
          <button class="warhub-btn good" id="wh-opt-in">Chain Sit In</button>
          <button class="warhub-btn warn" id="wh-opt-out">Chain Sit Out</button>
          ${enemyFaction.id ? `<a class="warhub-btn primary" href="https://www.torn.com/factions.php?step=profile&ID=${esc(enemyFaction.id)}" target="_blank" rel="noreferrer">Enemy Faction</a>` : ""}
          <a class="warhub-btn" href="https://www.torn.com/factions.php?step=your" target="_blank" rel="noreferrer">Faction</a>
          <a class="warhub-btn" href="https://www.torn.com/hospitalview.php" target="_blank" rel="noreferrer">Hospital</a>
        </div>
      </div>

      <div class="warhub-grid two">
        <div class="warhub-card">
          <h3>Online Counts</h3>
          <div class="warhub-grid three">
            <div class="warhub-metric"><div class="k">Online</div><div class="v">${fmtNum(byStatus(state?.members || [], "online").length)}</div></div>
            <div class="warhub-metric"><div class="k">Idle</div><div class="v">${fmtNum(byStatus(state?.members || [], "idle").length)}</div></div>
            <div class="warhub-metric"><div class="k">Offline</div><div class="v">${fmtNum(byStatus(state?.members || [], "offline").length)}</div></div>
          </div>
        </div>
        <div class="warhub-card">
          <h3>Enemy Snapshot</h3>
          <div class="warhub-grid two">
            <div class="warhub-metric"><div class="k">Enemy Members</div><div class="v">${fmtNum(arr(state?.enemies).length)}</div></div>
            <div class="warhub-metric"><div class="k">Enemy Hospital</div><div class="v">${fmtNum(sortHosp(arr(state?.enemies).filter(x => x.hosp_time || x.hospital_time || x.hospital_seconds)).length)}</div></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderMembersTab() {
    const members = arr(state?.members);
    if (!members.length) return `<div class="warhub-card"><div class="warhub-empty">No member data yet.</div></div>`;
    return `
      <div class="warhub-card">
        <h3>Faction Members</h3>
        <div class="warhub-list">${members.map((x) => memberRow(x, false)).join("")}</div>
      </div>
    `;
  }

  function renderEnemiesTab() {
    const enemies = arr(state?.enemies);
    if (!enemies.length) {
      return `<div class="warhub-card"><div class="warhub-empty">Currently not in a war or enemy faction members are unavailable.</div></div>`;
    }
    return `
      <div class="warhub-card">
        <h3>Enemy Members</h3>
        <div class="warhub-list">${enemies.map((x) => memberRow(x, true)).join("")}</div>
      </div>
    `;
  }

  function renderHospitalTab() {
    const enemies = sortHosp(arr(state?.enemies).filter(x => x.hosp_time || x.hospital_time || x.hospital_seconds));
    const ours = sortHosp(arr(state?.members).filter(x => x.hosp_time || x.hospital_time || x.hospital_seconds));
    return `
      <div class="warhub-grid two">
        <div class="warhub-card">
          <h3>Our Hospital</h3>
          ${ours.length ? `<div class="warhub-list">${ours.map((x) => memberRow(x, false)).join("")}</div>` : `<div class="warhub-empty">Nobody from your faction is in hospital right now.</div>`}
        </div>
        <div class="warhub-card">
          <h3>Enemy Hospital</h3>
          ${enemies.length ? `<div class="warhub-list">${enemies.map((x) => memberRow(x, true)).join("")}</div>` : `<div class="warhub-empty">No enemy hospital data available.</div>`}
        </div>
      </div>
    `;
  }

  function renderChainTab() {
    const me = state?.me || {};
    const sitters = arr(state?.chainSitters);
    return `
      <div class="warhub-card">
        <h3>Chain Control</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric"><div class="k">Your Availability</div><div class="v">${me.available ? "Available" : "Unavailable"}</div></div>
          <div class="warhub-metric"><div class="k">Chain Sitter</div><div class="v">${me.chain_sitter || me.chainSitter ? "Enabled" : "Disabled"}</div></div>
        </div>
        <div class="warhub-divider"></div>
        <div class="warhub-actions">
          <button class="warhub-btn good" id="wh-available">Available</button>
          <button class="warhub-btn" id="wh-unavailable">Unavailable</button>
          <button class="warhub-btn good" id="wh-opt-in">Opt In</button>
          <button class="warhub-btn warn" id="wh-opt-out">Opt Out</button>
        </div>
      </div>
      <div class="warhub-card">
        <h3>Chain Sitters</h3>
        ${sitters.length ? `<div class="warhub-list">${sitters.map((x) => `<div class="warhub-list-item"><div class="warhub-name">${esc(x.name || x.user_name || `ID ${x.user_id || x.id || "?"}`)}</div><div class="warhub-meta">${esc(x.note || x.status || "Ready")}</div></div>`).join("")}</div>` : `<div class="warhub-empty">No chain sitter list returned yet.</div>`}
      </div>
    `;
  }

  function renderMedDealsTab() {
    const live = arr(state?.medDeals);
    const local = getLocalMeds();
    const all = [...live, ...local];
    return `
      <div class="warhub-card">
        <h3>Add Med Deal</h3>
        <div class="warhub-grid two">
          <div><label class="warhub-label">Name</label><input id="wh-med-name" class="warhub-input" placeholder="Player name"></div>
          <div><label class="warhub-label">Cost / Terms</label><input id="wh-med-cost" class="warhub-input" placeholder="Example: 2x FAK or $500k"></div>
        </div>
        <div style="margin-top:8px;"><label class="warhub-label">Note</label><input id="wh-med-note" class="warhub-input" placeholder="Optional"></div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-add-med">Save Med Deal</button></div>
      </div>
      <div class="warhub-card">
        <h3>Med Deals</h3>
        ${all.length ? `<div class="warhub-list">${all.map((x, i) => `<div class="warhub-list-item"><div class="warhub-row"><div><div class="warhub-name">${esc(x.name || x.player || "Unknown")}</div><div class="warhub-meta">${esc(x.cost || x.price || "—")} • ${esc(x.note || x.terms || "")}</div></div>${x.__local ? `<button class="warhub-btn small" data-del-med="${i}">Delete</button>` : `<span class="warhub-pill">Live</span>`}</div></div>`).join("")}</div>` : `<div class="warhub-empty">No med deals yet.</div>`}
      </div>
    `;
  }

  function renderTargetsTab() {
    const live = arr(state?.targets);
    const local = getLocalTargets();
    const all = [...live, ...local];
    const enemyOptions = arr(state?.enemies).map((x) => {
      const id = x.user_id || x.id || x.player_id || "";
      const name = x.name || x.player_name || `ID ${id}`;
      return `<option value="${esc(String(id))}|${esc(name)}">${esc(name)}${id ? ` [${esc(id)}]` : ""}</option>`;
    }).join("");

    return `
      <div class="warhub-card">
        <h3>Add Target</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Enemy Player</label>
            <select id="wh-target-pick" class="warhub-select">
              <option value="">Pick enemy from current war</option>
              ${enemyOptions}
            </select>
          </div>
          <div>
            <label class="warhub-label">Reason / Priority</label>
            <input id="wh-target-note" class="warhub-input" placeholder="Example: Low life / easy chain hit">
          </div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-add-target">Save Target</button></div>
      </div>
      <div class="warhub-card">
        <h3>Targets</h3>
        ${all.length ? `<div class="warhub-list">${all.map((x, i) => `${targetRow(x)}${x.__local ? `<div class="warhub-actions" style="margin-top:6px;"><button class="warhub-btn small" data-del-target="${i}">Delete</button></div>` : ""}`).join("")}</div>` : `<div class="warhub-empty">No targets saved yet.</div>`}
      </div>
    `;
  }

  function renderAssignmentsTab() {
    const rows = [...arr(state?.assignments), ...getAssignments()];
    return `
      <div class="warhub-card">
        <h3>Assign Target</h3>
        <div class="warhub-grid two">
          <div><label class="warhub-label">Member</label><input id="wh-assignee" class="warhub-input" placeholder="Who should hit"></div>
          <div><label class="warhub-label">Target</label><input id="wh-assignment-target" class="warhub-input" placeholder="Target name or ID"></div>
        </div>
        <div style="margin-top:8px;"><label class="warhub-label">Note</label><input id="wh-assignment-note" class="warhub-input" placeholder="Optional assignment note"></div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-save-assignment">Save Assignment</button></div>
      </div>
      <div class="warhub-card">
        <h3>Assignments</h3>
        ${rows.length ? `<div class="warhub-list">${rows.map((x, i) => `<div class="warhub-list-item"><div class="warhub-row"><div><div class="warhub-name">${esc(x.assignee || x.member || x.name || "Unknown")}</div><div class="warhub-meta">Target: ${esc(x.target || x.target_name || x.target_id || "—")} • ${esc(x.note || "")}</div></div>${x.__local ? `<button class="warhub-btn small" data-del-assignment="${i}">Delete</button>` : `<span class="warhub-pill">Live</span>`}</div></div>`).join("")}</div>` : `<div class="warhub-empty">No assignments yet.</div>`}
      </div>
    `;
  }

  function renderNotesTab() {
    return `
      <div class="warhub-card">
        <h3>War Notes</h3>
        <label class="warhub-label">Saved locally in the script so you do not lose your overlay notes again.</label>
        <textarea id="wh-notes" class="warhub-textarea" placeholder="Paste plans, timers, targets, med deal notes...">${esc(getNotes())}</textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-notes">Save Notes</button>
          <button class="warhub-btn" id="wh-clear-notes">Clear</button>
        </div>
      </div>
    `;
  }

  function renderAnalyticsTab() {
    const a = analyticsCache || {};
    return `
      <div class="warhub-card">
        <h3>Analytics</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric"><div class="k">Total Members</div><div class="v">${fmtNum(a.total_members || arr(state?.members).length)}</div></div>
          <div class="warhub-metric"><div class="k">Total Enemies</div><div class="v">${fmtNum(a.total_enemies || arr(state?.enemies).length)}</div></div>
          <div class="warhub-metric"><div class="k">Online Members</div><div class="v">${fmtNum(a.online_members || byStatus(arr(state?.members), "online").length)}</div></div>
          <div class="warhub-metric"><div class="k">Enemy In Hosp</div><div class="v">${fmtNum(a.enemy_hospital || sortHosp(arr(state?.enemies).filter(x => x.hosp_time || x.hospital_time || x.hospital_seconds)).length)}</div></div>
        </div>
      </div>
    `;
  }

  function renderNotificationsTab() {
    const items = mergedNotifications();
    return `
      <div class="warhub-card">
        <h3>Alerts</h3>
        ${items.length ? `<div class="warhub-list">${items.map((x) => `<div class="warhub-list-item"><div class="warhub-name">${esc(x.kind || x.title || "Alert")}</div><div class="warhub-meta">${esc(x.text || x.message || x.note || "")}</div><div class="warhub-mini">${esc(fmtTs(x.created_at || x.time || x.ts || ""))}</div></div>`).join("")}</div>` : `<div class="warhub-empty">No alerts yet.</div>`}
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn" id="wh-clear-alerts">Clear Local Alerts</button></div>
      </div>
    `;
  }

  function renderSettingsTab() {
    const refreshMs = Number(GM_getValue(K_REFRESH, 25000) || 25000);
    return `
      <div class="warhub-card">
        <h3>Keys</h3>
        <div class="warhub-grid two">
          <div><label class="warhub-label">Torn API Key</label><input id="wh-api-key" class="warhub-input" value="${esc(GM_getValue(K_API_KEY, ""))}" placeholder="Paste your API key"></div>
          <div><label class="warhub-label">Admin Key</label><input id="wh-admin-key" class="warhub-input" value="${esc(GM_getValue(K_ADMIN_KEY, ""))}" placeholder="Paste your admin key"></div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-save-settings">Save + Login</button></div>
      </div>
      <div class="warhub-card">
        <h3>Refresh</h3>
        <div class="warhub-grid two">
          <div><label class="warhub-label">Refresh milliseconds</label><input id="wh-refresh-ms" class="warhub-input" value="${esc(refreshMs)}"></div>
          <div><label class="warhub-label">Session</label><div class="warhub-mini">${GM_getValue(K_SESSION, "") ? "Session saved" : "No session yet"}</div></div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-save-refresh">Save Refresh</button>
          <button class="warhub-btn" id="wh-reset-icon">Reset Icon Position</button>
          <button class="warhub-btn" id="wh-reset-overlay">Reset Overlay Position</button>
          <button class="warhub-btn warn" id="wh-logout">Log Out</button>
        </div>
      </div>
    `;
  }

  function renderTabContent() {
    switch (currentTab) {
      case "members": return renderMembersTab();
      case "enemies": return renderEnemiesTab();
      case "hospital": return renderHospitalTab();
      case "chain": return renderChainTab();
      case "meddeals": return renderMedDealsTab();
      case "targets": return renderTargetsTab();
      case "assignments": return renderAssignmentsTab();
      case "notes": return renderNotesTab();
      case "analytics": return renderAnalyticsTab();
      case "notifications": return renderNotificationsTab();
      case "settings": return renderSettingsTab();
      case "war":
      default: return renderWarTab();
    }
  }

  function tabBtn(key, label) {
    const badgeNum = key === "notifications" ? unreadCount() : 0;
    const text = badgeNum ? `${label} (${badgeNum})` : label;
    return `<button class="warhub-tab ${currentTab === key ? "active" : ""}" data-tab="${key}">${text}</button>`;
  }

  function renderBody() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="warhub-head" id="warhub-drag-handle">
        <div class="warhub-toprow">
          <div>
            <div class="warhub-title">War Hub</div>
            <div class="warhub-sub">made by Fries91</div>
          </div>
          <button class="warhub-close" id="warhub-close-btn">Close</button>
        </div>
      </div>
      <div class="warhub-tabs">${TAB_ORDER.map(([key, label]) => tabBtn(key, label)).join("")}</div>
      <div class="warhub-body">
        <div id="warhub-status" class="warhub-status"></div>
        ${renderTabContent()}
      </div>
    `;
    bindOverlayEvents();
    bindOverlayDrag();
  }

  function clampElementPosition(el, left, top) {
    const rect = el.getBoundingClientRect();
    const w = rect.width || parseInt(getComputedStyle(el).width, 10) || 300;
    const h = rect.height || parseInt(getComputedStyle(el).height, 10) || 100;
    const maxLeft = Math.max(4, window.innerWidth - w - 4);
    const maxTop = Math.max(4, window.innerHeight - h - 4);
    const clampedLeft = Math.min(Math.max(4, left), maxLeft);
    const clampedTop = Math.min(Math.max(4, top), maxTop);
    el.style.left = `${clampedLeft}px`;
    el.style.top = `${clampedTop}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function clampToViewport(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    clampElementPosition(el, rect.left, rect.top);
  }

  function updateBadge() {
    if (!shield || !badge) return;
    const n = unreadCount();
    if (!n) {
      badge.style.display = "none";
      return;
    }
    const r = shield.getBoundingClientRect();
    badge.style.display = "block";
    badge.textContent = String(n > 99 ? "99+" : n);
    badge.style.left = `${r.right - 10}px`;
    badge.style.top = `${r.top - 6}px`;
    badge.style.right = "auto";
    badge.style.bottom = "auto";
  }

  function resetShieldPosition() {
    if (!shield) return;
    shield.style.left = "auto";
    shield.style.top = "120px";
    shield.style.right = "14px";
    shield.style.bottom = "auto";
    if (window.innerWidth <= 700) {
      shield.style.right = "8px";
      shield.style.top = "82px";
    }
  }

  function positionOverlayNearShield() {
    if (!shield || !overlay) return;
    const sr = shield.getBoundingClientRect();
    const overlayWidth = Math.min(window.innerWidth - 16, 500);
    let left = sr.right - overlayWidth;
    let top = sr.bottom + 8;
    if (window.innerWidth <= 700) {
      left = 6;
      top = 54;
    }
    clampElementPosition(overlay, left, top);
  }

  function openOverlay() {
    if (!overlay) return;
    isOpen = true;
    GM_setValue(K_OPEN, true);
    overlay.classList.add("open");
    if (!GM_getValue(K_OVERLAY_POS, null)) positionOverlayNearShield();
    clampToViewport(overlay);
    renderBody();
  }

  function closeOverlay() {
    if (!overlay) return;
    isOpen = false;
    GM_setValue(K_OPEN, false);
    overlay.classList.remove("open");
  }

  function toggleOverlay() {
    if (isOpen) closeOverlay(); else openOverlay();
  }

  function saveOverlayPos() {
    if (!overlay) return;
    GM_setValue(K_OVERLAY_POS, {
      left: overlay.style.left || "",
      top: overlay.style.top || "",
      right: overlay.style.right || "",
      bottom: overlay.style.bottom || "",
    });
  }

  function saveShieldPos() {
    if (!shield) return;
    GM_setValue(K_SHIELD_POS, {
      left: shield.style.left || "",
      top: shield.style.top || "",
      right: shield.style.right || "",
      bottom: shield.style.bottom || "",
    });
  }

  function makeDraggable(handleEl, moveEl, saveFn, extra) {
    let active = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let moved = false;
    const THRESHOLD = 6;

    function cleanup() {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
      handleEl.classList.remove("dragging");
      moveEl.classList.remove("dragging");
      moveEl.dataset.dragging = "0";
      active = null;
    }

    function onMove(e) {
      if (active !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) >= THRESHOLD || Math.abs(dy) >= THRESHOLD)) moved = true;
      if (!moved) return;
      e.preventDefault();
      dragMoved = true;
      handleEl.classList.add("dragging");
      moveEl.classList.add("dragging");
      moveEl.dataset.dragging = "1";
      clampElementPosition(moveEl, startLeft + dx, startTop + dy);
      if (typeof extra === "function") extra();
    }

    function onUp(e) {
      if (active !== e.pointerId) return;
      if (moved && typeof saveFn === "function") saveFn();
      setTimeout(() => { dragMoved = false; }, 120);
      cleanup();
    }

    handleEl.addEventListener("pointerdown", (e) => {
      const t = e.target;
      if (t && (t.closest("button") || t.closest("a") || t.closest("input") || t.closest("textarea") || t.closest("select"))) return;
      active = e.pointerId;
      moved = false;
      const r = moveEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = r.left;
      startTop = r.top;
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
      document.addEventListener("pointercancel", onUp, true);
    }, { passive: true });
  }

  function bindOverlayDrag() {
    const handle = overlay?.querySelector("#warhub-drag-handle");
    if (!handle || !overlay) return;
    makeDraggable(handle, overlay, saveOverlayPos, () => {});
  }

  function fillAssignmentTarget(value) {
    const input = overlay?.querySelector("#wh-assignment-target");
    if (input) input.value = value;
  }

  function bindOverlayEvents() {
    overlay.querySelectorAll(".warhub-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        currentTab = btn.dataset.tab || "war";
        GM_setValue(K_TAB, currentTab);
        if (currentTab === "analytics") await loadAnalytics();
        renderBody();
      });
    });

    overlay.querySelector("#warhub-close-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    });

    overlay.querySelector("#wh-available")?.addEventListener("click", async () => {
      await doAction("POST", "/api/availability/set", { available: true }, "Set to available.");
    });
    overlay.querySelector("#wh-unavailable")?.addEventListener("click", async () => {
      await doAction("POST", "/api/availability/set", { available: false }, "Set to unavailable.");
    });
    overlay.querySelector("#wh-opt-in")?.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter/set", { enabled: true }, "Chain sitter enabled.");
    });
    overlay.querySelector("#wh-opt-out")?.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter/set", { enabled: false }, "Chain sitter disabled.");
    });

    overlay.querySelector("#wh-save-settings")?.addEventListener("click", async () => {
      const api = String(overlay.querySelector("#wh-api-key")?.value || "").trim();
      const admin = String(overlay.querySelector("#wh-admin-key")?.value || "").trim();
      if (!api) return setStatus("Enter your Torn API key first.", true);
      if (!admin) return setStatus("Enter your admin key first.", true);
      GM_setValue(K_API_KEY, api);
      GM_setValue(K_ADMIN_KEY, admin);
      GM_deleteValue(K_SESSION);
      setStatus("Keys saved. Logging in...");
      const ok = await login();
      if (!ok) return;
      setStatus("Logged in.");
      await loadState(true);
      renderBody();
    });

    overlay.querySelector("#wh-save-refresh")?.addEventListener("click", () => {
      const val = Number(overlay.querySelector("#wh-refresh-ms")?.value || 25000);
      const ms = Number.isFinite(val) && val >= 5000 ? val : 25000;
      GM_setValue(K_REFRESH, ms);
      startPolling();
      setStatus(`Refresh saved at ${ms} ms.`);
    });

    overlay.querySelector("#wh-reset-icon")?.addEventListener("click", () => {
      GM_deleteValue(K_SHIELD_POS);
      resetShieldPosition();
      saveShieldPos();
      updateBadge();
      setStatus("Icon position reset.");
    });

    overlay.querySelector("#wh-reset-overlay")?.addEventListener("click", () => {
      GM_deleteValue(K_OVERLAY_POS);
      positionOverlayNearShield();
      saveOverlayPos();
      setStatus("Overlay position reset.");
    });

    overlay.querySelector("#wh-logout")?.addEventListener("click", () => {
      GM_deleteValue(K_SESSION);
      setStatus("Logged out.");
    });

    overlay.querySelector("#wh-save-notes")?.addEventListener("click", () => {
      setNotes(overlay.querySelector("#wh-notes")?.value || "");
      setStatus("Notes saved.");
    });

    overlay.querySelector("#wh-clear-notes")?.addEventListener("click", () => {
      setNotes("");
      renderBody();
      setStatus("Notes cleared.");
    });

    overlay.querySelector("#wh-save-assignment")?.addEventListener("click", () => {
      const assignee = String(overlay.querySelector("#wh-assignee")?.value || "").trim();
      const target = String(overlay.querySelector("#wh-assignment-target")?.value || "").trim();
      const note = String(overlay.querySelector("#wh-assignment-note")?.value || "").trim();
      if (!assignee || !target) return setStatus("Enter assignee and target first.", true);
      const rows = getAssignments();
      rows.unshift({ assignee, target, note, __local: true, created_at: new Date().toISOString() });
      setAssignments(rows.slice(0, 100));
      renderBody();
      setStatus("Assignment saved locally.");
    });

    overlay.querySelectorAll("[data-del-assignment]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-del-assignment"));
        const rows = getAssignments();
        rows.splice(idx, 1);
        setAssignments(rows);
        renderBody();
      });
    });

    overlay.querySelectorAll("[data-fill-assignment]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.getAttribute("data-fill-assignment") || "";
        const [id, name] = raw.split("|");
        currentTab = "assignments";
        GM_setValue(K_TAB, currentTab);
        renderBody();
        fillAssignmentTarget(`${name || ""}${id ? ` [${id}]` : ""}`.trim());
      });
    });

    overlay.querySelector("#wh-add-target")?.addEventListener("click", () => {
      const raw = String(overlay.querySelector("#wh-target-pick")?.value || "");
      const note = String(overlay.querySelector("#wh-target-note")?.value || "").trim();
      if (!raw) return setStatus("Pick an enemy first.", true);
      const [id, name] = raw.split("|");
      const rows = getLocalTargets();
      rows.unshift({ id, target_id: id, name, reason: note, __local: true, created_at: new Date().toISOString() });
      setLocalTargets(rows.slice(0, 100));
      renderBody();
      setStatus("Target saved locally.");
    });

    overlay.querySelectorAll("[data-del-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-del-target"));
        const rows = getLocalTargets();
        rows.splice(idx, 1);
        setLocalTargets(rows);
        renderBody();
      });
    });

    overlay.querySelector("#wh-add-med")?.addEventListener("click", () => {
      const name = String(overlay.querySelector("#wh-med-name")?.value || "").trim();
      const cost = String(overlay.querySelector("#wh-med-cost")?.value || "").trim();
      const note = String(overlay.querySelector("#wh-med-note")?.value || "").trim();
      if (!name || !cost) return setStatus("Enter a player name and cost first.", true);
      const rows = getLocalMeds();
      rows.unshift({ name, cost, note, __local: true, created_at: new Date().toISOString() });
      setLocalMeds(rows.slice(0, 100));
      renderBody();
      setStatus("Med deal saved locally.");
    });

    overlay.querySelectorAll("[data-del-med]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-del-med"));
        const rows = getLocalMeds();
        rows.splice(idx, 1);
        setLocalMeds(rows);
        renderBody();
      });
    });

    overlay.querySelector("#wh-clear-alerts")?.addEventListener("click", () => {
      setLocalNotifications([]);
      renderBody();
      updateBadge();
      setStatus("Local alerts cleared.");
    });
  }

  function mount() {
    if (!document.body) return;

    document.getElementById("warhub-shield")?.remove();
    document.getElementById("warhub-overlay")?.remove();
    document.getElementById("warhub-badge")?.remove();

    shield = document.createElement("div");
    shield.id = "warhub-shield";
    shield.textContent = "⚔️";

    overlay = document.createElement("div");
    overlay.id = "warhub-overlay";

    badge = document.createElement("div");
    badge.id = "warhub-badge";

    document.body.appendChild(overlay);
    document.body.appendChild(shield);
    document.body.appendChild(badge);

    const savedShield = GM_getValue(K_SHIELD_POS, null);
    if (savedShield) {
      shield.style.left = savedShield.left || "auto";
      shield.style.top = savedShield.top || "120px";
      shield.style.right = savedShield.right || "14px";
      shield.style.bottom = savedShield.bottom || "auto";
    } else {
      resetShieldPosition();
    }

    const savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (savedOverlay) {
      overlay.style.left = savedOverlay.left || "auto";
      overlay.style.top = savedOverlay.top || "170px";
      overlay.style.right = savedOverlay.right || "12px";
      overlay.style.bottom = savedOverlay.bottom || "auto";
    }

    clampToViewport(shield);

    shield.addEventListener("click", (e) => {
      if (dragMoved) return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    });

    shield.addEventListener("touchend", (e) => {
      if (dragMoved) return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    }, { passive: false });

    makeDraggable(shield, shield, saveShieldPos, updateBadge);

    if (isOpen) openOverlay(); else renderBody();
    updateBadge();
    mounted = true;
  }

  function ensureMounted() {
    if (mounted && shield && overlay && document.body.contains(shield) && document.body.contains(overlay)) return;
    mount();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const ms = Number(GM_getValue(K_REFRESH, 25000) || 25000);
    pollTimer = setInterval(() => {
      ensureMounted();
      loadState(true);
      if (currentTab === "analytics") loadAnalytics();
    }, Math.max(5000, ms));
  }

  async function boot() {
    ensureMounted();
    const token = GM_getValue(K_SESSION, "");
    if (!token && GM_getValue(K_API_KEY, "") && GM_getValue(K_ADMIN_KEY, "")) {
      await login();
    }
    await loadState(true);
    if (currentTab === "analytics") await loadAnalytics();
    startPolling();

    const localAlerts = getLocalNotifications();
    if (!localAlerts.length) {
      localAlerts.unshift({ kind: "Script Ready", text: "Ultimate War Hub loaded.", created_at: new Date().toISOString() });
      setLocalNotifications(localAlerts.slice(0, 20));
      updateBadge();
    }
  }

  const observer = new MutationObserver(() => ensureMounted());
  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => { clampToViewport(shield); if (isOpen) clampToViewport(overlay); updateBadge(); });
  window.addEventListener("orientationchange", () => { setTimeout(() => { clampToViewport(shield); if (isOpen) clampToViewport(overlay); updateBadge(); }, 150); });

  boot();
})();
