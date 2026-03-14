// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      2.9.6
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
    'use strict';
    if (window.__WAR_HUB_V285__) return;
    window.__WAR_HUB_V285__ = true;
    var BASE_URL = 'https://torn-war-bot.onrender.com';
    var K_API_KEY = 'warhub_api_key_v3';
var K_ADMIN_KEY = 'warhub_admin_key_v3';
var K_OWNER_TOKEN = 'warhub_owner_token_v3';
var K_SESSION = 'warhub_session_v3';
var K_OPEN = 'warhub_open_v3';
var K_TAB = 'warhub_tab_v3';
var K_SHIELD_POS = 'warhub_shield_pos_v3';
var K_OVERLAY_POS = 'warhub_overlay_pos_v3';
var K_REFRESH = 'warhub_refresh_ms_v3';
var K_NOTES = 'warhub_notes_v3';
var K_LOCAL_NOTIFICATIONS = 'warhub_local_notifications_v3';
var K_ACCESS_CACHE = 'warhub_access_cache_v3';
var K_OVERVIEW_BOXES = 'warhub_overview_boxes_v3';
    var factionMembersCache = null;
    var PAYMENT_PLAYER = 'Fries91';
    var PRICE_PER_MEMBER = 2500000;
    var TAB_ORDER = [
    ['overview', 'Overview'],
    ['faction', 'Faction'],
    ['war', 'War'],
    ['chain', 'Chain'],
    ['terms', 'Terms'],
    ['members', 'Members'],
    ['enemies', 'Enemies'],
    ['hospital', 'Hospital'],
    ['meddeals', 'Med Deals'],
    ['targets', 'Targets'],
    ['assignments', 'Assignments'],
    ['notes', 'Notes'],
    ['instructions', 'Instructions'],
    ['settings', 'Settings'],
    ['admin', 'Admin']
];
    var state = null;
    var analyticsCache = null;
    var overlay = null;
    var shield = null;
    var badge = null;
    var mounted = false;
    var dragMoved = false;
    var isOpen = !!GM_getValue(K_OPEN, false);
    var currentTab = GM_getValue(K_TAB, 'overview');
    if (currentTab === 'owner') currentTab = 'admin';
    var pollTimer = null;
    var remountTimer = null;
    var loadInFlight = false;
    var lastStatusMsg = '';
    var lastStatusErr = false;
    var accessState = normalizeAccessCache(GM_getValue(K_ACCESS_CACHE, null));
    var css = "\n    #warhub-shield {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      width: 42px !important;\n      height: 42px !important;\n      border-radius: 12px !important;\n      display: flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      font-size: 22px !important;\n      line-height: 1 !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n      color: #fff !important;\n      top: 120px !important;\n      right: 14px !important;\n      left: auto !important;\n      bottom: auto !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      pointer-events: auto !important;\n    }\n    #warhub-shield.dragging { cursor: grabbing !important; }\n\n    #warhub-badge {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      min-width: 16px !important;\n      height: 16px !important;\n      padding: 0 4px !important;\n      border-radius: 999px !important;\n      background: #ffd54a !important;\n      color: #111 !important;\n      font-size: 10px !important;\n      line-height: 16px !important;\n      text-align: center !important;\n      font-weight: 800 !important;\n      box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;\n      display: none !important;\n      pointer-events: none !important;\n    }\n\n    #warhub-overlay {\n      position: fixed !important;\n      z-index: 2147483646 !important;\n      right: 12px !important;\n      top: 170px !important;\n      width: min(96vw, 520px) !important;\n      height: min(88vh, 900px) !important;\n      max-height: 88vh !important;\n      min-height: 420px !important;\n      overflow: hidden !important;\n      border-radius: 14px !important;\n      background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n      color: #f2f2f2 !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n      display: none !important;\n      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n      left: auto !important;\n      bottom: auto !important;\n      flex-direction: column !important;\n      box-sizing: border-box !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n    }\n    #warhub-overlay.open { display: flex !important; }\n\n    #warhub-overlay *,\n    #warhub-overlay *::before,\n    #warhub-overlay *::after {\n      box-sizing: border-box !important;\n    }\n\n    .warhub-head {\n      padding: 10px 12px 9px !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      flex: 0 0 auto !important;\n      display: block !important;\n      width: 100% !important;\n      min-height: 54px !important;\n    }\n    .warhub-head.dragging { cursor: grabbing !important; }\n\n    .warhub-toprow {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 10px !important;\n      width: 100% !important;\n    }\n\n    .warhub-title {\n      font-weight: 800 !important;\n      font-size: 16px !important;\n      letter-spacing: .2px !important;\n      color: #fff !important;\n    }\n    .warhub-sub {\n      opacity: .72 !important;\n      font-size: 11px !important;\n      margin-top: 2px !important;\n      color: #fff !important;\n    }\n\n    .warhub-close {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 9px !important;\n      background: rgba(255,255,255,.08) !important;\n      color: #fff !important;\n      padding: 5px 9px !important;\n      font-weight: 700 !important;\n      cursor: pointer !important;\n      font-size: 12px !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n    }\n\n    .warhub-tabs {\n      display: flex !important;\n      flex: 0 0 auto !important;\n      flex-wrap: nowrap !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 8px !important;\n      overflow-x: auto !important;\n      overflow-y: hidden !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: rgba(255,255,255,.02) !important;\n      scrollbar-width: thin !important;\n      -webkit-overflow-scrolling: touch !important;\n      width: 100% !important;\n      min-height: 48px !important;\n      max-height: 48px !important;\n      white-space: nowrap !important;\n    }\n\n    .warhub-tab {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      color: #fff !important;\n      padding: 6px 10px !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n      white-space: nowrap !important;\n      cursor: pointer !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n      line-height: 1.1 !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      gap: 6px !important;\n    }\n    .warhub-tab.active {\n      background: linear-gradient(180deg, #d23333, #831515) !important;\n      color: #fff !important;\n    }\n    .warhub-tab.locked {\n      opacity: .55 !important;\n    }\n\n    .warhub-body {\n      padding: 8px !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      flex: 1 1 auto !important;\n      min-height: 0 !important;\n      width: 100% !important;\n      display: block !important;\n    }\n\n    .warhub-status {\n      display: none !important;\n      margin-bottom: 8px !important;\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      font-size: 12px !important;\n      background: rgba(255,255,255,.06) !important;\n      color: #fff !important;\n    }\n    .warhub-status.show { display: block !important; }\n    .warhub-status.err {\n      background: rgba(185,52,52,.22) !important;\n      color: #ffdcdc !important;\n    }\n\n    .warhub-banner {\n      margin-bottom: 8px !important;\n      padding: 10px 12px !important;\n      border-radius: 12px !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: rgba(255,255,255,.05) !important;\n      color: #fff !important;\n    }\n    .warhub-banner.payment {\n      background: linear-gradient(180deg, rgba(150,43,43,.38), rgba(72,19,19,.26)) !important;\n      border-color: rgba(255,130,130,.22) !important;\n    }\n    .warhub-banner.trial {\n      background: linear-gradient(180deg, rgba(164,116,25,.34), rgba(83,59,12,.22)) !important;\n      border-color: rgba(255,215,118,.22) !important;\n    }\n    .warhub-banner.good {\n      background: linear-gradient(180deg, rgba(35,140,82,.30), rgba(21,96,58,.20)) !important;\n      border-color: rgba(109,214,143,.18) !important;\n    }\n\n    .warhub-grid { display: grid !important; gap: 8px !important; }\n    .warhub-grid.two { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }\n    .warhub-grid.three { grid-template-columns: repeat(3, minmax(0,1fr)) !important; }\n\n    .warhub-card {\n      border: 1px solid rgba(255,255,255,.07) !important;\n      background: rgba(255,255,255,.03) !important;\n      border-radius: 12px !important;\n      padding: 10px !important;\n      margin-bottom: 8px !important;\n      overflow: hidden !important;\n      color: #fff !important;\n    }\n\n    .warhub-card h3 {\n      margin: 0 0 8px !important;\n      font-size: 13px !important;\n      font-weight: 800 !important;\n      letter-spacing: .2px !important;\n      color: #fff !important;\n    }\n\n    .warhub-section-title {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      margin-bottom: 8px !important;\n    }\n\n    .warhub-count {\n      padding: 4px 8px !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.08) !important;\n      font-size: 11px !important;\n      font-weight: 800 !important;\n      color: #fff !important;\n    }\n\n    .warhub-roster-card.hospital-box {\n      border-color: rgba(255,130,130,.16) !important;\n      background: linear-gradient(180deg, rgba(145,37,37,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-roster-card.online-box {\n      border-color: rgba(109,214,143,.16) !important;\n      background: linear-gradient(180deg, rgba(31,120,63,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-roster-card.idle-box {\n      border-color: rgba(255,215,118,.16) !important;\n      background: linear-gradient(180deg, rgba(145,114,27,.18), rgba(255,255,255,.03)) !important;\n    }\n\n  .warhub-roster-card.travel-box {border-color: rgba(90,160,255,.16) !important;background: linear-gradient(180deg, rgba(36,87,155,.18), rgba(255,255,255,.03)) !important} .warhub-roster-card.jail-box {border-color: rgba(183,120,255,.16) !important;background: linear-gradient(180deg, rgba(98,53,145,.18), rgba(255,255,255,.03)) !important;}  .warhub-roster-card.offline-box {\n      border-color: rgba(180,180,180,.12) !important;\n      background: linear-gradient(180deg, rgba(70,70,70,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-dropdown {\n      border: 1px solid rgba(255,255,255,.07) !important;\n      border-radius: 12px !important;\n      background: rgba(255,255,255,.03) !important;\n      margin-bottom: 8px !important;\n      overflow: hidden !important;\n    }\n\n    .warhub-dropdown summary {\n      list-style: none !important;\n      cursor: pointer !important;\n      padding: 10px !important;\n      user-select: none !important;\n      outline: none !important;\n    }\n\n    .warhub-dropdown summary::-webkit-details-marker {\n      display: none !important;\n    }\n\n    .warhub-dropdown-body {\n      padding: 0 10px 10px 10px !important;\n    }\n\n    .warhub-metric {\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.05) !important;\n      padding: 8px !important;\n      min-height: 54px !important;\n    }\n    .warhub-metric .k {\n      opacity: .7 !important;\n      font-size: 10px !important;\n      text-transform: uppercase !important;\n      letter-spacing: .45px !important;\n      color: #fff !important;\n    }\n    .warhub-metric .v {\n      font-size: 16px !important;\n      font-weight: 800 !important;\n      margin-top: 4px !important;\n      word-break: break-word !important;\n      color: #fff !important;\n    }\n\n    .warhub-score-us {\n      background: linear-gradient(180deg, rgba(31,120,63,.40), rgba(17,67,35,.28)) !important;\n      border: 1px solid rgba(109,214,143,.18) !important;\n    }\n    .warhub-score-them {\n      background: linear-gradient(180deg, rgba(145,37,37,.40), rgba(88,18,18,.28)) !important;\n      border: 1px solid rgba(255,130,130,.18) !important;\n    }\n    .warhub-score-lead {\n      background: linear-gradient(180deg, rgba(145,114,27,.38), rgba(97,72,13,.26)) !important;\n      border: 1px solid rgba(255,215,118,.18) !important;\n    }\n\n    .warhub-list { display: grid !important; gap: 6px !important; }\n\n    .warhub-list-item {\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.04) !important;\n      padding: 8px !important;\n      display: grid !important;\n      gap: 4px !important;\n      color: #fff !important;\n    }\n\n    .warhub-row {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      flex-wrap: wrap !important;\n    }\n\n    .warhub-name { font-weight: 700 !important; color: #fff !important; }\n    .warhub-meta { opacity: .76 !important; font-size: 11px !important; color: #fff !important; }\n    .warhub-empty { opacity: .75 !important; font-size: 12px !important; color: #fff !important; }\n    .warhub-actions { display: flex !important; gap: 6px !important; flex-wrap: wrap !important; }\n\n    .warhub-btn, .warhub-input, .warhub-select, .warhub-textarea {\n      font: inherit !important;\n      border-radius: 10px !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: rgba(255,255,255,.05) !important;\n      color: #fff !important;\n    }\n\n    .warhub-btn {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      padding: 7px 10px !important;\n      cursor: pointer !important;\n      font-size: 12px !important;\n      font-weight: 700 !important;\n      text-decoration: none !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n    }\n\n    .warhub-btn.primary { background: linear-gradient(180deg, #cc3737, #821616) !important; border-color: rgba(255,255,255,.12) !important; }\n    .warhub-btn.good { background: linear-gradient(180deg, #238c52, #15603a) !important; }\n    .warhub-btn.warn { background: linear-gradient(180deg, #af7b22, #775114) !important; }\n    .warhub-btn.small { padding: 5px 8px !important; font-size: 11px !important; }\n    .warhub-btn[disabled] { opacity: .45 !important; cursor: not-allowed !important; }\n\n    .warhub-input, .warhub-select, .warhub-textarea {\n      width: 100% !important;\n      padding: 8px 10px !important;\n      font-size: 12px !important;\n    }\n\n    .warhub-input[readonly] {\n      opacity: .9 !important;\n      background: rgba(255,255,255,.035) !important;\n    }\n\n    .warhub-textarea { min-height: 94px !important; resize: vertical !important; }\n\n    .warhub-label {\n      font-size: 11px !important;\n      opacity: .74 !important;\n      margin-bottom: 4px !important;\n      display: block !important;\n      color: #fff !important;\n    }\n\n    .warhub-pill {\n      display: inline-flex !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 4px 8px !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n    }\n    .warhub-pill.online { background: rgba(40,140,90,.20) !important; color: #b7ffd5 !important; }\n    .warhub-pill.idle { background: rgba(197,141,46,.22) !important; color: #ffe3a5 !important; }\n    .warhub-pill.offline { background: rgba(113,113,113,.20) !important; color: #dadada !important; }\n    .warhub-pill.hosp { background: rgba(181,62,62,.24) !important; color: #ffd0d0 !important; }\n  .warhub-pill.travel { background: rgba(53,110,190,.24) !important; color: #d5e7ff !important; } .warhub-pill.jail { background: rgba(110,68,175,.24) !important; color: #e5d8ff !important; } .warhub-pill.leader { background: rgba(66,110,185,.24) !important; color: #d3e3ff !important; }\n    .warhub-pill.enabled { background: rgba(35,140,82,.22) !important; color: #b7ffd5 !important; }\n    .warhub-pill.disabled { background: rgba(145,37,37,.24) !important; color: #ffd0d0 !important; }\n\n    .warhub-divider {\n      height: 1px !important;\n      background: rgba(255,255,255,.07) !important;\n      margin: 8px 0 !important;\n    }\n\n    .warhub-mini { font-size: 11px !important; opacity: .78 !important; color: #fff !important; }\n    .warhub-link { color: #fff !important; text-decoration: none !important; }\n\n    .warhub-section-scroll {\n      max-height: 52vh !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      padding-right: 2px !important;\n    }\n\n    .warhub-payment-line {\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.06) !important;\n      font-weight: 800 !important;\n      text-align: center !important;\n      margin-top: 8px !important;\n    }\n\n    @media (max-width: 700px) {\n      #warhub-overlay {\n        width: 98vw !important;\n        height: 88vh !important;\n        min-height: 360px !important;\n        top: 56px !important;\n        left: 1vw !important;\n        right: 1vw !important;\n        border-radius: 12px !important;\n      }\n      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr !important; }\n      .warhub-body { padding-bottom: 18px !important; }\n      #warhub-shield {\n        width: 40px !important;\n        height: 40px !important;\n        font-size: 21px !important;\n      }\n      .warhub-section-scroll { max-height: 34vh !important; }\n      .warhub-tabs {\n        min-height: 44px !important;\n        max-height: 44px !important;\n      }\n    }\n  ";
    GM_addStyle(css);
    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtNum(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n.toLocaleString() : '—';
    }
    function fmtMoney(v) {
        var n = Number(v);
        return Number.isFinite(n) ? "$".concat(n.toLocaleString()) : '—';
    }
    function fmtHosp(v, txt) {
        if (txt) return txt;
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? "".concat(n, "s") : '—';
    }
    function fmtTs(v) {
        if (!v) return '—';
        try {
            var d = new Date(v);
            if (Number.isNaN(d.getTime())) return String(v);
            return d.toLocaleString();
        } catch (_unused) {
            return String(v);
        }
    }
    function fmtDaysLeftFromIso(v) {
        if (!v) return null;
        try {
            var ms = new Date(v).getTime() - Date.now();
            if (!Number.isFinite(ms)) return null;
            return Math.ceil(ms / 86400000);
        } catch (_unused2) {
            return null;
        }
    }
    function arr(v) {
        return Array.isArray(v) ? v : [];
    }
    function cleanInputValue(v) {
        return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().replace(/^['"]+|['"]+$/g, '').trim();
    }
    function getNotes() {
        return String(GM_getValue(K_NOTES, '') || '');
    }
    function setNotes(v) {
        GM_setValue(K_NOTES, String(v || ''));
    }
    function getLocalNotifications() {
        return arr(GM_getValue(K_LOCAL_NOTIFICATIONS, []));
    }
    function setLocalNotifications(v) {
        GM_setValue(K_LOCAL_NOTIFICATIONS, arr(v));
    }
    function mergedNotifications() {
        return [].concat(_toConsumableArray(arr(state && state.notifications)), _toConsumableArray(getLocalNotifications())).slice(0, 50);
    }
    function unreadCount() {
        return mergedNotifications().length;
    }
    function setStatus(msg) {
        var isErr = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
        lastStatusMsg = String(msg || '');
        lastStatusErr = !!isErr;
        var box = overlay ? overlay.querySelector('#warhub-status') : null;
        if (!box) return;
        if (!msg) {
            box.className = 'warhub-status';
            box.textContent = '';
            return;
        }
        box.className = "warhub-status show ".concat(isErr ? 'err' : '').trim();
        box.textContent = msg;
    }
    function restoreStatus() {
        if (lastStatusMsg) setStatus(lastStatusMsg, lastStatusErr);
    }
    function normalizeAccessCache(raw) {
        var a = raw && _typeof(raw) === 'object' ? raw : {};
        return {
            loggedIn: !!a.loggedIn,
            blocked: !!a.blocked,
            paymentRequired: !!a.paymentRequired,
            trialActive: !!a.trialActive,
            trialExpired: !!a.trialExpired,
            expiresAt: a.expiresAt || '',
            daysLeft: Number.isFinite(Number(a.daysLeft)) ? Number(a.daysLeft) : null,
            reason: a.reason || '',
            message: a.message || '',
            source: a.source || '',
            lastSeenAt: a.lastSeenAt || '',
            factionId: a.factionId || '',
            factionName: a.factionName || '',
            isFactionLeader: !!a.isFactionLeader,
            memberEnabled: !!a.memberEnabled,
            pricePerMember: Number.isFinite(Number(a.pricePerMember)) ? Number(a.pricePerMember) : PRICE_PER_MEMBER,
            paymentPlayer: a.paymentPlayer || PAYMENT_PLAYER,
            isOwner: !!a.isOwner
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
        if (!accessState) return '';
        var paymentPlayer = accessState.paymentPlayer || PAYMENT_PLAYER;
        var ppm = accessState.pricePerMember || PRICE_PER_MEMBER;
        if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
            return accessState.message || accessState.reason || "Faction access locked. Payment goes to ".concat(paymentPlayer, ".");
        }
        if (accessState.trialActive) {
            if (accessState.daysLeft != null) {
                if (accessState.daysLeft <= 0) return "Faction trial ends today. Billing is ".concat(fmtMoney(ppm), " per enabled member.");
                return "Faction trial active. ".concat(accessState.daysLeft, " day").concat(accessState.daysLeft === 1 ? '' : 's', " left.");
            }
            if (accessState.expiresAt) return "Faction trial active until ".concat(fmtTs(accessState.expiresAt), ".");
            return 'Faction trial active.';
        }
        return '';
    }
    function isOwnerSession() {
        return !!((accessState === null || accessState === void 0 ? void 0 : accessState.isOwner) || (state === null || state === void 0 ? void 0 : state.me) && state.me.is_owner || (state === null || state === void 0 ? void 0 : state.user) && state.user.is_owner || (state === null || state === void 0 ? void 0 : state.owner) && state.owner.is_owner);
    }
    function getAccessInfo(payload, httpStatus) {
        var d = payload && _typeof(payload) === 'object' ? payload : {};
        var access = d.access && _typeof(d.access) === 'object' ? d.access : {};
        var payment = d.payment && _typeof(d.payment) === 'object' ? d.payment : {};
        var factionAccess = d.faction_access && _typeof(d.faction_access) === 'object' ? d.faction_access : {};
        var memberAccess = d.member_access && _typeof(d.member_access) === 'object' ? d.member_access : {};
        var paymentRequired = !!d.payment_required || !!d.requires_payment || !!d.paymentRequired || !!access.payment_required || !!access.requires_payment || !!access.paymentRequired;
        var blocked = !!d.blocked || !!d.access_blocked || !!d.locked || !!d.denied || !!access.blocked || !!access.access_blocked || !!access.locked || !!access.denied || paymentRequired;
        var expiresAt = d.trial_expires_at || d.trialEndsAt || d.expires_at || access.trial_expires_at || access.trialEndsAt || access.expires_at || '';
        var explicitDaysLeft = d.trial_days_left != null ? d.trial_days_left : d.days_left != null ? d.days_left : access.trial_days_left != null ? access.trial_days_left : access.days_left != null ? access.days_left : null;
        var computedDaysLeft = explicitDaysLeft != null ? Number(explicitDaysLeft) : fmtDaysLeftFromIso(expiresAt);
        var trialExpired = !!d.trial_expired || !!d.expired || !!access.trial_expired || !!access.expired || computedDaysLeft != null && computedDaysLeft < 0 && !paymentRequired ? true : false;
        var trialActive = !!d.trial_active || !!access.trial_active || computedDaysLeft != null && computedDaysLeft >= 0 && !paymentRequired && !trialExpired;
        var accessStatus = String(d.access_status || d.status || access.status || access.access_status || '').toLowerCase();
        var reason = d.reason || d.block_reason || d.error || access.reason || access.block_reason || memberAccess.reason || '';
        var message = d.message || d.notice || d.details || access.message || access.notice || payment.message || '';
        var finalBlocked = blocked;
        var finalPaymentRequired = paymentRequired;
        var finalTrialExpired = trialExpired;
        if (accessStatus.includes('payment')) {
            finalBlocked = true;
            finalPaymentRequired = true;
            finalTrialExpired = true;
        } else if (accessStatus.includes('expired')) {
            finalBlocked = true;
            finalTrialExpired = true;
        } else if (accessStatus.includes('blocked') || accessStatus.includes('locked') || accessStatus.includes('denied')) {
            finalBlocked = true;
        }
        if ((httpStatus === 402 || httpStatus === 403) && !message) {
            message = "Faction access blocked. Payment goes to ".concat(payment.required_player || PAYMENT_PLAYER, ".");
        }
        if (finalPaymentRequired && !message) {
            message = "Faction payment required. Payment goes to ".concat(payment.required_player || PAYMENT_PLAYER, ".");
        } else if (finalBlocked && !message) {
            message = reason || 'Faction access locked.';
        }
        return {
            loggedIn: false,
            blocked: finalBlocked,
            paymentRequired: finalPaymentRequired,
            trialActive: !!trialActive && !finalBlocked,
            trialExpired: finalTrialExpired || finalPaymentRequired,
            expiresAt: expiresAt || '',
            daysLeft: Number.isFinite(computedDaysLeft) ? computedDaysLeft : null,
            reason: String(reason || ''),
            message: String(message || ''),
            source: String(accessStatus || ''),
            lastSeenAt: new Date().toISOString(),
            factionId: d.faction_id || (d.faction && d.faction.id) || (d.me && d.me.faction_id) || '',
            factionName: d.faction_name || (d.faction && d.faction.name) || (d.me && d.me.faction_name) || '',
            isFactionLeader: !!d.is_faction_leader || !!factionAccess.is_faction_leader || !!(d.me && d.me.is_faction_leader),
            memberEnabled: !!memberAccess.enabled || !!factionAccess.member_enabled || !!memberAccess.allowed,
            pricePerMember: Number(payment.price_per_enabled_member || payment.price_per_member || PRICE_PER_MEMBER) || PRICE_PER_MEMBER,
            paymentPlayer: String(payment.required_player || PAYMENT_PLAYER),
            isOwner: !!d.is_owner || !!(d.user && d.user.is_owner) || !!(d.me && d.me.is_owner) || !!(d.owner && d.owner.is_owner) || !!factionAccess.is_owner
        };
    }
    function updateAccessFromPayload(payload, httpStatus, loggedInHint) {
    var next = getAccessInfo(payload, httpStatus);
    if (loggedInHint === true && !next.blocked) next.loggedIn = true;
    if (loggedInHint === false) next.loggedIn = false;

    if (next.blocked || next.paymentRequired || next.trialExpired) {
        accessState = next;
        clearBlockedCredentials();
        saveAccessCache();
        return next;
    }

    if (next.trialActive || next.expiresAt || next.daysLeft != null || next.factionId || next.isFactionLeader) {
        accessState = _objectSpread(
            _objectSpread(
                _objectSpread({}, accessState),
                next
            ),
            {},
            {
                loggedIn: loggedInHint === true ? true : accessState.loggedIn,
                blocked: false,
                paymentRequired: false,
                trialExpired: false,
                expiresAt: next.expiresAt,
                daysLeft: next.daysLeft,
                reason: next.reason,
                message: next.message,
                source: next.source,
                lastSeenAt: next.lastSeenAt,
                isOwner: next.isOwner
            }
        );
        saveAccessCache();
        return accessState;
    }

    if (loggedInHint === true) {
        accessState = _objectSpread(_objectSpread({}, accessState), {}, {
            loggedIn: true,
            blocked: false,
            paymentRequired: false,
            trialExpired: false,
            lastSeenAt: new Date().toISOString(),
            isOwner: !!next.isOwner || !!accessState.isOwner
        });
        saveAccessCache();
    }

    return accessState;
}
    function canUseProtectedFeatures() {
        if (isOwnerSession()) return true;
        return !(accessState !== null && accessState !== void 0 && accessState.blocked || accessState !== null && accessState !== void 0 && accessState.paymentRequired || accessState !== null && accessState !== void 0 && accessState.trialExpired);
    }
    function ensureAllowedOrMessage() {
        if (canUseProtectedFeatures()) return true;
        setStatus(accessSummaryMessage() || 'Faction access locked.', true);
        renderBody();
        return false;
    }
    function gmXhr(method, path, body, extraHeaders) {
        return new Promise(function (resolve) {
            var token = cleanInputValue(GM_getValue(K_SESSION, ''));
            var url = "".concat(BASE_URL).concat(path);
            var headers = _objectSpread({
                Accept: 'application/json'
            }, extraHeaders || {});
            if (token) headers['X-Session-Token'] = token;
            if (body != null) headers['Content-Type'] = 'application/json';
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: headers,
                data: body != null ? JSON.stringify(body) : undefined,
                timeout: 60000,
                onload: function onload(res) {
                    var json = null;
                    try {
                        json = JSON.parse(res.responseText || '{}');
                    } catch (_unused3) {}
                    resolve({
                        ok: res.status >= 200 && res.status < 300 && (!json || json.ok !== false),
                        status: res.status,
                        data: json,
                        error: (json === null || json === void 0 ? void 0 : json.error) || (json === null || json === void 0 ? void 0 : json.details) || (res.status >= 400 ? "HTTP ".concat(res.status) : 'Request failed')
                    });
                },
                onerror: function onerror() {
                    return resolve({
                        ok: false,
                        status: 0,
                        data: null,
                        error: "Network error: ".concat(method, " ").concat(path)
                    });
                },
                ontimeout: function ontimeout() {
                    return resolve({
                        ok: false,
                        status: 0,
                        data: null,
                        error: "Request timed out: ".concat(method, " ").concat(path)
                    });
                }
            });
        });
    }
    
