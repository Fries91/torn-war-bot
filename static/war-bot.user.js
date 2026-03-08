// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      2.0.1
// @description  War Hub by Fries91. Restored draggable clickable icon, draggable overlay, PDA friendly, war overview, members, enemies, hospital, chain sitters, med deals, smart targets, assignments, notes, analytics, notifications, and settings.
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

  const K_API_KEY = "warhub_api_key_v1";
  const K_ADMIN_KEY = "warhub_admin_key_v1";
  const K_SESSION = "warhub_session_v1";
  const K_OPEN = "warhub_open_v1";
  const K_TAB = "warhub_tab_v1";
  const K_SHIELD_POS = "warhub_shield_pos_v1";
  const K_OVERLAY_POS = "warhub_overlay_pos_v1";
  const K_REFRESH = "warhub_refresh_ms_v1";

  let state = null;
  let analyticsCache = null;
  let isOpen = !!GM_getValue(K_OPEN, false);
  let currentTab = GM_getValue(K_TAB, "war");
  let overlay = null;
  let badge = null;
  let shield = null;
  let pollTimer = null;
  let mounted = false;
  let dragMoved = false;

  GM_addStyle(`
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
      box-shadow: 0 7px 18px rgba(0,0,0,.42);
      border: 1px solid rgba(255,255,255,.10);
      background: radial-gradient(circle at top, rgba(190,25,25,.96), rgba(78,8,8,.96));
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
      width: min(95vw, 460px);
      height: min(84vh, 800px);
      max-height: 84vh;
      overflow: hidden;
      border-radius: 14px;
      background: linear-gradient(180deg, #161616, #0c0c0c);
      color: #f2f2f2;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 14px 34px rgba(0,0,0,.5);
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
    .warhub-title { font-weight: 800; font-size: 16px; letter-spacing: .2px; }
    .warhub-sub { font-size: 10px; opacity: .74; margin-top: 1px; }

    .warhub-toprow {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }

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
      overscroll-behavior: contain;
      touch-action: pan-y;
      flex: 1 1 auto;
      min-height: 0;
    }

    .warhub-card {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 11px;
      padding: 9px;
      margin-bottom: 8px;
    }

    .warhub-card h3 { margin: 0 0 7px; font-size: 12px; }
    .warhub-grid { display: grid; gap: 7px; }
    .warhub-grid.two { grid-template-columns: 1fr 1fr; }

    .warhub-input, .warhub-textarea, .warhub-select {
      width: 100%;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(0,0,0,.25);
      color: #fff;
      border-radius: 9px;
      padding: 8px 9px;
      box-sizing: border-box;
      font-size: 12px;
    }

    .warhub-textarea { min-height: 72px; resize: vertical; }

    .warhub-btn {
      border: 0;
      border-radius: 9px;
      background: linear-gradient(180deg, #d23333, #891414);
      color: #fff;
      padding: 7px 10px;
      font-weight: 800;
      cursor: pointer;
      font-size: 11px;
      text-align: center;
      text-decoration: none;
      display: inline-block;
    }

    .warhub-btn.alt { background: rgba(255,255,255,.08); }
    .warhub-btn.green { background: linear-gradient(180deg, #2ea44f, #1c6b33); }
    .warhub-btn.gray { background: linear-gradient(180deg, #535353, #2d2d2d); }
    .warhub-btn.gold { background: linear-gradient(180deg, #c89726, #7c5910); }

    .warhub-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
    }

    .warhub-list-item {
      border: 1px solid rgba(255,255,255,.07);
      background: rgba(255,255,255,.03);
      border-radius: 10px;
      padding: 8px;
      margin-bottom: 7px;
    }

    .warhub-small { font-size: 10px; opacity: .75; }
    .warhub-link { color: #ff8d8d; text-decoration: none; font-weight: 700; font-size: 11px; }

    .warhub-status {
      padding: 7px 9px;
      border-radius: 10px;
      margin-bottom: 8px;
      font-size: 11px;
      background: rgba(255,255,255,.05);
      display: none;
    }

    .warhub-status.show { display: block; }
    .warhub-empty { opacity: .65; font-size: 11px; padding: 5px 2px; }

    .pill {
      display: inline-block;
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      margin-right: 5px;
      margin-bottom: 4px;
    }

    .pill.green { background: rgba(30,160,70,.22); color: #8ff0a7; }
    .pill.red { background: rgba(180,30,30,.24); color: #ff9a9a; }
    .pill.gold { background: rgba(190,145,20,.25); color: #ffe084; }
    .pill.gray { background: rgba(255,255,255,.08); color: #ddd; }
    .pill.blue { background: rgba(42,112,220,.22); color: #9fc4ff; }

    .warhub-group-title {
      margin: 8px 0 7px;
      font-size: 11px;
      font-weight: 800;
      opacity: .9;
    }

    .warhub-score-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 7px;
      margin-top: 7px;
    }

    .warhub-score-box {
      border-radius: 12px;
      padding: 10px 9px;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
      min-width: 0;
    }

    .warhub-score-box.us {
      background: linear-gradient(180deg, rgba(26,120,52,.34), rgba(10,46,20,.55));
      border-color: rgba(94,214,130,.28);
    }

    .warhub-score-box.them {
      background: linear-gradient(180deg, rgba(150,28,28,.34), rgba(60,10,10,.58));
      border-color: rgba(255,120,120,.24);
    }

    .warhub-score-box.lead {
      background: linear-gradient(180deg, rgba(180,138,22,.34), rgba(70,48,8,.58));
      border-color: rgba(255,214,102,.24);
    }

    .warhub-score-label {
      font-size: 9px;
      opacity: .78;
      text-transform: uppercase;
      letter-spacing: .5px;
      margin-bottom: 4px;
      font-weight: 800;
    }

    .warhub-score-value {
      font-size: 18px;
      font-weight: 900;
      line-height: 1.1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .warhub-score-sub {
      margin-top: 4px;
      font-size: 10px;
      opacity: .78;
      word-break: break-word;
    }

    .warhub-banner {
      border-radius: 12px;
      padding: 12px 10px;
      margin-bottom: 8px;
      text-align: center;
      font-weight: 900;
      letter-spacing: .6px;
      font-size: 13px;
      border: 1px solid rgba(255,120,120,.26);
      background: linear-gradient(180deg, rgba(170,20,20,.42), rgba(70,8,8,.62));
      color: #ffd5d5;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
    }

    @media (max-width: 700px) {
      #warhub-overlay {
        width: calc(100vw - 12px) !important;
        height: calc(100vh - 72px) !important;
        max-height: calc(100vh - 72px) !important;
        left: 6px !important;
        right: auto !important;
        top: 54px !important;
        bottom: auto !important;
      }

      #warhub-shield {
        right: 10px !important;
        top: auto !important;
        bottom: 16px !important;
        left: auto !important;
      }

      .warhub-grid.two,
      .warhub-score-grid {
        grid-template-columns: 1fr;
      }
    }
  `);

  function req(method, path, data, useSession = true) {
    const headers = { "Content-Type": "application/json" };
    if (useSession) {
      const token = GM_getValue(K_SESSION, "");
      if (token) headers["X-Session-Token"] = token;
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: BASE_URL + path,
        headers,
        data: data ? JSON.stringify(data) : undefined,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText || "{}"));
          } catch (_e) {
            reject(new Error("Bad JSON from server."));
          }
        },
        onerror: () => reject(new Error("Network request failed.")),
      });
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function asNum(v) {
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function fmtNum(v) {
    return asNum(v).toLocaleString();
  }

  function setStatus(msg, bad = false) {
    const el = document.querySelector("#warhub-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("show", !!msg);
    el.style.background = bad ? "rgba(170,20,20,.25)" : "rgba(255,255,255,.05)";
  }

  function unreadCount() {
    const arr = state?.notifications || [];
    return arr.filter(x => !Number(x.seen)).length;
  }

  function updateBadge() {
    if (!badge || !shield) return;
    const n = unreadCount();
    if (n > 0) {
      badge.style.display = "block";
      badge.textContent = String(n);
    } else {
      badge.style.display = "none";
    }

    const r = shield.getBoundingClientRect();
    badge.style.left = `${Math.max(0, r.right - 7)}px`;
    badge.style.top = `${Math.max(0, r.top - 5)}px`;
  }

  function resetShieldPosition() {
    if (!shield) return;
    shield.style.left = "auto";
    shield.style.bottom = "auto";
    if (window.innerWidth <= 700) {
      shield.style.right = "10px";
      shield.style.top = "auto";
      shield.style.bottom = "16px";
    } else {
      shield.style.right = "14px";
      shield.style.top = "120px";
    }
    GM_setValue(K_SHIELD_POS, {
      left: shield.style.left || "",
      top: shield.style.top || "",
      right: shield.style.right || "",
      bottom: shield.style.bottom || "",
    });
  }

  function clampElementPosition(el, preferredLeft = null, preferredTop = null) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;

    let left = preferredLeft != null ? preferredLeft : rect.left;
    let top = preferredTop != null ? preferredTop : rect.top;

    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);

    left = Math.min(Math.max(margin, left), maxLeft);
    top = Math.min(Math.max(margin, top), maxTop);

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  function clampToViewport(el) {
    clampElementPosition(el);
  }

  function formatHosp(seconds) {
    const s = Number(seconds || 0);
    if (!s) return "";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function fmtDate(tsOrText) {
    if (tsOrText == null || tsOrText === "") return "-";
    if (typeof tsOrText === "number" || /^\d+$/.test(String(tsOrText))) {
      const d = new Date(Number(tsOrText) * 1000);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    const d = new Date(tsOrText);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    return String(tsOrText);
  }

  function resolveWarContext() {
    const root = state || {};
    const war = root.war || {};
    const me = root.me || {};
    return {
      me,
      war,
      inWar: !!(war.active || war.enemy_faction_id || war.enemy_faction_name),
      myFactionName: String(war.faction_name || me.faction_name || "Our Faction"),
      enemyFactionName: String(war.enemy_faction_name || ""),
      members: Array.isArray(root.members) ? root.members : [],
      enemies: Array.isArray(root.enemies) ? root.enemies : [],
      myScore: asNum(war.score_us),
      enemyScore: asNum(war.score_them),
      lead: asNum(war.lead),
    };
  }

  async function login() {
    const apiKey = (GM_getValue(K_API_KEY, "") || "").trim();
    const adminKey = (GM_getValue(K_ADMIN_KEY, "") || "").trim();

    if (!apiKey) {
      setStatus("Save your Torn API key in Settings first.", true);
      return false;
    }
    if (!adminKey) {
      setStatus("Save your admin key in Settings first.", true);
      return false;
    }

    const res = await req("POST", "/api/auth", {
      api_key: apiKey,
      admin_key: adminKey,
    }, false);

    const token = res?.token || "";
    if (!res.ok || !token) {
      setStatus(res.error || "Login failed.", true);
      return false;
    }

    GM_setValue(K_SESSION, token);
    return true;
  }

  async function loadAnalytics() {
    const res = await req("GET", "/api/analytics");
    if (res && res.ok) analyticsCache = res.analytics || null;
  }

  async function loadState() {
    let res = await req("GET", "/api/state");
    if (res && res.ok) {
      state = res;
      if (currentTab === "analytics") await loadAnalytics();
      renderBody();
      updateBadge();
      refreshPoll();
      return;
    }

    const loggedIn = await login();
    if (!loggedIn) {
      renderBody();
      return;
    }

    res = await req("GET", "/api/state");
    if (res && res.ok) {
      state = res;
      if (currentTab === "analytics") await loadAnalytics();
      renderBody();
      updateBadge();
      refreshPoll();
    } else {
      setStatus((res && res.error) || "Could not load state.", true);
    }
  }

  function refreshPoll() {
    if (pollTimer) clearInterval(pollTimer);
    const fromState = asNum(state?.settings?.refresh_seconds || 0);
    const fallback = asNum(GM_getValue(K_REFRESH, 30000));
    const ms = Math.max(10000, (fromState > 0 ? fromState * 1000 : fallback));
    GM_setValue(K_REFRESH, ms);
    pollTimer = setInterval(() => {
      loadState().catch(() => {});
    }, ms);
  }

  function memberStatusPill(m) {
    const s = String(m.online_state || "offline").toLowerCase();
    if (s === "online") return `<span class="pill green">Online</span>`;
    if (s === "idle") return `<span class="pill blue">Idle</span>`;
    if (s === "hospital") return `<span class="pill red">Hospital ${esc(formatHosp(m.hospital_seconds || 0))}</span>`;
    return `<span class="pill gray">Offline</span>`;
  }

  function renderWarTab() {
    const ctx = resolveWarContext();
    const war = ctx.war || {};
    return `
      ${!ctx.inWar ? `<div class="warhub-banner">CURRENTLY NOT IN A WAR</div>` : ""}
      <div class="warhub-card">
        <h3>War Overview</h3>
        <div class="warhub-score-grid">
          <div class="warhub-score-box us">
            <div class="warhub-score-label">Our Score</div>
            <div class="warhub-score-value">${esc(fmtNum(ctx.myScore))}</div>
            <div class="warhub-score-sub">${esc(ctx.myFactionName)}</div>
          </div>
          <div class="warhub-score-box them">
            <div class="warhub-score-label">Their Score</div>
            <div class="warhub-score-value">${esc(fmtNum(ctx.enemyScore))}</div>
            <div class="warhub-score-sub">${esc(ctx.enemyFactionName || "No enemy")}</div>
          </div>
          <div class="warhub-score-box lead">
            <div class="warhub-score-label">Lead</div>
            <div class="warhub-score-value">${esc(fmtNum(ctx.lead))}</div>
            <div class="warhub-score-sub">${esc(war.status_text || "-")}</div>
          </div>
        </div>
      </div>
      <div class="warhub-card">
        <h3>Quick Links</h3>
        <div class="warhub-row">
          <button class="warhub-btn gold" id="wh-opt-in">Opt In</button>
          <button class="warhub-btn gray" id="wh-opt-out">Opt Out</button>
          <button class="warhub-btn green" id="wh-available">Available</button>
          <button class="warhub-btn alt" id="wh-unavailable">Unavailable</button>
        </div>
      </div>
    `;
  }

  function renderMembersTab() {
    const members = state?.members || [];
    return `
      <div class="warhub-card">
        <h3>Members</h3>
        ${members.length ? members.map(m => `
          <div class="warhub-list-item">
            <div><strong>${esc(m.name || "Unknown")}</strong> ${m.level ? `(Lvl ${esc(m.level)})` : ""}</div>
            <div style="margin-top:6px;">${memberStatusPill(m)}</div>
          </div>
        `).join("") : `<div class="warhub-empty">No members found.</div>`}
      </div>
    `;
  }

  function renderEnemiesTab() {
    const enemies = state?.enemies || [];
    return `
      <div class="warhub-card">
        <h3>Enemies</h3>
        ${enemies.length ? enemies.map(m => `
          <div class="warhub-list-item">
            <div><strong>${esc(m.name || "Unknown")}</strong> ${m.level ? `(Lvl ${esc(m.level)})` : ""}</div>
            <div style="margin-top:6px;">${memberStatusPill(m)}</div>
            <div class="warhub-row" style="margin-top:7px;">
              <a class="warhub-link" href="${esc(m.profile_url || "#")}" target="_blank" rel="noreferrer">Profile</a>
              <a class="warhub-link" href="${esc(m.attack_url || "#")}" target="_blank" rel="noreferrer">Attack</a>
            </div>
          </div>
        `).join("") : `<div class="warhub-empty">No enemies found.</div>`}
      </div>
    `;
  }

  function renderAnalyticsTab() {
    const a = analyticsCache || state?.analytics || {};
    return `
      <div class="warhub-card">
        <h3>Analytics</h3>
        <div class="warhub-list-item">Lead: ${esc(fmtNum(a.lead || 0))}</div>
        <div class="warhub-list-item">Our Pace / Hr: ${esc(String(a.pace_per_hour_us || 0))}</div>
        <div class="warhub-list-item">Their Pace / Hr: ${esc(String(a.pace_per_hour_them || 0))}</div>
        <div class="warhub-list-item">ETA: ${esc(a.eta_to_target_us_text || "-")}</div>
      </div>
    `;
  }

  function renderSettingsTab() {
    const apiKey = GM_getValue(K_API_KEY, "") || "";
    const adminKey = GM_getValue(K_ADMIN_KEY, "") || "";
    return `
      <div class="warhub-card">
        <h3>Settings</h3>
        <div class="warhub-grid two">
          <input id="wh-api-key" class="warhub-input" placeholder="Your Torn API key" value="${esc(apiKey)}">
          <input id="wh-admin-key" class="warhub-input" placeholder="Your admin key" value="${esc(adminKey)}">
        </div>
        <div class="warhub-row" style="margin-top:7px;">
          <button class="warhub-btn" id="wh-save-settings">Save Keys</button>
          <button class="warhub-btn alt" id="wh-reset-icon">Reset Icon</button>
          <button class="warhub-btn alt" id="wh-reset-overlay">Reset Overlay</button>
        </div>
      </div>
    `;
  }

  function renderNotificationsTab() {
    const items = state?.notifications || [];
    return `
      <div class="warhub-card">
        <h3>Notifications</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div><strong>${esc(x.kind || "notice")}</strong></div>
            <div>${esc(x.text || "")}</div>
          </div>
        `).join("") : `<div class="warhub-empty">No notifications yet.</div>`}
      </div>
    `;
  }

  function renderTabContent() {
    switch (currentTab) {
      case "members": return renderMembersTab();
      case "enemies": return renderEnemiesTab();
      case "analytics": return renderAnalyticsTab();
      case "notifications": return renderNotificationsTab();
      case "settings": return renderSettingsTab();
      case "war":
      default:
        return renderWarTab();
    }
  }

  function tabBtn(key, label) {
    return `<button class="warhub-tab ${currentTab === key ? "active" : ""}" data-tab="${key}">${label}</button>`;
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
      <div class="warhub-tabs">
        ${tabBtn("war", "War")}
        ${tabBtn("members", "Members")}
        ${tabBtn("enemies", "Enemies")}
        ${tabBtn("analytics", "Analytics")}
        ${tabBtn("notifications", `Notes${unreadCount() ? ` (${unreadCount()})` : ""}`)}
        ${tabBtn("settings", "Settings")}
      </div>
      <div class="warhub-body">
        <div id="warhub-status" class="warhub-status"></div>
        ${renderTabContent()}
      </div>
    `;

    bindOverlayEvents();
    bindOverlayDrag();
  }

  function openOverlay() {
    if (!overlay) return;
    isOpen = true;
    GM_setValue(K_OPEN, true);
    overlay.classList.add("open");
    const savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (!savedOverlay) positionOverlayNearShield();
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
    if (isOpen) closeOverlay();
    else openOverlay();
  }

  function positionOverlayNearShield() {
    if (!shield || !overlay) return;
    const sr = shield.getBoundingClientRect();
    const overlayWidth = Math.min(window.innerWidth - 16, 460);
    let left = sr.right - overlayWidth;
    let top = sr.bottom + 8;
    if (window.innerWidth <= 700) {
      left = 6;
      top = 54;
    }
    clampElementPosition(overlay, left, top);
  }

  async function doAction(method, path, body, successMsg, reload = true) {
    const res = await req(method, path, body);
    if (!res.ok) {
      setStatus(res.error || "Action failed.", true);
      return null;
    }
    if (successMsg) setStatus(successMsg, false);
    if (reload) await loadState();
    return res;
  }

  function val(sel) {
    const el = overlay?.querySelector(sel);
    return el ? String(el.value || "").trim() : "";
  }

  function bindOverlayEvents() {
    overlay.querySelectorAll(".warhub-tab").forEach(btn => {
      btn.addEventListener("click", async () => {
        currentTab = btn.dataset.tab || "war";
        GM_setValue(K_TAB, currentTab);
        if (currentTab === "analytics") await loadAnalytics();
        renderBody();
      });
    });

    const closeBtn = overlay.querySelector("#warhub-close-btn");
    if (closeBtn) closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeOverlay();
    });

    const quickOptIn = overlay.querySelector("#wh-opt-in");
    if (quickOptIn) quickOptIn.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter/set", { enabled: true }, "Opted in.");
    });

    const quickOptOut = overlay.querySelector("#wh-opt-out");
    if (quickOptOut) quickOptOut.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter/set", { enabled: false }, "Opted out.");
    });

    const quickAvailable = overlay.querySelector("#wh-available");
    if (quickAvailable) quickAvailable.addEventListener("click", async () => {
      await doAction("POST", "/api/availability/set", { available: true }, "Set to available.");
    });

    const quickUnavailable = overlay.querySelector("#wh-unavailable");
    if (quickUnavailable) quickUnavailable.addEventListener("click", async () => {
      await doAction("POST", "/api/availability/set", { available: false }, "Set to unavailable.");
    });

    const saveSettings = overlay.querySelector("#wh-save-settings");
    if (saveSettings) saveSettings.addEventListener("click", async () => {
      const newApiKey = val("#wh-api-key");
      const newAdminKey = val("#wh-admin-key");
      if (!newApiKey) return setStatus("Enter your Torn API key first.", true);
      if (!newAdminKey) return setStatus("Enter your admin key first.", true);

      GM_setValue(K_API_KEY, newApiKey);
      GM_setValue(K_ADMIN_KEY, newAdminKey);
      GM_deleteValue(K_SESSION);

      setStatus("Keys saved. Logging in...");
      const okLogin = await login();
      if (okLogin) {
        setStatus("Keys saved and logged in.");
        await loadState();
      }
    });

    const resetIcon = overlay.querySelector("#wh-reset-icon");
    if (resetIcon) resetIcon.addEventListener("click", () => {
      GM_deleteValue(K_SHIELD_POS);
      resetShieldPosition();
      updateBadge();
      setStatus("Icon reset.");
    });

    const resetOverlay = overlay.querySelector("#wh-reset-overlay");
    if (resetOverlay) resetOverlay.addEventListener("click", () => {
      GM_deleteValue(K_OVERLAY_POS);
      positionOverlayNearShield();
      clampToViewport(overlay);
      setStatus("Overlay reset.");
    });
  }

  function bindOverlayDrag() {
    const handle = overlay?.querySelector("#warhub-drag-handle");
    if (!handle || !overlay) return;
    makeDraggable(handle, overlay, K_OVERLAY_POS, () => {
      handle.classList.toggle("dragging", overlay.dataset.dragging === "1");
    });
  }

  function ensureMounted() {
    if (mounted && shield && overlay && document.body.contains(shield) && document.body.contains(overlay)) {
      return;
    }
    mount();
  }

  function mount() {
    if (!document.body) return;

    const oldShield = document.getElementById("warhub-shield");
    const oldOverlay = document.getElementById("warhub-overlay");
    const oldBadge = document.getElementById("warhub-badge");
    if (oldShield) oldShield.remove();
    if (oldOverlay) oldOverlay.remove();
    if (oldBadge) oldBadge.remove();

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
      if (savedShield.left) shield.style.left = savedShield.left;
      if (savedShield.top) shield.style.top = savedShield.top;
      if (savedShield.right) shield.style.right = savedShield.right;
      if (savedShield.bottom) shield.style.bottom = savedShield.bottom;
    } else {
      resetShieldPosition();
    }

    const savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (savedOverlay) {
      if (savedOverlay.left) overlay.style.left = savedOverlay.left;
      if (savedOverlay.top) overlay.style.top = savedOverlay.top;
      if (savedOverlay.right) overlay.style.right = savedOverlay.right;
      if (savedOverlay.bottom) overlay.style.bottom = savedOverlay.bottom;
    }

    clampToViewport(shield);

    shield.addEventListener("click", (e) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    });

    shield.addEventListener("touchend", (e) => {
      if (dragMoved) {
        dragMoved = false;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    }, { passive: false });

    makeDraggable(shield, shield, K_SHIELD_POS, () => {
      shield.classList.toggle("dragging", shield.dataset.dragging === "1");
      updateBadge();
    });

    if (isOpen) openOverlay();
    else renderBody();

    updateBadge();
    mounted = true;
  }

  function makeDraggable(handleEl, moveEl, storageKey, onMoveExtra) {
    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let moved = false;
    const DRAG_THRESHOLD = 6;

    const savePos = () => {
      GM_setValue(storageKey, {
        left: moveEl.style.left || "",
        top: moveEl.style.top || "",
        right: moveEl.style.right || "",
        bottom: moveEl.style.bottom || "",
      });
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);

      activePointerId = null;
      dragging = false;

      if (moved) {
        moveEl.dataset.dragging = "1";
        dragMoved = true;
        setTimeout(() => {
          moveEl.dataset.dragging = "0";
          dragMoved = false;
          if (typeof onMoveExtra === "function") onMoveExtra();
        }, 180);
      } else {
        moveEl.dataset.dragging = "0";
        if (typeof onMoveExtra === "function") onMoveExtra();
      }

      handleEl.classList.remove("dragging");
      if (moveEl === shield) shield.classList.remove("dragging");
    };

    const onPointerMove = (e) => {
      if (!dragging) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!moved && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) moved = true;
      if (!moved) return;

      e.preventDefault();
      e.stopPropagation();

      moveEl.dataset.dragging = "1";
      clampElementPosition(moveEl, startLeft + dx, startTop + dy);
      if (typeof onMoveExtra === "function") onMoveExtra();
    };

    const onPointerUp = (e) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (moved) savePos();
      cleanup();
    };

    const onPointerCancel = (e) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (moved) savePos();
      cleanup();
    };

    const onPointerDown = (e) => {
      const target = e.target;
      if (target && (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("textarea") ||
        target.closest("select")
      )) return;

      const rect = moveEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      activePointerId = e.pointerId;
      dragging = true;
      moved = false;
      moveEl.dataset.dragging = "0";

      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";

      handleEl.classList.add("dragging");
      if (moveEl === shield) shield.classList.add("dragging");

      document.addEventListener("pointermove", onPointerMove, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerCancel, true);

      try { handleEl.setPointerCapture(activePointerId); } catch (_err) {}

      e.preventDefault();
      e.stopPropagation();
    };

    handleEl.addEventListener("pointerdown", onPointerDown, { passive: false });
  }

  async function boot() {
    ensureMounted();
    try {
      await loadState();
    } catch (e) {
      setStatus(e.message || "Boot failed.", true);
      renderBody();
    }
  }

  function watchForBodyLoss() {
    setInterval(() => {
      if (!document.body) return;
      if (!document.getElementById("warhub-shield") || !document.getElementById("warhub-overlay")) {
        mounted = false;
        ensureMounted();
        loadState().catch(() => {});
      }
    }, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  watchForBodyLoss();

  window.addEventListener("resize", () => {
    if (shield) clampToViewport(shield);
    if (overlay && overlay.classList.contains("open")) clampToViewport(overlay);
    updateBadge();
  });
})();
