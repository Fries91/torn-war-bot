// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      2.8.6
// @description  War Hub by Fries91. Faction-license aware overlay with draggable icon, draggable overlay, PDA friendly, shared war tools, faction member management, and payment lock handling.
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

  alert("War Hub started");
  
  if (window.__WAR_HUB_V285__) return;
  window.__WAR_HUB_V285__ = true;

  const BASE_URL = "https://torn-war-bot.onrender.com";

  const K_API_KEY = "warhub_api_key_v3";
  const K_ADMIN_KEY = "warhub_admin_key_v3";
  const K_OWNER_TOKEN = "warhub_owner_token_v3";
  const K_SESSION = "warhub_session_v3";
  const K_OPEN = "warhub_open_v3";
  const K_TAB = "warhub_tab_v3";
  const K_SHIELD_POS = "warhub_shield_pos_v3";
  const K_OVERLAY_POS = "warhub_overlay_pos_v3";
  const K_REFRESH = "warhub_refresh_ms_v3";
  const K_NOTES = "warhub_notes_v3";
  const K_LOCAL_NOTIFICATIONS = "warhub_local_notifications_v3";
  const K_ACCESS_CACHE = "warhub_access_cache_v3";

  let factionMembersCache = null;

  const PAYMENT_PLAYER = "Fries91";
  const PRICE_PER_MEMBER = 2500000;

  const TAB_ORDER = [
    ["instructions", "Instructions"],
    ["war", "War"],
    ["terms", "Terms"],
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
    ["faction", "Faction"],
    ["admin", "Admin"],
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
  if (currentTab === "owner") currentTab = "admin";
  let pollTimer = null;
  let remountTimer = null;
  let loadInFlight = false;
  let lastStatusMsg = "";
  let lastStatusErr = false;
  let accessState = normalizeAccessCache(GM_getValue(K_ACCESS_CACHE, null));

  const css = `
    #warhub-shield {
      position: fixed !important;
      z-index: 2147483647 !important;
      width: 42px !important;
      height: 42px !important;
      border-radius: 12px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 22px !important;
      line-height: 1 !important;
      cursor: grab !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-touch-callout: none !important;
      touch-action: none !important;
      box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;
      border: 1px solid rgba(255,255,255,.10) !important;
      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;
      color: #fff !important;
      top: 120px !important;
      right: 14px !important;
      left: auto !important;
      bottom: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
    #warhub-shield.dragging { cursor: grabbing !important; }

    #warhub-badge {
      position: fixed !important;
      z-index: 2147483647 !important;
      min-width: 16px !important;
      height: 16px !important;
      padding: 0 4px !important;
      border-radius: 999px !important;
      background: #ffd54a !important;
      color: #111 !important;
      font-size: 10px !important;
      line-height: 16px !important;
      text-align: center !important;
      font-weight: 800 !important;
      box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;
      display: none !important;
      pointer-events: none !important;
    }

    #warhub-overlay {
      position: fixed !important;
      z-index: 2147483646 !important;
      right: 12px !important;
      top: 170px !important;
      width: min(96vw, 520px) !important;
      height: min(88vh, 900px) !important;
      max-height: 88vh !important;
      min-height: 420px !important;
      overflow: hidden !important;
      border-radius: 14px !important;
      background: linear-gradient(180deg, #171717, #0c0c0c) !important;
      color: #f2f2f2 !important;
      border: 1px solid rgba(255,255,255,.08) !important;
      box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;
      display: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      left: auto !important;
      bottom: auto !important;
      flex-direction: column !important;
      box-sizing: border-box !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    #warhub-overlay.open { display: flex !important; }

    #warhub-overlay *,
    #warhub-overlay *::before,
    #warhub-overlay *::after {
      box-sizing: border-box !important;
    }

    .warhub-head {
      padding: 10px 12px 9px !important;
      border-bottom: 1px solid rgba(255,255,255,.08) !important;
      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;
      cursor: grab !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-touch-callout: none !important;
      touch-action: none !important;
      flex: 0 0 auto !important;
      display: block !important;
      width: 100% !important;
      min-height: 54px !important;
    }
    .warhub-head.dragging { cursor: grabbing !important; }

    .warhub-toprow {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 10px !important;
      width: 100% !important;
    }

    .warhub-title {
      font-weight: 800 !important;
      font-size: 16px !important;
      letter-spacing: .2px !important;
      color: #fff !important;
    }
    .warhub-sub {
      opacity: .72 !important;
      font-size: 11px !important;
      margin-top: 2px !important;
      color: #fff !important;
    }

    .warhub-close {
      appearance: none !important;
      -webkit-appearance: none !important;
      border: 0 !important;
      border-radius: 9px !important;
      background: rgba(255,255,255,.08) !important;
      color: #fff !important;
      padding: 5px 9px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      font-size: 12px !important;
      flex: 0 0 auto !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-height: 30px !important;
    }

    .warhub-tabs {
      display: flex !important;
      flex: 0 0 auto !important;
      flex-wrap: nowrap !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 8px !important;
      overflow-x: auto !important;
      overflow-y: hidden !important;
      border-bottom: 1px solid rgba(255,255,255,.08) !important;
      background: rgba(255,255,255,.02) !important;
      scrollbar-width: thin !important;
      -webkit-overflow-scrolling: touch !important;
      width: 100% !important;
      min-height: 48px !important;
      max-height: 48px !important;
      white-space: nowrap !important;
    }

    .warhub-tab {
      appearance: none !important;
      -webkit-appearance: none !important;
      border: 0 !important;
      border-radius: 999px !important;
      background: rgba(255,255,255,.07) !important;
      color: #fff !important;
      padding: 6px 10px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      flex: 0 0 auto !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-height: 30px !important;
      line-height: 1.1 !important;
      opacity: 1 !important;
      visibility: visible !important;
      gap: 6px !important;
    }
    .warhub-tab.active {
      background: linear-gradient(180deg, #d23333, #831515) !important;
      color: #fff !important;
    }
    .warhub-tab.locked {
      opacity: .55 !important;
    }

    .warhub-body {
      padding: 8px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      width: 100% !important;
      display: block !important;
    }

    .warhub-status {
      display: none !important;
      margin-bottom: 8px !important;
      padding: 8px 10px !important;
      border-radius: 10px !important;
      font-size: 12px !important;
      background: rgba(255,255,255,.06) !important;
      color: #fff !important;
    }
    .warhub-status.show { display: block !important; }
    .warhub-status.err {
      background: rgba(185,52,52,.22) !important;
      color: #ffdcdc !important;
    }

    .warhub-banner {
      margin-bottom: 8px !important;
      padding: 10px 12px !important;
      border-radius: 12px !important;
      border: 1px solid rgba(255,255,255,.10) !important;
      background: rgba(255,255,255,.05) !important;
      color: #fff !important;
    }
    .warhub-banner.payment {
      background: linear-gradient(180deg, rgba(150,43,43,.38), rgba(72,19,19,.26)) !important;
      border-color: rgba(255,130,130,.22) !important;
    }
    .warhub-banner.trial {
      background: linear-gradient(180deg, rgba(164,116,25,.34), rgba(83,59,12,.22)) !important;
      border-color: rgba(255,215,118,.22) !important;
    }
    .warhub-banner.good {
      background: linear-gradient(180deg, rgba(35,140,82,.30), rgba(21,96,58,.20)) !important;
      border-color: rgba(109,214,143,.18) !important;
    }

    .warhub-grid { display: grid !important; gap: 8px !important; }
    .warhub-grid.two { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
    .warhub-grid.three { grid-template-columns: repeat(3, minmax(0,1fr)) !important; }

    .warhub-card {
      border: 1px solid rgba(255,255,255,.07) !important;
      background: rgba(255,255,255,.03) !important;
      border-radius: 12px !important;
      padding: 10px !important;
      margin-bottom: 8px !important;
      overflow: hidden !important;
      color: #fff !important;
    }

    .warhub-card h3 {
      margin: 0 0 8px !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      letter-spacing: .2px !important;
      color: #fff !important;
    }

    .warhub-section-title {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      margin-bottom: 8px !important;
    }

    .warhub-count {
      padding: 4px 8px !important;
      border-radius: 999px !important;
      background: rgba(255,255,255,.08) !important;
      font-size: 11px !important;
      font-weight: 800 !important;
      color: #fff !important;
    }

    .warhub-roster-card.hospital-box {
      border-color: rgba(255,130,130,.16) !important;
      background: linear-gradient(180deg, rgba(145,37,37,.18), rgba(255,255,255,.03)) !important;
    }

    .warhub-roster-card.online-box {
      border-color: rgba(109,214,143,.16) !important;
      background: linear-gradient(180deg, rgba(31,120,63,.18), rgba(255,255,255,.03)) !important;
    }

    .warhub-roster-card.idle-box {
      border-color: rgba(255,215,118,.16) !important;
      background: linear-gradient(180deg, rgba(145,114,27,.18), rgba(255,255,255,.03)) !important;
    }

    .warhub-roster-card.offline-box {
      border-color: rgba(180,180,180,.12) !important;
      background: linear-gradient(180deg, rgba(70,70,70,.18), rgba(255,255,255,.03)) !important;
    }

    .warhub-dropdown {
      border: 1px solid rgba(255,255,255,.07) !important;
      border-radius: 12px !important;
      background: rgba(255,255,255,.03) !important;
      margin-bottom: 8px !important;
      overflow: hidden !important;
    }

    .warhub-dropdown summary {
      list-style: none !important;
      cursor: pointer !important;
      padding: 10px !important;
      user-select: none !important;
      outline: none !important;
    }

    .warhub-dropdown summary::-webkit-details-marker {
      display: none !important;
    }

    .warhub-dropdown-body {
      padding: 0 10px 10px 10px !important;
    }

    .warhub-metric {
      border-radius: 10px !important;
      background: rgba(255,255,255,.05) !important;
      padding: 8px !important;
      min-height: 54px !important;
    }
    .warhub-metric .k {
      opacity: .7 !important;
      font-size: 10px !important;
      text-transform: uppercase !important;
      letter-spacing: .45px !important;
      color: #fff !important;
    }
    .warhub-metric .v {
      font-size: 16px !important;
      font-weight: 800 !important;
      margin-top: 4px !important;
      word-break: break-word !important;
      color: #fff !important;
    }

    .warhub-score-us {
      background: linear-gradient(180deg, rgba(31,120,63,.40), rgba(17,67,35,.28)) !important;
      border: 1px solid rgba(109,214,143,.18) !important;
    }
    .warhub-score-them {
      background: linear-gradient(180deg, rgba(145,37,37,.40), rgba(88,18,18,.28)) !important;
      border: 1px solid rgba(255,130,130,.18) !important;
    }
    .warhub-score-lead {
      background: linear-gradient(180deg, rgba(145,114,27,.38), rgba(97,72,13,.26)) !important;
      border: 1px solid rgba(255,215,118,.18) !important;
    }

    .warhub-list { display: grid !important; gap: 6px !important; }

    .warhub-list-item {
      border-radius: 10px !important;
      background: rgba(255,255,255,.04) !important;
      padding: 8px !important;
      display: grid !important;
      gap: 4px !important;
      color: #fff !important;
    }

    .warhub-row {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 8px !important;
      flex-wrap: wrap !important;
    }

    .warhub-name { font-weight: 700 !important; color: #fff !important; }
    .warhub-meta { opacity: .76 !important; font-size: 11px !important; color: #fff !important; }
    .warhub-empty { opacity: .75 !important; font-size: 12px !important; color: #fff !important; }
    .warhub-actions { display: flex !important; gap: 6px !important; flex-wrap: wrap !important; }

    .warhub-btn, .warhub-input, .warhub-select, .warhub-textarea {
      font: inherit !important;
      border-radius: 10px !important;
      border: 1px solid rgba(255,255,255,.10) !important;
      background: rgba(255,255,255,.05) !important;
      color: #fff !important;
    }

    .warhub-btn {
      appearance: none !important;
      -webkit-appearance: none !important;
      padding: 7px 10px !important;
      cursor: pointer !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      text-decoration: none !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    .warhub-btn.primary { background: linear-gradient(180deg, #cc3737, #821616) !important; border-color: rgba(255,255,255,.12) !important; }
    .warhub-btn.good { background: linear-gradient(180deg, #238c52, #15603a) !important; }
    .warhub-btn.warn { background: linear-gradient(180deg, #af7b22, #775114) !important; }
    .warhub-btn.small { padding: 5px 8px !important; font-size: 11px !important; }
    .warhub-btn[disabled] { opacity: .45 !important; cursor: not-allowed !important; }

    .warhub-input, .warhub-select, .warhub-textarea {
      width: 100% !important;
      padding: 8px 10px !important;
      font-size: 12px !important;
    }

    .warhub-input[readonly] {
      opacity: .9 !important;
      background: rgba(255,255,255,.035) !important;
    }

    .warhub-textarea { min-height: 94px !important; resize: vertical !important; }

    .warhub-label {
      font-size: 11px !important;
      opacity: .74 !important;
      margin-bottom: 4px !important;
      display: block !important;
      color: #fff !important;
    }

    .warhub-pill {
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding: 4px 8px !important;
      border-radius: 999px !important;
      background: rgba(255,255,255,.07) !important;
      font-size: 11px !important;
      font-weight: 700 !important;
    }
    .warhub-pill.online { background: rgba(40,140,90,.20) !important; color: #b7ffd5 !important; }
    .warhub-pill.idle { background: rgba(197,141,46,.22) !important; color: #ffe3a5 !important; }
    .warhub-pill.offline { background: rgba(113,113,113,.20) !important; color: #dadada !important; }
    .warhub-pill.hosp { background: rgba(181,62,62,.24) !important; color: #ffd0d0 !important; }
    .warhub-pill.leader { background: rgba(66,110,185,.24) !important; color: #d3e3ff !important; }
    .warhub-pill.enabled { background: rgba(35,140,82,.22) !important; color: #b7ffd5 !important; }
    .warhub-pill.disabled { background: rgba(145,37,37,.24) !important; color: #ffd0d0 !important; }

    .warhub-divider {
      height: 1px !important;
      background: rgba(255,255,255,.07) !important;
      margin: 8px 0 !important;
    }

    .warhub-mini { font-size: 11px !important; opacity: .78 !important; color: #fff !important; }
    .warhub-link { color: #fff !important; text-decoration: none !important; }

    .warhub-section-scroll {
      max-height: 52vh !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      padding-right: 2px !important;
    }

    .warhub-payment-line {
      padding: 8px 10px !important;
      border-radius: 10px !important;
      background: rgba(255,255,255,.06) !important;
      font-weight: 800 !important;
      text-align: center !important;
      margin-top: 8px !important;
    }

    @media (max-width: 700px) {
      #warhub-overlay {
        width: 98vw !important;
        height: 88vh !important;
        min-height: 360px !important;
        top: 56px !important;
        left: 1vw !important;
        right: 1vw !important;
        border-radius: 12px !important;
      }
      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr !important; }
      .warhub-body { padding-bottom: 18px !important; }
      #warhub-shield {
        width: 40px !important;
        height: 40px !important;
        font-size: 21px !important;
      }
      .warhub-section-scroll { max-height: 34vh !important; }
      .warhub-tabs {
        min-height: 44px !important;
        max-height: 44px !important;
      }
    }
  `;
  GM_addStyle(css);

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString() : "—";
  }

  function fmtMoney(v) {
    const n = Number(v);
    return Number.isFinite(n) ? `$${n.toLocaleString()}` : "—";
  }

  function fmtHosp(v, txt) {
    if (txt) return txt;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `${n}s` : "—";
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

  function fmtDaysLeftFromIso(v) {
    if (!v) return null;
    try {
      const ms = new Date(v).getTime() - Date.now();
      if (!Number.isFinite(ms)) return null;
      return Math.ceil(ms / 86400000);
    } catch {
      return null;
    }
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function cleanInputValue(v) {
    return String(v || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim()
      .replace(/^['"]+|['"]+$/g, "")
      .trim();
  }

  function getNotes() {
    return String(GM_getValue(K_NOTES, "") || "");
  }

  function setNotes(v) {
    GM_setValue(K_NOTES, String(v || ""));
  }

  function getLocalNotifications() {
    return arr(GM_getValue(K_LOCAL_NOTIFICATIONS, []));
  }

  function setLocalNotifications(v) {
    GM_setValue(K_LOCAL_NOTIFICATIONS, arr(v));
  }

  function mergedNotifications() {
    return [...arr(state?.notifications), ...getLocalNotifications()].slice(0, 50);
  }

  function unreadCount() {
    return mergedNotifications().length;
  }

  function setStatus(msg, isErr = false) {
    lastStatusMsg = String(msg || "");
    lastStatusErr = !!isErr;
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

  function restoreStatus() {
    if (lastStatusMsg) setStatus(lastStatusMsg, lastStatusErr);
  }

  function normalizeAccessCache(raw) {
    const a = raw && typeof raw === "object" ? raw : {};
    return {
      loggedIn: !!a.loggedIn,
      blocked: !!a.blocked,
      paymentRequired: !!a.paymentRequired,
      trialActive: !!a.trialActive,
      trialExpired: !!a.trialExpired,
      expiresAt: a.expiresAt || "",
      daysLeft: Number.isFinite(Number(a.daysLeft)) ? Number(a.daysLeft) : null,
      reason: a.reason || "",
      message: a.message || "",
      source: a.source || "",
      lastSeenAt: a.lastSeenAt || "",
      factionId: a.factionId || "",
      factionName: a.factionName || "",
      isFactionLeader: !!a.isFactionLeader,
      memberEnabled: !!a.memberEnabled,
      pricePerMember: Number.isFinite(Number(a.pricePerMember)) ? Number(a.pricePerMember) : PRICE_PER_MEMBER,
      paymentPlayer: a.paymentPlayer || PAYMENT_PLAYER,
      isOwner: !!a.isOwner,
    };
  }

  function saveAccessCache() {
    GM_setValue(K_ACCESS_CACHE, accessState || {});
  }

  function clearSavedKeys() {
    GM_deleteValue(K_API_KEY);
    GM_deleteValue(K_ADMIN_KEY);
    GM_deleteValue(K_SESSION);
  }

  function clearBlockedCredentials() {
    clearSavedKeys();
  }

  function accessSummaryMessage() {
    if (!accessState) return "";
    const paymentPlayer = accessState.paymentPlayer || PAYMENT_PLAYER;
    const ppm = accessState.pricePerMember || PRICE_PER_MEMBER;

    if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
      return accessState.message || accessState.reason || `Faction access locked. Payment goes to ${paymentPlayer}.`;
    }

    if (accessState.trialActive) {
      if (accessState.daysLeft != null) {
        if (accessState.daysLeft <= 0) return `Faction trial ends today. Billing is ${fmtMoney(ppm)} per enabled member.`;
        return `Faction trial active. ${accessState.daysLeft} day${accessState.daysLeft === 1 ? "" : "s"} left.`;
      }
      if (accessState.expiresAt) return `Faction trial active until ${fmtTs(accessState.expiresAt)}.`;
      return "Faction trial active.";
    }

    return "";
  }

  function isOwnerSession() {
    return !!(accessState?.isOwner || state?.me?.is_owner || state?.user?.is_owner || state?.owner?.is_owner);
  }

  function getAccessInfo(payload, httpStatus) {
    const d = payload && typeof payload === "object" ? payload : {};
    const access = d.access && typeof d.access === "object" ? d.access : {};
    const payment = d.payment && typeof d.payment === "object" ? d.payment : {};
    const factionAccess = d.faction_access && typeof d.faction_access === "object" ? d.faction_access : {};
    const memberAccess = d.member_access && typeof d.member_access === "object" ? d.member_access : {};

    const paymentRequired =
      !!d.payment_required ||
      !!d.requires_payment ||
      !!d.paymentRequired ||
      !!access.payment_required ||
      !!access.requires_payment ||
      !!access.paymentRequired;

    const blocked =
      !!d.blocked ||
      !!d.access_blocked ||
      !!d.locked ||
      !!d.denied ||
      !!access.blocked ||
      !!access.access_blocked ||
      !!access.locked ||
      !!access.denied ||
      paymentRequired;

    const expiresAt =
      d.trial_expires_at ||
      d.trialEndsAt ||
      d.expires_at ||
      access.trial_expires_at ||
      access.trialEndsAt ||
      access.expires_at ||
      "";

    const explicitDaysLeft = d.trial_days_left ?? d.days_left ?? access.trial_days_left ?? access.days_left;
    const computedDaysLeft = explicitDaysLeft != null ? Number(explicitDaysLeft) : fmtDaysLeftFromIso(expiresAt);

    const trialExpired =
      !!d.trial_expired ||
      !!d.expired ||
      !!access.trial_expired ||
      !!access.expired ||
      ((computedDaysLeft != null && computedDaysLeft < 0) && !paymentRequired ? true : false);

    const trialActive =
      !!d.trial_active ||
      !!access.trial_active ||
      ((computedDaysLeft != null && computedDaysLeft >= 0) && !paymentRequired && !trialExpired);

    const accessStatus = String(
      d.access_status ||
      d.status ||
      access.status ||
      access.access_status ||
      ""
    ).toLowerCase();

    const reason =
      d.reason ||
      d.block_reason ||
      d.error ||
      access.reason ||
      access.block_reason ||
      memberAccess.reason ||
      "";

    let message =
      d.message ||
      d.notice ||
      d.details ||
      access.message ||
      access.notice ||
      payment.message ||
      "";

    let finalBlocked = blocked;
    let finalPaymentRequired = paymentRequired;
    let finalTrialExpired = trialExpired;

    if (accessStatus.includes("payment")) {
      finalBlocked = true;
      finalPaymentRequired = true;
      finalTrialExpired = true;
    } else if (accessStatus.includes("expired")) {
      finalBlocked = true;
      finalTrialExpired = true;
    } else if (accessStatus.includes("blocked") || accessStatus.includes("locked") || accessStatus.includes("denied")) {
      finalBlocked = true;
    }

    if ((httpStatus === 402 || httpStatus === 403) && !message) {
      message = `Faction access blocked. Payment goes to ${payment.required_player || PAYMENT_PLAYER}.`;
    }

    if (finalPaymentRequired && !message) {
      message = `Faction payment required. Payment goes to ${payment.required_player || PAYMENT_PLAYER}.`;
    } else if (finalBlocked && !message) {
      message = reason || "Faction access locked.";
    }

    return {
      loggedIn: false,
      blocked: finalBlocked,
      paymentRequired: finalPaymentRequired,
      trialActive: !!trialActive && !finalBlocked,
      trialExpired: finalTrialExpired || finalPaymentRequired,
      expiresAt: expiresAt || "",
      daysLeft: Number.isFinite(computedDaysLeft) ? computedDaysLeft : null,
      reason: String(reason || ""),
      message: String(message || ""),
      source: String(accessStatus || ""),
      lastSeenAt: new Date().toISOString(),
      factionId: d.faction_id || d?.faction?.id || d?.me?.faction_id || "",
      factionName: d.faction_name || d?.faction?.name || d?.me?.faction_name || "",
      isFactionLeader: !!d.is_faction_leader || !!factionAccess.is_faction_leader || !!d?.me?.is_faction_leader,
      memberEnabled: !!memberAccess.enabled || !!factionAccess.member_enabled || !!memberAccess.allowed,
      pricePerMember: Number(payment.price_per_enabled_member || payment.price_per_member || PRICE_PER_MEMBER) || PRICE_PER_MEMBER,
      paymentPlayer: String(payment.required_player || PAYMENT_PLAYER),
      isOwner: !!d.is_owner || !!d?.user?.is_owner || !!d?.me?.is_owner || !!d?.owner?.is_owner || !!factionAccess.is_owner,
    };
  }

  function updateAccessFromPayload(payload, httpStatus, loggedInHint) {
    const next = getAccessInfo(payload, httpStatus);
    if (loggedInHint === true && !next.blocked) next.loggedIn = true;
    if (loggedInHint === false) next.loggedIn = false;

    if (next.blocked || next.paymentRequired || next.trialExpired) {
      accessState = next;
      clearBlockedCredentials();
      saveAccessCache();
      return next;
    }

    if (next.trialActive || next.expiresAt || next.daysLeft != null || next.factionId || next.isFactionLeader) {
      accessState = {
        ...accessState,
        ...next,
        loggedIn: loggedInHint === true ? true : accessState.loggedIn,
        blocked: false,
        paymentRequired: false,
        trialExpired: false,
      };
      saveAccessCache();
      return accessState;
    }

    if (loggedInHint === true) {
      accessState = {
        ...accessState,
        loggedIn: true,
        blocked: false,
        paymentRequired: false,
        trialExpired: false,
        lastSeenAt: new Date().toISOString(),
        isOwner: !!accessState.isOwner,
      };
      saveAccessCache();
    }

    return accessState;
  }

  function canUseProtectedFeatures() {
  if (isOwnerSession()) return true;
  return !(accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired);
}

  function ensureAllowedOrMessage() {
    if (canUseProtectedFeatures()) return true;
    setStatus(accessSummaryMessage() || "Faction access locked.", true);
    renderBody();
    return false;
  }

  function gmXhr(method, path, body, extraHeaders) {
    return new Promise((resolve) => {
      const token = cleanInputValue(GM_getValue(K_SESSION, ""));
      const url = `${BASE_URL}${path}`;
      const headers = { Accept: "application/json", ...(extraHeaders || {}) };
      if (token) headers["X-Session-Token"] = token;
      if (body != null) headers["Content-Type"] = "application/json";

      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data: body != null ? JSON.stringify(body) : undefined,
        timeout: 60000,
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
        onerror: () => resolve({
          ok: false,
          status: 0,
          data: null,
          error: `Network error: ${method} ${path}`,
        }),
        ontimeout: () => resolve({
          ok: false,
          status: 0,
          data: null,
          error: `Request timed out: ${method} ${path}`,
        }),
      });
    });
  }

  async function healthCheck() {
    return gmXhr("GET", "/health");
  }

  async function login(showDebug = false) {
    const apiKey = cleanInputValue(GM_getValue(K_API_KEY, ""));
    if (!apiKey) return false;

    if (showDebug) setStatus("Trying login with saved API key...");

    const res = await gmXhr("POST", "/api/auth", { api_key: apiKey });
    updateAccessFromPayload(res.data, res.status, false);

    if (!res.ok) {
      if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
        setStatus(accessSummaryMessage() || "Faction access blocked.", true);
        renderBody();
        return false;
      }
      setStatus(res.error || "Login failed.", true);
      return false;
    }

    const token = res.data?.token || res.data?.session_token || res.data?.session;
    if (token) {
      GM_setValue(K_SESSION, cleanInputValue(token));
      updateAccessFromPayload(res.data, res.status, true);
      return true;
    }

    if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
      setStatus(accessSummaryMessage() || "Faction access blocked.", true);
      renderBody();
      return false;
    }

    setStatus("Login failed.", true);
    return false;
  }

  async function req(method, path, body) {
    if (!canUseProtectedFeatures() && path !== "/health" && path !== "/api/auth") {
      return {
        ok: false,
        status: 403,
        data: { ok: false, payment_required: true, message: accessSummaryMessage() || "Faction access blocked." },
        error: accessSummaryMessage() || "Faction access blocked.",
      };
    }

    let res = await gmXhr(method, path, body);
    updateAccessFromPayload(res.data, res.status, !!cleanInputValue(GM_getValue(K_SESSION, "")));

    if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
      return {
        ok: false,
        status: res.status || 403,
        data: res.data,
        error: accessSummaryMessage() || res.error || "Faction access blocked.",
      };
    }

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      const ok = await login(false);
      if (ok) {
        res = await gmXhr(method, path, body);
        updateAccessFromPayload(res.data, res.status, true);
      }
    }

    return res;
  }

  async function adminReq(method, path, body) {
    if (!isOwnerSession()) {
      return { ok: false, status: 403, data: null, error: "Admin access required." };
    }
    return req(method, path, body);
  }

  function normalizeState(data) {
    const s = data || {};
    const me = s.me || s.user || {};
    const war = { ...(s.war || s.war_info || {}) };
    if (war.active == null) war.active = !!(s.has_war || war.war_id || war.id);

    const faction = s.faction || s.my_faction || {};

    const enemyFactionRaw = s.enemy_faction || s.opponent || war.enemy_faction || {};
    const enemyFactionId =
      enemyFactionRaw.id ||
      enemyFactionRaw.faction_id ||
      s.enemy_faction_id ||
      war.enemy_faction_id ||
      war.opponent_faction_id ||
      "";
    const enemyFactionName =
      enemyFactionRaw.name ||
      s.enemy_faction_name ||
      war.enemy_faction_name ||
      war.opponent_faction_name ||
      "";

    const enemyFaction = {
      ...enemyFactionRaw,
      id: enemyFactionId,
      faction_id: enemyFactionRaw.faction_id || enemyFactionId,
      name: enemyFactionName || "Enemy Faction",
    };

    const members = arr(s.members || faction.members || s.member_list);
    const enemies = arr(
      s.enemies ||
      s.enemy_members ||
      enemyFaction.members ||
      war.enemy_members
    );

    const hospital = s.hospital || {};
    const medDeals = arr(s.med_deals || s.medDeals || s.deals).map((x) => ({
      ...x,
      seller_name: x?.seller_name || x?.seller || x?.created_by || "",
      buyer_name: x?.buyer_name || x?.buyer || x?.item_name || "",
      note: x?.note || x?.notes || "",
    }));
    const targets = arr(s.targets || s.smart_targets || s.assignable_targets);
    const assignments = arr(s.assignments || s.target_assignments);
    const notifications = arr(s.notifications || s.alerts);
    const chainSitters = arr(s.chain_sitters || s.chainSitters || s.chain_helpers);
    const notes = arr(s.war_notes || s.notes || []);
    const warTerms = s.war_terms || s.terms || null;
    const medDealBuyers = arr(s.med_deal_buyers || enemies);
    const medDealsMessage = String(s.med_deals_message || war.message || enemyFaction.message || "").trim();
    const factionLicense = s.faction_license || s.license || {};
    const factionAccess = s.faction_access || {};
    const factionManagement = s.faction_management || {};
    const payment = s.payment || {};
    const hasWar = !!(
      s.has_war ||
      war.active ||
      war.war_id ||
      war.id ||
      enemyFactionId ||
      enemies.length
    );

    updateAccessFromPayload(s, 200, !!cleanInputValue(GM_getValue(K_SESSION, "")));

    return {
      ...s,
      has_war: hasWar,
      me,
      war,
      faction,
      enemyFaction,
      enemy_faction: s.enemy_faction || enemyFaction,
      enemy_faction_id: s.enemy_faction_id || enemyFactionId,
      enemy_faction_name: s.enemy_faction_name || enemyFactionName,
      members,
      enemies,
      hospital,
      medDeals,
      targets,
      assignments,
      notifications,
      chainSitters,
      notes,
      warTerms,
      medDealBuyers,
      medDealsMessage,
      factionLicense,
      factionAccess,
      factionManagement,
      payment,
    };
  }

   async function loadState(silent = false) {
    if (loadInFlight) return;
    if (!canUseProtectedFeatures()) {
      if (!silent) setStatus(accessSummaryMessage() || "Faction access blocked.", true);
      renderBody();
      return;
    }

    loadInFlight = true;
    try {
      const res = await req("GET", "/api/state");
      if (!res.ok) {
        if (!silent) setStatus(res.error || "Could not load state.", true);
        if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) renderBody();
        return;
      }
      state = normalizeState(res.data || {});
      if (accessState?.isFactionLeader && !factionMembersCache) loadFactionMembers().catch(() => null);
      if (!silent) setStatus("");
      if (overlay && isOpen) renderBody();
      updateBadge();
      if (overlay && isOpen && currentTab === "admin" && isOwnerSession()) loadAdminDashboard().catch(() => null);
    } finally {
      loadInFlight = false;
    }
  }

  async function loadAnalytics() {
    analyticsCache = analyticsCache || {};
    return analyticsCache;
  }

  async function loadFactionMembers(force = false) {
    if (!accessState?.isFactionLeader) {
      factionMembersCache = null;
      return null;
    }
    if (factionMembersCache && !force) return factionMembersCache;

    const res = await req("GET", "/api/faction/members");
    if (!res.ok) {
      setStatus(res.error || "Could not load faction member access.", true);
      return null;
    }

    factionMembersCache = {
      ...(res.data || {}),
      members: arr(res.data?.items || res.data?.members || []),
    };
    return factionMembersCache;
  }

  async function refreshLeaderFactionData() {
    if (!accessState?.isFactionLeader) return;
    await loadFactionMembers(true);
    await loadState(true);
    renderBody();
  }

  async function doAction(method, path, body, okMsg, reload = true) {
    if (!ensureAllowedOrMessage()) return null;
    const res = await req(method, path, body);
    if (!res.ok) {
      setStatus(res.error || "Action failed.", true);
      return null;
    }
    if (okMsg) setStatus(okMsg);
    if (reload) await loadState(true);
    return res;
  }

  function getHospSeconds(x) {
    return Number(
      x?.hospital_seconds ||
      x?.hosp_time ||
      x?.hospital_time ||
      x?.status?.until ||
      0
    ) || 0;
  }

  function getPresenceState(x) {
    const hosp = getHospSeconds(x);
    if (hosp > 0) return "hospital";
    const raw = String(x?.online_state || x?.online_status || x?.status || "").toLowerCase();
    if (raw.includes("online")) return "online";
    if (raw.includes("idle")) return "idle";
    return "offline";
  }

  function sortHosp(list) {
    return [...arr(list)].sort((a, b) => getHospSeconds(a) - getHospSeconds(b));
  }

  function sortAlphabetical(list) {
    return [...arr(list)].sort((a, b) => {
      const an = String(a?.name || a?.player_name || a?.member_name || "").toLowerCase();
      const bn = String(b?.name || b?.player_name || b?.member_name || "").toLowerCase();
      return an.localeCompare(bn);
    });
  }

  function sortRosterGroup(list, type) {
    if (type === "hospital") return sortHosp(list);
    return sortAlphabetical(list);
  }

  function splitRosterGroups(list) {
    const hospital = [];
    const online = [];
    const idle = [];
    const offline = [];

    arr(list).forEach((x) => {
      const stateName = getPresenceState(x);
      if (stateName === "hospital") hospital.push(x);
      else if (stateName === "online") online.push(x);
      else if (stateName === "idle") idle.push(x);
      else offline.push(x);
    });

    return {
      hospital: sortRosterGroup(hospital, "hospital"),
      online: sortRosterGroup(online, "online"),
      idle: sortRosterGroup(idle, "idle"),
      offline: sortRosterGroup(offline, "offline"),
    };
  }

  function memberRow(x, enemy = false) {
    const id = x.user_id || x.id || x.player_id || x.member_user_id || "";
    const name = x.name || x.player_name || x.member_name || `ID ${id}`;
    const onlineState = String(x.online_state || x.online_status || x.status || "offline").toLowerCase();
    const hosp = getHospSeconds(x);
    const hospText = x.hospital_text || "";
    const last = x.last_action || x.last_action_relative || x.last || "—";
    const level = x.level ? `Lvl ${x.level}` : "";
    const lifeCur = Number(x.life_current || x.current_life || 0);
    const lifeMax = Number(x.life_max || x.maximum_life || 0);
    const lifeText = lifeMax > 0 ? `${lifeCur.toLocaleString()}/${lifeMax.toLocaleString()}` : "—";
    const attackUrl = x.attack_url || (id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` : "#");
    const enabled = !!x.enabled_under_license || !!x.member_access_enabled || !!x.enabled;
    const leader = String(x.position || "").toLowerCase().includes("leader");

    const pill =
      hosp > 0
        ? `<span class="warhub-pill hosp">Hosp ${esc(fmtHosp(hosp, hospText))}</span>`
        : onlineState.includes("online")
          ? `<span class="warhub-pill online">Online</span>`
          : onlineState.includes("idle")
            ? `<span class="warhub-pill idle">Idle</span>`
            : `<span class="warhub-pill offline">Offline</span>`;

    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(name)}</div>
            <div class="warhub-meta">${esc([level, `Life ${lifeText}`, last].filter(Boolean).join(" • "))}</div>
          </div>
          <div class="warhub-actions">
            ${pill}
            ${leader ? `<span class="warhub-pill leader">Leader</span>` : ``}
            ${!enemy && accessState?.isFactionLeader ? `<span class="warhub-pill ${enabled ? "enabled" : "disabled"}">${enabled ? "Enabled" : "Disabled"}</span>` : ``}
          </div>
        </div>
        <div class="warhub-row">
          <div class="warhub-meta">ID ${esc(id || "—")}</div>
          <div class="warhub-actions">
            ${id ? `<a class="warhub-btn small" href="https://www.torn.com/profiles.php?XID=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Profile</a>` : ``}
            ${id ? `<a class="warhub-btn small primary" href="${esc(attackUrl)}" target="_blank" rel="noopener noreferrer">Attack</a>` : ``}
            ${enemy && id ? `<a class="warhub-btn small warn" href="https://www.torn.com/bounties.php?userID=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Bounty</a>` : ``}
          </div>
        </div>
      </div>
    `;
  }

  function rosterCard(title, items, opts = {}) {
    const extraClass = opts.extraClass || "";
    const content = arr(items).length
      ? arr(items).map((x) => memberRow(x, !!opts.enemy)).join("")
      : `<div class="warhub-empty">No ${esc(title.toLowerCase())}.</div>`;

    return `
      <div class="warhub-card warhub-roster-card ${esc(extraClass)}">
        <div class="warhub-section-title">
          <h3>${esc(title)}</h3>
          <span class="warhub-count">${arr(items).length}</span>
        </div>
        <div class="warhub-list">${content}</div>
      </div>
    `;
  }

  function rosterDropdown(title, items, opts = {}) {
    const extraClass = opts.extraClass || "";
    const openAttr = opts.open ? "open" : "";
    const content = arr(items).length
      ? arr(items).map((x) => memberRow(x, !!opts.enemy)).join("")
      : `<div class="warhub-empty">No ${esc(title.toLowerCase())}.</div>`;

    return `
      <details class="warhub-dropdown ${esc(extraClass)}" ${openAttr}>
        <summary>
          <div class="warhub-row">
            <strong>${esc(title)}</strong>
            <span class="warhub-count">${arr(items).length}</span>
          </div>
        </summary>
        <div class="warhub-dropdown-body">
          <div class="warhub-list">${content}</div>
        </div>
      </details>
    `;
  }

  function renderInstructionsTab() {
    const banner = accessSummaryMessage()
      ? `<div class="warhub-banner ${accessState?.paymentRequired || accessState?.blocked || accessState?.trialExpired ? "payment" : accessState?.trialActive ? "trial" : "good"}">
          <div><strong>Faction Access</strong></div>
          <div class="warhub-mini" style="margin-top:6px;">${esc(accessSummaryMessage())}</div>
        </div>`
      : "";

    return `
      ${banner}
      <div class="warhub-card">
        <h3>Getting Started</h3>
        <div class="warhub-list">
          <div class="warhub-list-item">
            <div class="warhub-name">1. Save your Torn API key</div>
            <div class="warhub-meta">Open Settings and paste your personal API key, then press Save Keys.</div>
          </div>
          <div class="warhub-list-item">
            <div class="warhub-name">2. Login to War Hub</div>
            <div class="warhub-meta">Press Login in Settings. Once connected, the overlay will load your faction and war state.</div>
          </div>
          <div class="warhub-list-item">
            <div class="warhub-name">3. Leader-only faction access</div>
            <div class="warhub-meta">Faction leaders can manage member access from the Faction tab when licensing is enabled.</div>
          </div>
          <div class="warhub-list-item">
            <div class="warhub-name">4. Use tabs for shared tools</div>
            <div class="warhub-meta">War, Terms, Targets, Assignments, Notes, and Med Deals are shared faction tools.</div>
          </div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Terms of Service</h3>
        <div class="warhub-mini" style="line-height:1.5;">
          This script is for faction coordination and convenience. You are responsible for your own Torn account, your own API key,
          and anything you enter into this tool. Do not share full-access secrets with people you do not trust.
        </div>
      </div>

      <div class="warhub-card">
        <h3>API Key Storage</h3>
        <div class="warhub-mini" style="line-height:1.5;">
          Your API key and session token are stored locally in your userscript storage on your device/browser.
          The server receives your API key only when you log in or when actions require backend sync.
          Faction-leader managed member access may store member API keys on the backend if the leader enters them in the Faction tab.
        </div>
      </div>
    `;
  }

  function renderWarTab() {
    const war = state?.war || {};
    const our = state?.faction || state?.our_faction || {};
    const enemy = state?.enemyFaction || state?.enemy_faction || {};
    const enemyFactionId = enemy?.faction_id || enemy?.id || state?.enemy_faction_id || state?.war?.enemy_faction_id || state?.war?.opponent_faction_id || "";
    const enemyFactionName = enemy?.name || state?.enemy_faction_name || state?.war?.enemy_faction_name || state?.war?.opponent_faction_name || "—";
    const scoreUs = Number(state?.score?.our || war?.our_score || our?.score || 0) || 0;
    const scoreThem = Number(state?.score?.enemy || war?.enemy_score || enemy?.score || 0) || 0;
    const target = Number(state?.score?.target || war?.target_score || war?.target || 0) || 0;
    const lead = scoreUs - scoreThem;
    const hasWar = !!(state?.has_war || war?.active || war?.war_id || war?.id || enemyFactionId || arr(state?.enemies).length);

    if (!hasWar) {
      return `
        <div class="warhub-card">
          <h3>War</h3>
          <div class="warhub-empty">Currently not in a war.</div>
        </div>
      `;
    }

    return `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>War Overview</h3>
          <span class="warhub-count">${esc(String(war?.war_id || war?.id || "Live"))}</span>
        </div>

        <div class="warhub-grid three">
          <div class="warhub-metric warhub-score-us">
            <div class="k">Our Score</div>
            <div class="v">${fmtNum(scoreUs)}</div>
          </div>
          <div class="warhub-metric warhub-score-them">
            <div class="k">Enemy Score</div>
            <div class="v">${fmtNum(scoreThem)}</div>
          </div>
          <div class="warhub-metric warhub-score-lead">
            <div class="k">${lead >= 0 ? "Lead" : "Behind"}</div>
            <div class="v">${fmtNum(Math.abs(lead))}</div>
          </div>
        </div>

        <div class="warhub-divider"></div>

        <div class="warhub-grid two">
          <div class="warhub-metric">
            <div class="k">Our Faction</div>
            <div class="v">${esc(our?.name || state?.user?.faction_name || "—")}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Enemy Faction</div>
            <div class="v">${esc(enemyFactionName)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Target Score</div>
            <div class="v">${fmtNum(target)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Status</div>
            <div class="v">${esc(war?.status || "Active")}</div>
          </div>
        </div>

        <div class="warhub-divider"></div>

        <div class="warhub-actions">
          <button class="warhub-btn primary" id="warhub-save-snapshot">Save Snapshot</button>
          ${enemyFactionId ? `<a class="warhub-btn" href="https://www.torn.com/factions.php?step=profile&ID=${encodeURIComponent(enemyFactionId)}" target="_blank" rel="noopener noreferrer">Enemy Faction</a>` : ``}
        </div>
      </div>
    `;
  }

  function renderTermsTab() {
    const warId = state?.war?.war_id || state?.war?.id || "";
    const termsText =
      state?.warTerms?.terms_text ||
      state?.warTerms?.terms ||
      state?.terms?.terms_text ||
      state?.terms?.terms ||
      "";

    const locked = !(accessState?.isFactionLeader || isOwnerSession());

    return `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>War Terms</h3>
          ${locked ? `<span class="warhub-pill disabled">Leader Only</span>` : ``}
        </div>
        <label class="warhub-label">War ID</label>
        <input class="warhub-input" id="warhub-terms-warid" value="${esc(warId)}" readonly />
        <div style="height:8px;"></div>
        <label class="warhub-label">Terms</label>
        <textarea class="warhub-textarea" id="warhub-terms-text" ${locked ? "readonly" : ""}>${esc(termsText)}</textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="warhub-terms-save" ${locked ? "disabled" : ""}>Save Terms</button>
          <button class="warhub-btn warn" id="warhub-terms-delete" ${locked ? "disabled" : ""}>Delete Terms</button>
        </div>
      </div>
    `;
  }

  function renderMembersTab() {
    const groups = splitRosterGroups(state?.members || []);
    return `
      ${rosterCard("Online Members", groups.online, { extraClass: "online-box" })}
      ${rosterCard("Idle Members", groups.idle, { extraClass: "idle-box" })}
      ${rosterCard("Hospital Members", groups.hospital, { extraClass: "hospital-box" })}
      ${rosterDropdown("Offline Members", groups.offline, { extraClass: "offline-box" })}
    `;
  }

  function renderEnemiesTab() {
    const enemies = arr(state?.enemies || []);
    const hasWar = !!(state?.has_war || state?.war?.active || state?.war?.war_id || state?.enemy_faction_id || state?.enemyFaction?.id || state?.enemyFaction?.faction_id);
    if (!enemies.length && !hasWar) {
      return `
        <div class="warhub-card">
          <h3>Enemies</h3>
          <div class="warhub-empty">Currently not in a war.</div>
        </div>
      `;
    }

    const groups = splitRosterGroups(enemies);
    return `
      ${rosterCard("Enemy Online", groups.online, { extraClass: "online-box", enemy: true })}
      ${rosterCard("Enemy Idle", groups.idle, { extraClass: "idle-box", enemy: true })}
      ${rosterCard("Enemy Hospital", groups.hospital, { extraClass: "hospital-box", enemy: true })}
      ${rosterDropdown("Enemy Offline", groups.offline, { extraClass: "offline-box", enemy: true })}
    `;
  }

  function renderHospitalTab() {
    const ours = sortHosp(arr(state?.members || []).filter((x) => getHospSeconds(x) > 0));
    const theirs = sortHosp(arr(state?.enemies || []).filter((x) => getHospSeconds(x) > 0));

    return `
      ${rosterCard("Our Hospital", ours, { extraClass: "hospital-box" })}
      ${rosterCard("Enemy Hospital", theirs, { extraClass: "hospital-box", enemy: true })}
    `;
  }

  function renderChainTab() {
    const sitters = arr(state?.members || []).filter((x) => !!x.chain_sitter);
    const avail = arr(state?.members || []).filter((x) => !!x.available);
    return `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Chain Helpers</h3>
          <span class="warhub-count">${sitters.length}</span>
        </div>
        <div class="warhub-list">
          ${sitters.length ? sitters.map((x) => memberRow(x, false)).join("") : `<div class="warhub-empty">No chain sitters enabled.</div>`}
        </div>
      </div>

      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Available Members</h3>
          <span class="warhub-count">${avail.length}</span>
        </div>
        <div class="warhub-list">
          ${avail.length ? avail.map((x) => memberRow(x, false)).join("") : `<div class="warhub-empty">No available members flagged.</div>`}
        </div>
      </div>

      <div class="warhub-card">
        <h3>My Toggle</h3>
        <div class="warhub-actions">
          <button class="warhub-btn good" id="warhub-set-available">Set Available</button>
          <button class="warhub-btn" id="warhub-set-unavailable">Set Unavailable</button>
          <button class="warhub-btn warn" id="warhub-set-chain-on">Chain Sitter On</button>
          <button class="warhub-btn" id="warhub-set-chain-off">Chain Sitter Off</button>
        </div>
      </div>
    `;
  }

  function renderMedDealsTab() {
    const deals = arr(state?.medDeals || state?.med_deals || []);
    return `
      <div class="warhub-card">
        <h3>Add Med Deal</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Seller</label>
            <input class="warhub-input" id="warhub-med-seller" placeholder="Seller name" />
          </div>
          <div>
            <label class="warhub-label">Item</label>
            <input class="warhub-input" id="warhub-med-item" placeholder="Xanax / Med item" />
          </div>
          <div>
            <label class="warhub-label">Price</label>
            <input class="warhub-input" id="warhub-med-price" placeholder="$ / text" />
          </div>
          <div>
            <label class="warhub-label">Note</label>
            <input class="warhub-input" id="warhub-med-note" placeholder="Optional note" />
          </div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="warhub-med-add">Add Med Deal</button>
        </div>
      </div>

      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Med Deals</h3>
          <span class="warhub-count">${deals.length}</span>
        </div>
        <div class="warhub-list">
          ${deals.length ? deals.map((x) => `
            <div class="warhub-list-item">
              <div class="warhub-row">
                <div>
                  <div class="warhub-name">${esc(x.seller_name || "Unknown seller")}</div>
                  <div class="warhub-meta">${esc([x.item_name || x.buyer_name || "", x.price || "", x.note || ""].filter(Boolean).join(" • "))}</div>
                </div>
                <div class="warhub-actions">
                  <button class="warhub-btn small warn warhub-del-med" data-id="${esc(String(x.id || x.deal_id || ""))}">Delete</button>
                </div>
              </div>
            </div>
          `).join("") : `<div class="warhub-empty">No med deals yet.</div>`}
        </div>
      </div>
    `;
  }

  function renderTargetsTab() {
    const targets = arr(state?.targets || []);
    const enemies = sortAlphabetical(arr(state?.enemies || []));
    return `
      <div class="warhub-card">
        <h3>Add Target</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Enemy</label>
            <select class="warhub-select" id="warhub-target-enemy">
              <option value="">Select enemy</option>
              ${enemies.map((x) => {
                const id = x.user_id || x.id || "";
                const name = x.name || `ID ${id}`;
                return `<option value="${esc(String(id))}" data-name="${esc(name)}">${esc(name)} [${esc(String(id))}]</option>`;
              }).join("")}
            </select>
          </div>
          <div>
            <label class="warhub-label">Target ID</label>
            <input class="warhub-input" id="warhub-target-id" placeholder="Target ID" />
          </div>
        </div>
        <div style="height:8px;"></div>
        <label class="warhub-label">Notes / Reason</label>
        <input class="warhub-input" id="warhub-target-notes" placeholder="Optional notes" />
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="warhub-target-add">Add Target</button>
        </div>
      </div>

      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Targets</h3>
          <span class="warhub-count">${targets.length}</span>
        </div>
        <div class="warhub-list">
          ${targets.length ? targets.map((x) => {
            const id = x.target_id || x.user_id || "";
            const name = x.target_name || x.name || `ID ${id}`;
            const rowId = x.id || x.target_row_id || "";
            return `
              <div class="warhub-list-item">
                <div class="warhub-row">
                  <div>
                    <div class="warhub-name">${esc(name)}</div>
                    <div class="warhub-meta">${esc([`ID ${id}`, x.notes || x.reason || ""].filter(Boolean).join(" • "))}</div>
                  </div>
                  <div class="warhub-actions">
                    ${id ? `<a class="warhub-btn small primary" href="https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">Attack</a>` : ``}
                    <button class="warhub-btn small warn warhub-del-target" data-id="${esc(String(rowId))}">Delete</button>
                  </div>
                </div>
              </div>
            `;
          }).join("") : `<div class="warhub-empty">No targets saved.</div>`}
        </div>
      </div>
    `;
  }

  function renderAssignmentsTab() {
    const warId = String(state?.war?.war_id || state?.war?.id || "");
    const managed = arr(state?.factionManagement?.members || factionMembersCache?.members || []).filter((m) => {
      const uid = String(m.member_user_id || m.user_id || "");
      return uid && !!m.enabled;
    });
    const rows = arr(state?.assignments || []).length ? `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3 style="margin:0;">Live Assignments</h3>
          <span class="warhub-count">${fmtNum(arr(state.assignments).length)}</span>
        </div>
        <div class="warhub-list">
          ${arr(state.assignments).map((a) => {
            const id = String(a.id || "");
            const assigned = a.assigned_to_name || a.assignee || "Unassigned";
            const targetName = a.target_name || a.target || a.target_id || "Unknown";
            const attack = a.target_attack_url || (a.target_id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${encodeURIComponent(String(a.target_id))}` : "");
            return `
              <div class="warhub-list-item">
                <div class="warhub-row">
                  <div>
                    <div class="warhub-name">${esc(targetName)}</div>
                    <div class="warhub-meta">${esc([`Assigned: ${assigned}`, a.priority || "normal", a.note || ""].filter(Boolean).join(" • "))}</div>
                  </div>
                  <div class="warhub-actions">
                    ${attack ? `<a class="warhub-btn small primary warhub-link" href="${esc(attack)}" target="_blank" rel="noopener noreferrer">Attack</a>` : ""}
                    ${id ? `<button class="warhub-btn small warn" data-del-assignment-live="${esc(id)}">Delete</button>` : ""}
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    ` : `
      <div class="warhub-card">
        <h3>Live Assignments</h3>
        <div class="warhub-empty">No assignments yet.</div>
      </div>
    `;

    return `
      <div class="warhub-card">
        <h3>Assign Target</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">War ID</label>
            <input class="warhub-input" id="wh-assignment-war-id" value="${esc(warId)}" readonly>
          </div>
          <div>
            <label class="warhub-label">Target ID</label>
            <input class="warhub-input" id="wh-assignment-target-id" placeholder="Enemy target ID">
          </div>
          <div>
            <label class="warhub-label">Target Name</label>
            <input class="warhub-input" id="wh-assignment-target-name" placeholder="Optional target name">
          </div>
          <div>
            <label class="warhub-label">Assign To</label>
            <select class="warhub-select" id="wh-assignment-member">
              <option value="">Select enabled member</option>
              ${managed.map((m) => {
                const uid = String(m.member_user_id || m.user_id || "");
                const nm = String(m.member_name || m.name || uid);
                return `<option value="${esc(uid)}" data-name="${esc(nm)}">${esc(nm)} [${esc(uid)}]</option>`;
              }).join("")}
            </select>
          </div>
        </div>
        <div style="height:8px;"></div>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Priority</label>
            <select class="warhub-select" id="wh-assignment-priority">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label class="warhub-label">Note</label>
            <input class="warhub-input" id="wh-assignment-note" placeholder="Optional note">
          </div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-assignment">Save Assignment</button>
        </div>
      </div>
      ${rows}
    `;
  }

  function renderNotesTab() {
    const localNotes = getNotes();
    const shared = arr(state?.notes || []);
    return `
      <div class="warhub-card">
        <h3>Local Notes</h3>
        <label class="warhub-label">Your personal notes</label>
        <textarea class="warhub-textarea" id="wh-notes">${esc(localNotes)}</textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-notes">Save Local</button>
          <button class="warhub-btn warn" id="wh-clear-notes">Clear Local</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Shared War Note</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">War ID</label>
            <input class="warhub-input" id="wh-note-war-id" value="${esc(String(state?.war?.war_id || state?.war?.id || ""))}" readonly>
          </div>
          <div>
            <label class="warhub-label">Target ID</label>
            <input class="warhub-input" id="wh-note-target-id" placeholder="Enemy target ID">
          </div>
        </div>
        <div style="height:8px;"></div>
        <label class="warhub-label">Note</label>
        <textarea class="warhub-textarea" id="wh-note-text" placeholder="Shared note for this target"></textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-add-server-note">Save Shared Note</button>
        </div>
      </div>

      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Shared Notes</h3>
          <span class="warhub-count">${fmtNum(shared.length)}</span>
        </div>
        <div class="warhub-list">
          ${shared.length ? shared.map((x) => noteRow(x)).join("") : `<div class="warhub-empty">No shared notes yet.</div>`}
        </div>
      </div>
    `;
  }

  function renderAnalyticsTab() {
    const snaps = arr(state?.snapshots || []);
    return `
      <div class="warhub-card">
        <h3>Analytics</h3>
        <div class="warhub-grid three">
          <div class="warhub-metric">
            <div class="k">Snapshots</div>
            <div class="v">${fmtNum(snaps.length)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Members</div>
            <div class="v">${fmtNum(arr(state?.members || []).length)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Enemies</div>
            <div class="v">${fmtNum(arr(state?.enemies || []).length)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNotificationsTab() {
    const items = mergedNotifications();
    return `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Notifications</h3>
          <span class="warhub-count">${fmtNum(items.length)}</span>
        </div>
        <div class="warhub-list">
          ${items.length ? items.map((x) => `
            <div class="warhub-list-item">
              <div class="warhub-name">${esc(x.title || x.kind || "Notification")}</div>
              <div class="warhub-meta">${esc(x.body || x.text || x.message || "")}</div>
              <div class="warhub-mini">${esc(fmtTs(x.created_at || x.ts || ""))}</div>
            </div>
          `).join("") : `<div class="warhub-empty">No notifications.</div>`}
        </div>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-mark-alerts-seen">Refresh / Mark Seen</button>
          <button class="warhub-btn warn" id="wh-clear-alerts">Clear Local</button>
        </div>
      </div>
    `;
  }

  function renderFactionTab() {
    const license = state?.factionLicense || state?.license || {};
    const members = arr(factionMembersCache?.members || []);
    const status = license.status || (accessState?.paymentRequired ? "payment_required" : accessState?.trialActive ? "trial" : "active");

    return `
      <div class="warhub-card">
        <h3>Faction License</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric">
            <div class="k">Status</div>
            <div class="v">${esc(status)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Faction</div>
            <div class="v">${esc(state?.user?.faction_name || accessState?.factionName || "—")}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Payment Player</div>
            <div class="v">${esc(license.payment_player || accessState?.paymentPlayer || PAYMENT_PLAYER)}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Price / Enabled Member</div>
            <div class="v">${fmtMoney(license.faction_member_price || accessState?.pricePerMember || PRICE_PER_MEMBER)}</div>
          </div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Manage Member Access</h3>
        (accessState?.isFactionLeader || isOwnerSession())
          <div class="warhub-grid two">
            <div>
              <label class="warhub-label">Member User ID</label>
              <input class="warhub-input" id="wh-fm-userid" placeholder="User ID">
            </div>
            <div>
              <label class="warhub-label">Member Name</label>
              <input class="warhub-input" id="wh-fm-name" placeholder="Member name">
            </div>
            <div>
              <label class="warhub-label">Member API Key</label>
              <input class="warhub-input" id="wh-fm-key" placeholder="Member API key">
            </div>
            <div>
              <label class="warhub-label">Position</label>
              <input class="warhub-input" id="wh-fm-position" placeholder="Position">
            </div>
          </div>
          <div class="warhub-actions" style="margin-top:8px;">
            <button class="warhub-btn primary" id="wh-fm-save">Save Member Access</button>
          </div>
        ` : `<div class="warhub-empty">Leader access required.</div>`}
      </div>

      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>Faction Members</h3>
          <span class="warhub-count">${fmtNum(members.length)}</span>
        </div>
        <div class="warhub-list">
          ${members.length ? members.map((x) => {
            const memberId = x.member_user_id || x.user_id || "";
            const memberName = x.member_name || x.name || `ID ${memberId}`;
            const enabled = !!x.enabled;
            return `
              <div class="warhub-list-item">
                <div class="warhub-row">
                  <div>
                    <div class="warhub-name">${esc(memberName)}</div>
                    <div class="warhub-meta">${esc([`ID ${memberId}`, x.position || "", x.member_api_key_masked || ""].filter(Boolean).join(" • "))}</div>
                  </div>
                  <div class="warhub-actions">
                    <span class="warhub-pill ${enabled ? "enabled" : "disabled"}">${enabled ? "Enabled" : "Disabled"}</span>
                    ${(accessState?.isFactionLeader || isOwnerSession()) ? `<button class="warhub-btn small ${enabled ? "" : "good"}" data-toggle-member="${esc(String(memberId))}" data-enabled="${enabled ? "0" : "1"}">${enabled ? "Disable" : "Enable"}</button>` : ``}
                    ${(accessState?.isFactionLeader || isOwnerSession()) ? `<button class="warhub-btn small warn" data-del-member="${esc(String(memberId))}">Delete</button>` : ``}
                  </div>
                </div>
              </div>
            `;
          }).join("") : `<div class="warhub-empty">No member access rows yet.</div>`}
        </div>
      </div>
    `;
  }

  function renderAdminTab() {
    if (!isOwnerSession()) {
      return `
        <div class="warhub-card">
          <h3>Admin</h3>
          <div class="warhub-empty">Owner access required.</div>
        </div>
      `;
    }

    const dash = state?.adminDashboard || {};
    const items = arr(dash.items || dash.factions || []);
    const summary = dash.summary || {};

    return `
      <div class="warhub-card">
        <h3>Owner Dashboard</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric"><div class="k">Factions</div><div class="v">${fmtNum(summary.faction_licenses_total || items.length || 0)}</div></div>
          <div class="warhub-metric"><div class="k">Trials</div><div class="v">${fmtNum(summary.trials_total || 0)}</div></div>
          <div class="warhub-metric"><div class="k">Paid</div><div class="v">${fmtNum(summary.paid_total || 0)}</div></div>
          <div class="warhub-metric"><div class="k">Payment Required</div><div class="v">${fmtNum(summary.payment_required_total || 0)}</div></div>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Faction Licenses</h3>
        <div class="warhub-list">
          ${items.length ? items.map((x) => {
            const factionId = x.faction_id || x.id || "";
            const factionName = x.faction_name || x.name || `Faction ${factionId}`;
            return `
              <div class="warhub-list-item">
                <div class="warhub-row">
                  <div>
                    <div class="warhub-name">${esc(factionName)}</div>
                    <div class="warhub-meta">${esc([`ID ${factionId}`, x.status || "", x.leader_name || "", x.expires_at ? fmtTs(x.expires_at) : ""].filter(Boolean).join(" • "))}</div>
                  </div>
                  <div class="warhub-actions">
                    <button class="warhub-btn small" data-admin-history="${esc(String(factionId))}">History</button>
                    <button class="warhub-btn small good" data-admin-renew="${esc(String(factionId))}">Renew</button>
                    <button class="warhub-btn small warn" data-admin-expire="${esc(String(factionId))}">Expire</button>
                  </div>
                </div>
              </div>
            `;
          }).join("") : `<div class="warhub-empty">No faction licenses found.</div>`}
        </div>
      </div>
    `;
  }

  function renderSettingsTab() {
    const apiKey = cleanInputValue(GM_getValue(K_API_KEY, ""));
    const refreshMs = Number(GM_getValue(K_REFRESH, 30000)) || 30000;
    return `
      <div class="warhub-card">
        <h3>Keys</h3>
        <label class="warhub-label">Your Torn API Key</label>
        <input class="warhub-input" id="wh-api-key" value="${esc(apiKey)}" placeholder="Paste your API key">
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-keys">Save Keys</button>
          <button class="warhub-btn" id="wh-login-btn">Login</button>
          <button class="warhub-btn warn" id="wh-logout-btn">Logout</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Polling</h3>
        <label class="warhub-label">Refresh every (ms)</label>
        <input class="warhub-input" id="wh-refresh-ms" value="${esc(String(refreshMs))}">
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-save-refresh">Save Refresh</button>
          <button class="warhub-btn" id="wh-reset-positions">Reset Positions</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Access Info</h3>
        <div class="warhub-mini" style="line-height:1.6;">
          Payment player: <strong>${esc(accessState?.paymentPlayer || PAYMENT_PLAYER)}</strong><br>
          Price per enabled member: <strong>${esc(fmtMoney(accessState?.pricePerMember || PRICE_PER_MEMBER))}</strong><br>
          ${accessSummaryMessage() ? `Status: <strong>${esc(accessSummaryMessage())}</strong>` : `Status: <strong>Ready</strong>`}
        </div>
      </div>
    `;
  }

  function renderAccessBanner() {
    const msg = accessSummaryMessage();
    if (!msg) return "";
    const cls = accessState?.paymentRequired || accessState?.blocked || accessState?.trialExpired
      ? "payment"
      : accessState?.trialActive
        ? "trial"
        : "good";
    return `
      <div class="warhub-banner ${cls}">
        <div><strong>Faction Access</strong></div>
        <div class="warhub-mini" style="margin-top:6px;">${esc(msg)}</div>
      </div>
    `;
  }

  function noteRow(x) {
    const id = String(x.id || x.note_id || "");
    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(x.target_name || `Target ${x.target_id || "—"}`)}</div>
            <div class="warhub-meta">${esc(x.note || "")}</div>
            <div class="warhub-mini">${esc([x.created_by_name || x.updated_by_name || "", fmtTs(x.created_at || x.updated_at || "")].filter(Boolean).join(" • "))}</div>
          </div>
          <div class="warhub-actions">
            ${id ? `<button class="warhub-btn small warn" data-del-note-live="${esc(id)}">Delete</button>` : ``}
          </div>
        </div>
      </div>
    `;
  }

  function tabLocked(key) {
  if (isOwnerSession()) return false;
  if (key === "admin") return !isOwnerSession();
  if (key === "terms" || key === "faction") return !accessState?.isFactionLeader;
  return false;
}

  function tabBtn(key, label) {
    const active = currentTab === key ? "active" : "";
    const locked = tabLocked(key) ? "locked" : "";
    return `<button class="warhub-tab ${active} ${locked}" data-tab="${esc(key)}">${esc(label)}</button>`;
  }

  function renderTabContent() {
    switch (currentTab) {
      case "instructions": return renderInstructionsTab();
      case "war": return `${renderAccessBanner()}${renderWarTab()}`;
      case "terms": return renderTermsTab();
      case "members": return `${renderAccessBanner()}${renderMembersTab()}`;
      case "enemies": return `${renderAccessBanner()}${renderEnemiesTab()}`;
      case "hospital": return `${renderAccessBanner()}${renderHospitalTab()}`;
      case "chain": return `${renderAccessBanner()}${renderChainTab()}`;
      case "meddeals": return `${renderAccessBanner()}${renderMedDealsTab()}`;
      case "targets": return `${renderAccessBanner()}${renderTargetsTab()}`;
      case "assignments": return `${renderAccessBanner()}${renderAssignmentsTab()}`;
      case "notes": return `${renderAccessBanner()}${renderNotesTab()}`;
      case "analytics": return `${renderAccessBanner()}${renderAnalyticsTab()}`;
      case "notifications": return `${renderAccessBanner()}${renderNotificationsTab()}`;
      case "faction": return `${renderAccessBanner()}${renderFactionTab()}`;
      case "admin": return renderAdminTab();
      case "settings": return renderSettingsTab();
      default: return `${renderAccessBanner()}${renderWarTab()}`;
    }
  }

  function renderBody() {
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="warhub-head" id="warhub-drag-handle">
        <div class="warhub-toprow">
          <div>
            <div class="warhub-title">War Hub</div>
            <div class="warhub-sub">Fries91 • Torn overlay</div>
          </div>
          <button class="warhub-close" id="warhub-close-btn" type="button">Close</button>
        </div>
      </div>
      <div class="warhub-tabs">
        ${TAB_ORDER.map(([key, label]) => tabBtn(key, label)).join("")}
      </div>
      <div class="warhub-body">
        <div id="warhub-status" class="warhub-status"></div>
        ${renderTabContent()}
      </div>
    `;
    bindOverlayEvents();
    bindOverlayDrag();
    restoreStatus();
  }

   function clampElementPosition(el, left, top) {
    const rect = el.getBoundingClientRect();
    const w = rect.width || parseInt(getComputedStyle(el).width, 10) || 320;
    const h = rect.height || parseInt(getComputedStyle(el).height, 10) || 320;
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
    const overlayWidth = Math.min(window.innerWidth - 16, 520);
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
    if (isOpen) closeOverlay();
    else openOverlay();
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
      if (t && (t.closest("button") || t.closest("a") || t.closest("input") || t.closest("textarea") || t.closest("select") || t.closest("summary"))) return;
      active = e.pointerId;
      moved = false;
      dragMoved = false;
      const rect = moveEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      moveEl.style.left = `${rect.left}px`;
      moveEl.style.top = `${rect.top}px`;
      moveEl.style.right = "auto";
      moveEl.style.bottom = "auto";
      handleEl.setPointerCapture?.(e.pointerId);
      document.addEventListener("pointermove", onMove, true);
      document.addEventListener("pointerup", onUp, true);
      document.addEventListener("pointercancel", onUp, true);
    });
  }

  function bindOverlayDrag() {
    const handle = overlay?.querySelector("#warhub-drag-handle");
    if (!handle || !overlay) return;
    makeDraggable(handle, overlay, saveOverlayPos, updateBadge);
  }

  async function loadAdminDashboard() {
    if (!isOwnerSession()) return null;
    const res = await adminReq("GET", "/api/admin/faction-licenses");
    if (!res.ok) {
      setStatus(res.error || "Could not load owner dashboard.", true);
      return null;
    }
    state = state || {};
    state.adminDashboard = {
      ...(res.data || {}),
      items: arr(res.data?.items || res.data?.factions || []),
      summary: res.data?.summary || {},
    };
    if (overlay && isOpen && currentTab === "admin") renderBody();
    return state.adminDashboard;
  }

  function bindOverlayEvents() {
    overlay?.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tab = btn.getAttribute("data-tab") || "war";
        currentTab = tab;
        GM_setValue(K_TAB, currentTab);

        if (tab === "faction" && accessState?.isFactionLeader) {
          await loadFactionMembers(true);
        }
        if (tab === "admin" && isOwnerSession()) {
          await loadAdminDashboard();
        }

        renderBody();
      });
    });

    overlay?.querySelector("#warhub-close-btn")?.addEventListener("click", () => {
      closeOverlay();
    });

    overlay?.querySelector("#warhub-save-snapshot")?.addEventListener("click", async () => {
      await doAction("POST", "/api/war/snapshot", {}, "War snapshot saved.");
    });

    overlay?.querySelector("#warhub-set-available")?.addEventListener("click", async () => {
      await doAction("POST", "/api/availability", { available: true }, "Availability set to available.");
    });

    overlay?.querySelector("#warhub-set-unavailable")?.addEventListener("click", async () => {
      await doAction("POST", "/api/availability", { available: false }, "Availability set to unavailable.");
    });

    overlay?.querySelector("#warhub-set-chain-on")?.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter", { enabled: true }, "Chain sitter enabled.");
    });

    overlay?.querySelector("#warhub-set-chain-off")?.addEventListener("click", async () => {
      await doAction("POST", "/api/chain-sitter", { enabled: false }, "Chain sitter disabled.");
    });

    overlay?.querySelector("#warhub-med-add")?.addEventListener("click", async () => {
      const seller_name = cleanInputValue(overlay.querySelector("#warhub-med-seller")?.value || "");
      const item_name = cleanInputValue(overlay.querySelector("#warhub-med-item")?.value || "");
      const price = cleanInputValue(overlay.querySelector("#warhub-med-price")?.value || "");
      const note = cleanInputValue(overlay.querySelector("#warhub-med-note")?.value || "");

      if (!seller_name || !item_name) {
        setStatus("Seller and item are required.", true);
        return;
      }

      const res = await doAction("POST", "/api/med-deals", { seller_name, item_name, price, note }, "Med deal added.");
      if (res) renderBody();
    });

    overlay?.querySelectorAll(".warhub-del-med").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = cleanInputValue(btn.getAttribute("data-id") || "");
        if (!id) return;
        const res = await doAction("DELETE", `/api/med-deals/${encodeURIComponent(id)}`, null, "Med deal deleted.");
        if (res) renderBody();
      });
    });

    overlay?.querySelector("#warhub-target-enemy")?.addEventListener("change", () => {
      const sel = overlay.querySelector("#warhub-target-enemy");
      const opt = sel?.selectedOptions?.[0];
      const id = cleanInputValue(opt?.value || "");
      overlay.querySelector("#warhub-target-id").value = id;
    });

    overlay?.querySelector("#warhub-target-add")?.addEventListener("click", async () => {
      const sel = overlay.querySelector("#warhub-target-enemy");
      const opt = sel?.selectedOptions?.[0];
      const target_id = cleanInputValue(overlay.querySelector("#warhub-target-id")?.value || opt?.value || "");
      const target_name = cleanInputValue(opt?.dataset?.name || "");
      const notes = cleanInputValue(overlay.querySelector("#warhub-target-notes")?.value || "");

      if (!target_id) {
        setStatus("Target ID is required.", true);
        return;
      }

      const res = await doAction("POST", "/api/targets", { target_id, target_name, notes }, "Target added.");
      if (res) renderBody();
    });

    overlay?.querySelectorAll(".warhub-del-target").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = cleanInputValue(btn.getAttribute("data-id") || "");
        if (!id) return;
        const res = await doAction("DELETE", `/api/targets/${encodeURIComponent(id)}`, null, "Target deleted.");
        if (res) renderBody();
      });
    });

    overlay?.querySelector("#wh-save-assignment")?.addEventListener("click", async () => {
      const war_id = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const target_id = cleanInputValue(overlay.querySelector("#wh-assignment-target-id")?.value || "");
      const target_name = cleanInputValue(overlay.querySelector("#wh-assignment-target-name")?.value || "");
      const sel = overlay.querySelector("#wh-assignment-member");
      const opt = sel?.selectedOptions?.[0];
      const assigned_to_user_id = cleanInputValue(opt?.value || "");
      const assigned_to_name = cleanInputValue(opt?.dataset?.name || "");
      const priority = cleanInputValue(overlay.querySelector("#wh-assignment-priority")?.value || "normal");
      const note = cleanInputValue(overlay.querySelector("#wh-assignment-note")?.value || "");

      if (!war_id || !target_id) {
        setStatus("War ID and target ID are required.", true);
        return;
      }

      const res = await doAction("POST", "/api/war/assignments", {
        war_id,
        target_id,
        target_name,
        assigned_to_user_id,
        assigned_to_name,
        priority,
        note,
      }, "Assignment saved.");

      if (res) renderBody();
    });

    overlay?.querySelectorAll("[data-del-assignment-live]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = cleanInputValue(btn.getAttribute("data-del-assignment-live") || "");
        if (!id) return;
        const res = await doAction("DELETE", `/api/war/assignments/${encodeURIComponent(id)}`, null, "Assignment deleted.");
        if (res) renderBody();
      });
    });

    overlay?.querySelector("#wh-save-notes")?.addEventListener("click", () => {
      const txt = overlay.querySelector("#wh-notes")?.value || "";
      setNotes(txt);
      setStatus("Local notes saved.");
    });

    overlay?.querySelector("#wh-clear-notes")?.addEventListener("click", () => {
      setNotes("");
      renderBody();
      setStatus("Local notes cleared.");
    });

    overlay?.querySelector("#wh-add-server-note")?.addEventListener("click", async () => {
      const war_id = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const target_id = cleanInputValue(overlay.querySelector("#wh-note-target-id")?.value || "");
      const note = cleanInputValue(overlay.querySelector("#wh-note-text")?.value || "");

      if (!war_id || !target_id || !note) {
        setStatus("War ID, target ID and note are required.", true);
        return;
      }

      const res = await doAction("POST", "/api/war/notes", { war_id, target_id, note }, "Shared note saved.");
      if (res) renderBody();
    });

    overlay?.querySelectorAll("[data-del-note-live]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = cleanInputValue(btn.getAttribute("data-del-note-live") || "");
        if (!id) return;
        const res = await doAction("DELETE", `/api/war/notes/${encodeURIComponent(id)}`, null, "Shared note deleted.");
        if (res) renderBody();
      });
    });

    overlay?.querySelector("#warhub-terms-save")?.addEventListener("click", async () => {
      const war_id = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const terms = cleanInputValue(overlay.querySelector("#warhub-terms-text")?.value || "");
      if (!war_id) {
        setStatus("No active war detected.", true);
        return;
      }
      const res = await doAction("POST", "/api/war-terms", { war_id, terms }, "War terms saved.");
      if (res) renderBody();
    });

    overlay?.querySelector("#warhub-terms-delete")?.addEventListener("click", async () => {
      const war_id = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      if (!war_id) {
        setStatus("No active war detected.", true);
        return;
      }
      const res = await doAction("DELETE", `/api/war-terms?war_id=${encodeURIComponent(war_id)}`, null, "War terms deleted.");
      if (res) renderBody();
    });

    overlay?.querySelector("#wh-mark-alerts-seen")?.addEventListener("click", async () => {
      const res = await req("GET", "/api/notifications");
      if (!res.ok) {
        setStatus(res.error || "Could not refresh notifications.", true);
        return;
      }
      setStatus("Notifications refreshed.");
      await loadState(true);
      renderBody();
    });

    overlay?.querySelector("#wh-clear-alerts")?.addEventListener("click", () => {
      setLocalNotifications([]);
      updateBadge();
      renderBody();
      setStatus("Local notifications cleared.");
    });

    overlay?.querySelector("#wh-fm-save")?.addEventListener("click", async () => {
      const member_user_id = cleanInputValue(overlay.querySelector("#wh-fm-userid")?.value || "");
      const member_name = cleanInputValue(overlay.querySelector("#wh-fm-name")?.value || "");
      const member_api_key = cleanInputValue(overlay.querySelector("#wh-fm-key")?.value || "");
      const position = cleanInputValue(overlay.querySelector("#wh-fm-position")?.value || "");

      if (!member_user_id) {
        setStatus("Member user ID is required.", true);
        return;
      }

      const res = await doAction("POST", "/api/faction/members", {
        member_user_id,
        member_name,
        member_api_key,
        enabled: true,
        position,
      }, "Faction member access saved.", false);

      if (res) {
        await refreshLeaderFactionData();
        setStatus("Faction member access saved.");
      }
    });

    overlay?.querySelectorAll("[data-toggle-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const memberId = cleanInputValue(btn.getAttribute("data-toggle-member") || "");
        const enabled = cleanInputValue(btn.getAttribute("data-enabled") || "") === "1";
        if (!memberId) return;

        const res = await doAction(
          "POST",
          `/api/faction/members/${encodeURIComponent(memberId)}/enable`,
          { enabled },
          enabled ? "Member enabled." : "Member disabled.",
          false
        );

        if (res) {
          await refreshLeaderFactionData();
        }
      });
    });

    overlay?.querySelectorAll("[data-del-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const memberId = cleanInputValue(btn.getAttribute("data-del-member") || "");
        if (!memberId) return;

        const res = await doAction(
          "DELETE",
          `/api/faction/members/${encodeURIComponent(memberId)}`,
          null,
          "Faction member removed.",
          false
        );

        if (res) {
          await refreshLeaderFactionData();
        }
      });
    });

    overlay?.querySelectorAll("[data-admin-history]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const factionId = cleanInputValue(btn.getAttribute("data-admin-history") || "");
        if (!factionId) return;

        const res = await adminReq("GET", `/api/admin/faction-licenses/${encodeURIComponent(factionId)}/history`);
        if (!res.ok) {
          setStatus(res.error || "Could not load payment history.", true);
          return;
        }

        const items = arr(res.data?.items || []);
        const lines = items.length
          ? items.map((x) => {
              const amount = x.amount != null ? fmtMoney(x.amount) : "—";
              const when = fmtTs(x.created_at || x.ts || x.time || "");
              const by = x.renewed_by || x.created_by || x.payment_player || "";
              return `${when} • ${amount}${by ? ` • ${by}` : ""}`;
            }).join("\n")
          : "No payment history found.";

        alert(lines);
      });
    });

    overlay?.querySelectorAll("[data-admin-renew]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const factionId = cleanInputValue(btn.getAttribute("data-admin-renew") || "");
        if (!factionId) return;

        const amountText = prompt("Renew faction for how much?", String(PRICE_PER_MEMBER));
        if (amountText == null) return;
        const amount = Number(String(amountText).replace(/[^\d.-]/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) {
          setStatus("Invalid renewal amount.", true);
          return;
        }

        const note = prompt("Optional note for renewal:", "") || "";

        const res = await adminReq("POST", `/api/admin/faction-licenses/${encodeURIComponent(factionId)}/renew`, {
          amount,
          note,
        });

        if (!res.ok) {
          setStatus(res.error || "Renew failed.", true);
          return;
        }

        setStatus("Faction renewed.");
        await loadAdminDashboard();
      });
    });

    overlay?.querySelectorAll("[data-admin-expire]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const factionId = cleanInputValue(btn.getAttribute("data-admin-expire") || "");
        if (!factionId) return;

        const confirmExpire = confirm(`Expire faction ${factionId}?`);
        if (!confirmExpire) return;

        const res = await adminReq("POST", `/api/admin/faction-licenses/${encodeURIComponent(factionId)}/expire`, {});
        if (!res.ok) {
          setStatus(res.error || "Expire failed.", true);
          return;
        }

        setStatus("Faction expired.");
        await loadAdminDashboard();
      });
    });

    overlay?.querySelector("#wh-save-keys")?.addEventListener("click", () => {
      const apiKey = cleanInputValue(overlay.querySelector("#wh-api-key")?.value || "");
      GM_setValue(K_API_KEY, apiKey);
      setStatus("API key saved locally.");
    });

    overlay?.querySelector("#wh-login-btn")?.addEventListener("click", async () => {
      const apiKey = cleanInputValue(overlay.querySelector("#wh-api-key")?.value || "");
      if (apiKey) GM_setValue(K_API_KEY, apiKey);

      const okLogin = await login(true);
      if (!okLogin) return;

      setStatus("Login successful.");
      await loadState(true);
      renderBody();
    });

    overlay?.querySelector("#wh-logout-btn")?.addEventListener("click", async () => {
      await req("POST", "/api/logout", {});
      clearSavedKeys();
      state = null;
      analyticsCache = null;
      factionMembersCache = null;
      accessState = normalizeAccessCache({});
      saveAccessCache();
      renderBody();
      updateBadge();
      setStatus("Logged out.");
    });

    overlay?.querySelector("#wh-save-refresh")?.addEventListener("click", () => {
      const raw = cleanInputValue(overlay.querySelector("#wh-refresh-ms")?.value || "30000");
      const ms = Math.max(10000, Number(raw) || 30000);
      GM_setValue(K_REFRESH, ms);
      startPolling();
      setStatus(`Refresh saved: ${ms}ms`);
    });

    overlay?.querySelector("#wh-reset-positions")?.addEventListener("click", () => {
      GM_deleteValue(K_SHIELD_POS);
      GM_deleteValue(K_OVERLAY_POS);
      resetShieldPosition();
      positionOverlayNearShield();
      saveShieldPos();
      saveOverlayPos();
      updateBadge();
      setStatus("Positions reset.");
    });
  }

  function mount() {
    if (mounted) return;
    mounted = true;

    shield = document.createElement("div");
    shield.id = "warhub-shield";
    shield.textContent = "⚔️";

    badge = document.createElement("div");
    badge.id = "warhub-badge";

    overlay = document.createElement("div");
    overlay.id = "warhub-overlay";

    document.body.appendChild(shield);
    document.body.appendChild(badge);
    document.body.appendChild(overlay);

    const savedShield = GM_getValue(K_SHIELD_POS, null);
    if (savedShield && typeof savedShield === "object") {
      if (savedShield.left) shield.style.left = savedShield.left;
      if (savedShield.top) shield.style.top = savedShield.top;
      if (savedShield.right) shield.style.right = savedShield.right;
      if (savedShield.bottom) shield.style.bottom = savedShield.bottom;
    } else {
      resetShieldPosition();
    }

    const savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (savedOverlay && typeof savedOverlay === "object") {
      if (savedOverlay.left) overlay.style.left = savedOverlay.left;
      if (savedOverlay.top) overlay.style.top = savedOverlay.top;
      if (savedOverlay.right) overlay.style.right = savedOverlay.right;
      if (savedOverlay.bottom) overlay.style.bottom = savedOverlay.bottom;
    } else {
      positionOverlayNearShield();
    }

    makeDraggable(shield, shield, saveShieldPos, () => {
      updateBadge();
      if (!GM_getValue(K_OVERLAY_POS, null) && !isOpen) positionOverlayNearShield();
    });

    shield.addEventListener("click", (e) => {
      if (dragMoved || shield?.dataset.dragging === "1") return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    });

    window.addEventListener("resize", () => {
      clampToViewport(shield);
      clampToViewport(overlay);
      updateBadge();
    });

    renderBody();
    if (isOpen) overlay.classList.add("open");
    else overlay.classList.remove("open");
    updateBadge();
  }

  function keepMounted() {
    if (!document.body) return;
    if (!document.getElementById("warhub-shield") || !document.getElementById("warhub-overlay")) {
      mounted = false;
      shield = null;
      overlay = null;
      badge = null;
      mount();
    }
  }

  function startMountWatcher() {
    if (remountTimer) clearInterval(remountTimer);
    remountTimer = setInterval(keepMounted, 2000);
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    const ms = Math.max(10000, Number(GM_getValue(K_REFRESH, 30000)) || 30000);
    pollTimer = setInterval(async () => {
      if (!cleanInputValue(GM_getValue(K_SESSION, ""))) return;
      await loadState(true);
      updateBadge();
    }, ms);
  }

  async function boot() {
    mount();
    startMountWatcher();
    startPolling();

    const health = await healthCheck();
    if (!health.ok) {
      setStatus("Server offline or unreachable.", true);
      return;
    }

    const hasApiKey = !!cleanInputValue(GM_getValue(K_API_KEY, ""));
    const hasSession = !!cleanInputValue(GM_getValue(K_SESSION, ""));

    if (hasApiKey && !hasSession) {
      await login(false);
    }

    if (cleanInputValue(GM_getValue(K_SESSION, "")) && canUseProtectedFeatures()) {
      await loadState(true);
      await loadAnalytics().catch(() => null);
      updateBadge();
      if (isOpen) renderBody();
    } else {
      renderBody();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