function whGetOwnFactionId() {
    try {
        return String((state && state.faction && (state.faction.faction_id || state.faction.id)) || '').trim();
    } catch (e) {
        return '';
    }
}

function whSaveWarPairFallback(data) {
    try {
        GM_setValue('war_pair_fallback_v1', JSON.stringify({
            enemy_faction_id: String(data.enemy_faction_id || ''),
            enemy_faction_name: String(data.enemy_faction_name || ''),
            saved_at: Date.now()
        }));
    } catch (e) {}
}

function whLoadWarPairFallback() {
    try {
        var raw = GM_getValue('war_pair_fallback_v1', '');
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !obj.enemy_faction_id) return null;
        return obj;
    } catch (e) {
        return null;
    }
}

function whDetectWarPairFromFactionPage() {
    try {
        var href = String(location.href || '');
        if (href.indexOf('factions.php?step=your&type=1') === -1) return null;

        var ownFactionId = whGetOwnFactionId();
        var links = Array.prototype.slice.call(document.querySelectorAll('a[href*="factions.php"]'));
        var found = [];

        links.forEach(function (a) {
            var url = String(a.getAttribute('href') || '');
            var text = String((a.textContent || '').trim());

            var m = url.match(/(?:ID|id|XID|factionID)=([0-9]+)/);
            if (!m) return;

            var factionId = String(m[1] || '').trim();
            if (!factionId) return;
            if (ownFactionId && factionId === ownFactionId) return;

            found.push({
                faction_id: factionId,
                faction_name: text || ('Faction ' + factionId)
            });
        });

        var unique = [];
        var seen = {};
        found.forEach(function (x) {
            if (!x.faction_id || seen[x.faction_id]) return;
            seen[x.faction_id] = true;
            unique.push(x);
        });

        if (!unique.length) return null;

        var enemy = unique[0];
        whSaveWarPairFallback({
            enemy_faction_id: enemy.faction_id,
            enemy_faction_name: enemy.faction_name
        });

        return enemy;
    } catch (e) {
        return null;
    }
}
    function healthCheck() {
        return _healthCheck.apply(this, arguments);
    }
    function _healthCheck() {
        _healthCheck = _asyncToGenerator(function* () {
            return gmXhr('GET', '/health');
        });
        return _healthCheck.apply(this, arguments);
    }
    function login() {
        return _login.apply(this, arguments);
    }
    function _login() {
        _login = _asyncToGenerator(function* () {
            var showDebug = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
            var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
            if (!apiKey) return false;
            if (showDebug) setStatus('Trying login with saved API key...');
            var res = yield gmXhr('POST', '/api/auth', {
                api_key: apiKey
            });
            updateAccessFromPayload(res.data, res.status, false);
            if (!res.ok) {
                if ((accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired)) {
                    setStatus(accessSummaryMessage() || 'Faction access blocked.', true);
                    renderBody();
                    return false;
                }
                setStatus(res.error || 'Login failed.', true);
                return false;
            }
            var token = (res.data === null || res.data === void 0 ? void 0 : res.data.token) || (res.data === null || res.data === void 0 ? void 0 : res.data.session_token) || (res.data === null || res.data === void 0 ? void 0 : res.data.session);
            if (token) {
                GM_setValue(K_SESSION, cleanInputValue(token));
                updateAccessFromPayload(res.data, res.status, true);
                return true;
            }
            if ((accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired)) {
                setStatus(accessSummaryMessage() || 'Faction access blocked.', true);
                renderBody();
                return false;
            }
            setStatus('Login failed.', true);
            return false;
        });
        return _login.apply(this, arguments);
    }

     function req(method, path, body) {
        return _req.apply(this, arguments);
    }
    function _req() {
        _req = _asyncToGenerator(function* (method, path, body) {
            if (!canUseProtectedFeatures() && path !== '/health' && path !== '/api/auth') {
                return {
                    ok: false,
                    status: 403,
                    data: {
                        ok: false,
                        payment_required: true,
                        message: accessSummaryMessage() || 'Faction access blocked.'
                    },
                    error: accessSummaryMessage() || 'Faction access blocked.'
                };
            }
            var res = yield gmXhr(method, path, body);
            updateAccessFromPayload(res.data, res.status, !!cleanInputValue(GM_getValue(K_SESSION, '')));
            if ((accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired)) {
                return {
                    ok: false,
                    status: res.status || 403,
                    data: res.data,
                    error: accessSummaryMessage() || res.error || 'Faction access blocked.'
                };
            }
            if (!res.ok && (res.status === 401 || res.status === 403)) {
                var okLogin = yield login(false);
                if (okLogin) {
                    res = yield gmXhr(method, path, body);
                    updateAccessFromPayload(res.data, res.status, true);
                }
            }
            return res;
        });
        return _req.apply(this, arguments);
    }
    function adminReq(method, path, body) {
        return _adminReq.apply(this, arguments);
    }
    function _adminReq() {
        _adminReq = _asyncToGenerator(function* (method, path, body) {
            if (!isOwnerSession()) {
                return {
                    ok: false,
                    status: 403,
                    data: null,
                    error: 'Admin access required.'
                };
            }
            return req(method, path, body);
        });
        return _adminReq.apply(this, arguments);
    }
    function normalizeState(data) {
    var s = data || {};
    var me = s.me || s.user || {};
    var war = Object.assign({}, s.war || s.war_info || {});
    if (war.active == null) war.active = !!(s.has_war || war.war_id || war.id);

    var faction = s.faction || s.my_faction || s.ourFaction || {};
    var enemyFactionRaw = s.enemy_faction || s.enemyFaction || {};
    var warPairFallback = whLoadWarPairFallback() || {};

    var members = arr(s.members || s.member_list || []);
    var enemies = arr(s.enemies || s.enemy_members || war.enemy_members || []);
    var medDeals = arr(s.med_deals || s.medDeals || []);
    var dibs = arr(s.dibs || []);
    var assignments = arr(s.assignments || []);
    var notes = arr(s.notes || []);
    var notifications = arr(s.notifications || []);
    var bounties = arr(s.bounties || []);
    var targets = arr(s.targets || []);
    var terms = s.war_terms || s.terms || {};
    var medDealsMessage = String(s.med_deals_message || s.medDealsMessage || '');

    var ownFactionId = String((faction && (faction.faction_id || faction.id)) || '').trim();
    var ownFactionName = String((faction && faction.name) || '').trim().toLowerCase();

    var enemyFactionId = String(
        enemyFactionRaw.faction_id ||
        enemyFactionRaw.id ||
        s.enemy_faction_id ||
        war.enemy_faction_id ||
        war.opponent_faction_id ||
        warPairFallback.enemy_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        enemyFactionRaw.name ||
        s.enemy_faction_name ||
        war.enemy_faction_name ||
        war.opponent_faction_name ||
        warPairFallback.enemy_faction_name ||
        ''
    ).trim();

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = String(warPairFallback.enemy_faction_id || '').trim();
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionName = String(warPairFallback.enemy_faction_name || '').trim();
    }

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionName = '';
    }

    var enemyFaction = Object.assign({}, enemyFactionRaw, {
        id: enemyFactionId || '',
        faction_id: enemyFactionId || '',
        name: enemyFactionName || 'Enemy Faction',
        score: Number(
            (enemyFactionRaw && enemyFactionRaw.score) ||
            s.enemy_score ||
            war.score_them ||
            0
        ) || 0,
        chain: Number(
            (enemyFactionRaw && enemyFactionRaw.chain) ||
            war.chain_them ||
            0
        ) || 0
    });

    var hasWar = !!(
        s.has_war ||
        s.is_ranked_war ||
        war.active ||
        war.registered ||
        war.war_id ||
        war.id ||
        enemyFactionId ||
        enemies.length
    );

    return {
        user: s.user || {},
        me: me,
        war: war,
        faction: faction,
        ourFaction: faction,
        enemyFaction: enemyFaction,
        enemy_faction: enemyFaction,
        enemy_faction_id: enemyFactionId || '',
        enemy_faction_name: enemyFactionName || '',
        members: members,
        enemies: enemies,
        medDeals: medDeals,
        med_deals: medDeals,
        med_deals_message: medDealsMessage,
        medDealsMessage: medDealsMessage,
        dibs: dibs,
        assignments: assignments,
        notes: notes,
        terms: terms,
        war_terms: terms,
        notifications: notifications,
        bounties: bounties,
        targets: targets,
        settings: s.settings || {},
        score: s.score || {
            our: Number(war.score_us || faction.score || 0) || 0,
            enemy: Number(war.score_them || enemyFaction.score || 0) || 0,
            target: Number(war.target_score || war.target || 0) || 0
        },
        has_war: hasWar,
        is_ranked_war: !!(s.is_ranked_war || hasWar),
        license: s.license || {}
    };
}
    function loadState() {
        return _loadState.apply(this, arguments);
    }
    function _loadState() {
        _loadState = _asyncToGenerator(function* () {
            var silent = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
            if (loadInFlight) return;
            if (!canUseProtectedFeatures()) {
                if (!silent) setStatus(accessSummaryMessage() || 'Faction access blocked.', true);
                renderBody();
                return;
            }
            loadInFlight = true;
            try {
                var res = yield req('GET', '/api/state');
                if (!res.ok) {
                    if (!silent) setStatus(res.error || 'Could not load state.', true);
                    if ((accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired)) renderBody();
                    return;
                }
                whDetectWarPairFromFactionPage();
state = normalizeState(res.data || {});
                if ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) && !factionMembersCache) loadFactionMembers()["catch"](function () {
                    return null;
                });
                if (!silent) setStatus('');
                if (overlay && isOpen) renderBody();
                updateBadge();
                if (overlay && isOpen && currentTab === 'admin' && isOwnerSession()) loadAdminDashboard()["catch"](function () {
                    return null;
                });
            } finally {
                loadInFlight = false;
            }
        });
        return _loadState.apply(this, arguments);
    }
    function loadAnalytics() {
        return _loadAnalytics.apply(this, arguments);
    }
    function _loadAnalytics() {
        _loadAnalytics = _asyncToGenerator(function* () {
            analyticsCache = analyticsCache || {};
            return analyticsCache;
        });
        return _loadAnalytics.apply(this, arguments);
    }
    function loadFactionMembers() {
        return _loadFactionMembers.apply(this, arguments);
    }
    function _loadFactionMembers() {
        _loadFactionMembers = _asyncToGenerator(function* () {
            var force = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
            if (!(accessState !== null && accessState !== void 0 && accessState.isFactionLeader) && !isOwnerSession()) {
                factionMembersCache = null;
                return null;
            }
            if (factionMembersCache && !force) return factionMembersCache;
            var res = yield req('GET', '/api/faction/members');
            if (!res.ok) {
                setStatus(res.error || 'Could not load faction member access.', true);
                return null;
            }
            factionMembersCache = _objectSpread(_objectSpread({}, res.data || {}), {}, {
                members: arr((res.data === null || res.data === void 0 ? void 0 : res.data.items) || (res.data === null || res.data === void 0 ? void 0 : res.data.members) || [])
            });
            return factionMembersCache;
        });
        return _loadFactionMembers.apply(this, arguments);
    }
    function refreshLeaderFactionData() {
        return _refreshLeaderFactionData.apply(this, arguments);
    }
    function _refreshLeaderFactionData() {
        _refreshLeaderFactionData = _asyncToGenerator(function* () {
            if (!(accessState !== null && accessState !== void 0 && accessState.isFactionLeader) && !isOwnerSession()) return;
            yield loadFactionMembers(true);
            yield loadState(true);
            renderBody();
        });
        return _refreshLeaderFactionData.apply(this, arguments);
    }
    function doAction(method, path, body, okMsg) {
        return _doAction.apply(this, arguments);
    }
    function _doAction() {
        _doAction = _asyncToGenerator(function* (method, path, body, okMsg) {
            var reload = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : true;
            if (!ensureAllowedOrMessage()) return null;
            var res = yield req(method, path, body);
            if (!res.ok) {
                setStatus(res.error || 'Action failed.', true);
                return null;
            }
            if (okMsg) setStatus(okMsg);
            if (reload) yield loadState(true);
            return res;
        });
        return _doAction.apply(this, arguments);
    }
    function getHospSeconds(x) {
        return Number((x === null || x === void 0 ? void 0 : x.hospital_seconds) || (x === null || x === void 0 ? void 0 : x.hosp_time) || (x === null || x === void 0 ? void 0 : x.hospital_time) || (x === null || x === void 0 ? void 0 : x.status) && x.status.until || 0) || 0;
    }
    function getPresenceState(x) {
    var hosp = getHospSeconds(x);
    if (hosp > 0) return 'hospital';

    var raw = String(
        (x === null || x === void 0 ? void 0 : x.online_state) ||
        (x === null || x === void 0 ? void 0 : x.online_status) ||
        (x === null || x === void 0 ? void 0 : x.status_class) ||
        (x === null || x === void 0 ? void 0 : x.activity_bucket) ||
        (x === null || x === void 0 ? void 0 : x.status) ||
        (x === null || x === void 0 ? void 0 : x.display_status) ||
        (x === null || x === void 0 ? void 0 : x.last_action) ||
        ''
    ).toLowerCase();

    if (
        raw.includes('hospital') ||
        raw.includes('rehab')
    ) return 'hospital';

    if (
        raw.includes('jail') ||
        raw.includes('jailed')
    ) return 'jail';

    if (
        raw.includes('travel') ||
        raw.includes('travelling') ||
        raw.includes('traveling') ||
        raw.includes('abroad') ||
        raw.includes('flying')
    ) return 'travel';

    if (
        raw.includes('online') ||
        raw === 'okay'
    ) return 'online';

    if (raw.includes('idle')) return 'idle';

    return 'offline';
}
    function sortHosp(list) {
        return [].concat(_toConsumableArray(arr(list))).sort(function (a, b) {
            return getHospSeconds(a) - getHospSeconds(b);
        });
    }
    function sortAlphabetical(list) {
        return [].concat(_toConsumableArray(arr(list))).sort(function (a, b) {
            var an = String((a === null || a === void 0 ? void 0 : a.name) || (a === null || a === void 0 ? void 0 : a.player_name) || (a === null || a === void 0 ? void 0 : a.member_name) || '').toLowerCase();
            var bn = String((b === null || b === void 0 ? void 0 : b.name) || (b === null || b === void 0 ? void 0 : b.player_name) || (b === null || b === void 0 ? void 0 : b.member_name) || '').toLowerCase();
            return an.localeCompare(bn);
        });
    }
    function sortRosterGroup(list, type) {
        if (type === 'hospital') return sortHosp(list);
        return sortAlphabetical(list);
    }
    function splitRosterGroups(list) {
    var hospital = [];
    var online = [];
    var idle = [];
    var travel = [];
    var jail = [];
    var offline = [];

    arr(list).forEach(function (x) {
        var stateName = getPresenceState(x);

        if (stateName === 'hospital') {
            hospital.push(x);
        } else if (stateName === 'online') {
            online.push(x);
        } else if (stateName === 'idle') {
            idle.push(x);
        } else if (stateName === 'travel') {
            travel.push(x);
        } else if (stateName === 'jail') {
            jail.push(x);
        } else {
            offline.push(x);
        }
    });

    return {
        hospital: sortRosterGroup(hospital, 'hospital'),
        online: sortRosterGroup(online, 'online'),
        idle: sortRosterGroup(idle, 'idle'),
        travel: sortRosterGroup(travel, 'travel'),
        jail: sortRosterGroup(jail, 'jail'),
        offline: sortRosterGroup(offline, 'offline')
    };
}

    function getActiveDibs() {
    return arr((state === null || state === void 0 ? void 0 : state.dibs) || []);
}

    function getOverviewBoxPrefs() {
    var saved = GM_getValue(K_OVERVIEW_BOXES, null);
    var defaults = {
        meddeals: true,
        dibs: true,
        terms: true,
        war: true
    };

    if (!saved || typeof saved !== 'object') return defaults;

    return {
        meddeals: saved.meddeals !== false,
        dibs: saved.dibs !== false,
        terms: saved.terms !== false,
        war: saved.war !== false
    };
}
    
