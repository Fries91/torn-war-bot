// ==UserScript==
// @name         War Hub 🛡️
// @namespace    fries91-war-hub
// @version      1.2.0
// @description  War Hub by Fries91. T.S.E style auth/state flow. Draggable shield, PDA friendly overlay, merged faction statuses, chain sitters, med deals, targets, bounties.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @downloadURL  https://torn-war-bot.onrender.com/static/war-bot.user.js
// @updateURL   https://torn-war-bot.onrender.com/static/war-bot.user.js
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      https://torn-war-bot.onrender.com
// ==/UserScript==

(function () {
  "use strict";

  // ================= USER CONFIG =================
  const BASE_URL = "https://YOUR-RENDER-DOMAIN.onrender.com/static/war-bot.user.js";
  const ADMIN_KEY = "666,613,925,001";
  // ==============================================

  const K_API_KEY = "warhub_api_key_v1";
  const K_SESSION = "warhub_session_v1";
  const K_OPEN = "warhub_open_v1";
  const K_TAB = "warhub_tab_v1";
  const K_POS = "warhub_pos_v1";

  let state = null;
  let isOpen = GM_getValue(K_OPEN, false);
  let currentTab = GM_getValue(K_TAB, "war");
  let overlay, badge, shield;

  GM_addStyle(`
    #warhub-shield {
      position: fixed;
      z-index: 2147483647;
      width: 44px;
      height: 44px;
      border-radius: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 23px;
      cursor: move;
      user-select: none;
      box-shadow: 0 8px 22px rgba(0,0,0,.45);
      border: 1px solid rgba(255,255,255,.10);
      background: radial-gradient(circle at top, rgba(190,25,25,.96), rgba(78,8,8,.96));
      color: #fff;
      top: 120px;
      right: 14px;
    }

    #warhub-badge {
      position: fixed;
      z-index: 2147483647;
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
    }

    #warhub-overlay {
      position: fixed;
      z-index: 2147483646;
      right: 12px;
      top: 172px;
      width: min(95vw, 440px);
      max-height: 74vh;
      overflow: hidden;
      border-radius: 16px;
      background: linear-gradient(180deg, #161616, #0c0c0c);
      color: #f2f2f2;
      border: 1px solid rgba(255,255,255,.08);
      box-shadow: 0 14px 34px rgba(0,0,0,.5);
      display: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #warhub-overlay.open { display: block; }

    .warhub-head {
      padding: 12px 14px 10px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20));
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
    }

    .warhub-tab.active {
      background: linear-gradient(180deg, #d23333, #831515);
    }

    .warhub-body {
      padding: 10px;
      max-height: calc(74vh - 114px);
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

    .warhub-input, .warhub-textarea {
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

    .warhub-status.show { display: block; }

    .warhub-kv {
      display: grid;
      grid-template-columns: 120px 1fr;
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

    @media (max-width: 700px) {
      #warhub-overlay {
        width: calc(100vw - 16px);
        right: 8px;
        left: 8px;
        top: auto;
        bottom: 72px;
        max-height: 68vh;
      }

      #warhub-shield {
        right: 10px !important;
        top: auto !important;
        bottom: 16px;
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
    badge.style.left = `${window.scrollX + r.right - 8}px`;
    badge.style.top = `${window.scrollY + r.top - 6}px`;
  }

  async function login() {
    const apiKey = (GM_getValue(K_API_KEY, "") || "").trim();
    if (!apiKey) return false;

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

  function memberPills(m) {
    return `
      <span class="pill ${Number(m.available) ? "green" : "red"}">${Number(m.available) ? "Available" : "Unavailable"}</span>
      <span class="pill ${Number(m.chain_sitter) ? "gold" : "gray"}">${Number(m.chain_sitter) ? "Chain Sit" : "No Chain Sit"}</span>
      <span class="pill ${m.linked_user ? "gray" : "red"}">${m.linked_user ? "Linked" : "Not Linked"}</span>
    `;
  }

  function renderWarTab() {
    const me = state?.me || {};
    const war = state?.war || {};

    return `
      <div class="warhub-card">
        <h3>War Overview</h3>
        <div class="warhub-kv">
          <div>You</div><div>${esc(me.name || "-")}</div>
          <div>Faction</div><div>${esc(war.faction_name || "-")}</div>
          <div>Faction ID</div><div>${esc(war.faction_id || "-")}</div>
          <div>Members</div><div>${esc(war.member_count || 0)}</div>
          <div>Available</div><div>${esc(war.available_count || 0)}</div>
          <div>Chain Sitters</div><div>${esc(war.chain_sitter_count || 0)}</div>
          <div>Linked Users</div><div>${esc(war.linked_user_count || 0)}</div>
          <div>Status</div><div>${war.active ? "Faction loaded" : "No faction found"}</div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Enemy Faction</h3>
        <div class="warhub-kv">
          <div>Name</div><div>${esc(war.enemy_faction_name || "Not connected yet")}</div>
          <div>ID</div><div>${esc(war.enemy_faction_id || "-")}</div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>My Status</h3>
        <div style="margin-bottom:8px;">
          <span class="pill ${Number(me.available) ? "green" : "red"}">${Number(me.available) ? "Available" : "Unavailable"}</span>
          <span class="pill ${Number(me.chain_sitter) ? "gold" : "gray"}">${Number(me.chain_sitter) ? "Chain Sit In" : "Chain Sit Out"}</span>
        </div>
        <div class="warhub-row">
          <button class="warhub-btn" id="wh-available-yes">Available</button>
          <button class="warhub-btn alt" id="wh-available-no">Unavailable</button>
          <button class="warhub-btn" id="wh-chain-on">Chain Sit In</button>
          <button class="warhub-btn alt" id="wh-chain-off">Chain Sit Out</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Quick Actions</h3>
        <div class="warhub-row">
          <button class="warhub-btn" id="warhub-refresh-btn">Refresh</button>
          <button class="warhub-btn alt" id="warhub-seen-btn">Mark notices seen</button>
        </div>
      </div>
    `;
  }

  function renderMembersTab() {
    const members = state?.members || [];
    if (!members.length) return `<div class="warhub-empty">No members found.</div>`;

    return members.map(m => `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div><strong>${esc(m.name)}</strong> ${m.level ? `(Lvl ${esc(m.level)})` : ""}</div>
            <div class="warhub-small">${esc(m.position || "")} • ${esc(m.last_action || m.status || "")}</div>
            <div style="margin-top:6px;">${memberPills(m)}</div>
          </div>
        </div>
        <div class="warhub-row" style="margin-top:8px;">
          <a class="warhub-link" href="${esc(m.profile_url)}" target="_blank" rel="noreferrer">Profile</a>
          <a class="warhub-link" href="${esc(m.attack_url)}" target="_blank" rel="noreferrer">Attack</a>
          <a class="warhub-link" href="${esc(m.bounty_url)}" target="_blank" rel="noreferrer">Bounty</a>
        </div>
      </div>
    `).join("");
  }

  function renderChainSittersTab() {
    const items = state?.chain_sitters || [];
    return `
      <div class="warhub-card">
        <h3>Chain Sitters</h3>
        ${items.length ? items.map(x => `
          <div class="warhub-list-item">
            <div><strong>${esc(x.name)}</strong> ${x.level ? `(Lvl ${esc(x.level)})` : ""}</div>
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

  function renderTargetsTab() {
    const items = state?.targets || [];
    return `
      <div class="warhub-card">
        <h3>Add Target</h3>
        <div class="warhub-grid two">
          <input id="wh-target-id" class="warhub-input" placeholder="Target ID">
          <input id="wh-target-name" class="warhub-input" placeholder="Target name">
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
      <div class="warhub-head">
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
  }

  function openOverlay() {
    isOpen = true;
    GM_setValue(K_OPEN, true);
    overlay.classList.add("open");
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
    if (closeBtn) closeBtn.addEventListener("click", closeOverlay);

    const refreshBtn = overlay.querySelector("#warhub-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadState);

    const seenBtn = overlay.querySelector("#warhub-seen-btn");
    if (seenBtn) {
      seenBtn.addEventListener("click", async () => {
        await doAction("POST", "/api/notifications/seen", {}, "Notifications updated.");
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
      saveSettings.addEventListener("click", () => {
        GM_setValue(K_API_KEY, val("#wh-api-key"));
        setStatus("API key saved.");
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

    const saved = GM_getValue(K_POS, null);
    if (saved) {
      if (saved.left) shield.style.left = saved.left;
      if (saved.top) shield.style.top = saved.top;
      if (saved.right) shield.style.right = saved.right;
    }

    shield.addEventListener("click", (e) => {
      if (shield.dataset.dragging === "1") return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    });

    makeDraggable(shield);

    if (isOpen) openOverlay();
    updateBadge();
  }

  function makeDraggable(el) {
    let startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const x = ("touches" in e ? e.touches[0].clientX : e.clientX);
      const y = ("touches" in e ? e.touches[0].clientY : e.clientY);

      const dx = x - startX;
      const dy = y - startY;

      el.style.right = "auto";
      el.style.left = `${Math.max(6, startLeft + dx)}px`;
      el.style.top = `${Math.max(6, startTop + dy)}px`;
      el.dataset.dragging = "1";
      updateBadge();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      setTimeout(() => { el.dataset.dragging = "0"; }, 50);

      GM_setValue(K_POS, {
        right: el.style.right || "",
        top: el.style.top || "",
        left: el.style.left || "",
      });

      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };

    const onDown = (e) => {
      const rect = el.getBoundingClientRect();
      startX = ("touches" in e ? e.touches[0].clientX : e.clientX);
      startY = ("touches" in e ? e.touches[0].clientY : e.clientY);
      startLeft = rect.left;
      startTop = rect.top;
      dragging = true;
      el.dataset.dragging = "0";

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("touchstart", onDown, { passive: true });
  }

  async function boot() {
    mount();
    try {
      await loadState();
    } catch (e) {
      setStatus(e.message || "Boot failed.", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.addEventListener("resize", updateBadge);
})();
