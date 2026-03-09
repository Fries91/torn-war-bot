// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      2.6.0
// @description  War Hub by Fries91. Trial/payment aware overlay with draggable icon, draggable overlay, PDA friendly, shared war tools, and payment lock handling.
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

  if (window.__WAR_HUB_V260__) return;
  window.__WAR_HUB_V260__ = true;

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
  const K_LOCAL_NOTIFICATIONS = "warhub_local_notifications_v2";
  const K_ACCESS_CACHE = "warhub_access_cache_v2";

  const PAYMENT_TEXT = "Send 50 Xanax to Fries91";

  const TAB_ORDER = [
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
      width: min(96vw, 500px) !important;
      height: min(86vh, 860px) !important;
      max-height: 86vh !important;
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
    if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
      return accessState.message || accessState.reason || `Access locked. ${PAYMENT_TEXT}.`;
    }
    if (accessState.trialActive) {
      if (accessState.daysLeft != null) {
        if (accessState.daysLeft <= 0) return `Trial ends today. After that, ${PAYMENT_TEXT}.`;
        return `Trial active. ${accessState.daysLeft} day${accessState.daysLeft === 1 ? "" : "s"} left.`;
      }
      if (accessState.expiresAt) return `Trial active until ${fmtTs(accessState.expiresAt)}.`;
      return "Trial active.";
    }
    return "";
  }

  function getAccessInfo(payload, httpStatus) {
    const d = payload && typeof payload === "object" ? payload : {};
    const access = d.access && typeof d.access === "object" ? d.access : {};

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
      "";

    let message =
      d.message ||
      d.notice ||
      d.details ||
      access.message ||
      access.notice ||
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
      message = `${PAYMENT_TEXT}.`;
    }

    if (finalPaymentRequired && !message) {
      message = `Trial expired. ${PAYMENT_TEXT}.`;
    } else if (finalBlocked && !message) {
      message = reason || `Access locked. ${PAYMENT_TEXT}.`;
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

    if (next.trialActive || next.expiresAt || next.daysLeft != null) {
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
      };
      saveAccessCache();
    }

    return accessState;
  }

  function canUseProtectedFeatures() {
    return !(accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired);
  }

  function ensureAllowedOrMessage() {
    if (canUseProtectedFeatures()) return true;
    setStatus(accessSummaryMessage() || `Access locked. ${PAYMENT_TEXT}.`, true);
    renderBody();
    return false;
  }

  function gmXhr(method, path, body) {
    return new Promise((resolve) => {
      const token = cleanInputValue(GM_getValue(K_SESSION, ""));
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

  async function healthCheck() {
    return gmXhr("GET", "/health");
  }

  async function login(showDebug = false) {
    const apiKey = cleanInputValue(GM_getValue(K_API_KEY, ""));
    const adminKey = cleanInputValue(GM_getValue(K_ADMIN_KEY, ""));
    if (!apiKey || !adminKey) return false;

    if (showDebug) {
      setStatus(`Trying login with admin key: ${adminKey}`);
    }

    const res = await gmXhr("POST", "/api/auth", { api_key: apiKey, admin_key: adminKey });
    updateAccessFromPayload(res.data, res.status, false);

    if (!res.ok) {
      if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
        setStatus(accessSummaryMessage() || `${PAYMENT_TEXT}.`, true);
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
      setStatus(accessSummaryMessage() || `${PAYMENT_TEXT}.`, true);
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
        data: { ok: false, payment_required: true, message: accessSummaryMessage() || `${PAYMENT_TEXT}.` },
        error: accessSummaryMessage() || `${PAYMENT_TEXT}.`,
      };
    }

    let res = await gmXhr(method, path, body);
    updateAccessFromPayload(res.data, res.status, !!cleanInputValue(GM_getValue(K_SESSION, "")));

    if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
      return {
        ok: false,
        status: res.status || 403,
        data: res.data,
        error: accessSummaryMessage() || res.error || `${PAYMENT_TEXT}.`,
      };
    }

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      const ok = await login(false);
      if (ok) {
        res = await gmXhr(method, path, body);
        updateAccessFromPayload(res.data, res.status, true);
      }
    }

    if (accessState?.blocked || accessState?.paymentRequired || accessState?.trialExpired) {
      return {
        ok: false,
        status: res.status || 403,
        data: res.data,
        error: accessSummaryMessage() || res.error || `${PAYMENT_TEXT}.`,
      };
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
    const hospital = s.hospital || {};
    const medDeals = arr(s.med_deals || s.medDeals || s.deals);
    const targets = arr(s.targets || s.smart_targets || s.assignable_targets);
    const assignments = arr(s.assignments || s.target_assignments);
    const notifications = arr(s.notifications || s.alerts);
    const chainSitters = arr(s.chain_sitters || s.chainSitters || s.chain_helpers);
    const notes = arr(s.war_notes || s.notes || []);
    const warTerms = s.war_terms || null;
    const medDealBuyers = arr(s.med_deal_buyers || enemies);
    const medDealsMessage = String(s.med_deals_message || war.message || enemyFaction.message || "").trim();

    updateAccessFromPayload(s, 200, !!cleanInputValue(GM_getValue(K_SESSION, "")));

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
      notes,
      warTerms,
      medDealBuyers,
      medDealsMessage,
    };
  }

  async function loadState(silent = false) {
    if (loadInFlight) return;
    if (!canUseProtectedFeatures()) {
      if (!silent) setStatus(accessSummaryMessage() || `${PAYMENT_TEXT}.`, true);
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
      if (!silent) setStatus("");
      if (overlay && isOpen) renderBody();
      updateBadge();
    } finally {
      loadInFlight = false;
    }
  }

  async function loadAnalytics() {
    if (!canUseProtectedFeatures()) return;
    const res = await req("GET", "/api/analytics");
    if (res.ok) analyticsCache = res.data?.analytics || res.data || {};
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
      const an = String(a?.name || a?.player_name || "").toLowerCase();
      const bn = String(b?.name || b?.player_name || "").toLowerCase();
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
    const id = x.user_id || x.id || x.player_id || "";
    const name = x.name || x.player_name || `ID ${id}`;
    const onlineState = String(x.online_state || x.online_status || x.status || "offline").toLowerCase();
    const hosp = getHospSeconds(x);
    const hospText = x.hospital_text || "";
    const last = x.last_action || x.last_action_relative || x.last || "—";
    const level = x.level ? `Lvl ${x.level}` : "";
    const lifeCur = Number(x.life_current || x.current_life || 0);
    const lifeMax = Number(x.life_max || x.maximum_life || 0);
    const lifeText = lifeMax > 0 ? `${lifeCur.toLocaleString()}/${lifeMax.toLocaleString()}` : "—";
    const attackUrl = x.attack_url || (id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` : "#");

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
            <div class="warhub-name">${esc(name)} ${id ? `<span class="warhub-mini">[${esc(id)}]</span>` : ""}</div>
            <div class="warhub-meta">${esc(level)}${level ? " • " : ""}Life: ${esc(lifeText)} • Last: ${esc(last)}</div>
          </div>
          <div class="warhub-actions">
            ${pill}
            ${enemy && id ? `<a class="warhub-btn small primary warhub-link" href="${esc(attackUrl)}" target="_blank" rel="noreferrer">Attack</a>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function targetRow(x, isLive = false) {
    const rowId = x.id || "";
    const id = x.target_id || x.user_id || "";
    const name = x.name || x.target_name || `Target ${id}`;
    const reason = x.reason || x.note || x.priority || "";
    const attackUrl = x.attack_url || (id ? `https://www.torn.com/loader.php?sid=attack&user2ID=${id}` : "#");

    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(name)} ${id ? `<span class="warhub-mini">[${esc(id)}]</span>` : ""}</div>
            <div class="warhub-meta">${esc(reason || "No note")}</div>
          </div>
          <div class="warhub-actions">
            ${id ? `<a class="warhub-btn small primary warhub-link" href="${esc(attackUrl)}" target="_blank" rel="noreferrer">Attack</a>` : ""}
            <button class="warhub-btn small" data-fill-assignment="${esc(String(id))}|${esc(name)}">Assign</button>
            ${isLive && rowId ? `<button class="warhub-btn small warn" data-del-target-live="${esc(String(rowId))}">Delete</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function noteRow(x) {
    const id = x.id || "";
    const targetId = x.target_id || "";
    const author = x.created_by_name || "Unknown";
    const message = x.text || x.message || x.note || "";
    return `
      <div class="warhub-list-item">
        <div class="warhub-row">
          <div>
            <div class="warhub-name">${esc(author)}${targetId ? ` <span class="warhub-mini">on [${esc(targetId)}]</span>` : ""}</div>
            <div class="warhub-meta">${esc(message)}</div>
            <div class="warhub-mini">${esc(fmtTs(x.created_at || ""))}</div>
          </div>
          <div class="warhub-actions">
            ${id ? `<button class="warhub-btn small warn" data-del-note="${esc(String(id))}">Delete</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function renderRosterBox(title, list, enemy, boxClass) {
    return `
      <div class="warhub-card warhub-roster-card ${boxClass}">
        <div class="warhub-section-title">
          <h3>${esc(title)}</h3>
          <span class="warhub-count">${fmtNum(list.length)}</span>
        </div>
        ${list.length
          ? `<div class="warhub-list">${list.map((x) => memberRow(x, enemy)).join("")}</div>`
          : `<div class="warhub-empty">None</div>`
        }
      </div>
    `;
  }

  function renderOfflineDropdown(title, list, enemy) {
    return `
      <details class="warhub-dropdown">
        <summary>
          <div class="warhub-section-title" style="margin-bottom:0;">
            <h3>${esc(title)}</h3>
            <span class="warhub-count">${fmtNum(list.length)}</span>
          </div>
        </summary>
        <div class="warhub-dropdown-body">
          ${list.length
            ? `<div class="warhub-list">${list.map((x) => memberRow(x, enemy)).join("")}</div>`
            : `<div class="warhub-empty">None</div>`
          }
        </div>
      </details>
    `;
  }

  function renderGroupedRosterTab(title, list, enemy) {
    const groups = splitRosterGroups(list);
    const total = arr(list).length;

    if (!total) {
      return `<div class="warhub-card"><div class="warhub-empty">${enemy ? "Currently not in war" : "No member data yet."}</div></div>`;
    }

    return `
      <div class="warhub-card">
        <div class="warhub-section-title">
          <h3>${esc(title)}</h3>
          <span class="warhub-count">${fmtNum(total)}</span>
        </div>
        <div class="warhub-section-scroll">
          ${renderRosterBox("Hospital", groups.hospital, enemy, "hospital-box")}
          ${renderRosterBox("Online", groups.online, enemy, "online-box")}
          ${renderRosterBox("Idle", groups.idle, enemy, "idle-box")}
          ${renderOfflineDropdown("Offline", groups.offline, enemy)}
        </div>
      </div>
    `;
  }

  function renderAccessBanner() {
    const msg = accessSummaryMessage();
    if (!msg) return "";

    if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
      return `
        <div class="warhub-banner payment">
          <div style="font-weight:800; margin-bottom:4px;">Payment Required</div>
          <div class="warhub-mini" style="opacity:.95;">${esc(msg)}</div>
          <div class="warhub-payment-line">${esc(PAYMENT_TEXT)}</div>
        </div>
      `;
    }

    if (accessState.trialActive) {
      return `
        <div class="warhub-banner trial">
          <div style="font-weight:800; margin-bottom:4px;">Trial Active</div>
          <div class="warhub-mini" style="opacity:.95;">${esc(msg)}</div>
        </div>
      `;
    }

    return "";
  }

  function renderLoginRequiredCard() {
    const savedAdmin = cleanInputValue(GM_getValue(K_ADMIN_KEY, ""));
    const savedApi = cleanInputValue(GM_getValue(K_API_KEY, ""));
    const blocked = accessState.paymentRequired || accessState.blocked || accessState.trialExpired;

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>${blocked ? "Access Locked" : "Login"}</h3>
        <div class="warhub-mini" style="line-height:1.55; margin-bottom:8px;">
          ${blocked
            ? `Your trial has expired or payment is required. ${esc(PAYMENT_TEXT)}. After payment, enter your keys again and log in.`
            : `Enter your Torn API key and admin key to use War Hub. Trial status will be checked when you log in.`}
        </div>

        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Torn API Key</label>
            <input id="wh-api-key" class="warhub-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${blocked ? "" : esc(savedApi)}" placeholder="Paste your API key" ${blocked ? "disabled" : ""}>
          </div>
          <div>
            <label class="warhub-label">Admin Key</label>
            <input id="wh-admin-key" class="warhub-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${blocked ? "" : esc(savedAdmin)}" placeholder="Paste your admin key" ${blocked ? "disabled" : ""}>
          </div>
        </div>

        <div class="warhub-payment-line">${esc(PAYMENT_TEXT)}</div>

        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-settings" ${blocked ? "disabled" : ""}>Save + Login</button>
          <button class="warhub-btn" id="wh-test-health">Test Health</button>
          <button class="warhub-btn warn" id="wh-clear-keys">Clear Saved Keys</button>
        </div>
      </div>
    `;
  }
    function renderWarTab() {
    const war = state?.war || {};
    const me = state?.me || {};
    const faction = state?.faction || {};
    const enemyFaction = state?.enemyFaction || {};
    const warActive = !!war.active;
    const scoreSelf = war.score || war.our_score || war.score_us || 0;
    const scoreEnemy = war.enemy_score || war.score_them || enemyFaction.score || 0;
    const currentWar = war.id || war.war_id || "";
    const chainCount = war.chain || war.chain_us || 0;
    const sharedTerms = String(war.terms_text || state?.warTerms?.terms_text || "").trim();
    const sharedTermsBy = String(war.terms_updated_by_name || state?.warTerms?.updated_by_name || "").trim();
    const sharedTermsAt = String(war.terms_updated_at || state?.warTerms?.updated_at || "").trim();
    const warMessage = String(war.message || war.status_text || "").trim() || "Currently not in war";

    const ourAttackLink = `https://www.torn.com/factions.php?step=your#/war/chain`;
    const enemyFactionId = enemyFaction?.id || enemyFaction?.faction_id || "";

    return `
      ${renderAccessBanner()}
      ${!warActive ? `
      <div class="warhub-card">
        <h3>Status</h3>
        <div class="warhub-empty">${esc(warMessage)}</div>
      </div>
      ` : ""}

      ${sharedTerms ? `
      <div class="warhub-card">
        <h3>War Terms</h3>
        <div class="warhub-meta" style="white-space:pre-wrap;">${esc(sharedTerms)}</div>
        <div class="warhub-mini" style="margin-top:6px;">
          Updated by ${esc(sharedTermsBy || "Unknown")} • ${esc(fmtTs(sharedTermsAt))}
        </div>
      </div>
      ` : ""}

      <div class="warhub-card">
        <h3>Overview</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric">
            <div class="k">You</div>
            <div class="v">${esc(me.name || "—")}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Faction</div>
            <div class="v">${esc(faction.name || faction.faction_name || "—")}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Enemy</div>
            <div class="v">${esc(enemyFaction.name || enemyFaction.faction_name || "Currently not in war")}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">War ID</div>
            <div class="v">${esc(currentWar || "—")}</div>
          </div>
        </div>

        <div class="warhub-actions" style="margin-top:8px;">
          <a class="warhub-btn primary warhub-link" href="https://www.torn.com/factions.php?step=your#/war" target="_blank" rel="noreferrer">Open War Page</a>
          <a class="warhub-btn warhub-link" href="${esc(ourAttackLink)}" target="_blank" rel="noreferrer">Open Chain</a>
          ${enemyFactionId ? `<a class="warhub-btn warhub-link" href="https://www.torn.com/factions.php?step=profile&ID=${esc(enemyFactionId)}" target="_blank" rel="noreferrer">Enemy Faction</a>` : ""}
        </div>
      </div>

      <div class="warhub-card">
        <h3>Score</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric warhub-score-us">
            <div class="k">Our Score</div>
            <div class="v">${fmtNum(scoreSelf)}</div>
          </div>
          <div class="warhub-metric warhub-score-them">
            <div class="k">Enemy Score</div>
            <div class="v">${fmtNum(scoreEnemy)}</div>
          </div>
          <div class="warhub-metric warhub-score-lead">
            <div class="k">Lead</div>
            <div class="v">${fmtNum(war.lead || (Number(scoreSelf) - Number(scoreEnemy)))}</div>
          </div>
          <div class="warhub-metric">
            <div class="k">Chain</div>
            <div class="v">${fmtNum(chainCount)}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderTermsTab() {
    const warId = String(state?.war?.war_id || state?.war?.id || "").trim();
    const sharedTerms = String(state?.war?.terms_text || state?.warTerms?.terms_text || "").trim();
    const sharedTermsBy = String(state?.war?.terms_updated_by_name || state?.warTerms?.updated_by_name || "").trim();
    const sharedTermsAt = String(state?.war?.terms_updated_at || state?.warTerms?.updated_at || "").trim();

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Shared War Terms</h3>
        ${warId ? `<div class="warhub-mini" style="margin-bottom:8px;">War ID: ${esc(warId)}</div>` : `<div class="warhub-mini" style="margin-bottom:8px;">Currently not in war.</div>`}
        <label class="warhub-label">These terms are shared for everyone in this same war.</label>
        <textarea id="wh-terms-text" class="warhub-textarea">${esc(sharedTerms)}</textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-terms">Save Terms</button>
          <button class="warhub-btn warn" id="wh-delete-terms">Delete Terms</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Current Shared Terms</h3>
        ${sharedTerms ? `
          <div class="warhub-meta" style="white-space:pre-wrap;">${esc(sharedTerms)}</div>
          <div class="warhub-mini" style="margin-top:6px;">
            Updated by ${esc(sharedTermsBy || "Unknown")} • ${esc(fmtTs(sharedTermsAt))}
          </div>
        ` : `<div class="warhub-empty">No war terms saved yet.</div>`}
      </div>
    `;
  }

  function renderMembersTab() {
    return `${renderAccessBanner()}${renderGroupedRosterTab("Faction Members", arr(state?.members), false)}`;
  }

  function renderEnemiesTab() {
    return `${renderAccessBanner()}${renderGroupedRosterTab("Enemy Members", arr(state?.enemies), true)}`;
  }

  function renderHospitalTab() {
    const hospital = state?.hospital || {};
    const enemies = sortHosp(arr(hospital.enemy_faction || state?.enemies).filter((x) => getHospSeconds(x) > 0));
    const ours = sortHosp(arr(hospital.our_faction || state?.members).filter((x) => getHospSeconds(x) > 0));
    const warActive = !!state?.war?.active;

    return `
      ${renderAccessBanner()}
      <div class="warhub-grid two">
        <div class="warhub-card">
          <h3>Our Hospital</h3>
          ${ours.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${ours.map((x) => memberRow(x, false)).join("")}</div></div>` : `<div class="warhub-empty">Nobody from your faction is in hospital right now.</div>`}
        </div>
        <div class="warhub-card">
          <h3>Enemy Hospital</h3>
          ${enemies.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${enemies.map((x) => memberRow(x, true)).join("")}</div></div>` : `<div class="warhub-empty">${warActive ? "No enemy hospital data available." : "Currently not in war"}</div>`}
        </div>
      </div>
    `;
  }

  function renderChainTab() {
    const me = state?.me || {};
    const sitters = sortAlphabetical(arr(state?.chainSitters));

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Chain Control</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric"><div class="k">Your Availability</div><div class="v">${me.available ? "Available" : "Unavailable"}</div></div>
          <div class="warhub-metric"><div class="k">Chain Sitter</div><div class="v">${me.chain_sitter ? "Enabled" : "Disabled"}</div></div>
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
        ${sitters.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${sitters.map((x) => memberRow(x, false)).join("")}</div></div>` : `<div class="warhub-empty">No chain sitter list returned yet.</div>`}
      </div>
    `;
  }

  function renderMedDealsTab() {
    const live = arr(state?.medDeals);
    const warActive = !!state?.war?.active;
    const sellerName = String(state?.me?.name || "").trim();
    const buyers = arr(state?.medDealBuyers);
    const medMsg = String(state?.medDealsMessage || "").trim() || "Currently not in war";
    const buyerOptions = buyers.map((x) => {
      const id = x.user_id || x.id || x.player_id || "";
      const name = x.name || x.player_name || `ID ${id}`;
      return `<option value="${esc(name)}">${esc(name)}${id ? ` [${esc(id)}]` : ""}</option>`;
    }).join("");

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Add Med Deal</h3>
        ${!warActive ? `<div class="warhub-empty" style="margin-bottom:8px;">${esc(medMsg)}</div>` : ""}
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Seller</label>
            <input id="wh-med-seller" class="warhub-input" value="${esc(sellerName || "—")}" readonly>
          </div>
          <div>
            <label class="warhub-label">Buyer</label>
            <select id="wh-med-buyer" class="warhub-select" ${warActive ? "" : "disabled"}>
              <option value="">${warActive ? "Pick enemy member" : "Currently not in war"}</option>
              ${buyerOptions}
            </select>
          </div>
        </div>
        <div style="margin-top:8px;">
          <label class="warhub-label">Note</label>
          <input id="wh-med-note" class="warhub-input" ${warActive ? "" : "disabled"}>
        </div>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-add-med" ${warActive ? "" : "disabled"}>Save Med Deal</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Med Deals</h3>
        ${live.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${live.map((x) => `
          <div class="warhub-list-item">
            <div class="warhub-row">
              <div>
                <div class="warhub-name">${esc((x.seller_name || x.seller || "Unknown") + " → " + (x.buyer_name || x.buyer || "Unknown"))}</div>
                <div class="warhub-meta">${esc(x.note || x.terms || x.notes || "") || "No note"}</div>
              </div>
              <div class="warhub-actions">
                ${x.id ? `<button class="warhub-btn small warn" data-del-med-live="${esc(String(x.id))}">Delete</button>` : ""}
              </div>
            </div>
          </div>
        `).join("")}</div></div>` : `<div class="warhub-empty">No med deals yet.</div>`}
      </div>
    `;
  }

  function renderTargetsTab() {
    const live = arr(state?.targets);
    const enemyOptions = arr(state?.enemies).map((x) => {
      const id = x.user_id || x.id || x.player_id || "";
      const name = x.name || x.player_name || `ID ${id}`;
      return `<option value="${esc(String(id))}|${esc(name)}">${esc(name)}${id ? ` [${esc(id)}]` : ""}</option>`;
    }).join("");

    return `
      ${renderAccessBanner()}
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
            <input id="wh-target-note" class="warhub-input">
          </div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-add-target">Save Target</button></div>
      </div>

      <div class="warhub-card">
        <h3>Targets</h3>
        ${live.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${live.map((x) => targetRow(x, true)).join("")}</div></div>` : `<div class="warhub-empty">No targets saved yet.</div>`}
      </div>
    `;
  }

  function renderAssignmentsTab() {
    const rows = arr(state?.assignments);
    const warId = state?.war?.war_id || state?.war?.id || "";
    const membersOptions = arr(state?.members).map((x) => {
      const id = x.user_id || x.id || "";
      const name = x.name || `ID ${id}`;
      return `<option value="${esc(String(id))}|${esc(name)}">${esc(name)}${id ? ` [${esc(id)}]` : ""}</option>`;
    }).join("");

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Assign Target</h3>
        ${warId ? `<div class="warhub-mini" style="margin-bottom:8px;">War ID: ${esc(warId)}</div>` : `<div class="warhub-mini" style="margin-bottom:8px;">Currently not in war.</div>`}
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Faction Member</label>
            <select id="wh-assignee-pick" class="warhub-select">
              <option value="">Pick member</option>
              ${membersOptions}
            </select>
          </div>
          <div>
            <label class="warhub-label">Target</label>
            <input id="wh-assignment-target" class="warhub-input">
          </div>
        </div>
        <div class="warhub-grid two" style="margin-top:8px;">
          <div>
            <label class="warhub-label">Priority</label>
            <select id="wh-assignment-priority" class="warhub-select">
              <option value="high">High</option>
              <option value="normal" selected>Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label class="warhub-label">Note</label>
            <input id="wh-assignment-note" class="warhub-input">
          </div>
        </div>
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-save-assignment">Save Assignment</button></div>
      </div>

      <div class="warhub-card">
        <h3>Assignments</h3>
        ${rows.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${rows.map((x) => `
          <div class="warhub-list-item">
            <div class="warhub-row">
              <div>
                <div class="warhub-name">${esc(x.assignee || x.assigned_to_name || x.member || "Unknown")}</div>
                <div class="warhub-meta">Target: ${esc(x.target || x.target_name || x.target_id || "—")} • ${esc(x.priority || "normal")} • ${esc(x.note || "")}</div>
              </div>
              <div class="warhub-actions">
                ${x.target_attack_url ? `<a class="warhub-btn small primary warhub-link" href="${esc(x.target_attack_url)}" target="_blank" rel="noreferrer">Attack</a>` : ""}
                ${x.id ? `<button class="warhub-btn small warn" data-del-assignment-live="${esc(String(x.id))}">Delete</button>` : ""}
              </div>
            </div>
          </div>
        `).join("")}</div></div>` : `<div class="warhub-empty">No assignments yet.</div>`}
      </div>
    `;
  }

  function renderNotesTab() {
    const serverNotes = arr(state?.notes);
    const warId = state?.war?.war_id || state?.war?.id || "";

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>War Notes</h3>
        ${warId ? `<div class="warhub-mini" style="margin-bottom:8px;">War ID: ${esc(warId)}</div>` : `<div class="warhub-mini" style="margin-bottom:8px;">No active war id detected.</div>`}
        <label class="warhub-label">Quick personal note</label>
        <textarea id="wh-notes" class="warhub-textarea">${esc(getNotes())}</textarea>
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-save-notes">Save Local Note</button>
          <button class="warhub-btn" id="wh-clear-notes">Clear Local</button>
        </div>

        <div class="warhub-divider"></div>

        <div class="warhub-grid two">
          <div><label class="warhub-label">Target ID</label><input id="wh-note-target-id" class="warhub-input"></div>
          <div><label class="warhub-label">Server War Note</label><input id="wh-note-text" class="warhub-input"></div>
        </div>

        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn primary" id="wh-add-server-note">Save Shared Note</button></div>
      </div>

      <div class="warhub-card">
        <h3>Shared Notes</h3>
        ${serverNotes.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${serverNotes.map((x) => noteRow(x)).join("")}</div></div>` : `<div class="warhub-empty">No shared war notes yet.</div>`}
      </div>
    `;
  }

  function renderAnalyticsTab() {
    const a = analyticsCache || state?.analytics || {};
    const snaps = arr(a.snapshots);

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Analytics</h3>
        <div class="warhub-grid two">
          <div class="warhub-metric"><div class="k">Lead</div><div class="v">${fmtNum(a.lead || 0)}</div></div>
          <div class="warhub-metric"><div class="k">Target Score</div><div class="v">${fmtNum(a.target_score || state?.war?.target_score || 0)}</div></div>
          <div class="warhub-metric"><div class="k">Pace / Hour Us</div><div class="v">${esc(String(a.pace_per_hour_us || 0))}</div></div>
          <div class="warhub-metric"><div class="k">Pace / Hour Them</div><div class="v">${esc(String(a.pace_per_hour_them || 0))}</div></div>
          <div class="warhub-metric"><div class="k">ETA</div><div class="v">${esc(a.eta_to_target_us_text || "—")}</div></div>
          <div class="warhub-metric"><div class="k">Snapshots</div><div class="v">${fmtNum(snaps.length)}</div></div>
        </div>
      </div>
    `;
  }

  function renderNotificationsTab() {
    const items = mergedNotifications();
    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Alerts</h3>
        ${items.length ? `<div class="warhub-section-scroll"><div class="warhub-list">${items.map((x) => `
          <div class="warhub-list-item">
            <div class="warhub-name">${esc(x.kind || x.title || "Alert")}</div>
            <div class="warhub-meta">${esc(x.text || x.message || x.note || "")}</div>
            <div class="warhub-mini">${esc(fmtTs(x.created_at || x.time || x.ts || ""))}</div>
          </div>
        `).join("")}</div></div>` : `<div class="warhub-empty">No alerts yet.</div>`}
        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn" id="wh-mark-alerts-seen">Mark Server Alerts Seen</button>
          <button class="warhub-btn" id="wh-clear-alerts">Clear Local Alerts</button>
        </div>
      </div>
    `;
  }

  function renderSettingsTab() {
    const refreshMs = Number(GM_getValue(K_REFRESH, 25000) || 25000);
    const savedAdmin = cleanInputValue(GM_getValue(K_ADMIN_KEY, ""));
    const savedApi = cleanInputValue(GM_getValue(K_API_KEY, ""));
    const blocked = accessState.paymentRequired || accessState.blocked || accessState.trialExpired;

    return `
      ${renderAccessBanner()}
      <div class="warhub-card">
        <h3>Keys</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Torn API Key</label>
            <input id="wh-api-key" class="warhub-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${blocked ? "" : esc(savedApi)}" placeholder="Paste your API key" ${blocked ? "disabled" : ""}>
          </div>
          <div>
            <label class="warhub-label">Admin Key</label>
            <input id="wh-admin-key" class="warhub-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${blocked ? "" : esc(savedAdmin)}" placeholder="Paste your admin key" ${blocked ? "disabled" : ""}>
          </div>
        </div>

        <div class="warhub-mini" style="margin-top:8px;">
          Saved admin key right now: <b>${esc(blocked ? "(cleared while blocked)" : (savedAdmin || "(empty)"))}</b>
        </div>

        <div class="warhub-payment-line">${esc(PAYMENT_TEXT)}</div>

        <div class="warhub-actions" style="margin-top:8px;">
          <button class="warhub-btn primary" id="wh-save-settings" ${blocked ? "disabled" : ""}>Save + Login</button>
          <button class="warhub-btn" id="wh-test-health">Test Health</button>
          <button class="warhub-btn warn" id="wh-clear-keys">Clear Saved Keys</button>
        </div>
      </div>

      <div class="warhub-card">
        <h3>Trial / Payment</h3>
        <div class="warhub-mini" style="line-height:1.55;">
          Trial length: <b>45 days</b>.
          <br><br>
          ${accessState.trialActive
            ? `Your trial is active${accessState.daysLeft != null ? ` with <b>${esc(String(accessState.daysLeft))}</b> day${accessState.daysLeft === 1 ? "" : "s"} left` : ""}${accessState.expiresAt ? ` and ends at <b>${esc(fmtTs(accessState.expiresAt))}</b>` : ""}.`
            : accessState.paymentRequired || accessState.blocked || accessState.trialExpired
              ? `Your trial has ended or payment is required. Access is locked until payment is made.`
              : `Your trial/payment status will show here after login.`}
          <br><br>
          When access is blocked, this script clears your saved Torn API key, admin key, and session token locally so the overlay cannot keep using an expired or unpaid session.
          <br><br>
          Payment instruction: <b>${esc(PAYMENT_TEXT)}</b>.
        </div>
      </div>

      <div class="warhub-card">
        <h3>API Key Storage</h3>
        <div class="warhub-mini" style="line-height:1.55;">
          Your <b>Torn API key</b> and <b>admin key</b> are stored locally on your device using your userscript storage
          (${esc("GM_setValue")}). They are not displayed publicly to other users through the overlay.
          <br><br>
          When you press <b>Save + Login</b>, the script sends your API key and admin key to the War Hub server only for
          authentication. After successful login, the server returns a <b>session token</b>, and the script stores that
          token locally as well.
          <br><br>
          After login, normal requests use the saved <b>session token</b> in the request header instead of repeatedly
          sending your keys on every action.
          <br><br>
          If the server reports your trial has expired or payment is required, the script will immediately clear the saved
          API key, admin key, and session token from local storage.
          <br><br>
          Do not share your API key, admin key, or session token with anyone you do not trust.
        </div>
      </div>

      <div class="warhub-card">
        <h3>Terms of Service</h3>
        <div class="warhub-mini" style="line-height:1.55;">
          By using War Hub, you acknowledge and agree that:
          <br><br>
          1. You use this script at your own risk.
          <br>
          2. You are responsible for the API key and admin key entered into the settings tab.
          <br>
          3. You will not redistribute, leak, abuse, reverse engineer, or attempt to damage the service, backend, or shared faction features.
          <br>
          4. Shared features such as targets, assignments, med deals, terms, and notes may be visible to other authorized users in the same faction or war context.
          <br>
          5. Access to War Hub may be changed, limited, revoked, trial-limited, payment-gated, or updated at any time.
          <br>
          6. Features, layout, endpoints, and stored data behavior may change as the project continues to receive upgrades and fixes.
          <br>
          7. Abuse, unauthorized sharing, spam, or malicious use may result in access being removed.
          <br>
          8. War Hub is an actively evolving tool, and by using it you accept ongoing updates, balancing, fixes, and interface changes.
        </div>
      </div>

      <div class="warhub-card">
        <h3>Refresh</h3>
        <div class="warhub-grid two">
          <div>
            <label class="warhub-label">Refresh milliseconds</label>
            <input id="wh-refresh-ms" class="warhub-input" value="${esc(refreshMs)}">
          </div>
          <div>
            <label class="warhub-label">Session</label>
            <div class="warhub-mini">${cleanInputValue(GM_getValue(K_SESSION, "")) ? "Session saved" : "No session yet"}</div>
          </div>
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

  function renderLockedOrLoginTab() {
    if (currentTab !== "settings") currentTab = "settings";
    return renderSettingsTab();
  }

  function renderTabContent() {
    const needsLogin = !cleanInputValue(GM_getValue(K_SESSION, "")) && !state;
    const blocked = accessState.paymentRequired || accessState.blocked || accessState.trialExpired;

    if (blocked) return renderLockedOrLoginTab();
    if (needsLogin && currentTab !== "settings") return renderLoginRequiredCard();

    switch (currentTab) {
      case "terms": return renderTermsTab();
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
    const blocked = accessState.paymentRequired || accessState.blocked || accessState.trialExpired;
    const needsLogin = !cleanInputValue(GM_getValue(K_SESSION, "")) && !state;
    const locked = (blocked || needsLogin) && key !== "settings";
    return `<button type="button" class="warhub-tab ${currentTab === key ? "active" : ""} ${locked ? "locked" : ""}" data-tab="${key}" ${locked ? 'data-locked="1"' : ""}>${text}</button>`;
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
          <button type="button" class="warhub-close" id="warhub-close-btn">Close</button>
        </div>
      </div>
      <div class="warhub-tabs" id="warhub-tabs-bar">${TAB_ORDER.map(([key, label]) => tabBtn(key, label)).join("")}</div>
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

  async function addTargetServer(targetId, targetName, note) {
    return req("POST", "/api/targets/add", {
      target_id: targetId || "",
      target_name: targetName || "",
      notes: note || "",
    });
  }

  async function deleteTargetServer(id) {
    return req("POST", "/api/targets/delete", { id });
  }

  async function addMedDealServer(buyerName, notes) {
    return req("POST", "/api/med-deals/add", {
      buyer_name: buyerName || "",
      notes: notes || "",
    });
  }

  async function deleteMedDealServer(id) {
    return req("POST", "/api/med-deals/delete", { id });
  }

  async function assignTargetServer({ warId, targetId, targetName, assignedToUserId, assignedToName, priority, note }) {
    return req("POST", "/api/targets/assign", {
      war_id: warId,
      target_id: targetId || "",
      target_name: targetName || "",
      assigned_to_user_id: assignedToUserId || "",
      assigned_to_name: assignedToName || "",
      priority: priority || "normal",
      note: note || "",
    });
  }

  async function deleteAssignmentServer(id) {
    return req("POST", "/api/targets/unassign", { id });
  }

  async function addServerNote(warId, targetId, note) {
    return req("POST", "/api/targets/note", {
      war_id: warId,
      target_id: targetId || "",
      note: note || "",
    });
  }

  async function deleteServerNote(id) {
    return req("POST", "/api/targets/note/delete", { id });
  }

  async function setWarTermsServer(warId, termsText) {
    return req("POST", "/api/war-terms/set", {
      war_id: warId,
      terms_text: termsText || "",
    });
  }

  async function deleteWarTermsServer(warId) {
    return req("POST", "/api/war-terms/delete", {
      war_id: warId,
    });
  }

  async function markNotificationsSeen() {
    return req("POST", "/api/notifications/seen", {});
  }
    function bindOverlayEvents() {
    overlay.querySelectorAll(".warhub-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.tab || "war";
        const locked = btn.getAttribute("data-locked") === "1";
        if (locked) {
          currentTab = "settings";
          GM_setValue(K_TAB, currentTab);
          renderBody();
          setStatus(accessSummaryMessage() || "Login required.", true);
          return;
        }
        currentTab = key;
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
      if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
        clearBlockedCredentials();
        renderBody();
        return setStatus(accessSummaryMessage() || `${PAYMENT_TEXT}.`, true);
      }

      const api = cleanInputValue(overlay.querySelector("#wh-api-key")?.value || "");
      const admin = cleanInputValue(overlay.querySelector("#wh-admin-key")?.value || "");

      if (!api) return setStatus("Enter your Torn API key first.", true);
      if (!admin) return setStatus("Enter your admin key first.", true);

      GM_setValue(K_API_KEY, api);
      GM_setValue(K_ADMIN_KEY, admin);
      GM_deleteValue(K_SESSION);

      setStatus(`Saved admin key as: ${admin}. Logging in...`);
      const ok = await login(true);
      if (!ok) {
        renderBody();
        return;
      }

      setStatus("Logged in.");
      await loadState(true);
      renderBody();
    });

    overlay.querySelector("#wh-test-health")?.addEventListener("click", async () => {
      const res = await healthCheck();
      if (!res.ok) return setStatus(res.error || "Health check failed.", true);
      const keys = arr(res.data?.admin_keys_loaded).join(", ") || "(none)";
      setStatus(`Server health OK. Loaded admin keys: ${keys}`);
    });

    overlay.querySelector("#wh-clear-keys")?.addEventListener("click", () => {
      clearSavedKeys();
      accessState = {
        ...accessState,
        loggedIn: false,
      };
      saveAccessCache();
      setStatus("Saved API key, admin key, and session cleared.");
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

    overlay.querySelector("#wh-logout")?.addEventListener("click", async () => {
      await req("POST", "/api/logout", {});
      GM_deleteValue(K_SESSION);
      accessState = {
        ...accessState,
        loggedIn: false,
      };
      saveAccessCache();
      setStatus("Logged out.");
      renderBody();
    });

    overlay.querySelector("#wh-save-notes")?.addEventListener("click", () => {
      if (!ensureAllowedOrMessage()) return;
      setNotes(overlay.querySelector("#wh-notes")?.value || "");
      setStatus("Local note saved.");
    });

    overlay.querySelector("#wh-clear-notes")?.addEventListener("click", () => {
      if (!ensureAllowedOrMessage()) return;
      setNotes("");
      renderBody();
      setStatus("Local note cleared.");
    });

    overlay.querySelectorAll("[data-fill-assignment]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!ensureAllowedOrMessage()) return;
        const raw = btn.getAttribute("data-fill-assignment") || "";
        const [id, name] = raw.split("|");
        currentTab = "assignments";
        GM_setValue(K_TAB, currentTab);
        renderBody();
        fillAssignmentTarget(`${name || ""}${id ? ` [${id}]` : ""}`.trim());
      });
    });

    overlay.querySelector("#wh-add-target")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const raw = String(overlay.querySelector("#wh-target-pick")?.value || "");
      const note = cleanInputValue(overlay.querySelector("#wh-target-note")?.value || "");
      if (!raw) return setStatus("Pick an enemy first.", true);
      const [id, name] = raw.split("|");
      const res = await addTargetServer(id, name, note);
      if (!res.ok) return setStatus(res.error || "Could not add target.", true);
      await loadState(true);
      renderBody();
      setStatus("Target saved.");
    });

    overlay.querySelectorAll("[data-del-target-live]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!ensureAllowedOrMessage()) return;
        const id = Number(btn.getAttribute("data-del-target-live") || 0);
        if (!id) return;
        const res = await deleteTargetServer(id);
        if (!res.ok) return setStatus(res.error || "Could not delete target.", true);
        await loadState(true);
        renderBody();
        setStatus("Target deleted.");
      });
    });

    overlay.querySelector("#wh-add-med")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const warActive = !!state?.war?.active;
      const buyer = cleanInputValue(overlay.querySelector("#wh-med-buyer")?.value || "");
      const note = cleanInputValue(overlay.querySelector("#wh-med-note")?.value || "");

      if (!warActive) return setStatus("Currently not in war.", true);
      if (!buyer) return setStatus("Pick a buyer first.", true);

      const res = await addMedDealServer(buyer, note);
      if (!res.ok) return setStatus(res.error || "Could not add med deal.", true);
      await loadState(true);
      renderBody();
      setStatus("Med deal saved.");
    });

    overlay.querySelectorAll("[data-del-med-live]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!ensureAllowedOrMessage()) return;
        const id = Number(btn.getAttribute("data-del-med-live") || 0);
        if (!id) return;
        const res = await deleteMedDealServer(id);
        if (!res.ok) return setStatus(res.error || "Could not delete med deal.", true);
        await loadState(true);
        renderBody();
        setStatus("Med deal deleted.");
      });
    });

    overlay.querySelector("#wh-save-assignment")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const warId = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const assigneeRaw = cleanInputValue(overlay.querySelector("#wh-assignee-pick")?.value || "");
      const targetText = cleanInputValue(overlay.querySelector("#wh-assignment-target")?.value || "");
      const priority = cleanInputValue(overlay.querySelector("#wh-assignment-priority")?.value || "normal");
      const note = cleanInputValue(overlay.querySelector("#wh-assignment-note")?.value || "");

      if (!warId) return setStatus("No active war id found.", true);
      if (!assigneeRaw) return setStatus("Pick a faction member first.", true);
      if (!targetText) return setStatus("Enter target first.", true);

      const [assignedToUserId, assignedToName] = assigneeRaw.split("|");
      const m = targetText.match(/\[(\d+)\]\s*$/);
      const targetId = m ? m[1] : "";
      const targetName = targetText.replace(/\s*\[\d+\]\s*$/, "").trim() || targetText;

      const res = await assignTargetServer({
        warId,
        targetId,
        targetName,
        assignedToUserId,
        assignedToName,
        priority,
        note,
      });

      if (!res.ok) return setStatus(res.error || "Could not save assignment.", true);
      await loadState(true);
      renderBody();
      setStatus("Assignment saved.");
    });

    overlay.querySelectorAll("[data-del-assignment-live]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!ensureAllowedOrMessage()) return;
        const id = Number(btn.getAttribute("data-del-assignment-live") || 0);
        if (!id) return;
        const res = await deleteAssignmentServer(id);
        if (!res.ok) return setStatus(res.error || "Could not delete assignment.", true);
        await loadState(true);
        renderBody();
        setStatus("Assignment deleted.");
      });
    });

    overlay.querySelector("#wh-add-server-note")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const warId = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const targetId = cleanInputValue(overlay.querySelector("#wh-note-target-id")?.value || "");
      const note = cleanInputValue(overlay.querySelector("#wh-note-text")?.value || "");
      if (!warId) return setStatus("No active war id found.", true);
      if (!targetId) return setStatus("Enter target id first.", true);
      if (!note) return setStatus("Enter note text first.", true);

      const res = await addServerNote(warId, targetId, note);
      if (!res.ok) return setStatus(res.error || "Could not save note.", true);
      await loadState(true);
      renderBody();
      setStatus("Shared note saved.");
    });

    overlay.querySelectorAll("[data-del-note]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!ensureAllowedOrMessage()) return;
        const id = Number(btn.getAttribute("data-del-note") || 0);
        if (!id) return;
        const res = await deleteServerNote(id);
        if (!res.ok) return setStatus(res.error || "Could not delete note.", true);
        await loadState(true);
        renderBody();
        setStatus("Shared note deleted.");
      });
    });

    overlay.querySelector("#wh-save-terms")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const warId = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      const termsText = cleanInputValue(overlay.querySelector("#wh-terms-text")?.value || "");
      if (!warId) return setStatus("No active war id found.", true);
      if (!termsText) return setStatus("Enter terms first.", true);
      const res = await setWarTermsServer(warId, termsText);
      if (!res.ok) return setStatus(res.error || "Could not save war terms.", true);
      await loadState(true);
      renderBody();
      setStatus("War terms saved.");
    });

    overlay.querySelector("#wh-delete-terms")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const warId = cleanInputValue(state?.war?.war_id || state?.war?.id || "");
      if (!warId) return setStatus("No active war id found.", true);
      const res = await deleteWarTermsServer(warId);
      if (!res.ok) return setStatus(res.error || "Could not delete war terms.", true);
      await loadState(true);
      renderBody();
      setStatus("War terms deleted.");
    });

    overlay.querySelector("#wh-mark-alerts-seen")?.addEventListener("click", async () => {
      if (!ensureAllowedOrMessage()) return;
      const res = await markNotificationsSeen();
      if (!res.ok) return setStatus(res.error || "Could not mark alerts seen.", true);
      await loadState(true);
      renderBody();
      setStatus("Server alerts marked seen.");
    });

    overlay.querySelector("#wh-clear-alerts")?.addEventListener("click", () => {
      if (!ensureAllowedOrMessage()) return;
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

    makeDraggable(shield, shield, saveShieldPos, updateBadge);

    if (isOpen) openOverlay();
    else renderBody();

    updateBadge();
    mounted = true;
  }

  function ensureMounted() {
    if (!document.body) return;
    const hasShield = !!document.getElementById("warhub-shield");
    const hasOverlay = !!document.getElementById("warhub-overlay");
    const hasBadge = !!document.getElementById("warhub-badge");

    if (mounted && hasShield && hasOverlay && hasBadge) {
      shield = document.getElementById("warhub-shield");
      overlay = document.getElementById("warhub-overlay");
      badge = document.getElementById("warhub-badge");
      return;
    }
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

  function startLightRemountCheck() {
    if (remountTimer) clearInterval(remountTimer);
    remountTimer = setInterval(() => {
      if (!document.getElementById("warhub-shield") || !document.getElementById("warhub-overlay") || !document.getElementById("warhub-badge")) {
        mounted = false;
        ensureMounted();
      }
    }, 3000);
  }

  async function boot() {
    ensureMounted();

    const token = cleanInputValue(GM_getValue(K_SESSION, ""));
    const savedApi = cleanInputValue(GM_getValue(K_API_KEY, ""));
    const savedAdmin = cleanInputValue(GM_getValue(K_ADMIN_KEY, ""));

    if ((accessState.paymentRequired || accessState.blocked || accessState.trialExpired) && (token || savedApi || savedAdmin)) {
      clearBlockedCredentials();
    }

    if (!token && savedApi && savedAdmin && canUseProtectedFeatures()) {
      // quiet auto-login will happen through req if needed
    }

    await loadState(true);
    if (currentTab === "analytics") await loadAnalytics();

    startPolling();
    startLightRemountCheck();

    const localAlerts = getLocalNotifications();
    if (!localAlerts.length) {
      localAlerts.unshift({
        kind: "Script Ready",
        text: "Ultimate War Hub loaded.",
        created_at: new Date().toISOString()
      });
      setLocalNotifications(localAlerts.slice(0, 20));
      updateBadge();
    }

    if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
      setStatus(accessSummaryMessage() || `${PAYMENT_TEXT}.`, true);
      renderBody();
    }
  }

  window.addEventListener("resize", () => {
    if (shield) clampToViewport(shield);
    if (isOpen && overlay) clampToViewport(overlay);
    updateBadge();
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (shield) clampToViewport(shield);
      if (isOpen && overlay) clampToViewport(overlay);
      updateBadge();
    }, 150);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureMounted();
  });

  window.addEventListener("pageshow", () => {
    ensureMounted();
  });

  boot();
})();