function getMyUserId() {
    return String(
        ((state === null || state === void 0 ? void 0 : state.me) && (
            (state === null || state === void 0 ? void 0 : state.me.user_id) ||
            (state === null || state === void 0 ? void 0 : state.me.id) ||
            (state === null || state === void 0 ? void 0 : state.me.player_id)
        )) ||
        ((state === null || state === void 0 ? void 0 : state.user) && (
            (state === null || state === void 0 ? void 0 : state.user.user_id) ||
            (state === null || state === void 0 ? void 0 : state.user.id) ||
            (state === null || state === void 0 ? void 0 : state.user.player_id)
        )) ||
        ''
    );
}

function getMyUserName() {
    return String(
        ((state === null || state === void 0 ? void 0 : state.me) && (
            (state === null || state === void 0 ? void 0 : state.me.name) ||
            (state === null || state === void 0 ? void 0 : state.me.player_name)
        )) ||
        ((state === null || state === void 0 ? void 0 : state.user) && (
            (state === null || state === void 0 ? void 0 : state.user.name) ||
            (state === null || state === void 0 ? void 0 : state.user.player_name)
        )) ||
        'You'
    );
}

function findDibsForTarget(targetId) {
    var id = String(targetId || '');
    return getActiveDibs().find(function (d) {
        return String(d.target_id || d.enemy_id || d.user_id || '') === id;
    }) || null;
}

function isDibsCooldownActive(dib) {
    if (!dib) return false;
    var until = dib.cooldown_until || dib.available_again_at || dib.locked_until || '';
    if (!until) return false;
    var ts = new Date(until).getTime();
    return Number.isFinite(ts) && ts > Date.now();
}

function filterHospitalEnemiesForTab(list) {
    return arr(list).filter(function (x) {
        var id = String(x.user_id || x.id || x.player_id || '');
        var dib = findDibsForTarget(id);
        if (!dib) return true;
        if (isDibsCooldownActive(dib)) return false;
        if (String(dib.status || '').toLowerCase() === 'active') return false;
        return true;
    });
}

function renderDibsOverviewCard() {
    var myId = getMyUserId();
    var myDibs = getActiveDibs().filter(function (d) {
        return String(d.assigned_to_user_id || d.user_id || '') === myId;
    });

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Dibs Overview</h3>\
          <span class="warhub-count">' + fmtNum(myDibs.length) + '</span>\
        </div>\
        <div class="warhub-list">' +
          (myDibs.length ? myDibs.map(function (d) {
            var name = d.target_name || d.enemy_name || ('ID ' + (d.target_id || d.enemy_id || '—'));
            var status = d.status || 'active';
            var until = d.cooldown_until || d.available_again_at || '';
            var extra = isDibsCooldownActive(d) ? ('Available again ' + fmtTs(until)) : status;
            return '\
              <div class="warhub-list-item">\
                <div class="warhub-row">\
                  <div>\
                    <div class="warhub-name">' + esc(name) + '</div>\
                    <div class="warhub-meta">' + esc(extra) + '</div>\
                  </div>\
                </div>\
              </div>';
          }).join('') : '<div class="warhub-empty">No dibs claimed.</div>') +
        '</div>\
      </div>';
}

function hospitalMemberRow(x, enemy) {
    if (enemy === void 0) enemy = false;

    var id = x.user_id || x.id || x.player_id || x.member_user_id || '';
    var name = x.name || x.player_name || x.member_name || ("ID " + id);
    var hosp = getHospSeconds(x);
    var hospText = x.hospital_text || '';
    var level = x.level ? ("Lvl " + x.level) : '';
    var last = x.last_action || x.last_action_relative || x.last || '—';

    var lifeCur = Number(x.life_current || x.current_life || x.life || 0);
    var lifeMax = Number(x.life_max || x.maximum_life || x.max_life || 0);
    var lifeText = lifeMax > 0 ? (lifeCur.toLocaleString() + "/" + lifeMax.toLocaleString()) : '—';

    var energyCur = Number(x.energy_current || x.energy || x.energy_now || 0);
    var energyMax = Number(x.energy_max || x.max_energy || 150);
    var energyText = energyMax > 0 ? (energyCur.toLocaleString() + "/" + energyMax.toLocaleString()) : '—';

    var dib = enemy ? findDibsForTarget(id) : null;
    var dibMine = dib && String(dib.assigned_to_user_id || '') === getMyUserId();
    var dibCooldown = dib && isDibsCooldownActive(dib);
    var dibTaken = dib && !dibCooldown && !dibMine && String(dib.status || '').toLowerCase() === 'active';

    var dibButton = '';
    if (enemy) {
        if (dibMine) {
            dibButton = '<button class="warhub-btn small good" disabled>My Dibs</button>';
        } else if (dibTaken) {
            dibButton = '<button class="warhub-btn small" disabled>Taken</button>';
        } else if (dibCooldown) {
            dibButton = '<button class="warhub-btn small" disabled>Cooldown</button>';
        } else {
            dibButton = '<button class="warhub-btn small warn warhub-dibs-btn" data-target-id="' + esc(String(id)) + '" data-target-name="' + esc(name) + '">Dibs</button>';
        }
    }

    return '\
      <div class="warhub-list-item">\
        <div class="warhub-row">\
          <div>\
            <div class="warhub-name">' + esc(name) + '</div>\
            <div class="warhub-meta">' + esc([level, last].filter(Boolean).join(' • ')) + '</div>\
            <div class="warhub-meta">' + esc(['Hosp ' + fmtHosp(hosp, hospText), 'Life ' + lifeText, 'Energy ' + energyText].join(' • ')) + '</div>\
          </div>\
          <div class="warhub-actions">\
            <span class="warhub-pill hosp">Hosp ' + esc(fmtHosp(hosp, hospText)) + '</span>\
            ' + dibButton + '\
          </div>\
        </div>\
      </div>';
}
    
    function memberRow(x, enemy) {
    if (enemy === void 0) enemy = false;

    var id = x.user_id || x.id || x.player_id || x.member_user_id || '';
    var name = x.name || x.player_name || x.member_name || ("ID " + id);

    var presence = getPresenceState(x);
    var hosp = getHospSeconds(x);
    var hospText = x.hospital_text || '';
    var last = x.last_action || x.last_action_relative || x.last || '—';
    var level = x.level ? ("Lvl " + x.level) : '';

    var lifeCur = Number(
        x.life_current ||
        x.current_life ||
        x.life ||
        0
    );

    var lifeMax = Number(
        x.life_max ||
        x.maximum_life ||
        x.max_life ||
        0
    );

    var lifeText = lifeMax > 0
        ? (lifeCur.toLocaleString() + "/" + lifeMax.toLocaleString())
        : (lifeCur > 0 ? lifeCur.toLocaleString() : '—');

    var energyCur = Number(
        x.energy_current ||
        x.energy ||
        x.energy_now ||
        x.energy_used_current ||
        0
    );

    var energyMax = Number(
        x.energy_max ||
        x.max_energy ||
        150
    );

    var energyText = energyMax > 0
        ? (energyCur.toLocaleString() + "/" + energyMax.toLocaleString())
        : (energyCur > 0 ? energyCur.toLocaleString() : '—');

    var attackUrl = x.attack_url || (id ? ("https://www.torn.com/loader.php?sid=attack&user2ID=" + id) : '#');
    var enabled = !!x.enabled_under_license || !!x.member_access_enabled || !!x.enabled;
    var leader = String(x.position || '').toLowerCase().includes('leader');

    var pill = hosp > 0
        ? '<span class="warhub-pill hosp">Hosp ' + esc(fmtHosp(hosp, hospText)) + '</span>'
        : presence === 'online'
            ? '<span class="warhub-pill online">Online</span>'
            : presence === 'idle'
                ? '<span class="warhub-pill idle">Idle</span>'
                : presence === 'travel'
                    ? '<span class="warhub-pill travel">Travel</span>'
                    : presence === 'jail'
                        ? '<span class="warhub-pill jail">Jail</span>'
                        : '<span class="warhub-pill offline">Offline</span>';

    return '\
      <div class="warhub-list-item">\
        <div class="warhub-row">\
          <div>\
            <div class="warhub-name">' + esc(name) + '</div>\
            <div class="warhub-meta">' + esc([level, x.display_status || last].filter(Boolean).join(' • ')) + '</div>\
            <div class="warhub-meta">' + esc(['Life ' + lifeText, 'Energy ' + energyText].join(' • ')) + '</div>\
          </div>\
          <div class="warhub-actions">\
            ' + pill + '\
            ' + (leader ? '<span class="warhub-pill leader">Leader</span>' : '') + '\
            ' + (!enemy && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession()) ? '<span class="warhub-pill ' + (enabled ? 'enabled' : 'disabled') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span>' : '') + '\
          </div>\
        </div>\
        <div class="warhub-row">\
          <div class="warhub-meta">ID ' + esc(id || '—') + '</div>\
          <div class="warhub-actions">\
            ' + (id ? '<a class="warhub-btn small" href="https://www.torn.com/profiles.php?XID=' + encodeURIComponent(id) + '" target="_blank" rel="noopener noreferrer">Profile</a>' : '') + '\
            ' + (id ? '<a class="warhub-btn small primary" href="' + esc(attackUrl) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '') + '\
            ' + (id ? '<a class="warhub-btn small warn" href="https://www.torn.com/bounties.php?userID=' + encodeURIComponent(id) + '" target="_blank" rel="noopener noreferrer">Bounty</a>' : '') + '\
          </div>\
        </div>\
      </div>';
}
    function rosterCard(title, items) {
        var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
        var extraClass = opts.extraClass || '';
        var content = arr(items).length ? arr(items).map(function (x) {
            return memberRow(x, !!opts.enemy);
        }).join('') : "<div class=\"warhub-empty\">No ".concat(esc(title.toLowerCase()), ".</div>");
        return "\n      <div class=\"warhub-card warhub-roster-card ".concat(esc(extraClass), "\">\n        <div class=\"warhub-section-title\">\n          <h3>").concat(esc(title), "</h3>\n          <span class=\"warhub-count\">").concat(arr(items).length, "</span>\n        </div>\n        <div class=\"warhub-list\">").concat(content, "</div>\n      </div>\n    ");
    }
    function rosterDropdown(title, items) {
        var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
        var extraClass = opts.extraClass || '';
        var openAttr = opts.open ? 'open' : '';
        var content = arr(items).length ? arr(items).map(function (x) {
            return memberRow(x, !!opts.enemy);
        }).join('') : "<div class=\"warhub-empty\">No ".concat(esc(title.toLowerCase()), ".</div>");
        return "\n      <details class=\"warhub-dropdown ".concat(esc(extraClass), "\" ").concat(openAttr, ">\n        <summary>\n          <div class=\"warhub-row\">\n            <strong>").concat(esc(title), "</strong>\n            <span class=\"warhub-count\">").concat(arr(items).length, "</span>\n          </div>\n        </summary>\n        <div class=\"warhub-dropdown-body\">\n          <div class=\"warhub-list\">").concat(content, "</div>\n        </div>\n      </details>\n    ");
    }
    function getOverviewBoxPrefs() {
    var saved = GM_getValue(K_OVERVIEW_BOXES, null);
    var defaults = {
        meddeals: true,
        dibs: true,
        terms: true,
        war: true
    };
    if (!saved || typeof saved !== 'object') return defaults;
    return {
        meddeals: saved.meddeals !== false,
        dibs: saved.dibs !== false,
        terms: saved.terms !== false,
        war: saved.war !== false
    };
}

