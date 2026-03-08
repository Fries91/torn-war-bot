// ==UserScript==
// @name         War Hub 🛡️
// @namespace    fries91-war-hub
// @version      1.5.0
// @description  War Hub by Fries91. Draggable shield, draggable overlay, members/enemies organization, target enemy dropdown, PDA friendly.
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
  const ADMIN_KEY = "666";

  const K_API_KEY = "warhub_api_key_v1";
  const K_SESSION = "warhub_session_v1";
  const K_OPEN = "warhub_open_v1";
  const K_TAB = "warhub_tab_v1";
  const K_SHIELD_POS = "warhub_shield_pos_v1";
  const K_OVERLAY_POS = "warhub_overlay_pos_v1";

  let state = null;
  let isOpen = GM_getValue(K_OPEN, false);
  let currentTab = GM_getValue(K_TAB, "war");
  let overlay, badge, shield;

  GM_addStyle(`
    #warhub-shield {
      position: fixed !important;
      z-index: 2147483647 !important;
      width: 46px;
      height: 46px;
      border-radius: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      box-shadow: 0 8px 22px rgba(0,0,0,.45);
      border: 1px solid rgba(255,255,255,.10);
      background: radial-gradient(circle at top, rgba(190,25,25,.96), rgba(78,8,8,.96));
      color: #fff;
      top: 120px;
      right: 14px;
      left: auto;
      bottom: auto;
    }

    #warhub-shield.dragging {
      cursor: grabbing;
    }

    #warhub-badge {
      position: fixed !important;
      z-index: 2147483647 !important;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: #ffd54a;
      color: #111;
      font-size: 11px;
      line-height: 18px;
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
      top: 172px;
      width: min(95vw, 460px);
      max-height: 76vh;
      overflow: hidden;
      border-radius: 16px;
      background: linear-gradient(180deg, #161616, #0c0c0c);
      color: #f2f2f2;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 14px 34px rgba(0,0,0,.5);
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      left: auto;
      bottom: auto;
    }

    #warhub-overlay.open {
      display: block !important;
    }

    .warhub-head {
      padding: 12px 14px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20));
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }

    .warhub-head.dragging {
      cursor: grabbing;
    }

    .warhub-title {
      font-weight: 800;
      font-size: 17px;
      letter-spacing: .2px;
    }

    .warhub-sub {
      font-size: 11px;
      opacity: .74;
      margin-top: 2px;
    }

    .warhub-toprow {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }

    .warhub-close {
      border: 0;
      border-radius: 10px;
      background: rgba(255,255,255,.08);
      color: #fff;
      padding: 6px 10px;
      font-weight: 700;
      cursor: pointer;
    }

    .warhub-tabs {
      display: flex;
      gap: 6px;
      padding: 10px;
      overflow-x: auto;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.02);
      scrollbar-width: thin;
    }

    .warhub-tab {
      border: 0;
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      color: #fff;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .warhub-tab.active {
      background: linear-gradient(180deg, #d23333, #831515);
    }

    .warhub-body {
      padding: 10px;
      max-height: calc(76vh - 114px);
      overflow: auto;
    }

    .warhub-card {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 10px;
    }

    .warhub-card h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }

    .warhub-grid {
      display: grid;
      gap: 8px;
    }

    .warhub-grid.two {
      grid-template-columns: 1fr 1fr;
    }

    .warhub-input, .warhub-textarea, .warhub-select {
      width: 100%;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(0,0,0,.25);
      color: #fff;
      border-radius: 10px;
      padding: 9px 10px;
      box-sizing: border-box;
      font-size: 13px;
    }

    .warhub-textarea {
      min-height: 76px;
      resize: vertical;
    }

    .warhub-btn {
      border: 0;
      border-radius: 10px;
      background: linear-gradient(180deg, #d23333, #891414);
      color: #fff;
      padding: 8px 11px;
      font-weight: 800;
      cursor: pointer;
      font-size: 12px;
    }

    .warhub-btn.alt {
      background: rgba(255,255,255,.08);
    }

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
      padding: 9px;
      margin-bottom: 8px;
    }

    .warhub-small {
      font-size: 11px;
      opacity: .75;
    }

    .warhub-link {
      color: #ff8d8d;
      text-decoration: none;
      font-weight: 700;
      font-size: 12px;
    }

    .warhub-status {
      padding: 8px 10px;
      border-radius: 10px;
      margin-bottom: 10px;
      font-size: 12px;
      background: rgba(255,255,255,.05);
      display: none;
    }

    .warhub-status.show {
      display: block;
    }

    .warhub-kv {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 6px 10px;
      font-size: 13px;
    }

    .warhub-empty {
      opacity: .65;
      font-size: 12px;
      padding: 6px 2px;
    }

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
      margin: 10px 0 8px;
      font-size: 12px;
      font-weight: 800;
      opacity: .9;
    }

    .warhub-tos {
      font-size: 11px;
      line-height: 1.45;
      opacity: .86;
      white-space: normal;
    }

    .warhub-overview-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .warhub-stat {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.07);
      border-radius: 12px;
      padding: 10px;
      min-width: 0;
    }

    .warhub-stat-label {
      font-size: 10px;
      opacity: .72;
      text-transform: uppercase;
      letter-spacing: .45px;
      margin-bottom: 4px;
    }

    .warhub-stat-value {
      font-size: 14px;
      font-weight: 800;
      line-height: 1.25;
      word-break: break-word;
    }

    .warhub-quick-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    @media (max-width: 700px) {
      #warhub-overlay {
        width: calc(100vw - 16px) !important;
        left: 8px !important;
        right: auto !important;
        top: 64px !important;
        bottom: auto !important;
        max-height: calc(100vh - 132px) !important;
      }

      #warhub-shield {
        right: 10px !important;
        top: auto !important;
        bottom: 16px !important;
        left: auto !important;
      }

      .warhub-body {
        max-height: calc(100vh - 196px);
      }

      .warhub-grid.two,
      .warhub-quick-grid,
      .warhub-overview-grid {
        grid-template-columns: 1fr 1fr;
      }

      .warhub-toprow {
        align-items: flex-start;
      }

      .warhub-row {
        justify-content: flex-start;
      }
    }

    @media (max-width: 430px) {
      .warhub-overview-grid,
      .warhub-quick-grid,
      .warhub-grid.two {
        grid-template-columns: 1fr;
      }

      #warhub-shield {
        width: 44px;
        height: 44px;
        font-size: 23px;
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
    const n = unreadCount();
    if (!badge || !shield) return;

    if (n > 0) {
      badge.style.display = "block";
      badge.textContent = String(n);
    } else {
      badge.style.display = "none";
    }

    const r = shield.getBoundingClientRect();
    badge.style.left = `${Math.max(0, r.right - 8)}px`;
    badge.style.top = `${Math.max(0, r.top - 6)}px`;
  }

  function isOffscreen(el) {
    const rect = el.getBoundingClientRect();
    return (
      rect.right < 8 ||
      rect.bottom < 8 ||
      rect.left > window.innerWidth - 8 ||
      rect.top > window.innerHeight - 8 ||
      rect.width <= 0 ||
      rect.height <= 0
    );
  }

  function resetShieldPosition() {
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

  function memberStatusPill(m) {
    const s = String(m.online_state || "offline").toLowerCase();
    if (s === "online") return `<span class="pill green">Online</span>`;
    if (s === "idle") return `<span class="pill blue">Idle</span>`;
    if (s === "hospital") return `<span class="pill red">Hospital ${esc(formatHosp(m.hospital_seconds))}</span>`;
    return `<span class="pill gray">Offline</span>`;
  }

  function memberPills(m) {
    const pills = [
      memberStatusPill(m),
      `<span class="pill ${Number(m.available) ? "green" : "red"}">${Number(m.available) ? "Available" : "Unavailable"}</span>`,
      `<span class="pill ${Number(m.chain_sitter) ? "gold" : "gray"}">${Number(m.chain_sitter) ? "Chain Sit" : "No Chain Sit"}</span>`,
      `<span class="pill ${m.linked_user ? "gray" : "red"}">${m.linked_user ? "Linked" : "Not Linked"}</span>`
    ];
    return pills.join("");
  }

  function enemyPills(m) {
    return memberStatusPill(m);
  }

  function groupMembers(arr) {
    const online = [];
    const idle = [];
    const offline = [];
    const hospital = [];

    for (const m of arr || []) {
      const s = String(m.online_state || "offline").toLowerCase();
      if (s === "online") online.push(m);
      else if (s === "idle") idle.push(m);
      else if (s === "hospital") hospital.push(m);
      else offline.push(m);
    }

    hospital.sort((a, b) => Number(a.hospital_seconds || 0) - Number(b.hospital_seconds || 0));
    return { online, idle, offline, hospital };
  }

  async function login() {
    const apiKey = (GM_getValue(K_API_KEY, "") || "").trim();
    if (!apiKey) {
      setStatus("Save your Torn API key in Settings first.", true);
      return false;
    }

    const res = await req("POST", "/api/auth", {
      api_key: apiKey,
      admin_key: ADMIN_KEY,
    }, false);

    if (!res.ok || !res.token) {
      setStatus(res.error || "Login failed.", true);
      return false;
    }

    GM_setValue(K_SESSION, res.token);
    return true;
  }

  async function loadState() {
    let res = await req("GET", "/api/state");
    if (res && res.ok) {
      state = res;
      renderBody();
      updateBadge();
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
      renderBody();
      updateBadge();
    } else {
      setStatus((res && res.error) || "Could not load state.", true);
    }
  }

  function statCard(label, value) {
    return `
      <div class="warhub-stat">
        <div class="warhub-stat-label">${esc(label)}</div>
        <div class="warhub-stat-value">${esc(value)}</div>
      </div>
    `;
  }

  function renderWarTab() {
    const me = state?.me || {};
    const war = state?.war || {};

    const factionName = war.faction_name || "-";
    const enemyName = war.enemy_faction_name || "-";
    const statusText = war.status_text || (war.active ? "Faction loaded" : "No faction found");

    return `
      <div class="warhub-card">
        <h3>Quick Actions</h3>
        <div class="warhub-quick-grid">
          <button class="warhub-btn" id="wh-available-yes">Available</button>
          <button class="warhub-btn alt" id="wh-available-no">Unavailable</button>
          <button class="warhub-btn" id="wh-chain-on">Chain Sit In</button>
          <button class="warhub-btn alt" id="wh-chain-off">Chain Sit Out</button>
          <button class="warhub-btn" id="warhub-refresh-btn">Refresh</button>
          <button class="warhub-btn alt" id="warhub-seen-btn">Mark notices seen</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>War Overview</h3>
        <div class="warhub-overview-grid">
          ${statCard("You", me.name || "-")}
          ${statCard("Faction", factionName)}
          ${statCard("Faction ID", war.faction_id || "-")}
          ${statCard("Enemy", enemyName)}
          ${statCard("Enemy ID", war.enemy_faction_id || "-")}
          ${statCard("Status", statusText)}
          ${statCard("Members", war.member_count || 0)}
          ${statCard("Enemies", war.enemy_member_count || 0)}
          ${statCard("Available", war.available_count || 0)}
          ${statCard("Chain Sitters", war.chain_sitter_count || 0)}
          ${statCard("Linked Users", war.linked_user_count || 0)}
          ${statCard("Our Score", war.score_us || 0)}
          ${statCard("Their Score", war.score_them || 0)}
          ${statCard("Lead", war.lead || 0)}
        </div>
      </div>

      <div class="warhub-card">
        <h3>My Status</h3>
        <div style="margin-bottom:8px;">
          <span class="pill ${Number(me.available) ? "green" : "red"}">${Number(me.available) ? "Available" : "Unavailable"}</span>
          <span class="pill ${Number(me.chain_sitter) ? "gold" : "gray"}">${Number(me.chain_sitter) ? "Chain Sit In" : "Chain Sit Out"}</span>
        </div>
      </div>
    `;
  }

  function renderMemberRow(m, isEnemy = false) {
    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div><strong>${esc(m.name)}</strong> ${m.level ? `(Lvl ${esc(m.level)})` : ""}</div>
            <div class="warhub-small">${esc(m.position || "")}${m.position ? " • " : ""}${esc(m.last_action || m.status || "")}</div>
            <div style="margin-top:6px;">${isEnemy ? enemyPills(m) : memberPills(m)}</div>
          </div>
        </div>
        <div class="warhub-row" style="margin-top:8px;">
          <a class="warhub-link" href="${esc(m.profile_url)}" target="_blank" rel="noreferrer">Profile</a>
          <a class="warhub-link" href="${esc(m.attack_url)}" target="_blank" rel="noreferrer">Attack</a>
          <a class="warhub-link" href="${esc(m.bounty_url)}" target="_blank" rel="noreferrer">Bounty</a>
        </div>
      </div>
    `;
  }

  function renderGroupedMemberSection(title, arr, isEnemy = false) {
    if (!arr.length) return "";
    return `
      <div class="warhub-group-title">${esc(title)} (${arr.length})</div>
      ${arr.map(m => renderMemberRow(m, isEnemy)).join("")}
    `;
  }

  function renderMembersTab() {
    const members = state?.members || [];
    if (!members.length) return `<div class="warhub-empty">No faction members found.</div>`;

    const grouped = groupMembers(members);
    return `
      <div class="warhub-card">
        <h3>Our Members</h3>
        <div class="warhub-small">Organized by Online, Idle, Offline, then Hospital with lowest hospital time first.</div>
        ${renderGroupedMemberSection("Online", grouped.online, false)}
        ${renderGroupedMemberSection("Idle", grouped.idle, false)}
        ${renderGroupedMemberSection("Offline", grouped.offline, false)}
        ${renderGroupedMemberSection("Hospital", grouped.hospital, false)}
      </div>
    `;
  }

  function renderEnemiesTab() {
    const enemies = state?.enemies || [];
    if (!enemies.length) return `<div class="warhub-empty">No enemy war members found.</div>`;

    const grouped = groupMembers(enemies);
    return `
      <div class="warhub-card">
        <h3>Enemy Members</h3>
        <div class="warhub-small">Faction currently at war with you, organized by Online, Idle, Offline, then Hospital with lowest hospital time first.</div>
        ${renderGroupedMemberSection("Online", grouped.online, true)}
        ${renderGroupedMemberSection("Idle", grouped.idle, true)}
        ${renderGroupedMemberSection("Offline", grouped.offline, true)}
        ${renderGroupedMemberSection("Hospital", grouped.hospital, true)}
      </div>
    `;
  }

  function renderChainSittersTab() {
    const items = state?.chain_sitters || [];
    return `
      <div class="warhub-card">
        <h3>Chain Sitters</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div><strong>${esc(x.name)}</strong> ${x.level ? `(Lvl ${esc(x.level)})` : ""}</div>
            <div style="margin-top:6px;">${memberStatusPill(x)}</div>
            <div class="warhub-row" style="margin-top:8px;">
              <a class="warhub-link" href="${esc(x.profile_url)}" target="_blank" rel="noreferrer">Profile</a>
              <a class="warhub-link" href="${esc(x.attack_url)}" target="_blank" rel="noreferrer">Attack</a>
            </div>
          </div>
        `).join("") : `<div class="warhub-empty">No one has opted into chain sitting yet.</div>`}
      </div>
    `;
  }

  function renderMedDealsTab() {
    const items = state?.med_deals || [];
    return `
      <div class="warhub-card">
        <h3>Add Med Deal</h3>
        <div class="warhub-grid two">
          <input id="wh-buyer" class="warhub-input" placeholder="Buyer name">
          <input id="wh-seller" class="warhub-input" placeholder="Seller name">
          <input id="wh-amount" class="warhub-input" placeholder="Amount" type="number" min="0">
          <div></div>
        </div>
        <div style="margin-top:8px;">
          <textarea id="wh-med-notes" class="warhub-textarea" placeholder="Notes"></textarea>
        </div>
        <div style="margin-top:8px;">
          <button class="warhub-btn" id="wh-add-med">Add Med Deal</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Saved Med Deals</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div><strong>${esc(x.buyer_name || "-")}</strong> ⇄ <strong>${esc(x.seller_name || "-")}</strong></div>
            <div class="warhub-small">Amount: ${esc(x.amount || 0)}</div>
            <div class="warhub-small">${esc(x.notes || "")}</div>
            <div class="warhub-small">${esc(x.created_at || "")}</div>
            <div style="margin-top:8px;">
              <button class="warhub-btn alt wh-del-med" data-id="${x.id}">Delete</button>
            </div>
          </div>
        `).join("") : `<div class="warhub-empty">No med deals yet.</div>`}
      </div>
    `;
  }

  function renderEnemyOptions() {
    const opts = state?.enemy_options || [];
    const rows = [`<option value="">Pick enemy target</option>`];
    for (const e of opts) {
      const extra = e.online_state === "hospital"
        ? ` | Hospital ${formatHosp(e.hospital_seconds)}`
        : ` | ${String(e.online_state || "offline")}`;
      rows.push(`<option value="${esc(e.user_id)}" data-name="${esc(e.name)}">${esc(e.name)} [${esc(e.user_id)}]${extra}</option>`);
    }
    return rows.join("");
  }

  function renderTargetsTab() {
    const items = state?.targets || [];
    return `
      <div class="warhub-card">
        <h3>Add Target</h3>
        <div class="warhub-grid">
          <select id="wh-target-select" class="warhub-select">
            ${renderEnemyOptions()}
          </select>
          <div class="warhub-grid two">
            <input id="wh-target-id" class="warhub-input" placeholder="Target ID">
            <input id="wh-target-name" class="warhub-input" placeholder="Target name">
          </div>
        </div>
        <div style="margin-top:8px;">
          <textarea id="wh-target-notes" class="warhub-textarea" placeholder="Notes / reason / score notes"></textarea>
        </div>
        <div style="margin-top:8px;">
          <button class="warhub-btn" id="wh-add-target">Add Target</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Tracked Targets</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div class="warhub-row">
              <div>
                <div><strong>${esc(x.target_name || x.target_id || "Unknown")}</strong></div>
                <div class="warhub-small">ID: ${esc(x.target_id || "-")}</div>
              </div>
              <div class="warhub-row">
                ${x.target_id ? `<a class="warhub-link" href="https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(x.target_id)}" target="_blank" rel="noreferrer">Attack</a>` : ""}
                ${x.target_id ? `<a class="warhub-link" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(x.target_id)}" target="_blank" rel="noreferrer">Profile</a>` : ""}
                ${x.target_id ? `<a class="warhub-link" href="https://www.torn.com/bounties.php#/p=add&userID=${encodeURIComponent(x.target_id)}" target="_blank" rel="noreferrer">Bounty</a>` : ""}
              </div>
            </div>
            <div class="warhub-small" style="margin-top:6px;">${esc(x.notes || "")}</div>
            <div style="margin-top:8px;">
              <button class="warhub-btn alt wh-del-target" data-id="${x.id}">Delete</button>
            </div>
          </div>
        `).join("") : `<div class="warhub-empty">No targets saved.</div>`}
      </div>
    `;
  }

  function renderBountiesTab() {
    const items = state?.bounties || [];
    return `
      <div class="warhub-card">
        <h3>Add Bounty</h3>
        <div class="warhub-grid two">
          <input id="wh-bounty-id" class="warhub-input" placeholder="Target ID">
          <input id="wh-bounty-name" class="warhub-input" placeholder="Target name">
        </div>
        <div style="margin-top:8px;">
          <input id="wh-bounty-reward" class="warhub-input" placeholder="Reward text">
        </div>
        <div style="margin-top:8px;">
          <button class="warhub-btn" id="wh-add-bounty">Add Bounty</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Saved Bounties</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div><strong>${esc(x.target_name || x.target_id || "Unknown")}</strong></div>
            <div class="warhub-small">ID: ${esc(x.target_id || "-")}</div>
            <div class="warhub-small">Reward: ${esc(x.reward_text || "")}</div>
            <div style="margin-top:8px;">
              <button class="warhub-btn alt wh-del-bounty" data-id="${x.id}">Delete</button>
            </div>
          </div>
        `).join("") : `<div class="warhub-empty">No bounties saved.</div>`}
      </div>
    `;
  }

  function renderSettingsTab() {
    const apiKey = GM_getValue(K_API_KEY, "") || "";
    return `
      <div class="warhub-card">
        <h3>Settings</h3>
        <div class="warhub-small" style="margin-bottom:8px;">
          Enter your Torn API key here.
        </div>
        <input id="wh-api-key" class="warhub-input" placeholder="Your Torn API key" value="${esc(apiKey)}">
        <div class="warhub-row" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-save-settings">Save API Key</button>
          <button class="warhub-btn alt" id="wh-relogin">Re-login</button>
          <button class="warhub-btn alt" id="wh-logout">Clear Session</button>
          <button class="warhub-btn alt" id="wh-reset-icon">Reset Icon</button>
          <button class="warhub-btn alt" id="wh-reset-overlay">Reset Overlay</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Terms of Service</h3>
        <div class="warhub-tos">
          By using War Hub, you agree that this tool is provided as-is for faction coordination and convenience.
          You are responsible for your own Torn account, API key, and any actions taken through links or quick actions.
          Do not share your personal API key with anyone you do not trust.
          Access may be removed for abuse, misuse, harassment, or attempts to interfere with the service.
          Features may change, be updated, or be removed at any time.
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
            <div class="warhub-small">${esc(x.created_at || "")}</div>
          </div>
        `).join("") : `<div class="warhub-empty">No notifications yet.</div>`}
      </div>
    `;
  }

  function renderTabContent() {
    switch (currentTab) {
      case "members": return renderMembersTab();
      case "enemies": return renderEnemiesTab();
      case "chainsitters": return renderChainSittersTab();
      case "med": return renderMedDealsTab();
      case "targets": return renderTargetsTab();
      case "bounties": return renderBountiesTab();
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
        ${tabBtn("chainsitters", "Chain Sitters")}
        ${tabBtn("med", "Med Deals")}
        ${tabBtn("targets", "Targets")}
        ${tabBtn("bounties", "Bounties")}
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
    isOpen = true;
    GM_setValue(K_OPEN, true);
    overlay.classList.add("open");

    const savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (!savedOverlay) {
      positionOverlayNearShield();
    }

    clampToViewport(overlay);
    renderBody();
  }

  function closeOverlay() {
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
      left = 8;
      top = 64;
    }

    clampElementPosition(overlay, left, top);
  }

  async function doAction(method, path, body, successMsg) {
    const res = await req(method, path, body);
    if (!res.ok) {
      setStatus(res.error || "Action failed.", true);
      return;
    }
    if (successMsg) setStatus(successMsg, false);
    await loadState();
  }

  function val(sel) {
    const el = overlay.querySelector(sel);
    return el ? String(el.value || "").trim() : "";
  }

  function bindOverlayEvents() {
    overlay.querySelectorAll(".warhub-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        currentTab = btn.dataset.tab || "war";
        GM_setValue(K_TAB, currentTab);
        renderBody();
      });
    });

    const closeBtn = overlay.querySelector("#warhub-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeOverlay();
      });
    }

    const refreshBtn = overlay.querySelector("#warhub-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadState);

    const seenBtn = overlay.querySelector("#warhub-seen-btn");
    if (seenBtn) {
      seenBtn.addEventListener("click", async () => {
        await doAction("POST", "/api/notifications/seen", {}, "Notifications updated.");
      });
    }

    const targetSelect = overlay.querySelector("#wh-target-select");
    if (targetSelect) {
      targetSelect.addEventListener("change", () => {
        const opt = targetSelect.options[targetSelect.selectedIndex];
        const idInput = overlay.querySelector("#wh-target-id");
        const nameInput = overlay.querySelector("#wh-target-name");
        if (!idInput || !nameInput) return;
        idInput.value = targetSelect.value || "";
        nameInput.value = opt ? (opt.getAttribute("data-name") || "") : "";
      });
    }

    const addMed = overlay.querySelector("#wh-add-med");
    if (addMed) {
      addMed.addEventListener("click", async () => {
        await doAction("POST", "/api/med-deals/add", {
          buyer_name: val("#wh-buyer"),
          seller_name: val("#wh-seller"),
          amount: Number(val("#wh-amount") || 0),
          notes: val("#wh-med-notes"),
        }, "Med deal added.");
      });
    }

    overlay.querySelectorAll(".wh-del-med").forEach(btn => {
      btn.addEventListener("click", async () => {
        await doAction("POST", "/api/med-deals/delete", { id: Number(btn.dataset.id) }, "Med deal deleted.");
      });
    });

    const addTarget = overlay.querySelector("#wh-add-target");
    if (addTarget) {
      addTarget.addEventListener("click", async () => {
        await doAction("POST", "/api/targets/add", {
          target_id: val("#wh-target-id"),
          target_name: val("#wh-target-name"),
          notes: val("#wh-target-notes"),
        }, "Target added.");
      });
    }

    overlay.querySelectorAll(".wh-del-target").forEach(btn => {
      btn.addEventListener("click", async () => {
        await doAction("POST", "/api/targets/delete", { id: Number(btn.dataset.id) }, "Target deleted.");
      });
    });

    const addBounty = overlay.querySelector("#wh-add-bounty");
    if (addBounty) {
      addBounty.addEventListener("click", async () => {
        await doAction("POST", "/api/bounties/add", {
          target_id: val("#wh-bounty-id"),
          target_name: val("#wh-bounty-name"),
          reward_text: val("#wh-bounty-reward"),
        }, "Bounty added.");
      });
    }

    overlay.querySelectorAll(".wh-del-bounty").forEach(btn => {
      btn.addEventListener("click", async () => {
        await doAction("POST", "/api/bounties/delete", { id: Number(btn.dataset.id) }, "Bounty deleted.");
      });
    });

    const saveSettings = overlay.querySelector("#wh-save-settings");
    if (saveSettings) {
      saveSettings.addEventListener("click", async () => {
        const newKey = val("#wh-api-key");
        if (!newKey) {
          setStatus("Enter your Torn API key first.", true);
          return;
        }

        GM_setValue(K_API_KEY, newKey);
        GM_deleteValue(K_SESSION);
        setStatus("API key saved. Logging in...");
        const okLogin = await login();
        if (okLogin) {
          setStatus("API key saved and logged in.");
          await loadState();
        }
      });
    }

    const relogin = overlay.querySelector("#wh-relogin");
    if (relogin) {
      relogin.addEventListener("click", async () => {
        GM_deleteValue(K_SESSION);
        const okLogin = await login();
        if (okLogin) {
          setStatus("Logged in.");
          await loadState();
        }
      });
    }

    const logout = overlay.querySelector("#wh-logout");
    if (logout) {
      logout.addEventListener("click", () => {
        GM_deleteValue(K_SESSION);
        setStatus("Session cleared.");
      });
    }

    const resetIcon = overlay.querySelector("#wh-reset-icon");
    if (resetIcon) {
      resetIcon.addEventListener("click", () => {
        GM_deleteValue(K_SHIELD_POS);
        resetShieldPosition();
        updateBadge();
        setStatus("Icon reset.");
      });
    }

    const resetOverlay = overlay.querySelector("#wh-reset-overlay");
    if (resetOverlay) {
      resetOverlay.addEventListener("click", () => {
        GM_deleteValue(K_OVERLAY_POS);
        positionOverlayNearShield();
        clampToViewport(overlay);
        setStatus("Overlay reset.");
      });
    }

    const availYes = overlay.querySelector("#wh-available-yes");
    if (availYes) {
      availYes.addEventListener("click", async () => {
        await doAction("POST", "/api/availability/set", { available: true }, "Marked available.");
      });
    }

    const availNo = overlay.querySelector("#wh-available-no");
    if (availNo) {
      availNo.addEventListener("click", async () => {
        await doAction("POST", "/api/availability/set", { available: false }, "Marked unavailable.");
      });
    }

    const chainOn = overlay.querySelector("#wh-chain-on");
    if (chainOn) {
      chainOn.addEventListener("click", async () => {
        await doAction("POST", "/api/chain-sitter/set", { enabled: true }, "Chain sitter enabled.");
      });
    }

    const chainOff = overlay.querySelector("#wh-chain-off");
    if (chainOff) {
      chainOff.addEventListener("click", async () => {
        await doAction("POST", "/api/chain-sitter/set", { enabled: false }, "Chain sitter disabled.");
      });
    }
  }

  function bindOverlayDrag() {
    const handle = overlay.querySelector("#warhub-drag-handle");
    if (!handle) return;
    makeDraggable(handle, overlay, K_OVERLAY_POS, () => {
      handle.classList.toggle("dragging", overlay.dataset.dragging === "1");
    });
  }

  function mount() {
    shield = document.createElement("div");
    shield.id = "warhub-shield";
    shield.textContent = "🛡️";

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

    if (isOffscreen(shield)) resetShieldPosition();
    clampToViewport(shield);

    shield.addEventListener("click", (e) => {
      if (shield.dataset.dragging === "1") return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    });

    makeDraggable(shield, shield, K_SHIELD_POS, () => {
      shield.classList.toggle("dragging", shield.dataset.dragging === "1");
      updateBadge();
    });

    if (isOpen) openOverlay();
    updateBadge();
  }

  function makeDraggable(handleEl, moveEl, storageKey, onMoveExtra) {
    let pointerId = null;
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
      pointerId = null;
      dragging = false;

      if (moved) {
        moveEl.dataset.dragging = "1";
        setTimeout(() => {
          moveEl.dataset.dragging = "0";
          if (typeof onMoveExtra === "function") onMoveExtra();
        }, 120);
      } else {
        moveEl.dataset.dragging = "0";
        if (typeof onMoveExtra === "function") onMoveExtra();
      }

      handleEl.classList.remove("dragging");
      if (moveEl === shield) shield.classList.remove("dragging");
    };

    const onPointerDown = (e) => {
      const target = e.target;
      if (target && (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("textarea") ||
        target.closest("select")
      )) {
        return;
      }

      const rect = moveEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      pointerId = e.pointerId;
      dragging = true;
      moved = false;
      moveEl.dataset.dragging = "0";

      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";

      try {
        handleEl.setPointerCapture(pointerId);
      } catch (_err) {}

      handleEl.classList.add("dragging");
      if (moveEl === shield) shield.classList.add("dragging");
    };

    const onPointerMove = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!moved && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) {
        moved = true;
      }

      if (!moved) return;

      e.preventDefault();
      moveEl.dataset.dragging = "1";
      clampElementPosition(moveEl, startLeft + dx, startTop + dy);
      if (typeof onMoveExtra === "function") onMoveExtra();
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== pointerId) return;
      if (moved) savePos();
      cleanup();
    };

    const onPointerCancel = (e) => {
      if (e.pointerId !== pointerId) return;
      if (moved) savePos();
      cleanup();
    };

    handleEl.addEventListener("pointerdown", onPointerDown, { passive: true });
    handleEl.addEventListener("pointermove", onPointerMove, { passive: false });
    handleEl.addEventListener("pointerup", onPointerUp);
    handleEl.addEventListener("pointercancel", onPointerCancel);
  }

  async function boot() {
    mount();
    try {
      await loadState();
    } catch (e) {
      setStatus(e.message || "Boot failed.", true);
      renderBody();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.addEventListener("resize", () => {
    if (shield) {
      if (isOffscreen(shield)) resetShieldPosition();
      clampToViewport(shield);
    }
    if (overlay && overlay.classList.contains("open")) {
      clampToViewport(overlay);
    }
    updateBadge();
  });
})();