function renderOverviewTab() {
    if (!state) {
        return renderAccessBanner() + '<div class="warhub-card"><div class="warhub-empty">Loading overview...</div></div>';
    }

    var prefs = getOverviewBoxPrefs();
    var deals = arr((state && (state.medDeals || state.med_deals)) || []);
    var allDibs = arr((state && state.dibs) || []);
    var war = (state && state.war) || {};
    var our = (state && (state.faction || state.our_faction)) || {};
    var enemy = (state && (state.enemyFaction || state.enemy_faction)) || {};
    var fallbackPair = (typeof whLoadWarPairFallback === 'function' && whLoadWarPairFallback()) || {};

    var ownFactionId = String((our && (our.faction_id || our.id)) || '').trim();
    var ownFactionName = String((our && our.name) || '').trim().toLowerCase();

    var enemyFactionId = String(
        (enemy && (enemy.faction_id || enemy.id)) ||
        state.enemy_faction_id ||
        war.enemy_faction_id ||
        war.opponent_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        (enemy && enemy.name) ||
        state.enemy_faction_name ||
        war.enemy_faction_name ||
        war.opponent_faction_name ||
        ''
    ).trim();

    if (!enemyFactionId) {
        enemyFactionId = String(fallbackPair.enemy_faction_id || '').trim();
    }
    if (!enemyFactionName) {
        enemyFactionName = String(fallbackPair.enemy_faction_name || '').trim();
    }

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionName = '';
    }

    if (!enemyFactionName) {
        enemyFactionName = '—';
    }

    var scoreUs = Number(
        (state && state.score && state.score.our) ||
        war.score_us ||
        war.our_score ||
        our.score ||
        0
    ) || 0;

    var scoreThem = Number(
        (state && state.score && state.score.enemy) ||
        war.score_them ||
        war.enemy_score ||
        (enemy && enemy.score) ||
        0
    ) || 0;

    var target = Number(
        (state && state.score && state.score.target) ||
        war.target_score ||
        war.target ||
        0
    ) || 0;

    var ourChain = Number(
        (our && our.chain) ||
        war.chain_us ||
        0
    ) || 0;

    var enemyChain = Number(
        (enemy && enemy.chain) ||
        war.chain_them ||
        0
    ) || 0;

    var lead = scoreUs - scoreThem;
    var hasWar = !!(
        state && (
            state.has_war ||
            war.active ||
            war.registered ||
            war.war_id ||
            war.id ||
            enemyFactionId ||
            ((state.enemies || []).length)
        )
    );

    var termsText = String(
        (state && state.war_terms && (state.war_terms.terms_text || state.war_terms.terms)) ||
        (state && state.terms && (state.terms.terms_text || state.terms.terms)) ||
        ''
    );

    var medDealsHtml = deals.length ? deals.slice(0, 6).map(function (x) {
        return '<div class="warhub-list-item">\
            <div class="warhub-name">' + esc(x.seller_name || x.created_by_name || 'Unknown user') + '</div>\
            <div class="warhub-meta">' + esc([x.item_name || x.buyer_name || '', x.note || x.notes || ''].filter(Boolean).join(' • ')) + '</div>\
        </div>';
    }).join('') : '<div class="warhub-empty">No med deals yet.</div>';

    var dibsHtml = allDibs.length ? allDibs.slice(0, 6).map(function (d) {
        var name = d.target_name || d.enemy_name || ('ID ' + (d.target_id || d.enemy_id || '—'));
        var owner = d.assigned_to_name || d.user_name || d.claimed_by_name || 'Unknown';
        return '<div class="warhub-list-item">\
            <div class="warhub-name">' + esc(name) + '</div>\
            <div class="warhub-meta">' + esc('Claimed by ' + owner) + '</div>\
        </div>';
    }).join('') : '<div class="warhub-empty">No dibs claimed.</div>';

    var warHtml = hasWar ? '\
        <div class="warhub-grid two">\
            <div class="warhub-metric warhub-score-us">\
                <div class="k">Our Score</div>\
                <div class="v">' + fmtNum(scoreUs) + '</div>\
            </div>\
            <div class="warhub-metric warhub-score-them">\
                <div class="k">Enemy Score</div>\
                <div class="v">' + fmtNum(scoreThem) + '</div>\
            </div>\
            <div class="warhub-metric">\
                <div class="k">' + (lead >= 0 ? 'Lead' : 'Behind') + '</div>\
                <div class="v">' + fmtNum(Math.abs(lead)) + '</div>\
            </div>\
            <div class="warhub-metric">\
                <div class="k">Target</div>\
                <div class="v">' + fmtNum(target) + '</div>\
            </div>\
            <div class="warhub-metric">\
                <div class="k">Our Chain</div>\
                <div class="v">' + fmtNum(ourChain) + '</div>\
            </div>\
            <div class="warhub-metric">\
                <div class="k">Enemy Chain</div>\
                <div class="v">' + fmtNum(enemyChain) + '</div>\
            </div>\
        </div>\
        <div class="warhub-divider"></div>\
        <div class="warhub-mini" style="line-height:1.6;">\
            <strong>Our Faction:</strong> ' + esc(our.name || '—') + '<br>\
            <strong>Enemy Faction:</strong> ' + esc(enemyFactionName) + '<br>\
            <strong>Status:</strong> ' + esc(war.status || (war.active ? 'Active' : war.registered ? 'Registered' : 'Active')) + '\
        </div>' : '<div class="warhub-empty">Currently not in a war.</div>';

    var cards = [];

    if (prefs.meddeals) {
        cards.push('\
        <div class="warhub-card">\
            <div class="warhub-section-title">\
                <h3>Med Deals Made by Members</h3>\
                <span class="warhub-count">' + fmtNum(deals.length) + '</span>\
            </div>\
            <div class="warhub-actions" style="margin-bottom:8px;">\
                <button class="warhub-btn small" data-overview-go="meddeals">Open Med Deals</button>\
            </div>\
            <div class="warhub-list">' + medDealsHtml + '</div>\
        </div>');
    }

    if (prefs.dibs) {
        cards.push('\
        <div class="warhub-card">\
            <div class="warhub-section-title">\
                <h3>Dibs</h3>\
                <span class="warhub-count">' + fmtNum(allDibs.length) + '</span>\
            </div>\
            <div class="warhub-actions" style="margin-bottom:8px;">\
                <button class="warhub-btn small" data-overview-go="hospital">Open Dibs</button>\
            </div>\
            <div class="warhub-list">' + dibsHtml + '</div>\
        </div>');
    }

    if (prefs.terms) {
        cards.push('\
        <div class="warhub-card">\
            <div class="warhub-section-title">\
                <h3>Terms</h3>\
                <span class="warhub-count">Live</span>\
            </div>\
            <div class="warhub-actions" style="margin-bottom:8px;">\
                <button class="warhub-btn small" data-overview-go="terms">Open Terms</button>\
            </div>\
            <div class="warhub-mini" style="white-space:pre-wrap; line-height:1.5;">' + esc(termsText || 'No terms posted yet.') + '</div>\
        </div>');
    }

    if (prefs.war) {
        cards.push('\
        <div class="warhub-card">\
            <div class="warhub-section-title">\
                <h3>War Overview</h3>\
                <span class="warhub-count">' + (hasWar ? 'Live' : 'Idle') + '</span>\
            </div>\
            <div class="warhub-actions" style="margin-bottom:8px;">\
                <button class="warhub-btn small" data-overview-go="war">Open War</button>\
            </div>\
            ' + warHtml + '\
        </div>');
    }

        if (!cards.length) {
        cards.push('\
        <div class="warhub-card">\
            <h3>Overview</h3>\
            <div class="warhub-empty">No quick boxes selected. Turn them on in Settings.</div>\
        </div>');
    }

    if (state && state.debug) {
        cards.push('\
        <div class="warhub-card">\
            <div class="warhub-section-title">\
                <h3>War Debug</h3>\
                <span class="warhub-count">Live</span>\
            </div>\
            <div class="warhub-mini" style="white-space:pre-wrap; line-height:1.5;">' + esc(JSON.stringify(state.debug, null, 2)) + '</div>\
        </div>');
    }

    return renderAccessBanner() + '<div class="warhub-grid two">' + cards.join('') + '</div>';
}
    function renderInstructionsTab() {
        var banner = accessSummaryMessage() ? "<div class=\"warhub-banner ".concat((accessState !== null && accessState !== void 0 && accessState.paymentRequired) || (accessState !== null && accessState !== void 0 && accessState.blocked) || (accessState !== null && accessState !== void 0 && accessState.trialExpired) ? 'payment' : (accessState !== null && accessState !== void 0 && accessState.trialActive) ? 'trial' : 'good', "\">\n          <div><strong>Faction Access</strong></div>\n          <div class=\"warhub-mini\" style=\"margin-top:6px;\">").concat(esc(accessSummaryMessage()), "</div>\n        </div>") : '';
        return "\n      ".concat(banner, "\n      <div class=\"warhub-card\">\n        <h3>Getting Started</h3>\n        <div class=\"warhub-list\">\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">1. Save your Torn API key</div>\n            <div class=\"warhub-meta\">Open Settings and paste your personal API key, then press Save Keys.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">2. Login to War Hub</div>\n            <div class=\"warhub-meta\">Press Login in Settings. Once connected, the overlay will load your faction and war state.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">3. Leader-only faction access</div>\n            <div class=\"warhub-meta\">Faction leaders can manage member access from the Faction tab when licensing is enabled.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">4. Use tabs for shared tools</div>\n            <div class=\"warhub-meta\">War, Terms, Targets, Assignments, Notes, and Med Deals are shared faction tools.</div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Terms of Service</h3>\n        <div class=\"warhub-mini\" style=\"line-height:1.5;\">\n          This script is for faction coordination and convenience. You are responsible for your own Torn account, your own API key,\n          and anything you enter into this tool. Do not share full-access secrets with people you do not trust.\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>API Key Storage</h3>\n        <div class=\"warhub-mini\" style=\"line-height:1.5;\">\n          Your API key and session token are stored locally in your userscript storage on your device/browser.\n          The server receives your API key only when you log in or when actions require backend sync.\n          Faction-leader managed member access may store member API keys on the backend if the leader enters them in the Faction tab.\n        </div>\n      </div>\n    ");
    }
    function renderWarTab() {
    var war = (state === null || state === void 0 ? void 0 : state.war) || {};
    var our = (state === null || state === void 0 ? void 0 : state.faction) || (state === null || state === void 0 ? void 0 : state.our_faction) || {};
    var enemy = (state === null || state === void 0 ? void 0 : state.enemyFaction) || (state === null || state === void 0 ? void 0 : state.enemy_faction) || {};
    var fallbackPair = (typeof whLoadWarPairFallback === 'function' && whLoadWarPairFallback()) || {};

    var ownFactionId = String((our === null || our === void 0 ? void 0 : our.faction_id) || (our === null || our === void 0 ? void 0 : our.id) || '').trim();
    var ownFactionName = String((our === null || our === void 0 ? void 0 : our.name) || '').trim().toLowerCase();

    var enemyFactionId = String(
        (enemy === null || enemy === void 0 ? void 0 : enemy.faction_id) ||
        (enemy === null || enemy === void 0 ? void 0 : enemy.id) ||
        (state === null || state === void 0 ? void 0 : state.enemy_faction_id) ||
        (state === null || state === void 0 ? void 0 : state.war) && state.war.enemy_faction_id ||
        (state === null || state === void 0 ? void 0 : state.war) && state.war.opponent_faction_id ||
        fallbackPair.enemy_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        (enemy === null || enemy === void 0 ? void 0 : enemy.name) ||
        (state === null || state === void 0 ? void 0 : state.enemy_faction_name) ||
        (state === null || state === void 0 ? void 0 : state.war) && state.war.enemy_faction_name ||
        (state === null || state === void 0 ? void 0 : state.war) && state.war.opponent_faction_name ||
        fallbackPair.enemy_faction_name ||
        '—'
    ).trim();

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
        enemyFactionName = '—';
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionId = '';
        enemyFactionName = '—';
    }

    var scoreUs = Number((state === null || state === void 0 ? void 0 : state.score) && state.score.our || (war === null || war === void 0 ? void 0 : war.our_score) || (our === null || our === void 0 ? void 0 : our.score) || 0) || 0;
    var scoreThem = Number((state === null || state === void 0 ? void 0 : state.score) && state.score.enemy || (war === null || war === void 0 ? void 0 : war.enemy_score) || (enemy === null || enemy === void 0 ? void 0 : enemy.score) || 0) || 0;
    var target = Number((state === null || state === void 0 ? void 0 : state.score) && state.score.target || (war === null || war === void 0 ? void 0 : war.target_score) || (war === null || war === void 0 ? void 0 : war.target) || 0) || 0;
    var lead = scoreUs - scoreThem;
    var hasWar = !!((state === null || state === void 0 ? void 0 : state.has_war) || (war === null || war === void 0 ? void 0 : war.active) || (war === null || war === void 0 ? void 0 : war.war_id) || (war === null || war === void 0 ? void 0 : war.id) || enemyFactionId || arr(state && state.enemies).length);

    if (!hasWar) {
        return "\n        <div class=\"warhub-card\">\n          <h3>War</h3>\n          <div class=\"warhub-empty\">Currently not in a war.</div>\n        </div>\n      ";
    }

    return "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>War Overview</h3>\n          <span class=\"warhub-count\">".concat(esc(String((war === null || war === void 0 ? void 0 : war.war_id) || (war === null || war === void 0 ? void 0 : war.id) || 'Live')), "</span>\n        </div>\n\n        <div class=\"warhub-grid three\">\n          <div class=\"warhub-metric warhub-score-us\">\n            <div class=\"k\">Our Score</div>\n            <div class=\"v\">").concat(fmtNum(scoreUs), "</div>\n          </div>\n          <div class=\"warhub-metric warhub-score-them\">\n            <div class=\"k\">Enemy Score</div>\n            <div class=\"v\">").concat(fmtNum(scoreThem), "</div>\n          </div>\n          <div class=\"warhub-metric warhub-score-lead\">\n            <div class=\"k\">").concat(lead >= 0 ? 'Lead' : 'Behind', "</div>\n            <div class=\"v\">").concat(fmtNum(Math.abs(lead)), "</div>\n          </div>\n        </div>\n\n        <div class=\"warhub-divider\"></div>\n\n        <div class=\"warhub-grid two\">\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Our Faction</div>\n            <div class=\"v\">").concat(esc((our === null || our === void 0 ? void 0 : our.name) || (state === null || state === void 0 ? void 0 : state.user) && state.user.faction_name || '—'), "</div>\n          </div>\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Enemy Faction</div>\n            <div class=\"v\">").concat(esc(enemyFactionName), "</div>\n          </div>\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Target Score</div>\n            <div class=\"v\">").concat(fmtNum(target), "</div>\n          </div>\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Status</div>\n            <div class=\"v\">").concat(esc((war === null || war === void 0 ? void 0 : war.status) || 'Active'), "</div>\n          </div>\n        </div>\n\n        <div class=\"warhub-divider\"></div>\n\n        <div class=\"warhub-actions\">\n          <button class=\"warhub-btn primary\" id=\"warhub-save-snapshot\">Save Snapshot</button>\n          ").concat(enemyFactionId ? "<a class=\"warhub-btn\" href=\"https://www.torn.com/factions.php?step=profile&ID=".concat(encodeURIComponent(enemyFactionId), "\" target=\"_blank\" rel=\"noopener noreferrer\">Enemy Faction</a>") : '', "\n        </div>\n      </div>\n    ");
}
    function renderTermsTab() {
        var warId = (state === null || state === void 0 ? void 0 : state.war) && state.war.war_id || (state === null || state === void 0 ? void 0 : state.war) && state.war.id || '';
        var termsText = (state === null || state === void 0 ? void 0 : state.warTerms) && state.warTerms.terms_text || (state === null || state === void 0 ? void 0 : state.warTerms) && state.warTerms.terms || (state === null || state === void 0 ? void 0 : state.terms) && state.terms.terms_text || (state === null || state === void 0 ? void 0 : state.terms) && state.terms.terms || '';
        var locked = !((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession());
        return "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>War Terms</h3>\n          ".concat(locked ? '<span class="warhub-pill disabled">Leader Only</span>' : '', "\n        </div>\n        <label class=\"warhub-label\">War ID</label>\n        <input class=\"warhub-input\" id=\"warhub-terms-warid\" value=\"").concat(esc(warId), "\" readonly />\n        <div style=\"height:8px;\"></div>\n        <label class=\"warhub-label\">Terms</label>\n        <textarea class=\"warhub-textarea\" id=\"warhub-terms-text\" ").concat(locked ? 'readonly' : '', ">").concat(esc(termsText), "</textarea>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"warhub-terms-save\" ").concat(locked ? 'disabled' : '', ">Save Terms</button>\n          <button class=\"warhub-btn warn\" id=\"warhub-terms-delete\" ").concat(locked ? 'disabled' : '', ">Delete Terms</button>\n        </div>\n      </div>\n    ");
    }
    function renderMembersTab() {
    var groups = splitRosterGroups((state === null || state === void 0 ? void 0 : state.members) || []);
    var total = groups.online.length + groups.idle.length + groups.hospital.length + groups.offline.length;

    return "\n\
      <div class=\"warhub-card\">\n\
        <div class=\"warhub-section-title\">\n\
          <h3>Members Overview</h3>\n\
          <span class=\"warhub-count\">".concat(fmtNum(total), "</span>\n\
        </div>\n\
        <div class=\"warhub-grid two\">\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Online</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.online.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Idle</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.idle.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Hospital</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.hospital.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Offline</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.offline.length), "</div>\n\
          </div>\n\
        </div>\n\
      </div>\n\
      ").concat(rosterCard('Online Members', groups.online, {
        extraClass: 'online-box'
    }), "\n\
      ").concat(rosterCard('Idle Members', groups.idle, {
        extraClass: 'idle-box'
    }), "\n\
      ").concat(rosterCard('Hospital Members', groups.hospital, {
        extraClass: 'hospital-box'
    }), "\n\
      ").concat(rosterDropdown('Offline Members', groups.offline, {
        extraClass: 'offline-box'
    }), "\n\
    ");
}
    function renderEnemiesTab() {
    var enemies = arr((state === null || state === void 0 ? void 0 : state.enemies) || []);
    var hasWar = !!(
        ((state === null || state === void 0 ? void 0 : state.has_war)) ||
        (((state === null || state === void 0 ? void 0 : state.war) && state.war.active)) ||
        (((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id)) ||
        ((state === null || state === void 0 ? void 0 : state.enemy_faction_id)) ||
        (((state === null || state === void 0 ? void 0 : state.enemyFaction) && state.enemyFaction.id)) ||
        (((state === null || state === void 0 ? void 0 : state.enemyFaction) && state.enemyFaction.faction_id))
    );

    if (!enemies.length && !hasWar) {
        return "\n\
        <div class=\"warhub-card\">\n\
          <h3>Enemies</h3>\n\
          <div class=\"warhub-empty\">Currently not in a war.</div>\n\
        </div>\n\
      ";
    }

    var groups = splitRosterGroups(enemies);
    var total =
        groups.online.length +
        groups.idle.length +
        (groups.travel || []).length +
        groups.hospital.length +
        (groups.jail || []).length +
        groups.offline.length;

    return "\n\
      <div class=\"warhub-card\">\n\
        <div class=\"warhub-section-title\">\n\
          <h3>Enemies Overview</h3>\n\
          <span class=\"warhub-count\">".concat(fmtNum(total), "</span>\n\
        </div>\n\
        <div class=\"warhub-grid two\">\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Online</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.online.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Idle</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.idle.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Travel</div>\n\
            <div class=\"v\">").concat(fmtNum((groups.travel || []).length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Hospital</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.hospital.length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Jail</div>\n\
            <div class=\"v\">").concat(fmtNum((groups.jail || []).length), "</div>\n\
          </div>\n\
          <div class=\"warhub-metric\">\n\
            <div class=\"k\">Offline</div>\n\
            <div class=\"v\">").concat(fmtNum(groups.offline.length), "</div>\n\
          </div>\n\
        </div>\n\
      </div>\n\
      ").concat(rosterCard('Enemy Online', groups.online, {
        extraClass: 'online-box',
        enemy: true
    }), "\n\
      ").concat(rosterCard('Enemy Idle', groups.idle, {
        extraClass: 'idle-box',
        enemy: true
    }), "\n\
      ").concat(rosterCard('Enemy Travel', groups.travel || [], {
        extraClass: 'travel-box',
        enemy: true
    }), "\n\
      ").concat(rosterCard('Enemy Hospital', groups.hospital, {
        extraClass: 'hospital-box',
        enemy: true
    }), "\n\
      ").concat(rosterCard('Enemy Jailed', groups.jail || [], {
        extraClass: 'jail-box',
        enemy: true
    }), "\n\
      ").concat(rosterDropdown('Enemy Offline', groups.offline, {
        extraClass: 'offline-box',
        enemy: true
    }), "\n\
    ");
}
    function renderHospitalTab() {
    var ours = sortHosp(arr((state === null || state === void 0 ? void 0 : state.members) || []).filter(function (x) {
        return getHospSeconds(x) > 0;
    }));

    var enemyHospRaw = sortHosp(arr((state === null || state === void 0 ? void 0 : state.enemies) || []).filter(function (x) {
        return getHospSeconds(x) > 0;
    }));

    var theirs = filterHospitalEnemiesForTab(enemyHospRaw);
    var total = ours.length + theirs.length;

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Hospital Overview</h3>\
          <span class="warhub-count">' + fmtNum(total) + '</span>\
        </div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric">\
            <div class="k">Our Hospital</div>\
            <div class="v">' + fmtNum(ours.length) + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">Enemy Hospital</div>\
            <div class="v">' + fmtNum(theirs.length) + '</div>\
          </div>\
        </div>\
      </div>\
      ' + renderDibsOverviewCard() + '\
      <div class="warhub-card warhub-roster-card hospital-box">\
        <div class="warhub-section-title">\
          <h3>Our Hospital</h3>\
          <span class="warhub-count">' + fmtNum(ours.length) + '</span>\
        </div>\
        <div class="warhub-list">' +
          (ours.length ? ours.map(function (x) { return hospitalMemberRow(x, false); }).join('') : '<div class="warhub-empty">No one in our hospital.</div>') +
        '</div>\
      </div>\
      <div class="warhub-card warhub-roster-card hospital-box">\
        <div class="warhub-section-title">\
          <h3>Enemy Hospital</h3>\
          <span class="warhub-count">' + fmtNum(theirs.length) + '</span>\
        </div>\
        <div class="warhub-list">' +
          (theirs.length ? theirs.map(function (x) { return hospitalMemberRow(x, true); }).join('') : '<div class="warhub-empty">No enemy in hospital.</div>') +
        '</div>\
      </div>';
}
function renderChainTab() {
    var members = arr((state && state.members) || []);
    var sitters = members.filter(function (x) {
        return !!x.chain_sitter;
    });
    var avail = members.filter(function (x) {
        return !!x.available;
    });

    var war = (state && state.war) || {};
    var chainCount = Number(
        (state && state.chain && state.chain.current) ||
        (state && state.chain_count) ||
        (war && war.chain_count) ||
        (war && war.chain) ||
        0
    ) || 0;

    var chainTimeout =
        (state && state.chain && state.chain.timeout_text) ||
        (state && state.chain_timeout_text) ||
        (war && war.chain_timeout_text) ||
        (state && state.chain && state.chain.timeout) ||
        (war && war.chain_timeout) ||
        '—';

    var myUserId = String(
        (state && state.me && (state.me.user_id || state.me.id || state.me.player_id)) ||
        (state && state.user && (state.user.user_id || state.user.id || state.user.player_id)) ||
        ''
    );

    var myMember = members.find(function (x) {
        return String(x.user_id || x.id || x.player_id || x.member_user_id || '') === myUserId;
    }) || {};

    var myAvailable = !!myMember.available;
    var myChainSitter = !!myMember.chain_sitter;

    var availabilityButtons =
        '<button class="warhub-btn ' + (myAvailable ? '' : 'warn') + '" id="warhub-set-unavailable">Unavailable</button>' +
        '<button class="warhub-btn ' + (myAvailable ? 'good' : '') + '" id="warhub-set-available">Available</button>';

    var sitterButtons =
        '<button class="warhub-btn ' + (myChainSitter ? '' : 'warn') + '" id="warhub-set-chain-off">Off</button>' +
        '<button class="warhub-btn ' + (myChainSitter ? 'good' : '') + '" id="warhub-set-chain-on">On</button>';

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Chain Overview</h3>\
        </div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric">\
            <div class="k">Current Chain</div>\
            <div class="v">' + fmtNum(chainCount) + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">Timeout</div>\
            <div class="v">' + esc(String(chainTimeout || '—')) + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">Available Members</div>\
            <div class="v">' + fmtNum(avail.length) + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">Chain Sitters</div>\
            <div class="v">' + fmtNum(sitters.length) + '</div>\
          </div>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <h3>My Controls</h3>\
        <div class="warhub-grid two">\
          <div class="warhub-list-item">\
            <div class="warhub-row">\
              <div>\
                <div class="warhub-name">Availability</div>\
                <div class="warhub-meta">Switch between unavailable and available</div>\
              </div>\
              <div class="warhub-actions">' + availabilityButtons + '</div>\
            </div>\
          </div>\
          <div class="warhub-list-item">\
            <div class="warhub-row">\
              <div>\
                <div class="warhub-name">Chain Sitter</div>\
                <div class="warhub-meta">Switch chain sitter mode on or off</div>\
              </div>\
              <div class="warhub-actions">' + sitterButtons + '</div>\
            </div>\
          </div>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Available Members</h3>\
          <span class="warhub-count">' + avail.length + '</span>\
        </div>\
        <div class="warhub-list">' +
          (avail.length ? avail.map(function (x) { return memberRow(x, false); }).join('') : '<div class="warhub-empty">No available members flagged.</div>') +
        '</div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Chain Sitters</h3>\
          <span class="warhub-count">' + sitters.length + '</span>\
        </div>\
        <div class="warhub-list">' +
          (sitters.length ? sitters.map(function (x) { return memberRow(x, false); }).join('') : '<div class="warhub-empty">No chain sitters enabled.</div>') +
        '</div>\
      </div>';
}
    function renderMedDealsTab() {
    var deals = arr((state && state.medDeals) || (state && state.med_deals) || []);
    var enemies = sortAlphabetical(arr((state && state.enemies) || []));
    var hasWar = !!(
        (state && state.has_war) ||
        (state && state.war && state.war.active) ||
        (state && state.war && state.war.war_id) ||
        (state && state.enemy_faction_id) ||
        (state && state.enemyFaction && state.enemyFaction.id) ||
        enemies.length
    );

    return "\
      <div class=\"warhub-card\">\n\
        <h3>Add Med Deal</h3>\n\
        <div>\n\
          <label class=\"warhub-label\">Enemy</label>\n\
          <select class=\"warhub-select\" id=\"warhub-med-item\">\n\
            <option value=\"\">".concat(hasWar ? 'Select enemy member' : 'Currently not in a war', "</option>\n\
            ").concat(enemies.map(function (x) {
                var id = x.user_id || x.id || x.player_id || '';
                var name = x.name || x.player_name || "ID ".concat(id);
                return "<option value=\"".concat(esc(name), "\" data-id=\"").concat(esc(String(id)), "\">").concat(esc(name), " [").concat(esc(String(id)), "]</option>");
            }).join(''), "\n\
          </select>\n\
        </div>\n\
        <div style=\"height:8px;\"></div>\n\
        <div>\n\
          <label class=\"warhub-label\">Note</label>\n\
          <input class=\"warhub-input\" id=\"warhub-med-note\" placeholder=\"Optional note\" />\n\
        </div>\n\
        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n\
          <button class=\"warhub-btn primary\" id=\"warhub-med-add\">Add Med Deal</button>\n\
        </div>\n\
      </div>\n\
\n\
      <div class=\"warhub-card\">\n\
        <div class=\"warhub-section-title\">\n\
          <h3>Med Deals</h3>\n\
          <span class=\"warhub-count\">").concat(deals.length, "</span>\n\
        </div>\n\
        <div class=\"warhub-list\">\n\
          ").concat(deals.length ? deals.map(function (x) {
                return "\
            <div class=\"warhub-list-item\">\n\
              <div class=\"warhub-row\">\n\
                <div>\n\
                  <div class=\"warhub-name\">".concat(esc(x.seller_name || x.created_by_name || 'Unknown user'), "</div>\n\
                  <div class=\"warhub-meta\">").concat(esc([x.item_name || x.buyer_name || '', x.note || ''].filter(Boolean).join(' • ')), "</div>\n\
                </div>\n\
                <div class=\"warhub-actions\">\n\
                  <button class=\"warhub-btn small warn warhub-del-med\" data-id=\"").concat(esc(String(x.id || x.deal_id || '')), "\">Delete</button>\n\
                </div>\n\
              </div>\n\
            </div>\n\
          ");
            }).join('') : '<div class="warhub-empty">No med deals yet.</div>', "\n\
        </div>\n\
      </div>\n\
    ");
}
    function renderTargetsTab() {
        var targets = arr((state === null || state === void 0 ? void 0 : state.targets) || []);
        var enemies = sortAlphabetical(arr((state === null || state === void 0 ? void 0 : state.enemies) || []));
        return "\n      <div class=\"warhub-card\">\n        <h3>Add Target</h3>\n        <div class=\"warhub-grid two\">\n          <div>\n            <label class=\"warhub-label\">Enemy</label>\n            <select class=\"warhub-select\" id=\"warhub-target-enemy\">\n              <option value=\"\">Select enemy</option>\n              ".concat(enemies.map(function (x) {
            var id = x.user_id || x.id || '';
            var name = x.name || "ID ".concat(id);
            return "<option value=\"".concat(esc(String(id)), "\" data-name=\"").concat(esc(name), "\">").concat(esc(name), " [").concat(esc(String(id)), "]</option>");
        }).join(''), "\n            </select>\n          </div>\n          <div>\n            <label class=\"warhub-label\">Target ID</label>\n            <input class=\"warhub-input\" id=\"warhub-target-id\" placeholder=\"Target ID\" />\n          </div>\n        </div>\n        <div style=\"height:8px;\"></div>\n        <label class=\"warhub-label\">Notes / Reason</label>\n        <input class=\"warhub-input\" id=\"warhub-target-notes\" placeholder=\"Optional notes\" />\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"warhub-target-add\">Add Target</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>Targets</h3>\n          <span class=\"warhub-count\">").concat(targets.length, "</span>\n        </div>\n        <div class=\"warhub-list\">\n          ").concat(targets.length ? targets.map(function (x) {
            var id = x.target_id || x.user_id || '';
            var name = x.target_name || x.name || "ID ".concat(id);
            var rowId = x.id || x.target_row_id || '';
            return "\n              <div class=\"warhub-list-item\">\n                <div class=\"warhub-row\">\n                  <div>\n                    <div class=\"warhub-name\">".concat(esc(name), "</div>\n                    <div class=\"warhub-meta\">").concat(esc(["ID ".concat(id), x.notes || x.reason || ''].filter(Boolean).join(' • ')), "</div>\n                  </div>\n                  <div class=\"warhub-actions\">\n                    ").concat(id ? "<a class=\"warhub-btn small primary\" href=\"https://www.torn.com/loader.php?sid=attack&user2ID=".concat(encodeURIComponent(id), "\" target=\"_blank\" rel=\"noopener noreferrer\">Attack</a>") : '', "\n                    <button class=\"warhub-btn small warn warhub-del-target\" data-id=\"").concat(esc(String(rowId)), "\">Delete</button>\n                  </div>\n                </div>\n              </div>\n            ");
        }).join('') : '<div class="warhub-empty">No targets saved.</div>', "\n        </div>\n      </div>\n    ");
    }
    function renderAssignmentsTab() {
        var warId = String((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id || (state === null || state === void 0 ? void 0 : state.war) && state.war.id || '');
        var managed = arr((state === null || state === void 0 ? void 0 : state.factionManagement) && state.factionManagement.members || (factionMembersCache === null || factionMembersCache === void 0 ? void 0 : factionMembersCache.members) || []).filter(function (m) {
            var uid = String(m.member_user_id || m.user_id || '');
            return uid && !!m.enabled;
        });
        var rows = arr((state === null || state === void 0 ? void 0 : state.assignments) || []).length ? "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3 style=\"margin:0;\">Live Assignments</h3>\n          <span class=\"warhub-count\">".concat(fmtNum(arr(state.assignments).length), "</span>\n        </div>\n        <div class=\"warhub-list\">\n          ").concat(arr(state.assignments).map(function (a) {
            var id = String(a.id || '');
            var assigned = a.assigned_to_name || a.assignee || 'Unassigned';
            var targetName = a.target_name || a.target || a.target_id || 'Unknown';
            var attack = a.target_attack_url || (a.target_id ? "https://www.torn.com/loader.php?sid=attack&user2ID=".concat(encodeURIComponent(String(a.target_id))) : '');
            return "\n                <div class=\"warhub-list-item\">\n                  <div class=\"warhub-row\">\n                    <div>\n                      <div class=\"warhub-name\">".concat(esc(targetName), "</div>\n                      <div class=\"warhub-meta\">").concat(esc(["Assigned: ".concat(assigned), a.priority || 'normal', a.note || ''].filter(Boolean).join(' • ')), "</div>\n                    </div>\n                    <div class=\"warhub-actions\">\n                      ").concat(attack ? "<a class=\"warhub-btn small primary warhub-link\" href=\"".concat(esc(attack), "\" target=\"_blank\" rel=\"noopener noreferrer\">Attack</a>") : '', "\n                      ").concat(id ? "<button class=\"warhub-btn small warn\" data-del-assignment-live=\"".concat(esc(id), "\">Delete</button>") : '', "\n                    </div>\n                  </div>\n                </div>\n              ");
        }).join(''), "\n        </div>\n      </div>\n    ") : "\n      <div class=\"warhub-card\">\n        <h3>Live Assignments</h3>\n        <div class=\"warhub-empty\">No assignments yet.</div>\n      </div>\n    ";
        return "\n      <div class=\"warhub-card\">\n        <h3>Assign Target</h3>\n        <div class=\"warhub-grid two\">\n          <div>\n            <label class=\"warhub-label\">War ID</label>\n            <input class=\"warhub-input\" id=\"wh-assignment-war-id\" value=\"".concat(esc(warId), "\" readonly>\n          </div>\n          <div>\n            <label class=\"warhub-label\">Target ID</label>\n            <input class=\"warhub-input\" id=\"wh-assignment-target-id\" placeholder=\"Enemy target ID\">\n          </div>\n          <div>\n            <label class=\"warhub-label\">Target Name</label>\n            <input class=\"warhub-input\" id=\"wh-assignment-target-name\" placeholder=\"Optional target name\">\n          </div>\n          <div>\n            <label class=\"warhub-label\">Assign To</label>\n            <select class=\"warhub-select\" id=\"wh-assignment-member\">\n              <option value=\"\">Select enabled member</option>\n              ").concat(managed.map(function (m) {
            var uid = String(m.member_user_id || m.user_id || '');
            var nm = String(m.member_name || m.name || uid);
            return "<option value=\"".concat(esc(uid), "\" data-name=\"").concat(esc(nm), "\">").concat(esc(nm), " [").concat(esc(uid), "]</option>");
        }).join(''), "\n            </select>\n          </div>\n        </div>\n        <div style=\"height:8px;\"></div>\n        <div class=\"warhub-grid two\">\n          <div>\n            <label class=\"warhub-label\">Priority</label>\n            <select class=\"warhub-select\" id=\"wh-assignment-priority\">\n              <option value=\"normal\">Normal</option>\n              <option value=\"high\">High</option>\n              <option value=\"low\">Low</option>\n            </select>\n          </div>\n          <div>\n            <label class=\"warhub-label\">Note</label>\n            <input class=\"warhub-input\" id=\"wh-assignment-note\" placeholder=\"Optional note\">\n          </div>\n        </div>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"wh-save-assignment\">Save Assignment</button>\n        </div>\n      </div>\n      ").concat(rows, "\n    ");
    }
    function noteRow(x) {
        var id = String(x.id || x.note_id || '');
        return "\n      <div class=\"warhub-list-item\">\n        <div class=\"warhub-row\">\n          <div>\n            <div class=\"warhub-name\">".concat(esc(x.target_name || "Target ".concat(x.target_id || '—')), "</div>\n            <div class=\"warhub-meta\">").concat(esc(x.note || ''), "</div>\n            <div class=\"warhub-mini\">").concat(esc([x.created_by_name || x.updated_by_name || '', fmtTs(x.created_at || x.updated_at || '')].filter(Boolean).join(' • ')), "</div>\n          </div>\n          <div class=\"warhub-actions\">\n            ").concat(id ? "<button class=\"warhub-btn small warn\" data-del-note-live=\"".concat(esc(id), "\">Delete</button>") : '', "\n          </div>\n        </div>\n      </div>\n    ");
    }
    function renderNotesTab() {
        var localNotes = getNotes();
        var shared = arr((state === null || state === void 0 ? void 0 : state.notes) || []);
        return "\n      <div class=\"warhub-card\">\n        <h3>Local Notes</h3>\n        <label class=\"warhub-label\">Your personal notes</label>\n        <textarea class=\"warhub-textarea\" id=\"wh-notes\">".concat(esc(localNotes), "</textarea>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"wh-save-notes\">Save Local</button>\n          <button class=\"warhub-btn warn\" id=\"wh-clear-notes\">Clear Local</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Shared War Note</h3>\n        <div class=\"warhub-grid two\">\n          <div>\n            <label class=\"warhub-label\">War ID</label>\n            <input class=\"warhub-input\" id=\"wh-note-war-id\" value=\"").concat(esc(String((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id || (state === null || state === void 0 ? void 0 : state.war) && state.war.id || '')), "\" readonly>\n          </div>\n          <div>\n            <label class=\"warhub-label\">Target ID</label>\n            <input class=\"warhub-input\" id=\"wh-note-target-id\" placeholder=\"Enemy target ID\">\n          </div>\n        </div>\n        <div style=\"height:8px;\"></div>\n        <label class=\"warhub-label\">Note</label>\n        <textarea class=\"warhub-textarea\" id=\"wh-note-text\" placeholder=\"Shared note for this target\"></textarea>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"wh-add-server-note\">Save Shared Note</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>Shared Notes</h3>\n          <span class=\"warhub-count\">").concat(fmtNum(shared.length), "</span>\n        </div>\n        <div class=\"warhub-list\">\n          ").concat(shared.length ? shared.map(function (x) {
            return noteRow(x);
        }).join('') : '<div class="warhub-empty">No shared notes yet.</div>', "\n        </div>\n      </div>\n    ");
    }
    function renderAnalyticsTab() {
        var snaps = arr((state === null || state === void 0 ? void 0 : state.snapshots) || []);
        return "\n      <div class=\"warhub-card\">\n        <h3>Analytics</h3>\n        <div class=\"warhub-grid three\">\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Snapshots</div>\n            <div class=\"v\">".concat(fmtNum(snaps.length), "</div>\n          </div>\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Members</div>\n            <div class=\"v\">").concat(fmtNum(arr((state === null || state === void 0 ? void 0 : state.members) || []).length), "</div>\n          </div>\n          <div class=\"warhub-metric\">\n            <div class=\"k\">Enemies</div>\n            <div class=\"v\">").concat(fmtNum(arr((state === null || state === void 0 ? void 0 : state.enemies) || []).length), "</div>\n          </div>\n        </div>\n      </div>\n    ");
    }
    function renderNotificationsTab() {
        var items = mergedNotifications();
        return "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>Notifications</h3>\n          <span class=\"warhub-count\">".concat(fmtNum(items.length), "</span>\n        </div>\n        <div class=\"warhub-list\">\n          ").concat(items.length ? items.map(function (x) {
            return "\n            <div class=\"warhub-list-item\">\n              <div class=\"warhub-name\">".concat(esc(x.title || x.kind || 'Notification'), "</div>\n              <div class=\"warhub-meta\">").concat(esc(x.body || x.text || x.message || ''), "</div>\n              <div class=\"warhub-mini\">").concat(esc(fmtTs(x.created_at || x.ts || '')), "</div>\n            </div>\n          ");
        }).join('') : '<div class="warhub-empty">No notifications.</div>', "\n        </div>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn\" id=\"wh-mark-alerts-seen\">Refresh / Mark Seen</button>\n          <button class=\"warhub-btn warn\" id=\"wh-clear-alerts\">Clear Local</button>\n        </div>\n      </div>\n    ");
    }
    function renderFactionTab() {
        var license = (state === null || state === void 0 ? void 0 : state.factionLicense) || (state === null || state === void 0 ? void 0 : state.license) || {};
        var members = arr((factionMembersCache === null || factionMembersCache === void 0 ? void 0 : factionMembersCache.members) || []);
        var status = license.status || ((accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) ? 'payment_required' : (accessState === null || accessState === void 0 ? void 0 : accessState.trialActive) ? 'trial' : 'active');
        var canManage = !!((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession());
        return "\n      <div class=\"warhub-card\">\n        <h3>Faction License</h3>\n        <div class=\"warhub-grid two\">\n          <div class=\"warhub-metric\"><div class=\"k\">Status</div><div class=\"v\">".concat(esc(status), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Faction</div><div class=\"v\">").concat(esc((state === null || state === void 0 ? void 0 : state.user) && state.user.faction_name || (accessState === null || accessState === void 0 ? void 0 : accessState.factionName) || '—'), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Payment Player</div><div class=\"v\">").concat(esc(license.payment_player || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentPlayer) || PAYMENT_PLAYER), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Price / Enabled Member</div><div class=\"v\">").concat(fmtMoney(license.faction_member_price || (accessState === null || accessState === void 0 ? void 0 : accessState.pricePerMember) || PRICE_PER_MEMBER), "</div></div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Manage Member Access</h3>\n        ").concat(canManage ? "\n          <div class=\"warhub-grid two\">\n            <div>\n              <label class=\"warhub-label\">Member User ID</label>\n              <input class=\"warhub-input\" id=\"wh-fm-userid\" placeholder=\"User ID\">\n            </div>\n            <div>\n              <label class=\"warhub-label\">Member Name</label>\n              <input class=\"warhub-input\" id=\"wh-fm-name\" placeholder=\"Member name\">\n            </div>\n            <div>\n              <label class=\"warhub-label\">Member API Key</label>\n              <input class=\"warhub-input\" id=\"wh-fm-key\" placeholder=\"Member API key\">\n            </div>\n            <div>\n              <label class=\"warhub-label\">Position</label>\n              <input class=\"warhub-input\" id=\"wh-fm-position\" placeholder=\"Position\">\n            </div>\n          </div>\n          <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n            <button class=\"warhub-btn primary\" id=\"wh-fm-save\">Save Member Access</button>\n          </div>\n        " : '<div class=\"warhub-empty\">Leader access required.</div>', "\n      </div>\n\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>Faction Members</h3>\n          <span class=\"warhub-count\">").concat(fmtNum(members.length), "</span>\n        </div>\n        <div class=\"warhub-list\">\n          ").concat(members.length ? members.map(function (x) {
            var memberId = x.member_user_id || x.user_id || '';
            var memberName = x.member_name || x.name || "ID ".concat(memberId);
            var enabled = !!x.enabled;
            return "\n              <div class=\"warhub-list-item\">\n                <div class=\"warhub-row\">\n                  <div>\n                    <div class=\"warhub-name\">".concat(esc(memberName), "</div>\n                    <div class=\"warhub-meta\">").concat(esc(["ID ".concat(memberId), x.position || '', x.member_api_key_masked || ''].filter(Boolean).join(' • ')), "</div>\n                  </div>\n                  <div class=\"warhub-actions\">\n                    <span class=\"warhub-pill ").concat(enabled ? 'enabled' : 'disabled', "\">").concat(enabled ? 'Enabled' : 'Disabled', "</span>\n                    ").concat(canManage ? "<button class=\"warhub-btn small ".concat(enabled ? '' : 'good', "\" data-toggle-member=\"").concat(esc(String(memberId)), "\" data-enabled=\"").concat(enabled ? '0' : '1', "\">").concat(enabled ? 'Disable' : 'Enable', "</button>") : '', "\n                    ").concat(canManage ? "<button class=\"warhub-btn small warn\" data-del-member=\"".concat(esc(String(memberId)), "\">Delete</button>") : '', "\n                  </div>\n                </div>\n              </div>\n            ");
        }).join('') : '<div class="warhub-empty">No member access rows yet.</div>', "\n        </div>\n      </div>\n    ");
    }
    function renderAdminTab() {
        if (!isOwnerSession()) {
            return "\n        <div class=\"warhub-card\">\n          <h3>Admin</h3>\n          <div class=\"warhub-empty\">Owner access required.</div>\n        </div>\n      ";
        }
        var dash = (state === null || state === void 0 ? void 0 : state.adminDashboard) || {};
        var items = arr(dash.items || dash.factions || []);
        var summary = dash.summary || {};
        return "\n      <div class=\"warhub-card\">\n        <h3>Owner Dashboard</h3>\n        <div class=\"warhub-grid two\">\n          <div class=\"warhub-metric\"><div class=\"k\">Factions</div><div class=\"v\">".concat(fmtNum(summary.faction_licenses_total || items.length || 0), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Trials</div><div class=\"v\">").concat(fmtNum(summary.trials_total || 0), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Paid</div><div class=\"v\">").concat(fmtNum(summary.paid_total || 0), "</div></div>\n          <div class=\"warhub-metric\"><div class=\"k\">Payment Required</div><div class=\"v\">").concat(fmtNum(summary.payment_required_total || 0), "</div></div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Faction Licenses</h3>\n        <div class=\"warhub-list\">\n          ").concat(items.length ? items.map(function (x) {
            var factionId = x.faction_id || x.id || '';
            var factionName = x.faction_name || x.name || "Faction ".concat(factionId);
            return "\n              <div class=\"warhub-list-item\">\n                <div class=\"warhub-row\">\n                  <div>\n                    <div class=\"warhub-name\">".concat(esc(factionName), "</div>\n                    <div class=\"warhub-meta\">").concat(esc(["ID ".concat(factionId), x.status || '', x.leader_name || '', x.expires_at ? fmtTs(x.expires_at) : ''].filter(Boolean).join(' • ')), "</div>\n                  </div>\n                  <div class=\"warhub-actions\">\n                    <button class=\"warhub-btn small\" data-admin-history=\"").concat(esc(String(factionId)), "\">History</button>\n                    <button class=\"warhub-btn small good\" data-admin-renew=\"").concat(esc(String(factionId)), "\">Renew</button>\n                    <button class=\"warhub-btn small warn\" data-admin-expire=\"").concat(esc(String(factionId)), "\">Expire</button>\n                  </div>\n                </div>\n              </div>\n            ");
        }).join('') : '<div class="warhub-empty">No faction licenses found.</div>', "\n        </div>\n      </div>\n    ");
    }
    function renderSettingsTab() {
    var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
    var refreshMs = Number(GM_getValue(K_REFRESH, 30000)) || 30000;
    var overviewPrefs = getOverviewBoxPrefs();

    return "\n      <div class=\"warhub-card\">\n        <h3>Keys</h3>\n        <label class=\"warhub-label\">Your Torn API Key</label>\n        <input class=\"warhub-input\" id=\"wh-api-key\" value=\"".concat(esc(apiKey), "\" placeholder=\"Paste your API key\">\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"wh-save-keys\">Save Keys</button>\n          <button class=\"warhub-btn\" id=\"wh-login-btn\">Login</button>\n          <button class=\"warhub-btn warn\" id=\"wh-logout-btn\">Logout</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Overview Quick Boxes</h3>\n        <div class=\"warhub-mini\" style=\"margin-bottom:10px; line-height:1.5;\">\n          Each player can choose which boxes appear on their Overview tab.\n        </div>\n        <label class=\"warhub-check\"><input type=\"checkbox\" id=\"wh-overview-meddeals\" ").concat(overviewPrefs.meddeals ? 'checked' : '', "> Med Deals</label><br>\n        <label class=\"warhub-check\"><input type=\"checkbox\" id=\"wh-overview-dibs\" ").concat(overviewPrefs.dibs ? 'checked' : '', "> Dibs</label><br>\n        <label class=\"warhub-check\"><input type=\"checkbox\" id=\"wh-overview-terms\" ").concat(overviewPrefs.terms ? 'checked' : '', "> Terms</label><br>\n        <label class=\"warhub-check\"><input type=\"checkbox\" id=\"wh-overview-war\" ").concat(overviewPrefs.war ? 'checked' : '', "> War Overview</label>\n        <div class=\"warhub-actions\" style=\"margin-top:10px;\">\n          <button class=\"warhub-btn\" id=\"wh-save-overview-boxes\">Save Overview Boxes</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Polling</h3>\n        <label class=\"warhub-label\">Refresh every (ms)</label>\n        <input class=\"warhub-input\" id=\"wh-refresh-ms\" value=\"").concat(esc(String(refreshMs)), "\">\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn\" id=\"wh-save-refresh\">Save Refresh</button>\n          <button class=\"warhub-btn\" id=\"wh-reset-positions\">Reset Positions</button>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Access Info</h3>\n        <div class=\"warhub-mini\" style=\"line-height:1.6;\">\n          Payment player: <strong>").concat(esc((accessState === null || accessState === void 0 ? void 0 : accessState.paymentPlayer) || PAYMENT_PLAYER), "</strong><br>\n          Price per enabled member: <strong>").concat(esc(fmtMoney((accessState === null || accessState === void 0 ? void 0 : accessState.pricePerMember) || PRICE_PER_MEMBER)), "</strong><br>\n          ").concat(accessSummaryMessage() ? "Status: <strong>".concat(esc(accessSummaryMessage()), "</strong>") : 'Status: <strong>Ready</strong>', "\n        </div>\n      </div>\n    ");
}
    function renderAccessBanner() {
        var msg = accessSummaryMessage();
        if (!msg) return '';
        var cls = (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired) ? 'payment' : (accessState === null || accessState === void 0 ? void 0 : accessState.trialActive) ? 'trial' : 'good';
        return "\n      <div class=\"warhub-banner ".concat(cls, "\">\n        <div><strong>Faction Access</strong></div>\n        <div class=\"warhub-mini\" style=\"margin-top:6px;\">").concat(esc(msg), "</div>\n      </div>\n    ");
    }
    function tabLocked(key) {
        if (isOwnerSession()) return false;
        if (key === 'admin') return !isOwnerSession();
        if (key === 'terms' || key === 'faction') return !(accessState !== null && accessState !== void 0 && accessState.isFactionLeader);
        return false;
    }
    function tabBtn(key, label) {
        var active = currentTab === key ? 'active' : '';
        var locked = tabLocked(key) ? 'locked' : '';
        return "<button class=\"warhub-tab ".concat(active, " ").concat(locked, "\" data-tab=\"").concat(esc(key), "\">").concat(esc(label), "</button>");
    }
    function renderTabContent() {
    switch (currentTab) {
        case 'overview': return renderOverviewTab();
        case 'faction': return "".concat(renderAccessBanner()).concat(renderFactionTab());
        case 'war': return "".concat(renderAccessBanner()).concat(renderWarTab());
        case 'chain': return "".concat(renderAccessBanner()).concat(renderChainTab());
        case 'terms': return renderTermsTab();
        case 'members': return "".concat(renderAccessBanner()).concat(renderMembersTab());
        case 'enemies': return "".concat(renderAccessBanner()).concat(renderEnemiesTab());
        case 'hospital': return "".concat(renderAccessBanner()).concat(renderHospitalTab());
        case 'meddeals': return "".concat(renderAccessBanner()).concat(renderMedDealsTab());
        case 'targets': return "".concat(renderAccessBanner()).concat(renderTargetsTab());
        case 'assignments': return "".concat(renderAccessBanner()).concat(renderAssignmentsTab());
        case 'notes': return "".concat(renderAccessBanner()).concat(renderNotesTab());
        case 'instructions': return renderInstructionsTab();
        case 'settings': return renderSettingsTab();
        case 'admin': return renderAdminTab();
        default: return renderOverviewTab();
    }
}
    function renderBody() {
        if (!overlay) return;
        overlay.innerHTML = "\n      <div class=\"warhub-head\" id=\"warhub-drag-handle\">\n        <div class=\"warhub-toprow\">\n          <div>\n            <div class=\"warhub-title\">War Hub</div>\n            <div class=\"warhub-sub\">Fries91 • Torn overlay</div>\n          </div>\n          <button class=\"warhub-close\" id=\"warhub-close-btn\" type=\"button\">Close</button>\n        </div>\n      </div>\n      <div class=\"warhub-tabs\">\n        ".concat(TAB_ORDER.map(function (_ref) {
            var key = _ref[0], label = _ref[1];
            return tabBtn(key, label);
        }).join(''), "\n      </div>\n      <div class=\"warhub-body\">\n        <div id=\"warhub-status\" class=\"warhub-status\"></div>\n        ").concat(renderTabContent(), "\n      </div>\n    ");
        bindOverlayEvents();
        bindOverlayDrag();
        restoreStatus();
    }
    function clampElementPosition(el, left, top) {
        var rect = el.getBoundingClientRect();
        var w = rect.width || parseInt(getComputedStyle(el).width, 10) || 320;
        var h = rect.height || parseInt(getComputedStyle(el).height, 10) || 320;
        var maxLeft = Math.max(4, window.innerWidth - w - 4);
        var maxTop = Math.max(4, window.innerHeight - h - 4);
        var clampedLeft = Math.min(Math.max(4, left), maxLeft);
        var clampedTop = Math.min(Math.max(4, top), maxTop);
        el.style.left = "".concat(clampedLeft, "px");
        el.style.top = "".concat(clampedTop, "px");
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }
    function clampToViewport(el) {
        if (!el) return;
        var rect = el.getBoundingClientRect();
        clampElementPosition(el, rect.left, rect.top);
    }
    function updateBadge() {
        if (!shield || !badge) return;
        var n = unreadCount();
        if (!n) {
            badge.style.display = 'none';
            return;
        }
        var r = shield.getBoundingClientRect();
        badge.style.display = 'block';
        badge.textContent = String(n > 99 ? '99+' : n);
        badge.style.left = "".concat(r.right - 10, "px");
        badge.style.top = "".concat(r.top - 6, "px");
        badge.style.right = 'auto';
        badge.style.bottom = 'auto';
    }
    function resetShieldPosition() {
        if (!shield) return;
        shield.style.left = 'auto';
        shield.style.top = '120px';
        shield.style.right = '14px';
        shield.style.bottom = 'auto';
        if (window.innerWidth <= 700) {
            shield.style.right = '8px';
            shield.style.top = '82px';
        }
    }
    function positionOverlayNearShield() {
        if (!shield || !overlay) return;
        var sr = shield.getBoundingClientRect();
        var overlayWidth = Math.min(window.innerWidth - 16, 520);
        var left = sr.right - overlayWidth;
        var top = sr.bottom + 8;
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
        overlay.classList.add('open');
        if (!GM_getValue(K_OVERLAY_POS, null)) positionOverlayNearShield();
        clampToViewport(overlay);
        renderBody();
    }
    function closeOverlay() {
        if (!overlay) return;
        isOpen = false;
        GM_setValue(K_OPEN, false);
        overlay.classList.remove('open');
    }
    function toggleOverlay() {
        if (isOpen) closeOverlay(); else openOverlay();
    }
    function saveOverlayPos() {
        if (!overlay) return;
        GM_setValue(K_OVERLAY_POS, {
            left: overlay.style.left || '',
            top: overlay.style.top || '',
            right: overlay.style.right || '',
            bottom: overlay.style.bottom || ''
        });
    }
    function saveShieldPos() {
        if (!shield) return;
        GM_setValue(K_SHIELD_POS, {
            left: shield.style.left || '',
            top: shield.style.top || '',
            right: shield.style.right || '',
            bottom: shield.style.bottom || ''
        });
    }
    function makeDraggable(handleEl, moveEl, saveFn, extra) {
        var active = null;
        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;
        var moved = false;
        var THRESHOLD = 6;
        function cleanup() {
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            document.removeEventListener('pointercancel', onUp, true);
            handleEl.classList.remove('dragging');
            moveEl.classList.remove('dragging');
            moveEl.dataset.dragging = '0';
            active = null;
        }
        function onMove(e) {
            if (active !== e.pointerId) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (!moved && (Math.abs(dx) >= THRESHOLD || Math.abs(dy) >= THRESHOLD)) moved = true;
            if (!moved) return;
            e.preventDefault();
            dragMoved = true;
            handleEl.classList.add('dragging');
            moveEl.classList.add('dragging');
            moveEl.dataset.dragging = '1';
            clampElementPosition(moveEl, startLeft + dx, startTop + dy);
            if (typeof extra === 'function') extra();
        }
        function onUp(e) {
            if (active !== e.pointerId) return;
            if (moved && typeof saveFn === 'function') saveFn();
            setTimeout(function () {
                dragMoved = false;
            }, 120);
            cleanup();
        }
        handleEl.addEventListener('pointerdown', function (e) {
            var t = e.target;
            if (t && (t.closest('button') || t.closest('a') || t.closest('input') || t.closest('textarea') || t.closest('select') || t.closest('summary'))) return;
            active = e.pointerId;
            moved = false;
            dragMoved = false;
            var rect = moveEl.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            moveEl.style.left = "".concat(rect.left, "px");
            moveEl.style.top = "".concat(rect.top, "px");
            moveEl.style.right = 'auto';
            moveEl.style.bottom = 'auto';
            if (handleEl.setPointerCapture) handleEl.setPointerCapture(e.pointerId);
            document.addEventListener('pointermove', onMove, true);
            document.addEventListener('pointerup', onUp, true);
            document.addEventListener('pointercancel', onUp, true);
        });
    }
    function bindOverlayDrag() {
        var handle = overlay ? overlay.querySelector('#warhub-drag-handle') : null;
        if (!handle || !overlay) return;
        makeDraggable(handle, overlay, saveOverlayPos, updateBadge);
    }
    function loadAdminDashboard() {
        return _loadAdminDashboard.apply(this, arguments);
    }
    function _loadAdminDashboard() {
        _loadAdminDashboard = _asyncToGenerator(function* () {
            if (!isOwnerSession()) return null;
            var res = yield adminReq('GET', '/api/admin/faction-licenses');
            if (!res.ok) {
                setStatus(res.error || 'Could not load owner dashboard.', true);
                return null;
            }
            state = state || {};
            state.adminDashboard = _objectSpread(_objectSpread({}, res.data || {}), {}, {
                items: arr((res.data === null || res.data === void 0 ? void 0 : res.data.items) || (res.data === null || res.data === void 0 ? void 0 : res.data.factions) || []),
                summary: (res.data === null || res.data === void 0 ? void 0 : res.data.summary) || {}
            });
            if (overlay && isOpen && currentTab === 'admin') renderBody();
            return state.adminDashboard;
        });
        return _loadAdminDashboard.apply(this, arguments);
    }
    function bindOverlayEvents() {
        if (overlay) overlay.querySelectorAll('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var tab = btn.getAttribute('data-tab') || 'war';
                currentTab = tab;
                GM_setValue(K_TAB, currentTab);
                if (tab === 'faction' && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession())) yield loadFactionMembers(true);
                if (tab === 'admin' && isOwnerSession()) yield loadAdminDashboard();
                renderBody();
            }));
        });
        var closeBtn = overlay ? overlay.querySelector('#warhub-close-btn') : null;
        if (closeBtn) closeBtn.addEventListener('click', function () { closeOverlay(); });
        var snapBtn = overlay ? overlay.querySelector('#warhub-save-snapshot') : null;
        if (snapBtn) snapBtn.addEventListener('click', _asyncToGenerator(function* () { yield doAction('POST', '/api/war/snapshot', {}, 'War snapshot saved.'); }));
        var avOn = overlay ? overlay.querySelector('#warhub-set-available') : null;
        if (avOn) avOn.addEventListener('click', _asyncToGenerator(function* () { yield doAction('POST', '/api/availability', { available: true }, 'Availability set to available.'); }));
        var avOff = overlay ? overlay.querySelector('#warhub-set-unavailable') : null;
        if (avOff) avOff.addEventListener('click', _asyncToGenerator(function* () { yield doAction('POST', '/api/availability', { available: false }, 'Availability set to unavailable.'); }));
        var chOn = overlay ? overlay.querySelector('#warhub-set-chain-on') : null;
        if (chOn) chOn.addEventListener('click', _asyncToGenerator(function* () { yield doAction('POST', '/api/chain-sitter', { enabled: true }, 'Chain sitter enabled.'); }));
        var chOff = overlay ? overlay.querySelector('#warhub-set-chain-off') : null;
        if (chOff) chOff.addEventListener('click', _asyncToGenerator(function* () { yield doAction('POST', '/api/chain-sitter', { enabled: false }, 'Chain sitter disabled.'); }));
        var medAdd = overlay ? overlay.querySelector('#warhub-med-add') : null;
if (medAdd) medAdd.addEventListener('click', _asyncToGenerator(function* () {
    var itemField = overlay ? overlay.querySelector('#warhub-med-item') : null;
    var noteField = overlay ? overlay.querySelector('#warhub-med-note') : null;

    var seller_name = cleanInputValue(
        (state && state.me && (state.me.name || state.me.player_name)) ||
        (state && state.user && (state.user.name || state.user.player_name)) ||
        ''
    );

    var item_name = cleanInputValue((itemField ? itemField.value : '') || '');
    var note = cleanInputValue((noteField ? noteField.value : '') || '');

    if (!seller_name || !item_name) {
        setStatus('Enemy is required.', true);
        return;
    }

    var res = yield doAction('POST', '/api/med-deals', {
        seller_name: seller_name,
        item_name: item_name,
        price: '',
        note: note
    }, 'Med deal added.');

    if (res) renderBody();
}));
        
        if (overlay) overlay.querySelectorAll('.warhub-del-med').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var id = cleanInputValue(btn.getAttribute('data-id') || '');
                if (!id) return;
                var res = yield doAction('DELETE', "/api/med-deals/".concat(encodeURIComponent(id)), null, 'Med deal deleted.');
                if (res) renderBody();
            }));
        });
        if (overlay) overlay.querySelectorAll('.warhub-dibs-btn').forEach(function (btn) {
    btn.addEventListener('click', _asyncToGenerator(function* () {
        var targetId = cleanInputValue(btn.getAttribute('data-target-id') || '');
        var targetName = cleanInputValue(btn.getAttribute('data-target-name') || '');

        if (!targetId) return;

        var res = yield doAction('POST', '/api/dibs', {
            target_id: targetId,
            target_name: targetName
        }, 'Dibs claimed.', false);

        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));
});
        
        var targetSel = overlay ? overlay.querySelector('#warhub-target-enemy') : null;
        if (targetSel) targetSel.addEventListener('change', function () {
            var opt = targetSel.selectedOptions ? targetSel.selectedOptions[0] : null;
            var id = cleanInputValue((opt === null || opt === void 0 ? void 0 : opt.value) || '');
            overlay.querySelector('#warhub-target-id').value = id;
        });
        var targetAdd = overlay ? overlay.querySelector('#warhub-target-add') : null;
        if (targetAdd) targetAdd.addEventListener('click', _asyncToGenerator(function* () {
            var sel = overlay.querySelector('#warhub-target-enemy');
            var opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
            var target_id = cleanInputValue((overlay.querySelector('#warhub-target-id').value) || ((opt === null || opt === void 0 ? void 0 : opt.value) || ''));
            var target_name = cleanInputValue((opt === null || opt === void 0 ? void 0 : opt.dataset.name) || '');
            var notes = cleanInputValue(overlay.querySelector('#warhub-target-notes').value || '');
            if (!target_id) { setStatus('Target ID is required.', true); return; }
            var res = yield doAction('POST', '/api/targets', { target_id: target_id, target_name: target_name, notes: notes }, 'Target added.');
            if (res) renderBody();
        }));
        if (overlay) overlay.querySelectorAll('.warhub-del-target').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var id = cleanInputValue(btn.getAttribute('data-id') || '');
                if (!id) return;
                var res = yield doAction('DELETE', "/api/targets/".concat(encodeURIComponent(id)), null, 'Target deleted.');
                if (res) renderBody();
            }));
        });
        var saveAssign = overlay ? overlay.querySelector('#wh-save-assignment') : null;
        if (saveAssign) saveAssign.addEventListener('click', _asyncToGenerator(function* () {
            var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');
            var target_id = cleanInputValue(overlay.querySelector('#wh-assignment-target-id').value || '');
            var target_name = cleanInputValue(overlay.querySelector('#wh-assignment-target-name').value || '');
            var sel = overlay.querySelector('#wh-assignment-member');
            var opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
            var assigned_to_user_id = cleanInputValue((opt === null || opt === void 0 ? void 0 : opt.value) || '');
            var assigned_to_name = cleanInputValue((opt === null || opt === void 0 ? void 0 : opt.dataset.name) || '');
            var priority = cleanInputValue(overlay.querySelector('#wh-assignment-priority').value || 'normal');
            var note = cleanInputValue(overlay.querySelector('#wh-assignment-note').value || '');
            if (!war_id || !target_id) { setStatus('War ID and target ID are required.', true); return; }
            var res = yield doAction('POST', '/api/war/assignments', {
                war_id: war_id,
                target_id: target_id,
                target_name: target_name,
                assigned_to_user_id: assigned_to_user_id,
                assigned_to_name: assigned_to_name,
                priority: priority,
                note: note
            }, 'Assignment saved.');
            if (res) renderBody();
        }));
        if (overlay) overlay.querySelectorAll('[data-del-assignment-live]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var id = cleanInputValue(btn.getAttribute('data-del-assignment-live') || '');
                if (!id) return;
                var res = yield doAction('DELETE', "/api/war/assignments/".concat(encodeURIComponent(id)), null, 'Assignment deleted.');
                if (res) renderBody();
            }));
        });
        var saveNotes = overlay ? overlay.querySelector('#wh-save-notes') : null;
        if (saveNotes) saveNotes.addEventListener('click', function () {
            var txt = overlay.querySelector('#wh-notes').value || '';
            setNotes(txt);
            setStatus('Local notes saved.');
        });
        var clearNotes = overlay ? overlay.querySelector('#wh-clear-notes') : null;
        if (clearNotes) clearNotes.addEventListener('click', function () {
            setNotes('');
            renderBody();
            setStatus('Local notes cleared.');
        });
        var addServerNote = overlay ? overlay.querySelector('#wh-add-server-note') : null;
        if (addServerNote) addServerNote.addEventListener('click', _asyncToGenerator(function* () {
            var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');
            var target_id = cleanInputValue(overlay.querySelector('#wh-note-target-id').value || '');
            var note = cleanInputValue(overlay.querySelector('#wh-note-text').value || '');
            if (!war_id || !target_id || !note) { setStatus('War ID, target ID and note are required.', true); return; }
            var res = yield doAction('POST', '/api/war/notes', { war_id: war_id, target_id: target_id, note: note }, 'Shared note saved.');
            if (res) renderBody();
        }));
        if (overlay) overlay.querySelectorAll('[data-del-note-live]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var id = cleanInputValue(btn.getAttribute('data-del-note-live') || '');
                if (!id) return;
                var res = yield doAction('DELETE', "/api/war/notes/".concat(encodeURIComponent(id)), null, 'Shared note deleted.');
                if (res) renderBody();
            }));
        });
        var saveTerms = overlay ? overlay.querySelector('#warhub-terms-save') : null;
        if (saveTerms) saveTerms.addEventListener('click', _asyncToGenerator(function* () {
            var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');
            var terms = cleanInputValue(overlay.querySelector('#warhub-terms-text').value || '');
            if (!war_id) { setStatus('No active war detected.', true); return; }
            var res = yield doAction('POST', '/api/war-terms', { war_id: war_id, terms: terms }, 'War terms saved.');
            if (res) renderBody();
        }));
        var delTerms = overlay ? overlay.querySelector('#warhub-terms-delete') : null;
        if (delTerms) delTerms.addEventListener('click', _asyncToGenerator(function* () {
            var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');
            if (!war_id) { setStatus('No active war detected.', true); return; }
            var res = yield doAction('DELETE', "/api/war-terms?war_id=".concat(encodeURIComponent(war_id)), null, 'War terms deleted.');
            if (res) renderBody();
        }));
        var refreshAlerts = overlay ? overlay.querySelector('#wh-mark-alerts-seen') : null;
        if (refreshAlerts) refreshAlerts.addEventListener('click', _asyncToGenerator(function* () {
            var res = yield req('GET', '/api/notifications');
            if (!res.ok) { setStatus(res.error || 'Could not refresh notifications.', true); return; }
            setStatus('Notifications refreshed.');
            yield loadState(true);
            renderBody();
        }));
        var clearAlerts = overlay ? overlay.querySelector('#wh-clear-alerts') : null;
        if (clearAlerts) clearAlerts.addEventListener('click', function () {
            setLocalNotifications([]);
            updateBadge();
            renderBody();
            setStatus('Local notifications cleared.');
        });
        var saveFactionMember = overlay ? overlay.querySelector('#wh-fm-save') : null;
        if (saveFactionMember) saveFactionMember.addEventListener('click', _asyncToGenerator(function* () {
            var member_user_id = cleanInputValue(overlay.querySelector('#wh-fm-userid').value || '');
            var member_name = cleanInputValue(overlay.querySelector('#wh-fm-name').value || '');
            var member_api_key = cleanInputValue(overlay.querySelector('#wh-fm-key').value || '');
            var position = cleanInputValue(overlay.querySelector('#wh-fm-position').value || '');
            if (!member_user_id) { setStatus('Member user ID is required.', true); return; }
            var res = yield doAction('POST', '/api/faction/members', {
                member_user_id: member_user_id,
                member_name: member_name,
                member_api_key: member_api_key,
                enabled: true,
                position: position
            }, 'Faction member access saved.', false);
            if (res) { yield refreshLeaderFactionData(); setStatus('Faction member access saved.'); }
        }));
        if (overlay) overlay.querySelectorAll('[data-toggle-member]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var memberId = cleanInputValue(btn.getAttribute('data-toggle-member') || '');
                var enabled = cleanInputValue(btn.getAttribute('data-enabled') || '') === '1';
                if (!memberId) return;
                var res = yield doAction('POST', "/api/faction/members/".concat(encodeURIComponent(memberId), "/enable"), { enabled: enabled }, enabled ? 'Member enabled.' : 'Member disabled.', false);
                if (res) yield refreshLeaderFactionData();
            }));
        });
        if (overlay) overlay.querySelectorAll('[data-del-member]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var memberId = cleanInputValue(btn.getAttribute('data-del-member') || '');
                if (!memberId) return;
                var res = yield doAction('DELETE', "/api/faction/members/".concat(encodeURIComponent(memberId)), null, 'Faction member removed.', false);
                if (res) yield refreshLeaderFactionData();
            }));
        });
        if (overlay) overlay.querySelectorAll('[data-admin-history]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var factionId = cleanInputValue(btn.getAttribute('data-admin-history') || '');
                if (!factionId) return;
                var res = yield adminReq('GET', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/history"));
                if (!res.ok) { setStatus(res.error || 'Could not load payment history.', true); return; }
                var items = arr((res.data === null || res.data === void 0 ? void 0 : res.data.items) || []);
                var lines = items.length ? items.map(function (x) {
                    var amount = x.amount != null ? fmtMoney(x.amount) : '—';
                    var when = fmtTs(x.created_at || x.ts || x.time || '');
                    var by = x.renewed_by || x.created_by || x.payment_player || '';
                    return "".concat(when, " • ").concat(amount).concat(by ? " • ".concat(by) : '');
                }).join('\n') : 'No payment history found.';
                alert(lines);
            }));
        });
        if (overlay) overlay.querySelectorAll('[data-admin-renew]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var factionId = cleanInputValue(btn.getAttribute('data-admin-renew') || '');
                if (!factionId) return;
                var amountText = prompt('Renew faction for how much?', String(PRICE_PER_MEMBER));
                if (amountText == null) return;
                var amount = Number(String(amountText).replace(/[^\d.-]/g, ''));
                if (!Number.isFinite(amount) || amount <= 0) { setStatus('Invalid renewal amount.', true); return; }
                var note = prompt('Optional note for renewal:', '') || '';
                var res = yield adminReq('POST', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/renew"), { amount: amount, note: note });
                if (!res.ok) { setStatus(res.error || 'Renew failed.', true); return; }
                setStatus('Faction renewed.');
                yield loadAdminDashboard();
            }));
        });
        if (overlay) overlay.querySelectorAll('[data-admin-expire]').forEach(function (btn) {
            btn.addEventListener('click', _asyncToGenerator(function* () {
                var factionId = cleanInputValue(btn.getAttribute('data-admin-expire') || '');
                if (!factionId) return;
                if (!confirm("Expire faction ".concat(factionId, "?"))) return;
                var res = yield adminReq('POST', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/expire"), {});
                if (!res.ok) { setStatus(res.error || 'Expire failed.', true); return; }
                setStatus('Faction expired.');
                yield loadAdminDashboard();
            }));
        });
        var saveKeys = overlay ? overlay.querySelector('#wh-save-keys') : null;
        if (saveKeys) saveKeys.addEventListener('click', function () {
            var apiKey = cleanInputValue(overlay.querySelector('#wh-api-key').value || '');
            GM_setValue(K_API_KEY, apiKey);
            setStatus('API key saved locally.');
        });
        var loginBtn = overlay ? overlay.querySelector('#wh-login-btn') : null;
        if (loginBtn) loginBtn.addEventListener('click', _asyncToGenerator(function* () {
            var apiKey = cleanInputValue(overlay.querySelector('#wh-api-key').value || '');
            if (apiKey) GM_setValue(K_API_KEY, apiKey);
            var okLogin = yield login(true);
            if (!okLogin) return;
            setStatus('Login successful.');
            yield loadState(true);
            renderBody();
        }));
        var logoutBtn = overlay ? overlay.querySelector('#wh-logout-btn') : null;
        if (logoutBtn) logoutBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield req('POST', '/api/logout', {});
            clearSavedKeys();
            state = null;
            analyticsCache = null;
            factionMembersCache = null;
            accessState = normalizeAccessCache({});
            saveAccessCache();
            renderBody();
            updateBadge();
            setStatus('Logged out.');
        }));
        var saveRefresh = overlay ? overlay.querySelector('#wh-save-refresh') : null;
        if (saveRefresh) saveRefresh.addEventListener('click', function () {
    var raw = cleanInputValue(overlay.querySelector('#wh-refresh-ms').value || '30000');
    var ms = Math.max(10000, Number(raw) || 30000);
    GM_setValue(K_REFRESH, ms);
    startPolling();
    setStatus("Refresh saved: ".concat(ms, "ms"));
});

var resetPositions = overlay ? overlay.querySelector('#wh-reset-positions') : null;
if (resetPositions) resetPositions.addEventListener('click', function () {
    GM_deleteValue(K_SHIELD_POS);
    GM_deleteValue(K_OVERLAY_POS);
    resetShieldPosition();
    positionOverlayNearShield();
    saveShieldPos();
    saveOverlayPos();
    updateBadge();
    setStatus('Positions reset.');
});

var saveOverviewBoxes = overlay ? overlay.querySelector('#wh-save-overview-boxes') : null;
if (saveOverviewBoxes) saveOverviewBoxes.addEventListener('click', function () {
    var prefs = {
        meddeals: !!(overlay.querySelector('#wh-overview-meddeals') && overlay.querySelector('#wh-overview-meddeals').checked),
        dibs: !!(overlay.querySelector('#wh-overview-dibs') && overlay.querySelector('#wh-overview-dibs').checked),
        terms: !!(overlay.querySelector('#wh-overview-terms') && overlay.querySelector('#wh-overview-terms').checked),
        war: !!(overlay.querySelector('#wh-overview-war') && overlay.querySelector('#wh-overview-war').checked)
    };
    GM_setValue(K_OVERVIEW_BOXES, prefs);
    setStatus('Overview boxes saved.');
    renderBody();
});

if (overlay) overlay.querySelectorAll('[data-overview-go]').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var nextTab = cleanInputValue(btn.getAttribute('data-overview-go') || '');
        if (!nextTab) return;
        currentTab = nextTab;
        GM_setValue(K_TAB, currentTab);
        renderBody();
    });
});
}
    function mount() {
        if (mounted) return;
        mounted = true;
        shield = document.createElement('div');
        shield.id = 'warhub-shield';
        shield.textContent = '⚔️';
        badge = document.createElement('div');
        badge.id = 'warhub-badge';
        overlay = document.createElement('div');
        overlay.id = 'warhub-overlay';
        document.body.appendChild(shield);
        document.body.appendChild(badge);
        document.body.appendChild(overlay);
        var savedShield = GM_getValue(K_SHIELD_POS, null);
if (savedShield && typeof savedShield === 'object') {
    if (savedShield.left) shield.style.left = savedShield.left;
    if (savedShield.top) shield.style.top = savedShield.top;
    if (savedShield.right) shield.style.right = savedShield.right;
    if (savedShield.bottom) shield.style.bottom = savedShield.bottom;
} else {
    resetShieldPosition();
}
clampToViewport(shield);
saveShieldPos();
        var savedOverlay = GM_getValue(K_OVERLAY_POS, null);
if (savedOverlay && typeof savedOverlay === 'object') {
    if (savedOverlay.left) overlay.style.left = savedOverlay.left;
    if (savedOverlay.top) overlay.style.top = savedOverlay.top;
    if (savedOverlay.right) overlay.style.right = savedOverlay.right;
    if (savedOverlay.bottom) overlay.style.bottom = savedOverlay.bottom;
} else {
    positionOverlayNearShield();
}
clampToViewport(overlay);
saveOverlayPos();
        makeDraggable(shield, shield, saveShieldPos, function () {
            updateBadge();
            if (!GM_getValue(K_OVERLAY_POS, null) && !isOpen) positionOverlayNearShield();
        });
        shield.addEventListener('click', function (e) {
            if (dragMoved || (shield && shield.dataset.dragging === '1')) return;
            e.preventDefault();
            e.stopPropagation();
            toggleOverlay();
        });
        window.addEventListener('resize', function () {
            clampToViewport(shield);
            clampToViewport(overlay);
            updateBadge();
        });
        renderBody();
        if (isOpen) overlay.classList.add('open'); else overlay.classList.remove('open');
        updateBadge();
    }
    function keepMounted() {
        if (!document.body) return;
        if (!document.getElementById('warhub-shield') || !document.getElementById('warhub-overlay')) {
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
        var ms = Math.max(10000, Number(GM_getValue(K_REFRESH, 30000)) || 30000);
        pollTimer = setInterval(function () {
            return _asyncToGenerator(function* () {
                if (!cleanInputValue(GM_getValue(K_SESSION, ''))) return;
                yield loadState(true);
                updateBadge();
            })();
        }, ms);
    }
    function boot() {
        return _boot.apply(this, arguments);
    }
    function _boot() {
        _boot = _asyncToGenerator(function* () {
            mount();
            startMountWatcher();
            startPolling();
            var health = yield healthCheck();
            if (!health.ok) {
                setStatus('Server offline or unreachable.', true);
                return;
            }
            var hasApiKey = !!cleanInputValue(GM_getValue(K_API_KEY, ''));
            var hasSession = !!cleanInputValue(GM_getValue(K_SESSION, ''));
            if (hasApiKey && !hasSession) yield login(false);
            if (cleanInputValue(GM_getValue(K_SESSION, '')) && canUseProtectedFeatures()) {
                yield loadState(true);
                yield loadAnalytics().catch(function () { return null; });
                updateBadge();
                if (isOpen) renderBody();
            } else {
                renderBody();
            }
        });
        return _boot.apply(this, arguments);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    function _toConsumableArray(arr) {
        if (Array.isArray(arr)) return arr.slice();
        return Array.from(arr || []);
    }
    function _defineProperty(obj, key, value) {
        if (key in obj) {
            Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
        } else {
            obj[key] = value;
        }
        return obj;
    }
    function _objectSpread(target) {
        for (var i = 1; i < arguments.length; i++) {
            var source = arguments[i] != null ? arguments[i] : {};
            var ownKeys = Object.keys(source);
            if (typeof Object.getOwnPropertySymbols === 'function') {
                ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) {
                    return Object.getOwnPropertyDescriptor(source, sym).enumerable;
                }));
            }
            ownKeys.forEach(function (key) {
                _defineProperty(target, key, source[key]);
            });
        }
        return target;
    }
    function _typeof(obj) {
        return typeof obj;
    }
    function _asyncToGenerator(fn) {
        return function () {
            var self = this, args = arguments;
            return new Promise(function (resolve, reject) {
                var gen = fn.apply(self, args);
                function step(key, arg) {
                    var info;
                    try { info = gen[key](arg); } catch (error) { reject(error); return; }
                    var value = info.value;
                    if (info.done) {
                        resolve(value);
                    } else {
                        Promise.resolve(value).then(function (val) { step('next', val); }, function (err) { step('throw', err); });
                    }
                }
                step('next');
            });
        };
    }
})();
