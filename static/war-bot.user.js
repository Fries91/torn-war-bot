// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.0.9
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
var K_LOCAL_NOTIFICATIONS = 'warhub_local_notifications_v3';
var K_ACCESS_CACHE = 'warhub_access_cache_v3';
var K_OVERVIEW_BOXES = 'warhub_overview_boxes_v3';
var K_OVERLAY_SCROLL = 'warhub_overlay_scroll_v3';
    var factionMembersCache = null;
    var PAYMENT_PLAYER = 'Fries91';
    var OWNER_NAME = 'Fries91';
    var OWNER_USER_ID = '3679030';
    var PRICE_PER_MEMBER = 3;
    var TAB_ORDER = [
    ['overview', 'Overview'],
    ['faction', 'Faction'],
    ['war', 'War'],
    ['summary', 'Summary'],
    ['chain', 'Chain'],
    ['terms', 'Terms'],
    ['members', 'Members'],
    ['enemies', 'Enemies'],
    ['hospital', 'Hospital'],
    ['meddeals', 'Med Deals'],
    ['targets', 'Targets'],
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
    var css = "\n    #warhub-shield {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      width: 42px !important;\n      height: 42px !important;\n      border-radius: 12px !important;\n      display: flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      font-size: 22px !important;\n      line-height: 1 !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n      color: #fff !important;\n      top: 120px !important;\n      right: 14px !important;\n      left: auto !important;\n      bottom: auto !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      pointer-events: auto !important;\n    }\n    #warhub-shield.dragging { cursor: grabbing !important; }\n\n    #warhub-badge {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      min-width: 16px !important;\n      height: 16px !important;\n      padding: 0 4px !important;\n      border-radius: 999px !important;\n      background: #ffd54a !important;\n      color: #111 !important;\n      font-size: 10px !important;\n      line-height: 16px !important;\n      text-align: center !important;\n      font-weight: 800 !important;\n      box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;\n      display: none !important;\n      pointer-events: none !important;\n    }\n\n    #warhub-overlay {\n      position: fixed !important;\n      z-index: 2147483646 !important;\n      right: 12px !important;\n      top: 170px !important;\n      width: min(96vw, 520px) !important;\n      height: min(88vh, 900px) !important;\n      max-height: 88vh !important;\n      min-height: 420px !important;\n      overflow: hidden !important;\n      border-radius: 14px !important;\n      background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n      color: #f2f2f2 !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n      display: none !important;\n      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n      left: auto !important;\n      bottom: auto !important;\n      flex-direction: column !important;\n      box-sizing: border-box !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n    }\n    #warhub-overlay.open { display: flex !important; }\n\n    #warhub-overlay *,\n    #warhub-overlay *::before,\n    #warhub-overlay *::after {\n      box-sizing: border-box !important;\n    }\n\n    .warhub-head {\n      padding: 10px 12px 9px !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      flex: 0 0 auto !important;\n      display: block !important;\n      width: 100% !important;\n      min-height: 54px !important;\n    }\n    .warhub-head.dragging { cursor: grabbing !important; }\n\n    .warhub-toprow {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 10px !important;\n      width: 100% !important;\n    }\n\n    .warhub-title {\n      font-weight: 800 !important;\n      font-size: 16px !important;\n      letter-spacing: .2px !important;\n      color: #fff !important;\n    }\n    .warhub-sub {\n      opacity: .72 !important;\n      font-size: 11px !important;\n      margin-top: 2px !important;\n      color: #fff !important;\n    }\n\n    .warhub-close {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 9px !important;\n      background: rgba(255,255,255,.08) !important;\n      color: #fff !important;\n      padding: 5px 9px !important;\n      font-weight: 700 !important;\n      cursor: pointer !important;\n      font-size: 12px !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n    }\n\n    .warhub-tabs {\n      display: flex !important;\n      flex: 0 0 auto !important;\n      flex-wrap: nowrap !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 8px !important;\n      overflow-x: auto !important;\n      overflow-y: hidden !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: rgba(255,255,255,.02) !important;\n      scrollbar-width: thin !important;\n      -webkit-overflow-scrolling: touch !important;\n      width: 100% !important;\n      min-height: 48px !important;\n      max-height: 48px !important;\n      white-space: nowrap !important;\n    }\n\n    .warhub-tab {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      color: #fff !important;\n      padding: 6px 10px !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n      white-space: nowrap !important;\n      cursor: pointer !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n      line-height: 1.1 !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      gap: 6px !important;\n    }\n    .warhub-tab.active {\n      background: linear-gradient(180deg, #d23333, #831515) !important;\n      color: #fff !important;\n    }\n    .warhub-tab.locked {\n      opacity: .55 !important;\n    }\n\n    .warhub-body {\n      padding: 8px !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      flex: 1 1 auto !important;\n      min-height: 0 !important;\n      width: 100% !important;\n      display: block !important;\n    }\n\n    .warhub-status {\n      display: none !important;\n      margin-bottom: 8px !important;\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      font-size: 12px !important;\n      background: rgba(255,255,255,.06) !important;\n      color: #fff !important;\n    }\n    .warhub-status.show { display: block !important; }\n    .warhub-status.err {\n      background: rgba(185,52,52,.22) !important;\n      color: #ffdcdc !important;\n    }\n\n    .warhub-banner {\n      margin-bottom: 8px !important;\n      padding: 10px 12px !important;\n      border-radius: 12px !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: rgba(255,255,255,.05) !important;\n      color: #fff !important;\n    }\n    .warhub-banner.payment {\n      background: linear-gradient(180deg, rgba(150,43,43,.38), rgba(72,19,19,.26)) !important;\n      border-color: rgba(255,130,130,.22) !important;\n    }\n    .warhub-banner.trial {\n      background: linear-gradient(180deg, rgba(164,116,25,.34), rgba(83,59,12,.22)) !important;\n      border-color: rgba(255,215,118,.22) !important;\n    }\n    .warhub-banner.good {\n      background: linear-gradient(180deg, rgba(35,140,82,.30), rgba(21,96,58,.20)) !important;\n      border-color: rgba(109,214,143,.18) !important;\n    }\n\n    .warhub-grid { display: grid !important; gap: 8px !important; }\n    .warhub-grid.two { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }\n    .warhub-grid.three { grid-template-columns: repeat(3, minmax(0,1fr)) !important; }\n\n    .warhub-card {\n      border: 1px solid rgba(255,255,255,.07) !important;\n      background: rgba(255,255,255,.03) !important;\n      border-radius: 12px !important;\n      padding: 10px !important;\n      margin-bottom: 8px !important;\n      overflow: hidden !important;\n      color: #fff !important;\n    }\n\n    .warhub-card h3 {\n      margin: 0 0 8px !important;\n      font-size: 13px !important;\n      font-weight: 800 !important;\n      letter-spacing: .2px !important;\n      color: #fff !important;\n    }\n\n    .warhub-section-title {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      margin-bottom: 8px !important;\n    }\n\n    .warhub-count {\n      padding: 4px 8px !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.08) !important;\n      font-size: 11px !important;\n      font-weight: 800 !important;\n      color: #fff !important;\n    }\n\n    .warhub-roster-card.hospital-box {\n      border-color: rgba(255,130,130,.16) !important;\n      background: linear-gradient(180deg, rgba(145,37,37,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-roster-card.online-box {\n      border-color: rgba(109,214,143,.16) !important;\n      background: linear-gradient(180deg, rgba(31,120,63,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-roster-card.idle-box {\n      border-color: rgba(255,215,118,.16) !important;\n      background: linear-gradient(180deg, rgba(145,114,27,.18), rgba(255,255,255,.03)) !important;\n    }\n\n  .warhub-roster-card.travel-box {border-color: rgba(90,160,255,.16) !important;background: linear-gradient(180deg, rgba(36,87,155,.18), rgba(255,255,255,.03)) !important} .warhub-roster-card.jail-box {border-color: rgba(183,120,255,.16) !important;background: linear-gradient(180deg, rgba(98,53,145,.18), rgba(255,255,255,.03)) !important;}  .warhub-roster-card.offline-box {\n      border-color: rgba(180,180,180,.12) !important;\n      background: linear-gradient(180deg, rgba(70,70,70,.18), rgba(255,255,255,.03)) !important;\n    }\n\n    .warhub-dropdown {\n      border: 1px solid rgba(255,255,255,.07) !important;\n      border-radius: 12px !important;\n      background: rgba(255,255,255,.03) !important;\n      margin-bottom: 8px !important;\n      overflow: hidden !important;\n    }\n\n    .warhub-dropdown summary {\n      list-style: none !important;\n      cursor: pointer !important;\n      padding: 10px !important;\n      user-select: none !important;\n      outline: none !important;\n    }\n\n    .warhub-dropdown summary::-webkit-details-marker {\n      display: none !important;\n    }\n\n    .warhub-dropdown-body {\n      padding: 0 10px 10px 10px !important;\n    }\n\n    .warhub-metric {\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.05) !important;\n      padding: 8px !important;\n      min-height: 54px !important;\n    }\n    .warhub-metric .k {\n      opacity: .7 !important;\n      font-size: 10px !important;\n      text-transform: uppercase !important;\n      letter-spacing: .45px !important;\n      color: #fff !important;\n    }\n    .warhub-metric .v {\n      font-size: 16px !important;\n      font-weight: 800 !important;\n      margin-top: 4px !important;\n      word-break: break-word !important;\n      color: #fff !important;\n    }\n\n    .warhub-score-us {\n      background: linear-gradient(180deg, rgba(31,120,63,.40), rgba(17,67,35,.28)) !important;\n      border: 1px solid rgba(109,214,143,.18) !important;\n    }\n    .warhub-score-them {\n      background: linear-gradient(180deg, rgba(145,37,37,.40), rgba(88,18,18,.28)) !important;\n      border: 1px solid rgba(255,130,130,.18) !important;\n    }\n    .warhub-score-lead {\n      background: linear-gradient(180deg, rgba(145,114,27,.38), rgba(97,72,13,.26)) !important;\n      border: 1px solid rgba(255,215,118,.18) !important;\n    }\n\n    .warhub-list { display: grid !important; gap: 6px !important; }\n\n    .warhub-list-item {\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.04) !important;\n      padding: 8px !important;\n      display: grid !important;\n      gap: 4px !important;\n      color: #fff !important;\n    }\n\n    .warhub-row {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      flex-wrap: wrap !important;\n    }\n\n    .warhub-name { font-weight: 700 !important; color: #fff !important; }\n    .warhub-meta { opacity: .76 !important; font-size: 11px !important; color: #fff !important; }\n    .warhub-empty { opacity: .75 !important; font-size: 12px !important; color: #fff !important; }\n    .warhub-actions { display: flex !important; gap: 6px !important; flex-wrap: wrap !important; }\n\n    .warhub-btn, .warhub-input, .warhub-select, .warhub-textarea {\n      font: inherit !important;\n      border-radius: 10px !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: rgba(255,255,255,.05) !important;\n      color: #fff !important;\n    }\n\n    .warhub-btn {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      padding: 7px 10px !important;\n      cursor: pointer !important;\n      font-size: 12px !important;\n      font-weight: 700 !important;\n      text-decoration: none !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n    }\n\n    .warhub-btn.primary { background: linear-gradient(180deg, #cc3737, #821616) !important; border-color: rgba(255,255,255,.12) !important; }\n    .warhub-btn.good { background: linear-gradient(180deg, #238c52, #15603a) !important; }\n    .warhub-btn.warn { background: linear-gradient(180deg, #af7b22, #775114) !important; }\n    .warhub-btn.small { padding: 5px 8px !important; font-size: 11px !important; }\n    .warhub-btn[disabled] { opacity: .45 !important; cursor: not-allowed !important; }\n\n    .warhub-input, .warhub-select, .warhub-textarea {\n      width: 100% !important;\n      padding: 8px 10px !important;\n      font-size: 12px !important;\n    }\n\n    .warhub-input[readonly] {\n      opacity: .9 !important;\n      background: rgba(255,255,255,.035) !important;\n    }\n\n    .warhub-textarea { min-height: 94px !important; resize: vertical !important; }\n\n    .warhub-label {\n      font-size: 11px !important;\n      opacity: .74 !important;\n      margin-bottom: 4px !important;\n      display: block !important;\n      color: #fff !important;\n    }\n\n   .warhub-pill {\n      display: inline-flex !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 4px 8px !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n    }\n\n    .warhub-pill.online {\n      background: rgba(40,140,90,.20) !important;\n      color: #b7ffd5 !important;\n    }\n\n    .warhub-pill.idle {\n      background: rgba(197,141,46,.22) !important;\n      color: #ffe3a5 !important;\n    }\n\n    .warhub-pill.offline {\n      background: rgba(113,113,113,.20) !important;\n      color: #dadada !important;\n    }\n\n    .warhub-pill.hosp {\n      background: rgba(181,62,62,.24) !important;\n      color: #ffd0d0 !important;\n    }\n\n    .warhub-pill.travel {\n      background: rgba(53,110,190,.24) !important;\n      color: #d5e7ff !important;\n    }\n\n    .warhub-pill.jail {\n      background: rgba(110,68,175,.24) !important;\n      color: #e5d8ff !important;\n    }\n\n    .warhub-pill.leader {\n      background: rgba(66,110,185,.24) !important;\n      color: #d3e3ff !important;\n    }\n\n    .warhub-pill.enabled {\n      background: rgba(35,140,82,.22) !important;\n      color: #b7ffd5 !important;\n    }\n\n    .warhub-pill.disabled {\n      background: rgba(145,37,37,.24) !important;\n      color: #ffd0d0 !important;\n    }\n\n    .warhub-pill.good {\n      background: rgba(34,197,94,.18) !important;\n      border-color: rgba(34,197,94,.45) !important;\n      color: #bbf7d0 !important;\n    }\n\n    .warhub-pill.bad {\n      background: rgba(239,68,68,.18) !important;\n      border-color: rgba(239,68,68,.45) !important;\n      color: #fecaca !important;\n    }\n\n    .warhub-pill.neutral {\n      background: rgba(148,163,184,.16) !important;\n      border-color: rgba(148,163,184,.35) !important;\n      color: #e2e8f0 !important;\n    }\n\n    .warhub-pos {\n      color: #86efac !important;\n    }\n\n    .warhub-neg {\n      color: #fca5a5 !important;\n    }\n\n    .warhub-divider {\n      height: 1px !important;\n      background: rgba(255,255,255,.07) !important;\n      margin: 8px 0 !important;\n    }\n    .warhub-mini { font-size: 11px !important; opacity: .78 !important; color: #fff !important; }\n    .warhub-link { color: #fff !important; text-decoration: none !important; }\n\n    .warhub-section-scroll {\n      max-height: 52vh !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      padding-right: 2px !important;\n    }\n\n    .warhub-payment-line {\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.06) !important;\n      font-weight: 800 !important;\n      text-align: center !important;\n      margin-top: 8px !important;\n    }\n\n    @media (max-width: 700px) {\n      #warhub-overlay {\n        width: 98vw !important;\n        height: 88vh !important;\n        min-height: 360px !important;\n        top: 56px !important;\n        left: 1vw !important;\n        right: 1vw !important;\n        border-radius: 12px !important;\n      }\n      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr !important; }\n      .warhub-body { padding-bottom: 18px !important; }\n      #warhub-shield {\n        width: 40px !important;\n        height: 40px !important;\n        font-size: 21px !important;\n      }\n      .warhub-section-scroll { max-height: 34vh !important; }\n      .warhub-tabs {\n        min-height: 44px !important;\n        max-height: 44px !important;\n      }\n    }\n  ";
    GM_addStyle(css);
    function esc(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function fmtNum(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n.toLocaleString() : '—';
    }
    function netPill(value, label) {
    var n = Number(value || 0);
    var cls = n > 0 ? 'good' : (n < 0 ? 'bad' : 'neutral');
    return '<span class="warhub-pill ' + cls + '">' + esc(label || 'Net') + ' ' + fmtNum(n) + '</span>';
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
        var canUseFeatures = a.canUseFeatures;
        if (canUseFeatures == null) {
            canUseFeatures = !!a.isOwner || !!a.isFactionLeader || !!a.memberEnabled;
        }
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
            status: a.status || '',
            lastSeenAt: a.lastSeenAt || '',
            factionId: a.factionId || '',
            factionName: a.factionName || '',
            userId: a.userId || '',
            userName: a.userName || '',
            isFactionLeader: !!a.isFactionLeader,
            memberEnabled: !!a.memberEnabled,
            canUseFeatures: !!canUseFeatures,
            pricePerMember: Number.isFinite(Number(a.pricePerMember)) ? Number(a.pricePerMember) : PRICE_PER_MEMBER,
            paymentPlayer: a.paymentPlayer || PAYMENT_PLAYER,
            isOwner: !!a.isOwner,
            isUserExempt: !!a.isUserExempt,
            isFactionExempt: !!a.isFactionExempt
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
        var ppm = Number(accessState.pricePerMember || PRICE_PER_MEMBER) || PRICE_PER_MEMBER;

        if (accessState.isFactionExempt) {
            return accessState.message || 'Faction exemption active. No payment or renewal is required.';
        }

        if (accessState.isUserExempt) {
            return accessState.message || 'Player exemption active. Full script access is unlocked except Admin and leader-only tabs.';
        }

        if (accessState.paymentRequired || accessState.blocked || accessState.trialExpired) {
            if (accessState.isFactionLeader || isOwnerSession()) {
                return accessState.message || accessState.reason || ("Faction access locked. Renewal goes to " + paymentPlayer + ".");
            }
            if (accessState.memberEnabled) {
                return accessState.message || ("Your access was enabled by your leader, but faction renewal is now required. Payment goes to " + paymentPlayer + ".");
            }
            return accessState.message || "Read-only access. Your leader must enable you after trial starts, or faction renewal is required.";
        }

        if (accessState.trialActive) {
            if (accessState.isFactionLeader || isOwnerSession()) {
                if (accessState.daysLeft != null) {
                    return "Faction trial active. " + accessState.daysLeft + " day" + (accessState.daysLeft === 1 ? '' : 's') + " left. Members can see War Hub now, and you choose who gets full access.";
                }
                return "Faction trial active. Members can see War Hub now, and you choose who gets full access.";
            }

            if (!accessState.memberEnabled && accessState.loggedIn) {
                return "Faction trial is active, but you are read-only until your leader enables your access.";
            }

            if (accessState.memberEnabled) {
                return "Your leader enabled your access for this faction cycle. Your access stays on until the next renewal/payment cycle.";
            }
        }

        if (accessState.loggedIn && !accessState.isFactionLeader && !accessState.memberEnabled && !accessState.canUseFeatures) {
            return "Read-only access. Your leader must enable you before you can use shared faction tools.";
        }

        if (accessState.loggedIn && (accessState.isFactionLeader || isOwnerSession())) {
            return "Leader access ready. Trial starts automatically the first time the faction leader logs in. Billing is " + String(ppm) + " Xanax per enabled member.";
        }

        return '';
    }
        function isOwnerSession() {
        var meId = String(
            (accessState && accessState.userId) ||
            (state && state.me && (state.me.user_id || state.me.id || state.me.player_id)) ||
            (state && state.user && (state.user.user_id || state.user.id || state.user.player_id)) ||
            ''
        ).trim();

        var meName = String(
            (accessState && accessState.userName) ||
            (state && state.me && (state.me.name || state.me.player_name)) ||
            (state && state.user && (state.user.name || state.user.player_name)) ||
            ''
        ).trim().toLowerCase();

        return meId === OWNER_USER_ID || meName === OWNER_NAME.toLowerCase();
    }
        function getAccessInfo(payload, httpStatus) {
        var d = payload && _typeof(payload) === 'object' ? payload : {};
        var access = d.access && _typeof(d.access) === 'object' ? d.access : {};
        var payment = d.payment && _typeof(d.payment) === 'object' ? d.payment : {};
        var factionAccess = d.faction_access && _typeof(d.faction_access) === 'object' ? d.faction_access : {};
        var memberAccess = d.member_access && _typeof(d.member_access) === 'object' ? d.member_access : {};
        var license = d.license && _typeof(d.license) === 'object' ? d.license : {};
        var paymentRequired = !!d.payment_required || !!d.requires_payment || !!d.paymentRequired || !!access.payment_required || !!access.requires_payment || !!access.paymentRequired || !!license.payment_required;
        var blocked = !!d.blocked || !!d.access_blocked || !!d.locked || !!d.denied || !!access.blocked || !!access.access_blocked || !!access.locked || !!access.denied || paymentRequired;
        var expiresAt = d.trial_expires_at || d.trialEndsAt || d.expires_at || access.trial_expires_at || access.trialEndsAt || access.expires_at || license.trial_expires_at || license.expires_at || '';
        var explicitDaysLeft = d.trial_days_left != null ? d.trial_days_left : d.days_left != null ? d.days_left : access.trial_days_left != null ? access.trial_days_left : access.days_left != null ? access.days_left : license.days_left != null ? license.days_left : null;
        var computedDaysLeft = explicitDaysLeft != null ? Number(explicitDaysLeft) : fmtDaysLeftFromIso(expiresAt);
        var trialExpired = !!d.trial_expired || !!d.expired || !!access.trial_expired || !!access.expired || !!license.trial_expired || computedDaysLeft != null && computedDaysLeft < 0 && !paymentRequired ? true : false;
        var trialActive = !!d.trial_active || !!access.trial_active || !!license.trial_active || computedDaysLeft != null && computedDaysLeft >= 0 && !paymentRequired && !trialExpired;
        var accessStatus = String(d.access_status || d.status || access.status || access.access_status || license.status || '').toLowerCase();
        var reason = d.reason || d.block_reason || d.error || access.reason || access.block_reason || memberAccess.reason || license.block_reason || '';
        var message = d.message || d.notice || d.details || access.message || access.notice || payment.message || license.message || '';
        var isOwner = !!d.is_owner || !!(d.user && d.user.is_owner) || !!(d.me && d.me.is_owner) || !!(d.owner && d.owner.is_owner) || !!factionAccess.is_owner;
        var isFactionLeader = !!d.is_faction_leader || !!access.is_faction_leader || !!factionAccess.is_faction_leader || !!(d.me && d.me.is_faction_leader);
        var isUserExempt = !!access.is_user_exempt || !!factionAccess.is_user_exempt || !!license.viewer_is_exempt_user;
        var isFactionExempt = !!access.is_faction_exempt || !!factionAccess.is_faction_exempt || !!license.faction_exempt;
        var memberEnabled = !!memberAccess.enabled || !!factionAccess.member_enabled || !!access.member_enabled || !!memberAccess.allowed;
        if (isFactionLeader || isOwner) memberEnabled = true;
        var canUseFeatures = access.can_use_features;
        if (canUseFeatures == null) canUseFeatures = access.canUseFeatures;
        if (canUseFeatures == null) canUseFeatures = factionAccess.can_use_features;
        if (canUseFeatures == null) canUseFeatures = isOwner || isFactionLeader || isUserExempt || isFactionExempt || memberEnabled;
        var finalBlocked = blocked;
        var finalPaymentRequired = paymentRequired;
        var finalTrialExpired = trialExpired;

        if (isFactionExempt || isUserExempt) {
            finalBlocked = false;
            finalPaymentRequired = false;
            finalTrialExpired = false;
        } else if (accessStatus.includes('payment')) {
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
            if (accessStatus === 'inactive' || reason === 'read_only_access' || (!memberEnabled && !isFactionLeader && !isOwner)) {
                message = 'Read-only access. Your leader must enable you before you can use shared faction tools.';
            } else {
                message = "Faction access blocked. Payment goes to " + (payment.required_player || PAYMENT_PLAYER) + ".";
            }
        }

        if (finalPaymentRequired && !message) {
            message = "Faction payment required. Payment goes to " + (payment.required_player || PAYMENT_PLAYER) + ".";
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
            status: String(accessStatus || ''),
            lastSeenAt: new Date().toISOString(),
            factionId: d.faction_id || (d.faction && d.faction.id) || (d.me && d.me.faction_id) || (d.user && d.user.faction_id) || '',
            factionName: d.faction_name || (d.faction && d.faction.name) || (d.me && d.me.faction_name) || (d.user && d.user.faction_name) || '',
            userId: String((d.user && (d.user.user_id || d.user.id)) || (d.me && (d.me.user_id || d.me.id || d.me.player_id)) || ''),
            userName: String((d.user && (d.user.name || d.user.player_name)) || (d.me && (d.me.name || d.me.player_name)) || ''),
            isFactionLeader: isFactionLeader,
            memberEnabled: memberEnabled,
            canUseFeatures: (!!canUseFeatures && !finalBlocked && !finalPaymentRequired && !finalTrialExpired) || isUserExempt || isFactionExempt,
            pricePerMember: Number(payment.payment_per_member || license.payment_per_member || PRICE_PER_MEMBER) || PRICE_PER_MEMBER,
            paymentPlayer: String(payment.required_player || payment.payment_player || license.payment_player || PAYMENT_PLAYER),
            isOwner: isOwner,
            isUserExempt: isUserExempt,
            isFactionExempt: isFactionExempt
        };
    }
        function updateAccessFromPayload(payload, httpStatus, loggedInHint) {
    var next = getAccessInfo(payload, httpStatus);
    if (loggedInHint === true && !next.blocked) next.loggedIn = true;
    if (loggedInHint === false) next.loggedIn = false;

    if (next.blocked || next.paymentRequired || next.trialExpired || (next.loggedIn && !next.canUseFeatures && !next.isFactionLeader && !next.isOwner)) {
        accessState = normalizeAccessCache(_objectSpread(_objectSpread({}, accessState), next));
        saveAccessCache();
        return accessState;
    }

    if (next.trialActive || next.expiresAt || next.daysLeft != null || next.factionId || next.isFactionLeader || next.userId || next.loggedIn) {
        accessState = normalizeAccessCache(
            _objectSpread(
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
                    status: next.status,
                    lastSeenAt: next.lastSeenAt,
                    isOwner: next.isOwner,
                    isFactionLeader: next.isFactionLeader,
                    memberEnabled: next.memberEnabled,
                    canUseFeatures: next.canUseFeatures,
                    userId: next.userId || accessState.userId,
                    userName: next.userName || accessState.userName
                }
            )
        );
        saveAccessCache();
        return accessState;
    }

    if (loggedInHint === true) {
        accessState = normalizeAccessCache(_objectSpread(_objectSpread({}, accessState), {}, {
            loggedIn: true,
            blocked: false,
            paymentRequired: false,
            trialExpired: false,
            lastSeenAt: new Date().toISOString(),
            isOwner: !!next.isOwner || !!accessState.isOwner
        }));
        saveAccessCache();
    }

    return accessState;
}
        function canUseProtectedFeatures() {
        if (isOwnerSession()) return true;
        if (accessState && (accessState.blocked || accessState.paymentRequired || accessState.trialExpired)) return false;
        if (accessState && accessState.isFactionLeader) return true;
        if (accessState && accessState.loggedIn && accessState.canUseFeatures === false) return false;
        return !(accessState && accessState.loggedIn && !accessState.memberEnabled);
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

    function getEnemyFactionMeta() {
    var s = state || {};
    var enemyFaction = s.enemy_faction || s.enemyFaction || {};
    var war = s.war || {};
    var ownFaction = s.faction || s.our_faction || {};
    var fallbackPair = whLoadWarPairFallback() || {};

    var ownFactionId = String(
        (ownFaction && (ownFaction.faction_id || ownFaction.id)) ||
        (s.user && s.user.faction_id) ||
        ''
    ).trim();

    var ownFactionName = String(
        (ownFaction && ownFaction.name) ||
        (s.user && s.user.faction_name) ||
        ''
    ).trim().toLowerCase();

    var enemyFactionId = String(
        (enemyFaction && (enemyFaction.faction_id || enemyFaction.id)) ||
        s.enemy_faction_id ||
        (war && war.enemy_faction_id) ||
        fallbackPair.enemy_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        (enemyFaction && enemyFaction.name) ||
        s.enemy_faction_name ||
        (war && war.enemy_faction_name) ||
        fallbackPair.enemy_faction_name ||
        ''
    ).trim();

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
        enemyFactionName = '';
    }

    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionId = '';
        enemyFactionName = '';
    }

    return {
        id: enemyFactionId,
        name: enemyFactionName
    };
}

function fetchSameOriginHtml(url) {
    return fetch(url, {
        credentials: 'include'
    }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
    });
}

function parseEnemyRosterFromHtml(html, enemyFactionName) {
    return [];
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
                        payment_required: !!(accessState && accessState.paymentRequired),
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

    var members = arr(s.members || s.member_list || []);
    var enemies = arr(s.enemies || s.enemy_members || war.enemy_members || []);
    var medDeals = arr(s.med_deals || s.medDeals || []);
    var dibs = arr(s.dibs || []);
    var notifications = arr(s.notifications || []);
    var bounties = arr(s.bounties || []);
    var targets = arr(s.targets || []);
    var terms = s.war_terms || s.terms || {};
    var medDealsMessage = String(s.med_deals_message || s.medDealsMessage || '');

    var ownFactionId = String(
        (faction && (faction.faction_id || faction.id)) ||
        (s.user && s.user.faction_id) ||
        ''
    ).trim();

    var ownFactionName = String(
        (faction && faction.name) ||
        (s.user && s.user.faction_name) ||
        ''
    ).trim().toLowerCase();

    var enemyFactionId = String(
        enemyFactionRaw.faction_id ||
        enemyFactionRaw.id ||
        s.enemy_faction_id ||
        war.enemy_faction_id ||
        war.opponent_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        enemyFactionRaw.name ||
        s.enemy_faction_name ||
        war.enemy_faction_name ||
        war.opponent_faction_name ||
        ''
    ).trim();

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
        enemyFactionName = '';
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionId = '';
        enemyFactionName = '';
    }

    var seenEnemyIds = {};
    enemies = enemies.filter(function (x) {
        var id = String((x && (x.user_id || x.id || x.player_id)) || '').trim();
        if (!id) return true;
        if (id === getMyUserId()) return false;
        if (seenEnemyIds[id]) return false;
        seenEnemyIds[id] = true;
        return true;
    });

    var enemyFaction = Object.assign({}, enemyFactionRaw, {
        id: enemyFactionId || '',
        faction_id: enemyFactionId || '',
        name: enemyFactionName || 'Enemy Faction',
        score: Number(
            (enemyFactionRaw && enemyFactionRaw.score) ||
            s.enemy_score ||
            (s.score && s.score.enemy) ||
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
        license: s.license || {},
        debug: s.debug || {}
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

var prevState = state ? normalizeState(state) : null;
var nextState = normalizeState(res.data || {});

if (prevState) {
    var prevEnemies = arr((prevState && prevState.enemies) || []);
    var nextEnemies = arr((nextState && nextState.enemies) || []);
    var prevEnemyId = String((prevState && prevState.enemy_faction_id) || (((prevState || {}).enemyFaction || {}).faction_id) || '').trim();
    var nextEnemyId = String((nextState && nextState.enemy_faction_id) || (((nextState || {}).enemyFaction || {}).faction_id) || '').trim();
    var prevEnemyName = String((prevState && prevState.enemy_faction_name) || (((prevState || {}).enemyFaction || {}).name) || '').trim().toLowerCase();
    var nextEnemyName = String((nextState && nextState.enemy_faction_name) || (((nextState || {}).enemyFaction || {}).name) || '').trim().toLowerCase();
    var sameEnemy = !!(
        (prevEnemyId && nextEnemyId && prevEnemyId === nextEnemyId) ||
        (!nextEnemyId && prevEnemyId) ||
        (prevEnemyName && nextEnemyName && prevEnemyName === nextEnemyName)
    );

    if (prevEnemies.length && !nextEnemies.length && sameEnemy) {
        nextState.enemies = prevEnemies.slice();
        nextState.enemyFaction = Object.assign({}, (prevState && prevState.enemyFaction) || {}, (nextState && nextState.enemyFaction) || {});
        nextState.enemy_faction = nextState.enemyFaction;
        if (!nextState.enemy_faction_id) nextState.enemy_faction_id = prevEnemyId;
        if (!nextState.enemy_faction_name) nextState.enemy_faction_name = (prevState && prevState.enemy_faction_name) || '';
    }
}

state = nextState;

if (state && state.enemy_faction_id) {
    whSaveWarPairFallback({
        enemy_faction_id: state.enemy_faction_id || '',
        enemy_faction_name: state.enemy_faction_name || ''
    });
}

if ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) && !factionMembersCache) {
    loadFactionMembers()["catch"](function () {
        return null;
    });
}

if (!silent) setStatus('');
if (overlay && isOpen && !(overlay && overlay.dataset.dragging === '1')) renderBody();
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
        if (!(accessState && accessState.isFactionLeader) && !isOwnerSession()) {
            analyticsCache = null;
            return null;
        }

        try {
            var res = yield req('GET', '/api/war/summary');
            if (!res.ok) {
                analyticsCache = {
                    ok: false,
                    error: res.error || 'Could not load war summary.'
                };
                return analyticsCache;
            }

            analyticsCache = _objectSpread({
                ok: true
            }, res.data || {});
            return analyticsCache;
        } catch (e) {
            analyticsCache = {
                ok: false,
                error: 'Could not load war summary.'
            };
            return analyticsCache;
        }
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

    var lifeCur = Number(x.life_current || x.current_life || x.life || 0);
    var lifeMax = Number(x.life_max || x.maximum_life || x.max_life || 0);
    var lifeText = lifeMax > 0 ? (lifeCur.toLocaleString() + "/" + lifeMax.toLocaleString()) : (lifeCur > 0 ? lifeCur.toLocaleString() : '—');

    var hasEnergy = x.energy_current != null || x.energy != null || x.energy_now != null || x.current_energy != null;
    var energyCur = Number(x.energy_current ?? x.current_energy ?? x.energy_now ?? x.energy ?? 0);
    var energyMax = Number(x.energy_max ?? x.max_energy ?? 150);
    var energyText = hasEnergy ? (energyMax > 0 ? (energyCur.toLocaleString() + "/" + energyMax.toLocaleString()) : energyCur.toLocaleString()) : '—';

    var hasMedCd = x.medical_cooldown != null || x.med_cooldown != null || x.med_cd != null || x.medicalcooldown != null;
    var medCd = Number(x.medical_cooldown ?? x.med_cooldown ?? x.med_cd ?? x.medicalcooldown ?? 0);
    var medText = hasMedCd ? (medCd > 0 ? fmtHosp(medCd) : 'Ready') : '—';

    var attackUrl = x.attack_url || (id ? ("https://www.torn.com/loader.php?sid=attack&user2ID=" + id) : '#');
    var bountyUrl = x.bounty_url || (id ? ("https://www.torn.com/bounties.php#/p=add&userID=" + id) : '#');
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
            <div class="warhub-meta">' + esc(['Life ' + lifeText, 'Energy ' + energyText, 'Med CD ' + medText].join(' • ')) + '</div>\
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
            ' + (!enemy && id ? '<a class="warhub-btn small warn" href="' + esc(bountyUrl) + '" target="_blank" rel="noopener noreferrer">Bounty</a>' : '') + '\
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
    prefs.war = true;

    var deals = arr((state && (state.medDeals || state.med_deals)) || []);
    var allDibs = arr((state && state.dibs) || []);
    var war = (state && state.war) || {};
    var our = (state && (state.faction || state.our_faction || state.ourFaction)) || {};
    var enemy = (state && (state.enemyFaction || state.enemy_faction)) || {};
    var fallbackPair = (typeof whLoadWarPairFallback === 'function' && whLoadWarPairFallback()) || {};

    var ownFactionId = String((our && (our.faction_id || our.id)) || '').trim();
    var ownFactionName = String((our && our.name) || '').trim().toLowerCase();

    var enemyFactionId = String(
        (enemy && (enemy.faction_id || enemy.id)) ||
        state.enemy_faction_id ||
        war.enemy_faction_id ||
        war.opponent_faction_id ||
        fallbackPair.enemy_faction_id ||
        ''
    ).trim();

    var enemyFactionName = String(
        (enemy && enemy.name) ||
        state.enemy_faction_name ||
        war.enemy_faction_name ||
        war.opponent_faction_name ||
        fallbackPair.enemy_faction_name ||
        ''
    ).trim();

    if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
        enemyFactionId = '';
    }
    if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
        enemyFactionName = '';
    }
    if (!enemyFactionName) enemyFactionName = '—';

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
        var maker =
            x.seller_name ||
            x.created_by_name ||
            x.user_name ||
            x.member_name ||
            'Unknown user';

        var details = [
            x.item_name || x.buyer_name || '',
            x.note || x.notes || ''
        ].filter(Boolean).join(' • ');

        return '<div class="warhub-list-item">\
            <div class="warhub-name">' + esc(maker) + '</div>\
            <div class="warhub-meta">' + esc(details || 'Live shared med deal') + '</div>\
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

    return renderAccessBanner() + '<div class="warhub-grid two">' + cards.join('') + '</div>';
}
    function renderInstructionsTab() {
        var banner = accessSummaryMessage() ? "<div class=\"warhub-banner ".concat((accessState !== null && accessState !== void 0 && accessState.paymentRequired) || (accessState !== null && accessState !== void 0 && accessState.blocked) || (accessState !== null && accessState !== void 0 && accessState.trialExpired) ? 'payment' : (accessState !== null && accessState !== void 0 && accessState.trialActive) ? 'trial' : 'good', "\">\n          <div><strong>Faction Access</strong></div>\n          <div class=\"warhub-mini\" style=\"margin-top:6px;\">").concat(esc(accessSummaryMessage()), "</div>\n        </div>") : '';
        return "\n      ".concat(banner, "\n      <div class=\"warhub-card\">\n        <h3>Getting Started</h3>\n        <div class=\"warhub-list\">\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">1. Save your API key</div>\n            <div class=\"warhub-meta\">Open Settings, paste your personal Torn API key, then press Save Keys.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">2. Login to War Hub</div>\n            <div class=\"warhub-meta\">Press Login in Settings. War Hub will load your faction, war state, members, and enemies.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">3. Set your war status</div>\n            <div class=\"warhub-meta\">Use the Chain tab to mark yourself Available or Unavailable and to switch Chain Sitter on or off.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">4. Use the faction tabs</div>\n            <div class=\"warhub-meta\">Members, Enemies, Hospital, Med Deals, Targets, and War Summary all pull from the backend once your access is enabled.</div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>Terms of Service</h3>\n        <div class=\"warhub-list\">\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">Use at your own risk</div>\n            <div class=\"warhub-meta\">War Hub is a private Torn utility. You are responsible for how you use the data, links, and shared tools.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">Access is role-based</div>\n            <div class=\"warhub-meta\">Leader-only and admin-only tabs stay locked unless your role allows them. Exempt players still do not get Admin or leader tabs.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">Service can change</div>\n            <div class=\"warhub-meta\">Torn API limits, browser caching, PDA behavior, or backend restarts can affect refresh speed and available features.</div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\">\n        <h3>API Key Storage</h3>\n        <div class=\"warhub-list\">\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">Saved in local userscript storage</div>\n            <div class=\"warhub-meta\">Your API key is stored on your device in Tampermonkey/PDA script storage so the overlay can log you in.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">Used by your backend only</div>\n            <div class=\"warhub-meta\">The script sends the key to your War Hub backend for login and Torn API requests. Do not share your key with anyone you do not trust.</div>\n          </div>\n          <div class=\"warhub-list-item\">\n            <div class=\"warhub-name\">You can change it anytime</div>\n            <div class=\"warhub-meta\">Open Settings to save a new key, or use Logout to clear the active session.</div>\n          </div>\n        </div>\n      </div>\n    ");
    }
    function renderTermsTab() {
        var warId = (state === null || state === void 0 ? void 0 : state.war) && state.war.war_id || (state === null || state === void 0 ? void 0 : state.war) && state.war.id || '';
        var termsText = (state === null || state === void 0 ? void 0 : state.warTerms) && state.warTerms.terms_text || (state === null || state === void 0 ? void 0 : state.warTerms) && state.warTerms.terms || (state === null || state === void 0 ? void 0 : state.terms) && state.terms.terms_text || (state === null || state === void 0 ? void 0 : state.terms) && state.terms.terms || '';
        var locked = !((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession());
        return "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-section-title\">\n          <h3>War Terms</h3>\n          ".concat(locked ? '<span class="warhub-pill disabled">Leader Only</span>' : '', "\n        </div>\n        <label class=\"warhub-label\">War ID</label>\n        <input class=\"warhub-input\" id=\"warhub-terms-warid\" value=\"").concat(esc(warId), "\" readonly />\n        <div style=\"height:8px;\"></div>\n        <label class=\"warhub-label\">Terms</label>\n        <textarea class=\"warhub-textarea\" id=\"warhub-terms-text\" ").concat(locked ? 'readonly' : '', ">").concat(esc(termsText), "</textarea>\n        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n          <button class=\"warhub-btn primary\" id=\"warhub-terms-save\" ").concat(locked ? 'disabled' : '', ">Save Terms</button>\n          <button class=\"warhub-btn warn\" id=\"warhub-terms-delete\" ").concat(locked ? 'disabled' : '', ">Delete Terms</button>\n        </div>\n      </div>\n    ");
    }
    function renderMembersTab() {
    var allMembers = arr((state && state.members) || []);
    var rawQ = String((state && state.membersSearch) || '').trim();
    var q = rawQ.toLowerCase();

    var filtered = !q ? allMembers : allMembers.filter(function (x) {
        var id = String(x.user_id || x.id || x.player_id || x.member_user_id || '').toLowerCase();
        var name = String(x.name || x.player_name || x.member_name || '').toLowerCase();
        var status = String(x.display_status || x.status || x.status_detail || x.last_action || '').toLowerCase();
        var position = String(x.position || '').toLowerCase();
        return (
            name.indexOf(q) >= 0 ||
            id.indexOf(q) >= 0 ||
            status.indexOf(q) >= 0 ||
            position.indexOf(q) >= 0
        );
    });

    var groups = splitRosterGroups(filtered);
    var total =
        groups.online.length +
        groups.idle.length +
        groups.travel.length +
        groups.hospital.length +
        groups.jail.length +
        groups.offline.length;

    return "\
      <div class=\"warhub-card\">\
        <div class=\"warhub-section-title\">\
          <h3>Members Overview</h3>\
          <span class=\"warhub-count\">" + fmtNum(total) + "</span>\
        </div>\
        <div class=\"warhub-row\" style=\"margin-top:8px; gap:8px; align-items:center;\">\
          <input class=\"warhub-input\" id=\"warhub-members-search\" placeholder=\"Search member, ID, status, position...\" value=\"" + esc(rawQ) + "\" />\
          " + (q ? "<button class=\"warhub-btn small\" id=\"warhub-members-search-clear\">Clear</button>" : "") + "\
        </div>\
        <div class=\"warhub-grid three\" style=\"margin-top:10px;\">\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Online</div>\
            <div class=\"v\">" + fmtNum(groups.online.length) + "</div>\
          </div>\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Idle</div>\
            <div class=\"v\">" + fmtNum(groups.idle.length) + "</div>\
          </div>\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Hospital</div>\
            <div class=\"v\">" + fmtNum(groups.hospital.length) + "</div>\
          </div>\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Travel</div>\
            <div class=\"v\">" + fmtNum(groups.travel.length) + "</div>\
          </div>\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Jail</div>\
            <div class=\"v\">" + fmtNum(groups.jail.length) + "</div>\
          </div>\
          <div class=\"warhub-metric\">\
            <div class=\"k\">Offline</div>\
            <div class=\"v\">" + fmtNum(groups.offline.length) + "</div>\
          </div>\
        </div>\
      </div>\
      " + rosterCard('Online Members', groups.online, { extraClass: 'online-box' }) + "\
      " + rosterCard('Idle Members', groups.idle, { extraClass: 'idle-box' }) + "\
      " + rosterCard('Hospital Members', groups.hospital, { extraClass: 'hospital-box' }) + "\
      " + rosterCard('Travel Members', groups.travel, { extraClass: 'travel-box' }) + "\
      " + rosterCard('Jailed Members', groups.jail, { extraClass: 'jail-box' }) + "\
      " + rosterDropdown('Offline Members', groups.offline, { extraClass: 'offline-box' }) + "\
    ";
}
    
    function renderEnemiesTab() {
    try {
        var enemies = arr((state && state.enemies) || []);
        var enemyFaction =
            (state && state.enemy_faction) ||
            (state && state.enemyFaction) ||
            {};
        var war = (state && state.war) || {};
        var fallbackPair = whLoadWarPairFallback() || {};

        var ownFaction =
            (state && state.faction) ||
            (state && state.ourFaction) ||
            {};

        var ownFactionId = String((ownFaction && (ownFaction.faction_id || ownFaction.id)) || ((state && state.user) && state.user.faction_id) || '').trim();
        var ownFactionName = String((ownFaction && ownFaction.name) || ((state && state.user) && state.user.faction_name) || '').trim().toLowerCase();
        var enemyFactionId = String((enemyFaction && (enemyFaction.faction_id || enemyFaction.id)) || (state && state.enemy_faction_id) || (war && war.enemy_faction_id) || fallbackPair.enemy_faction_id || '').trim();
        var enemyFactionName = String((enemyFaction && enemyFaction.name) || (state && state.enemy_faction_name) || (war && war.enemy_faction_name) || fallbackPair.enemy_faction_name || 'Unknown Enemy').trim();

        if (enemyFactionId && ownFactionId && enemyFactionId === ownFactionId) {
            enemyFactionId = '';
            enemyFactionName = '—';
        }
        if (enemyFactionName && ownFactionName && enemyFactionName.toLowerCase() === ownFactionName) {
            enemyFactionId = '';
            enemyFactionName = '—';
        }

        var scoreThem = Number(((state && state.score) && state.score.enemy) || (enemyFaction && enemyFaction.score) || 0) || 0;
        var chainThem = Number((enemyFaction && enemyFaction.chain) || 0) || 0;
        var groups = splitRosterGroups(enemies || []);
        var total = groups.online.length + groups.idle.length + groups.travel.length + groups.hospital.length + groups.jail.length + groups.offline.length;
        var hasWar = !!((state && state.has_war) || (war && war.active) || (war && war.registered) || (war && war.war_id) || enemyFactionId || enemies.length);

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Enemies Overview</h3>\
              <span class="warhub-count">' + fmtNum(total) + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Enemy Faction</div>\
                <div class="v">' + esc(enemyFactionName || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">War Status</div>\
                <div class="v">' + esc(String(war.status || war.phase || (hasWar ? 'Active' : 'No War'))) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Enemy Score</div>\
                <div class="v">' + fmtNum(scoreThem) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Enemy Chain</div>\
                <div class="v">' + fmtNum(chainThem) + '</div>\
              </div>\
            </div>\
            ' + (enemyFactionId ? '<div class="warhub-actions" style="margin-top:8px;"><a class="warhub-btn" href="https://www.torn.com/factions.php?step=profile&ID=' + encodeURIComponent(enemyFactionId) + '" target="_blank" rel="noopener noreferrer">Open Enemy Faction</a></div>' : '') + '\
          </div>\
          ' + rosterCard('Online Enemies', groups.online, { extraClass: 'online-box', enemy: true }) + '\
          ' + rosterCard('Idle Enemies', groups.idle, { extraClass: 'idle-box', enemy: true }) + '\
          ' + rosterCard('Hospital Enemies', groups.hospital, { extraClass: 'hospital-box', enemy: true }) + '\
          ' + rosterCard('Travel Enemies', groups.travel, { extraClass: 'travel-box', enemy: true }) + '\
          ' + rosterCard('Jailed Enemies', groups.jail, { extraClass: 'jail-box', enemy: true }) + '\
          ' + rosterDropdown('Offline Enemies', groups.offline, { extraClass: 'offline-box', enemy: true }) + '';
    } catch (e) {
        return '<div class="warhub-card"><div class="warhub-empty">Enemy tab crashed.</div></div>';
    }
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
    var sitters = members.filter(function (x) { return !!x.chain_sitter; });
    var avail = members.filter(function (x) { return !!x.available; });
    var war = (state && state.war) || {};
    var chainCount = Number((state && state.chain && state.chain.current) || (state && state.chain_count) || (war && war.chain_count) || (war && war.chain) || 0) || 0;
    var chainTimeout = (state && state.chain && state.chain.timeout_text) || (state && state.chain_timeout_text) || (war && war.chain_timeout_text) || (state && state.chain && state.chain.timeout) || (war && war.chain_timeout) || '—';
    var myUserId = String((state && state.me && (state.me.user_id || state.me.id || state.me.player_id)) || (state && state.user && (state.user.user_id || state.user.id || state.user.player_id)) || '');
    var myMember = members.find(function (x) { return String(x.user_id || x.id || x.player_id || x.member_user_id || '') === myUserId; }) || {};
    var myAvailable = !!myMember.available;
    var myChainSitter = !!myMember.chain_sitter;
    var visibleAvail = myAvailable ? avail : [];

    var availabilityButtons = '<button class="warhub-btn ' + (myAvailable ? '' : 'warn') + '" id="warhub-set-unavailable">Unavailable</button>' + '<button class="warhub-btn ' + (myAvailable ? 'good' : '') + '" id="warhub-set-available">Available</button>';
    var sitterButtons = '<button class="warhub-btn ' + (myChainSitter ? '' : 'warn') + '" id="warhub-set-chain-off">Off</button>' + '<button class="warhub-btn ' + (myChainSitter ? 'good' : '') + '" id="warhub-set-chain-on">On</button>';

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Chain Overview</h3>\
        </div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">Current Chain</div><div class="v">' + fmtNum(chainCount) + '</div></div>\
          <div class="warhub-metric"><div class="k">Timeout</div><div class="v">' + esc(String(chainTimeout || '—')) + '</div></div>\
          <div class="warhub-metric"><div class="k">Available Members</div><div class="v">' + fmtNum(visibleAvail.length) + '</div></div>\
          <div class="warhub-metric"><div class="k">Chain Sitters</div><div class="v">' + fmtNum(sitters.length) + '</div></div>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <h3>My Controls</h3>\
        <div class="warhub-grid two">\
          <div class="warhub-list-item"><div class="warhub-row"><div><div class="warhub-name">Availability</div><div class="warhub-meta">Switch between unavailable and available</div></div><div class="warhub-actions">' + availabilityButtons + '</div></div></div>\
          <div class="warhub-list-item"><div class="warhub-row"><div><div class="warhub-name">Chain Sitter</div><div class="warhub-meta">Switch chain sitter mode on or off</div></div><div class="warhub-actions">' + sitterButtons + '</div></div></div>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>Available Members</h3><span class="warhub-count">' + visibleAvail.length + '</span></div>\
        <div class="warhub-list">' + (visibleAvail.length ? visibleAvail.map(function (x) { return memberRow(x, false); }).join('') : '<div class="warhub-empty">No available members flagged.</div>') + '</div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>Chain Sitters</h3><span class="warhub-count">' + sitters.length + '</span></div>\
        <div class="warhub-list">' + (sitters.length ? sitters.map(function (x) { return memberRow(x, false); }).join('') : '<div class="warhub-empty">No chain sitters enabled.</div>') + '</div>\
      </div>';
}
    function renderMedDealsTab() {
    var deals = arr((state && state.medDeals) || (state && state.med_deals) || []);
    var enemies = sortAlphabetical(arr((state && state.enemies) || []));
    var sellerName = cleanInputValue((state && state.me && (state.me.name || state.me.player_name)) || (state && state.user && (state.user.name || state.user.player_name)) || '');
    var hasWar = !!((state && state.has_war) || (state && state.war && state.war.active) || (state && state.war && state.war.war_id) || (state && state.enemy_faction_id) || (state && state.enemyFaction && state.enemyFaction.id) || enemies.length);

    return "\
      <div class=\"warhub-card\">\n\
        <h3>Add Med Deal</h3>\n\
        <div>\n\
          <label class=\"warhub-label\">Enemy</label>\n\
          <select class=\"warhub-select\" id=\"warhub-med-item\"".concat(hasWar ? '' : ' disabled', ">\n\
            <option value=\"\">").concat(hasWar ? 'Select enemy member' : 'Currently not in a war', "</option>\n\
            ").concat(enemies.map(function (x) {
                var id = x.user_id || x.id || x.player_id || '';
                var name = x.name || x.player_name || "ID ".concat(id);
                var duo = [sellerName, name].filter(Boolean).join(' ↔ ');
                return "<option value=\"".concat(esc(String(id)), "\" data-name=\"").concat(esc(name), "\">").concat(esc(duo || name), " [").concat(esc(String(id)), "]</option>");
            }).join(''), "\n\
          </select>\n\
        </div>\n\
        <div style=\"height:8px;\"></div>\n\
        <div>\n\
          <label class=\"warhub-label\">Note</label>\n\
          <input class=\"warhub-input\" id=\"warhub-med-note\" placeholder=\"Optional note\" />\n\
        </div>\n\
        <div class=\"warhub-actions\" style=\"margin-top:8px;\">\n\
          <button class=\"warhub-btn primary\" id=\"warhub-med-add\"").concat(hasWar ? '' : ' disabled', ">Add Med Deal</button>\n\
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
                var dealId = String(x.id || x.deal_id || x.row_id || '');
                var seller = x.seller_name || x.created_by_name || sellerName || 'Unknown user';
                var enemyName = x.item_name || x.buyer_name || x.enemy_name || x.target_name || '';
                var noteText = x.note || '';
                var heading = [seller, enemyName].filter(Boolean).join(' ↔ ');
                var meta = [noteText].filter(Boolean).join(' • ');
                return "\
            <div class=\"warhub-list-item\">\n\
              <div class=\"warhub-row\">\n\
                <div>\n\
                  <div class=\"warhub-name\">".concat(esc(heading || seller), "</div>\n\
                  <div class=\"warhub-meta\">").concat(esc(meta || 'No details'), "</div>\n\
                </div>\n\
                <div class=\"warhub-actions\">\n\
                  <button class=\"warhub-btn small warn warhub-del-med\" data-id=\"").concat(esc(dealId), "\">Delete</button>\n\
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
    var targets = arr((state && state.targets) || []);
    var enemies = sortAlphabetical(arr((state && state.enemies) || []));
    var hasWar = !!(
        (state && state.has_war) ||
        ((state && state.war) && state.war.active) ||
        ((state && state.war) && state.war.war_id) ||
        (state && state.enemy_faction_id) ||
        ((state && state.enemyFaction) && state.enemyFaction.id) ||
        enemies.length
    );

    var enemyOptions = enemies.map(function (x) {
        var id = x.user_id || x.id || x.player_id || '';
        var name = x.name || x.player_name || ("ID " + id);
        return '<option value="' + esc(String(id)) + '" data-name="' + esc(name) + '">' +
            esc(name) + ' [' + esc(String(id)) + ']</option>';
    }).join('');

    var targetRows = targets.length ? targets.map(function (x) {
        var id = x.target_id || x.user_id || x.id || '';
        var name = x.target_name || x.name || ("ID " + id);
        var rowId = x.id || x.target_row_id || '';
        var meta = [('ID ' + id), x.notes || x.reason || ''].filter(Boolean).join(' • ');

        return '' +
            '<div class="warhub-list-item">' +
                '<div class="warhub-row">' +
                    '<div>' +
                        '<div class="warhub-name">' + esc(name) + '</div>' +
                        '<div class="warhub-meta">' + esc(meta) + '</div>' +
                    '</div>' +
                    '<div class="warhub-actions">' +
                        (id
                            ? '<a class="warhub-btn small primary" href="https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(id) + '" target="_blank" rel="noopener noreferrer">Attack</a>'
                            : '') +
                        '<button class="warhub-btn small warn warhub-del-target" data-id="' + esc(String(rowId)) + '">Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }).join('') : '<div class="warhub-empty">No targets saved.</div>';

    return '' +
        '<div class="warhub-card">' +
            '<h3>Add Target</h3>' +
            '<div class="warhub-grid two">' +
                '<div>' +
                    '<label class="warhub-label">Enemy</label>' +
                    '<select class="warhub-select" id="warhub-target-enemy"' + (hasWar ? '' : ' disabled') + '>' +
                        '<option value="">' + (hasWar ? 'Select enemy' : 'Currently not in a war') + '</option>' +
                        enemyOptions +
                    '</select>' +
                '</div>' +
                '<div>' +
                    '<label class="warhub-label">Target ID</label>' +
                    '<input class="warhub-input" id="warhub-target-id" placeholder="Target ID"' + (hasWar ? '' : ' disabled') + ' />' +
                '</div>' +
            '</div>' +
            '<div style="height:8px;"></div>' +
            '<label class="warhub-label">Notes / Reason</label>' +
            '<input class="warhub-input" id="warhub-target-notes" placeholder="Optional notes"' + (hasWar ? '' : ' disabled') + ' />' +
            '<div class="warhub-actions" style="margin-top:8px;">' +
                '<button class="warhub-btn primary" id="warhub-target-add"' + (hasWar ? '' : ' disabled') + '>Add Target</button>' +
            '</div>' +
        '</div>' +

        '<div class="warhub-card">' +
            '<div class="warhub-section-title">' +
                '<h3>Targets</h3>' +
                '<span class="warhub-count">' + targets.length + '</span>' +
            '</div>' +
            '<div class="warhub-list">' +
                targetRows +
            '</div>' +
        '</div>';
}
    
    function renderAnalyticsTab() {
    var canSee = !!((accessState && accessState.isFactionLeader) || isOwnerSession());
    if (!canSee) {
        return '\
          <div class="warhub-card">\
            <h3>War Summary</h3>\
            <div class="warhub-empty">Only faction leaders and admin can access this tab.</div>\
          </div>';
    }
    if (analyticsCache === null) {
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>War Summary</h3><span class="warhub-count">…</span></div>\
            <div class="warhub-empty">Loading war summary...</div>\
            <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn" id="wh-refresh-summary">Refresh Summary</button></div>\
          </div>';
    }
    if (analyticsCache && analyticsCache.ok === false) {
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>War Summary</h3><span class="warhub-count">0</span></div>\
            <div class="warhub-empty">' + esc(analyticsCache.error || 'Could not load war summary.') + '</div>\
            <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn" id="wh-refresh-summary">Refresh Summary</button></div>\
          </div>';
    }

    var sum = analyticsCache || {};
    var totals = sum.totals || {};
    var members = arr(sum.members || []);
    var liveMembers = arr((state && state.members) || []);
    var liveMap = {};
    liveMembers.forEach(function (x) {
        var id = String(x.user_id || x.id || x.player_id || x.member_user_id || '');
        if (id) liveMap[id] = x;
    });

    var mergedMembers = members.map(function (m) {
        var uid = String(m.user_id || m.id || '');
        var live = liveMap[uid] || {};
        var hits = Number(m.hits || m.attacks || 0);
        var gained = Number(m.respect_gained || 0);
        var lost = Number(m.respect_lost || 0);
        var wins = Number(m.wins || 0);
        var losses = Number(m.losses || 0);
        var fights = wins + losses;
        var net = Number(m.net_respect != null ? m.net_respect : (gained - lost));
        return {
            user_id: uid,
            name: m.name || m.member_name || live.name || live.player_name || ('ID ' + uid),
            hits: hits,
            gained: gained,
            lost: lost,
            wins: wins,
            losses: losses,
            fights: fights,
            net: net,
            carryScore: (hits * 2) + (wins * 3) + net,
            position: live.position || '',
            presence: getPresenceState(live),
            statusText: String(live.display_status || live.last_action || live.status || live.status_detail || '—')
        };
    });

    function pillForPresence(presence) {
        if (presence === 'hospital') return '<span class="warhub-pill hosp">Hosp</span>';
        if (presence === 'online') return '<span class="warhub-pill online">Online</span>';
        if (presence === 'idle') return '<span class="warhub-pill idle">Idle</span>';
        if (presence === 'travel') return '<span class="warhub-pill travel">Travel</span>';
        if (presence === 'jail') return '<span class="warhub-pill jail">Jail</span>';
        return '<span class="warhub-pill offline">Offline</span>';
    }

    function pickTop(sorter) {
        var list = [].concat(_toConsumableArray(mergedMembers));
        list.sort(sorter);
        return list[0] || null;
    }

    function singleCard(title, member, lines) {
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>' + esc(title) + '</h3><span class="warhub-count">Top</span></div>\
            ' + (!member ? '<div class="warhub-empty">No data.</div>' : '\
              <div class="warhub-list-item">\
                <div class="warhub-row">\
                  <div>\
                    <div class="warhub-name">' + esc(member.name) + '</div>\
                    <div class="warhub-meta">ID ' + esc(String(member.user_id || '—')) + (member.position ? ' • ' + esc(member.position) : '') + '</div>\
                    <div class="warhub-meta">' + esc(lines.join(' • ')) + '</div>\
                  </div>\
                  <div class="warhub-actions">' + pillForPresence(member.presence) + '</div>\
                </div>\
              </div>') + '\
          </div>';
    }

    var topRespect = pickTop(function (a, b) { if (b.net !== a.net) return b.net - a.net; return b.hits - a.hits; });
    var topHits = pickTop(function (a, b) { if (b.hits !== a.hits) return b.hits - a.hits; return b.net - a.net; });
    var topAttacks = pickTop(function (a, b) { if (b.fights !== a.fights) return b.fights - a.fights; return b.wins - a.wins; });
    var carryingWar = pickTop(function (a, b) { if (b.carryScore !== a.carryScore) return b.carryScore - a.carryScore; return b.net - a.net; });
    var losingGround = pickTop(function (a, b) { if (a.net !== b.net) return a.net - b.net; if (b.losses !== a.losses) return b.losses - a.losses; return a.hits - b.hits; });

    var totalHits = Number(totals.hits || 0);
    var totalWins = Number(totals.wins || 0);
    var totalLosses = Number(totals.losses || 0);
    var totalNet = Number(totals.net_respect != null ? totals.net_respect : ((totals.respect_gained || 0) - (totals.respect_lost || 0)));

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>War Summary</h3><span class="warhub-count">' + fmtNum(mergedMembers.length) + '</span></div>\
        <div class="warhub-grid three">\
          <div class="warhub-metric"><div class="k">Hits</div><div class="v">' + fmtNum(totalHits) + '</div></div>\
          <div class="warhub-metric"><div class="k">Respect</div><div class="v">' + fmtNum(Math.round(totalNet)) + '</div></div>\
          <div class="warhub-metric"><div class="k">Wins / Losses</div><div class="v">' + fmtNum(totalWins) + ' / ' + fmtNum(totalLosses) + '</div></div>\
        </div>\
        <div class="warhub-actions" style="margin-top:8px;"><button class="warhub-btn" id="wh-refresh-summary">Refresh Summary</button></div>\
      </div>\
      <div class="warhub-grid two">\
        ' + singleCard('Top Respect', topRespect, ['Net ' + fmtNum(Math.round((topRespect && topRespect.net) || 0)), 'Hits ' + fmtNum((topRespect && topRespect.hits) || 0), (topRespect && topRespect.statusText) || '—']) + '\
        ' + singleCard('Top Hits', topHits, ['Hits ' + fmtNum((topHits && topHits.hits) || 0), 'Net ' + fmtNum(Math.round((topHits && topHits.net) || 0)), (topHits && topHits.statusText) || '—']) + '\
        ' + singleCard('Top Attacks', topAttacks, ['Fights ' + fmtNum((topAttacks && topAttacks.fights) || 0), 'Wins ' + fmtNum((topAttacks && topAttacks.wins) || 0), (topAttacks && topAttacks.statusText) || '—']) + '\
        ' + singleCard('Carrying the War', carryingWar, ['Hits ' + fmtNum((carryingWar && carryingWar.hits) || 0), 'Respect ' + fmtNum(Math.round((carryingWar && carryingWar.net) || 0)), 'Wins ' + fmtNum((carryingWar && carryingWar.wins) || 0)]) + '\
        ' + singleCard('Member Losing Ground', losingGround, ['Net ' + fmtNum(Math.round((losingGround && losingGround.net) || 0)), 'Losses ' + fmtNum((losingGround && losingGround.losses) || 0), (losingGround && losingGround.statusText) || '—']) + '\
      </div>';
}
        function renderAdminTab() {
        if (!isOwnerSession()) {
            return '\
        <div class="warhub-card">\
          <h3>Fries91 [3679030]</h3>\
          <div class="warhub-empty">Fries91 [3679030] access required.</div>\
        </div>\
      ';
        }

        var dash = (state && state.adminDashboard) || {};
        var items = arr(dash.items || dash.factions || []);
        var summary = dash.summary || {};
        var factionExemptions = arr(dash.faction_exemptions || dash.factionExemptions || []);
        var userExemptions = arr(dash.user_exemptions || dash.userExemptions || []);

        var factionExemptHtml = factionExemptions.length ? factionExemptions.map(function (x) {
            var factionId = x.faction_id || '';
            var factionName = x.faction_name || ('Faction ' + factionId);
            return '\
              <div class="warhub-list-item">\
                <div class="warhub-row">\
                  <div>\
                    <div class="warhub-name">' + esc(factionName) + '</div>\
                    <div class="warhub-meta">' + esc(['ID ' + factionId, x.note || '', x.added_by_name || ''].filter(Boolean).join(' • ')) + '</div>\
                  </div>\
                  <div class="warhub-actions">\
                    <button class="warhub-btn small warn" data-admin-delete-faction-exempt="' + esc(String(factionId)) + '">Remove</button>\
                  </div>\
                </div>\
              </div>\
            ';
        }).join('') : '<div class="warhub-empty">No faction exemptions saved.</div>';

        var userExemptHtml = userExemptions.length ? userExemptions.map(function (x) {
            var userId = x.user_id || '';
            var userName = x.user_name || ('Player ' + userId);
            return '\
              <div class="warhub-list-item">\
                <div class="warhub-row">\
                  <div>\
                    <div class="warhub-name">' + esc(userName) + '</div>\
                    <div class="warhub-meta">' + esc(['ID ' + userId, x.faction_id ? 'Faction ' + x.faction_id : '', x.note || ''].filter(Boolean).join(' • ')) + '</div>\
                  </div>\
                  <div class="warhub-actions">\
                    <button class="warhub-btn small warn" data-admin-delete-user-exempt="' + esc(String(userId)) + '">Remove</button>\
                  </div>\
                </div>\
              </div>\
            ';
        }).join('') : '<div class="warhub-empty">No player exemptions saved.</div>';

        var licenseHtml = items.length ? items.map(function (x) {
            var factionId = x.faction_id || x.id || '';
            var factionName = x.faction_name || x.name || ('Faction ' + factionId);
            var isExempt = !!(x.license && x.license.faction_exempt);
            var metaBits = ['ID ' + factionId, x.status || ''];
            if (isExempt) metaBits.push('Exempt');
            if (x.leader_name) metaBits.push(x.leader_name);
            if (x.expires_at) metaBits.push(fmtTs(x.expires_at));
            return '\
              <div class="warhub-list-item">\
                <div class="warhub-row">\
                  <div>\
                    <div class="warhub-name">' + esc(factionName) + '</div>\
                    <div class="warhub-meta">' + esc(metaBits.filter(Boolean).join(' • ')) + '</div>\
                  </div>\
                  <div class="warhub-actions">\
                    <button class="warhub-btn small" data-admin-history="' + esc(String(factionId)) + '">History</button>\
                    <button class="warhub-btn small good" data-admin-renew="' + esc(String(factionId)) + '">Renew</button>\
                    <button class="warhub-btn small warn" data-admin-expire="' + esc(String(factionId)) + '">Expire</button>\
                  </div>\
                </div>\
              </div>\
            ';
        }).join('') : '<div class="warhub-empty">No faction licenses found.</div>';

        return '\
      <div class="warhub-card">\
        <h3>Fries91 [3679030] Dashboard</h3>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">Factions</div><div class="v">' + fmtNum(summary.faction_licenses_total || items.length || 0) + '</div></div>\
          <div class="warhub-metric"><div class="k">Trials</div><div class="v">' + fmtNum(summary.trials_total || 0) + '</div></div>\
          <div class="warhub-metric"><div class="k">Paid</div><div class="v">' + fmtNum(summary.paid_total || 0) + '</div></div>\
          <div class="warhub-metric"><div class="k">Payment Required</div><div class="v">' + fmtNum(summary.payment_required_total || 0) + '</div></div>\
          <div class="warhub-metric"><div class="k">Faction Exemptions</div><div class="v">' + fmtNum(summary.faction_exemptions_total || factionExemptions.length || 0) + '</div></div>\
          <div class="warhub-metric"><div class="k">Player Exemptions</div><div class="v">' + fmtNum(summary.user_exemptions_total || userExemptions.length || 0) + '</div></div>\
        </div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Faction Exemption</h3>\
        <label class="warhub-label">Faction ID</label>\
        <input class="warhub-input" id="wh-admin-faction-exempt-id" placeholder="Enter faction ID">\
        <label class="warhub-label" style="margin-top:8px;">Faction Name (optional)</label>\
        <input class="warhub-input" id="wh-admin-faction-exempt-name" placeholder="Faction name">\
        <label class="warhub-label" style="margin-top:8px;">Note (optional)</label>\
        <input class="warhub-input" id="wh-admin-faction-exempt-note" placeholder="Why exempt?">\
        <div class="warhub-actions" style="margin-top:10px;">\
          <button class="warhub-btn primary" id="wh-admin-save-faction-exempt">Save Faction Exemption</button>\
        </div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Player Exemption</h3>\
        <label class="warhub-label">Player ID</label>\
        <input class="warhub-input" id="wh-admin-user-exempt-id" placeholder="Enter player ID">\
        <label class="warhub-label" style="margin-top:8px;">Player Name (optional)</label>\
        <input class="warhub-input" id="wh-admin-user-exempt-name" placeholder="Player name">\
        <label class="warhub-label" style="margin-top:8px;">Faction ID (optional)</label>\
        <input class="warhub-input" id="wh-admin-user-exempt-faction-id" placeholder="Faction ID">\
        <label class="warhub-label" style="margin-top:8px;">Faction Name (optional)</label>\
        <input class="warhub-input" id="wh-admin-user-exempt-faction-name" placeholder="Faction name">\
        <label class="warhub-label" style="margin-top:8px;">Note (optional)</label>\
        <input class="warhub-input" id="wh-admin-user-exempt-note" placeholder="Why exempt?">\
        <div class="warhub-actions" style="margin-top:10px;">\
          <button class="warhub-btn primary" id="wh-admin-save-user-exempt">Save Player Exemption</button>\
        </div>\
        <div class="warhub-mini" style="margin-top:8px;">Player exemptions unlock full script use except Admin and leader-only tabs.</div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Faction Exemption List</h3>\
        <div class="warhub-list">' + factionExemptHtml + '</div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Player Exemption List</h3>\
        <div class="warhub-list">' + userExemptHtml + '</div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Faction Licenses</h3>\
        <div class="warhub-list">' + licenseHtml + '</div>\
      </div>\
    ';
    }
    function renderSettingsTab() {
    var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
    var enabledCount = arr((factionMembersCache === null || factionMembersCache === void 0 ? void 0 : factionMembersCache.members) || []).filter(function (x) {
        return !!x.enabled;
    }).length;
    var totalPayment = enabledCount * 3;

    return '\
      <div class="warhub-card">\
        <h3>Keys</h3>\
        <label class="warhub-label">Your Torn API Key</label>\
        <input class="warhub-input" id="wh-api-key" value="' + esc(apiKey) + '" placeholder="Paste your API key">\
        <div class="warhub-actions" style="margin-top:8px;">\
          <button class="warhub-btn primary" id="wh-save-keys">Save Keys</button>\
          <button class="warhub-btn" id="wh-login-btn">Login</button>\
          <button class="warhub-btn warn" id="wh-logout-btn">Logout</button>\
          <button class="warhub-btn" id="wh-reset-positions">Reset Positions</button>\
        </div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Access Info</h3>\
        <div class="warhub-mini" style="line-height:1.6;">\
          Payment player: <strong>' + esc((accessState === null || accessState === void 0 ? void 0 : accessState.paymentPlayer) || PAYMENT_PLAYER) + '</strong><br>\
          Price per enabled member: <strong>3 Xanax</strong><br>\
          Enabled members: <strong>' + esc(String(enabledCount)) + '</strong><br>\
          Total payment: <strong>' + esc(String(totalPayment) + ' Xanax') + '</strong><br>\
          ' + (accessSummaryMessage() ? 'Status: <strong>' + esc(accessSummaryMessage()) + '</strong>' : 'Status: <strong>Ready</strong>') + '\
        </div>\
      </div>';
}
    function renderAccessBanner() {
        var msg = accessSummaryMessage();
        if (!msg) return '';
        var cls = (accessState && (accessState.paymentRequired || accessState.blocked || accessState.trialExpired)) ? 'payment' : (accessState && accessState.trialActive) ? 'trial' : 'good';
        var extra = '';

        if (accessState && accessState.isFactionExempt) {
            extra = 'This faction is exempt from payment and renewal, so members can use War Hub without billing.';
        } else if (accessState && accessState.isUserExempt) {
            extra = 'This player ID is exempt. Shared tabs are unlocked, but Admin and leader-only tabs still stay locked.';
        } else if (accessState && accessState.trialActive && (accessState.isFactionLeader || isOwnerSession())) {
            extra = 'Trial starts automatically when the faction leader logs in. Members can see the script right away, but only enabled members can use shared tools.';
        } else if (accessState && accessState.loggedIn && !accessState.isFactionLeader && !isOwnerSession() && !accessState.memberEnabled) {
            extra = 'You can view the overlay, but your leader must enable you before you can use the faction tools.';
        } else if (accessState && accessState.memberEnabled && !accessState.paymentRequired && !accessState.trialExpired) {
            extra = 'Once your leader enables you for the current faction cycle, your access stays on until the next renewal/payment cycle.';
        }

        return "\n      <div class=\"warhub-banner ".concat(cls, "\">\n        <div><strong>Faction Access</strong></div>\n        <div class=\"warhub-mini\" style=\"margin-top:6px;\">").concat(esc(msg), "</div>\n        ").concat(extra ? '<div class=\"warhub-mini\" style=\"margin-top:6px;\">' + esc(extra) + '</div>' : '', "\n      </div>\n    ");
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
case 'summary': return "".concat(renderAccessBanner()).concat(renderAnalyticsTab());
case 'chain': return "".concat(renderAccessBanner()).concat(renderChainTab());
case 'terms': return renderTermsTab();
case 'members': return "".concat(renderAccessBanner()).concat(renderMembersTab());
case 'enemies': return "".concat(renderAccessBanner()).concat(renderEnemiesTab());
case 'hospital': return "".concat(renderAccessBanner()).concat(renderHospitalTab());
case 'meddeals': return "".concat(renderAccessBanner()).concat(renderMedDealsTab());
case 'targets': return "".concat(renderAccessBanner()).concat(renderTargetsTab());
case 'instructions': return renderInstructionsTab();
case 'settings': return renderSettingsTab();
case 'admin': return renderAdminTab();
default: return renderOverviewTab();
    }
}
    function renderBody() {
        if (!overlay) return;
        var prevLeft = overlay.style.left || '';
        var prevTop = overlay.style.top || '';
        var prevRight = overlay.style.right || '';
        var prevBottom = overlay.style.bottom || '';
        var prevBody = overlay.querySelector('.warhub-body');
        var prevScrollTop = prevBody ? prevBody.scrollTop : Number(GM_getValue(K_OVERLAY_SCROLL, 0)) || 0;
        if (tabLocked(currentTab)) {
            currentTab = 'overview';
            GM_setValue(K_TAB, currentTab);
        }
        overlay.innerHTML = "\n      <div class=\"warhub-head\" id=\"warhub-drag-handle\">\n        <div class=\"warhub-toprow\">\n          <div>\n            <div class=\"warhub-title\">War Hub</div>\n            <div class=\"warhub-sub\">Fries91 • Torn overlay</div>\n          </div>\n          <button class=\"warhub-close\" id=\"warhub-close-btn\" type=\"button\">Close</button>\n        </div>\n      </div>\n      <div class=\"warhub-tabs\">\n        ".concat(TAB_ORDER.map(function (_ref) {
            var key = _ref[0], label = _ref[1];
            return tabBtn(key, label);
        }).join(''), "\n      </div>\n      <div class=\"warhub-body\">\n        <div id=\"warhub-status\" class=\"warhub-status\"></div>\n        ").concat(renderTabContent(), "\n      </div>\n    ");
        bindOverlayEvents();
        bindOverlayDrag();
        restoreStatus();
        if (prevLeft || prevTop || prevRight || prevBottom) {
            overlay.style.left = prevLeft;
            overlay.style.top = prevTop;
            overlay.style.right = prevRight;
            overlay.style.bottom = prevBottom;
        }
        var nextBody = overlay.querySelector('.warhub-body');
        if (nextBody) {
            nextBody.scrollTop = prevScrollTop;
            nextBody.addEventListener('scroll', function () {
                GM_setValue(K_OVERLAY_SCROLL, nextBody.scrollTop || 0);
            }, { passive: true });
        }
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
    shield.style.bottom = 'auto';

    if (window.innerWidth <= 700) {
        shield.style.right = '8px';
        shield.style.top = '92px';
    } else {
        shield.style.right = '14px';
        shield.style.top = '120px';
    }
}
    function positionOverlayNearShield() {
    if (!shield || !overlay) return;

    var saved = GM_getValue(K_OVERLAY_POS, null);
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        overlay.style.left = saved.left + 'px';
        overlay.style.top = saved.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        clampElementPosition(overlay, saved.left, saved.top);
        return;
    }

    var sr = shield.getBoundingClientRect();
    var overlayWidth = Math.min(window.innerWidth - 16, 520);
    var left = sr.right - overlayWidth;
    var top = sr.bottom + 8;

    if (window.innerWidth <= 700) {
        left = 6;
        top = 54;
    }

    overlay.style.right = 'auto';
    overlay.style.bottom = 'auto';
    clampElementPosition(overlay, left, top);
}
    function openOverlay() {
    if (!overlay) return;

    isOpen = true;
    GM_setValue(K_OPEN, true);
    overlay.classList.add('open');

    var saved = GM_getValue(K_OVERLAY_POS, null);

    renderBody();

    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        overlay.style.left = saved.left + 'px';
        overlay.style.top = saved.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        clampElementPosition(overlay, saved.left, saved.top);
    } else {
        positionOverlayNearShield();
    }
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
    var left = parseInt(overlay.style.left || '0', 10);
    var top = parseInt(overlay.style.top || '0', 10);
    GM_setValue(K_OVERLAY_POS, { left: left, top: top });
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
    var dragReady = false;
    var holdTimer = null;
    var THRESHOLD = 6;
    var TOUCH_HOLD_MS = 180;

    function clearHoldTimer() {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    function cleanup() {
        clearHoldTimer();
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
        handleEl.classList.remove('dragging');
        moveEl.classList.remove('dragging');
        moveEl.dataset.dragging = '0';
        active = null;
        dragReady = false;
    }

    function onMove(e) {
        if (active !== e.pointerId) return;

        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        var passedThreshold = Math.abs(dx) >= THRESHOLD || Math.abs(dy) >= THRESHOLD;

        if (!dragReady) {
            if (e.pointerType !== 'touch' && passedThreshold) {
                dragReady = true;
            }
        }

        if (!dragReady || !passedThreshold) return;

        moved = true;
        e.preventDefault();
        dragMoved = true;
        clearHoldTimer();
        handleEl.classList.add('dragging');
        moveEl.classList.add('dragging');
        moveEl.dataset.dragging = '1';
        moveEl.style.right = 'auto';
        moveEl.style.bottom = 'auto';
        clampElementPosition(moveEl, startLeft + dx, startTop + dy);
        if (typeof extra === 'function') extra();
    }

    function onUp(e) {
        if (active !== e.pointerId) return;
        if (moved && typeof saveFn === 'function') saveFn();
        if (typeof extra === 'function') extra();
        cleanup();
        setTimeout(function () { dragMoved = false; }, 120);
    }

    handleEl.addEventListener('pointerdown', function (e) {
        var t = e.target;
        if (t && (t.closest('button') || t.closest('a') || t.closest('input') || t.closest('textarea') || t.closest('select') || t.closest('summary'))) {
            return;
        }

        active = e.pointerId;
        moved = false;
        dragMoved = false;
        dragReady = e.pointerType !== 'touch';

        var rect = moveEl.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        moveEl.style.left = "".concat(rect.left, "px");
        moveEl.style.top = "".concat(rect.top, "px");
        moveEl.style.right = 'auto';
        moveEl.style.bottom = 'auto';

        clearHoldTimer();
        if (e.pointerType === 'touch') {
            holdTimer = setTimeout(function () {
                dragReady = true;
                holdTimer = null;
            }, TOUCH_HOLD_MS);
        }

        if (handleEl.setPointerCapture) {
            handleEl.setPointerCapture(e.pointerId);
        }

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
                setStatus(res.error || 'Could not load Fries91 dashboard.', true);
                return null;
            }
            state = state || {};
            state.adminDashboard = _objectSpread(_objectSpread({}, res.data || {}), {}, {
                items: arr((res.data === null || res.data === void 0 ? void 0 : res.data.items) || (res.data === null || res.data === void 0 ? void 0 : res.data.factions) || []),
                summary: (res.data === null || res.data === void 0 ? void 0 : res.data.summary) || {},
                faction_exemptions: arr((res.data === null || res.data === void 0 ? void 0 : res.data.faction_exemptions) || []),
                user_exemptions: arr((res.data === null || res.data === void 0 ? void 0 : res.data.user_exemptions) || [])
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
            if (tabLocked(tab)) {
                setStatus(tab === 'admin' ? 'Admin tab is locked to Fries91 [3679030].' : 'Leader access required for that tab.', true);
                renderBody();
                return;
            }
            currentTab = tab;
            GM_setValue(K_TAB, currentTab);

            if (tab === 'faction' && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession())) {
                yield loadFactionMembers(true);
            }

            if (tab === 'summary' && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession())) {
                yield loadAnalytics().catch(function () { return null; });
            }

            if (tab === 'admin' && isOwnerSession()) {
                yield loadAdminDashboard();
            }

            renderBody();
        }));
    });

    var closeBtn = overlay ? overlay.querySelector('#warhub-close-btn') : null;
    if (closeBtn) closeBtn.addEventListener('click', function () { closeOverlay(); });

    var avOn = overlay ? overlay.querySelector('#warhub-set-available') : null;
    if (avOn) avOn.addEventListener('click', _asyncToGenerator(function* () {
        var res = yield doAction('POST', '/api/availability', { available: true }, 'Availability set to available.', false);
        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

    var avOff = overlay ? overlay.querySelector('#warhub-set-unavailable') : null;
    if (avOff) avOff.addEventListener('click', _asyncToGenerator(function* () {
        var res = yield doAction('POST', '/api/availability', { available: false }, 'Availability set to unavailable.', false);
        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

    var chOn = overlay ? overlay.querySelector('#warhub-set-chain-on') : null;
    if (chOn) chOn.addEventListener('click', _asyncToGenerator(function* () {
        var res = yield doAction('POST', '/api/chain-sitter', { enabled: true }, 'Chain sitter enabled.', false);
        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

    var chOff = overlay ? overlay.querySelector('#warhub-set-chain-off') : null;
    if (chOff) chOff.addEventListener('click', _asyncToGenerator(function* () {
        var res = yield doAction('POST', '/api/chain-sitter', { enabled: false }, 'Chain sitter disabled.', false);
        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

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
        }, 'Med deal added.', false);

        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

    if (overlay) overlay.querySelectorAll('.warhub-del-med').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var id = cleanInputValue(btn.getAttribute('data-id') || '');
            if (!id) return;

            var res = yield req('DELETE', "/api/med-deals/".concat(encodeURIComponent(id)));
            if (!res.ok) {
                setStatus(res.error || 'Could not delete med deal.', true);
                return;
            }
            setStatus('Med deal deleted.');

            var remainingDeals = arr((state && (state.medDeals || state.med_deals)) || []).filter(function (x) {
                return String(x.id || x.deal_id || '') !== id;
            });

            state = state || {};
            state.medDeals = remainingDeals;
            state.med_deals = remainingDeals;

            yield loadState(true);
            renderBody();
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
        var targetIdField = overlay ? overlay.querySelector('#warhub-target-id') : null;
        if (targetIdField) targetIdField.value = id;
    });

    var targetAdd = overlay ? overlay.querySelector('#warhub-target-add') : null;
    if (targetAdd) targetAdd.addEventListener('click', _asyncToGenerator(function* () {
        var sel = overlay ? overlay.querySelector('#warhub-target-enemy') : null;
        var opt = sel && sel.selectedOptions ? sel.selectedOptions[0] : null;
        var targetIdField = overlay ? overlay.querySelector('#warhub-target-id') : null;
        var targetNotesField = overlay ? overlay.querySelector('#warhub-target-notes') : null;

        var target_id = cleanInputValue(((targetIdField && targetIdField.value) || ((opt === null || opt === void 0 ? void 0 : opt.value) || '')));
        var target_name = cleanInputValue((opt === null || opt === void 0 ? void 0 : opt.dataset.name) || '');
        var notes = cleanInputValue(((targetNotesField && targetNotesField.value) || ''));

        if (!target_id) {
            setStatus('Target ID is required.', true);
            return;
        }

        var res = yield doAction('POST', '/api/targets', {
            target_id: target_id,
            target_name: target_name,
            notes: notes
        }, 'Target added.', false);

        if (res) {
            yield loadState(true);
            renderBody();
        }
    }));

    if (overlay) overlay.querySelectorAll('.warhub-del-target').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var id = cleanInputValue(btn.getAttribute('data-id') || '');
            if (!id) return;

            var res = yield req('DELETE', "/api/targets/".concat(encodeURIComponent(id)));
            if (!res.ok) {
                setStatus(res.error || 'Could not delete target.', true);
                return;
            }
            setStatus('Target deleted.');

            var remainingTargets = arr((state && state.targets) || []).filter(function (x) {
                return String(x.id || x.target_row_id || x.target_id || '') !== id;
            });

            state = state || {};
            state.targets = remainingTargets;

            yield loadState(true);
            renderBody();
        }));
    });

    var saveTerms = overlay ? overlay.querySelector('#warhub-terms-save') : null;
    if (saveTerms) saveTerms.addEventListener('click', _asyncToGenerator(function* () {
        var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');
        var terms = cleanInputValue((overlay.querySelector('#warhub-terms-text') || {}).value || '');

        if (!war_id) {
            setStatus('No active war detected.', true);
            return;
        }

        var res = yield doAction('POST', '/api/war-terms', { war_id: war_id, terms: terms }, 'War terms saved.');
        if (res) renderBody();
    }));

    var delTerms = overlay ? overlay.querySelector('#warhub-terms-delete') : null;
    if (delTerms) delTerms.addEventListener('click', _asyncToGenerator(function* () {
        var war_id = cleanInputValue(((state === null || state === void 0 ? void 0 : state.war) && state.war.war_id) || ((state === null || state === void 0 ? void 0 : state.war) && state.war.id) || '');

        if (!war_id) {
            setStatus('No active war detected.', true);
            return;
        }

        var box = overlay ? overlay.querySelector('#warhub-terms-text') : null;
        if (box) box.value = '';

        var saveRes = yield doAction('POST', '/api/war-terms', { war_id: war_id, terms: '' }, 'War terms cleared.');
        if (saveRes) {
            if (state) {
                state.terms = state.terms || {};
                state.terms.terms = '';
                state.terms.terms_text = '';
                state.warTerms = state.warTerms || {};
                state.warTerms.terms = '';
                state.warTerms.terms_text = '';
            }
            renderBody();
        }
    }));

    var refreshSummary = overlay ? overlay.querySelector('#wh-refresh-summary') : null;
    if (refreshSummary) refreshSummary.addEventListener('click', _asyncToGenerator(function* () {
        analyticsCache = null;
        yield loadAnalytics().catch(function () { return null; });
        renderBody();
        setStatus('War summary refreshed.');
    }));

    var refreshAlerts = overlay ? overlay.querySelector('#wh-mark-alerts-seen') : null;
    if (refreshAlerts) refreshAlerts.addEventListener('click', _asyncToGenerator(function* () {
        var res = yield req('GET', '/api/notifications');
        if (!res.ok) {
            setStatus(res.error || 'Could not refresh notifications.', true);
            return;
        }
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
        var member_user_id = cleanInputValue((overlay.querySelector('#wh-fm-userid') || {}).value || '');
        if (!member_user_id) {
            setStatus('Select a faction member first.', true);
            return;
        }

        var picked = arr((state && state.members) || []).find(function (m) {
            return String(m.user_id || m.id || '').trim() === member_user_id;
        }) || {};

        var member_name = cleanInputValue(
            picked.name ||
            picked.member_name ||
            ''
        );

        var position = cleanInputValue(
            picked.position ||
            picked.faction_position ||
            picked.role ||
            ''
        );

        var res = yield doAction('POST', '/api/faction/members', {
            member_user_id: member_user_id,
            member_name: member_name,
            enabled: true,
            position: position
        }, 'Member enabled for this faction cycle.', false);

        if (res) {
            yield refreshLeaderFactionData();
            setStatus('Faction member access saved.');
        }
    }));

    if (overlay) overlay.querySelectorAll('[data-toggle-member]').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var memberId = cleanInputValue(btn.getAttribute('data-toggle-member') || '');
            var enabled = cleanInputValue(btn.getAttribute('data-enabled') || '') === '1';
            var cycleLocked = cleanInputValue(btn.getAttribute('data-cycle-locked') || '') === '1';
            if (!memberId) return;
            if (cycleLocked) {
                setStatus('Enabled member access is locked until the next renewal/payment cycle.', true);
                return;
            }
            var res = yield doAction('POST', "/api/faction/members/".concat(encodeURIComponent(memberId), "/enable"), { enabled: enabled }, enabled ? 'Member enabled.' : 'Member disabled.', false);
            if (res) yield refreshLeaderFactionData();
        }));
    });

    if (overlay) overlay.querySelectorAll('[data-del-member]').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var memberId = cleanInputValue(btn.getAttribute('data-del-member') || '');
            var cycleLocked = cleanInputValue(btn.getAttribute('data-cycle-locked') || '') === '1';
            if (!memberId) return;
            if (cycleLocked) {
                setStatus('Enabled member access is locked until the next renewal/payment cycle.', true);
                return;
            }
            var res = yield doAction('DELETE', "/api/faction/members/".concat(encodeURIComponent(memberId)), null, 'Faction member removed.', false);
            if (res) yield refreshLeaderFactionData();
        }));
    });

    if (overlay) overlay.querySelectorAll('[data-admin-history]').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var factionId = cleanInputValue(btn.getAttribute('data-admin-history') || '');
            if (!factionId) return;
            var res = yield adminReq('GET', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/history"));
            if (!res.ok) {
                setStatus(res.error || 'Could not load payment history.', true);
                return;
            }
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
            var amountText = prompt('Renew faction for how much?', '3');
            if (amountText == null) return;
            var amount = Number(String(amountText).replace(/[^\d.-]/g, ''));
            if (!Number.isFinite(amount) || amount <= 0) {
                setStatus('Invalid renewal amount.', true);
                return;
            }
            var note = prompt('Optional note for renewal:', '') || '';
            var res = yield adminReq('POST', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/renew"), { amount: amount, note: note });
            if (!res.ok) {
                setStatus(res.error || 'Renew failed.', true);
                return;
            }
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
            if (!res.ok) {
                setStatus(res.error || 'Expire failed.', true);
                return;
            }
            setStatus('Faction expired.');
            yield loadAdminDashboard();
        }));
    });


    var saveFactionExempt = overlay ? overlay.querySelector('#wh-admin-save-faction-exempt') : null;
    if (saveFactionExempt) saveFactionExempt.addEventListener('click', _asyncToGenerator(function* () {
        var factionId = cleanInputValue((overlay.querySelector('#wh-admin-faction-exempt-id') || {}).value || '');
        var factionName = cleanInputValue((overlay.querySelector('#wh-admin-faction-exempt-name') || {}).value || '');
        var note = cleanInputValue((overlay.querySelector('#wh-admin-faction-exempt-note') || {}).value || '');
        if (!factionId) {
            setStatus('Faction ID is required.', true);
            return;
        }
        var res = yield adminReq('POST', '/api/admin/exemptions/factions', {
            faction_id: factionId,
            faction_name: factionName,
            note: note
        });
        if (!res.ok) {
            setStatus(res.error || 'Could not save faction exemption.', true);
            return;
        }
        setStatus('Faction exemption saved.');
        yield loadAdminDashboard();
    }));

    var saveUserExempt = overlay ? overlay.querySelector('#wh-admin-save-user-exempt') : null;
    if (saveUserExempt) saveUserExempt.addEventListener('click', _asyncToGenerator(function* () {
        var userId = cleanInputValue((overlay.querySelector('#wh-admin-user-exempt-id') || {}).value || '');
        var userName = cleanInputValue((overlay.querySelector('#wh-admin-user-exempt-name') || {}).value || '');
        var factionId = cleanInputValue((overlay.querySelector('#wh-admin-user-exempt-faction-id') || {}).value || '');
        var factionName = cleanInputValue((overlay.querySelector('#wh-admin-user-exempt-faction-name') || {}).value || '');
        var note = cleanInputValue((overlay.querySelector('#wh-admin-user-exempt-note') || {}).value || '');
        if (!userId) {
            setStatus('Player ID is required.', true);
            return;
        }
        var res = yield adminReq('POST', '/api/admin/exemptions/users', {
            user_id: userId,
            user_name: userName,
            faction_id: factionId,
            faction_name: factionName,
            note: note
        });
        if (!res.ok) {
            setStatus(res.error || 'Could not save player exemption.', true);
            return;
        }
        setStatus('Player exemption saved.');
        yield loadAdminDashboard();
    }));

    if (overlay) overlay.querySelectorAll('[data-admin-delete-faction-exempt]').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var factionId = cleanInputValue(btn.getAttribute('data-admin-delete-faction-exempt') || '');
            if (!factionId) return;
            if (!confirm('Remove faction exemption ' + factionId + '?')) return;
            var res = yield adminReq('DELETE', '/api/admin/exemptions/factions/' + encodeURIComponent(factionId));
            if (!res.ok) {
                setStatus(res.error || 'Could not remove faction exemption.', true);
                return;
            }
            setStatus('Faction exemption removed.');
            yield loadAdminDashboard();
        }));
    });

    if (overlay) overlay.querySelectorAll('[data-admin-delete-user-exempt]').forEach(function (btn) {
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var userId = cleanInputValue(btn.getAttribute('data-admin-delete-user-exempt') || '');
            if (!userId) return;
            if (!confirm('Remove player exemption ' + userId + '?')) return;
            var res = yield adminReq('DELETE', '/api/admin/exemptions/users/' + encodeURIComponent(userId));
            if (!res.ok) {
                setStatus(res.error || 'Could not remove player exemption.', true);
                return;
            }
            setStatus('Player exemption removed.');
            yield loadAdminDashboard();
        }));
    });

    var saveKeys = overlay ? overlay.querySelector('#wh-save-keys') : null;
    if (saveKeys) saveKeys.addEventListener('click', function () {
        var apiKey = cleanInputValue((overlay.querySelector('#wh-api-key') || {}).value || '');
        GM_setValue(K_API_KEY, apiKey);
        setStatus('API key saved locally.');
    });

    var loginBtn = overlay ? overlay.querySelector('#wh-login-btn') : null;
    if (loginBtn) loginBtn.addEventListener('click', _asyncToGenerator(function* () {
        var apiKey = cleanInputValue((overlay.querySelector('#wh-api-key') || {}).value || '');
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

    var membersSearch = overlay ? overlay.querySelector('#warhub-members-search') : null;
    if (membersSearch) membersSearch.addEventListener('input', function () {
        state = state || {};
        state.membersSearch = String(membersSearch.value || '');
        renderBody();
    });

    var membersSearchClear = overlay ? overlay.querySelector('#warhub-members-search-clear') : null;
    if (membersSearchClear) membersSearchClear.addEventListener('click', function () {
        state = state || {};
        state.membersSearch = '';
        renderBody();
    });

    var saveRefresh = overlay ? overlay.querySelector('#wh-save-refresh') : null;
    if (saveRefresh) saveRefresh.addEventListener('click', function () {
        var raw = cleanInputValue((overlay.querySelector('#wh-refresh-ms') || {}).value || '30000');
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
        btn.addEventListener('click', _asyncToGenerator(function* () {
            var nextTab = cleanInputValue(btn.getAttribute('data-overview-go') || '');
            if (!nextTab) return;

            currentTab = nextTab;
            GM_setValue(K_TAB, currentTab);

            if (nextTab === 'faction' && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession())) {
                yield loadFactionMembers(true);
            }

            if (nextTab === 'summary' && ((accessState === null || accessState === void 0 ? void 0 : accessState.isFactionLeader) || isOwnerSession())) {
                yield loadAnalytics().catch(function () { return null; });
            }

            if (nextTab === 'admin' && isOwnerSession()) {
                yield loadAdminDashboard();
            }

            renderBody();
        }));
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
    if (
        savedShield &&
        typeof savedShield === 'object'
    ) {
        shield.style.left = savedShield.left || 'auto';
        shield.style.top = savedShield.top || '';
        shield.style.right = savedShield.right || '14px';
        shield.style.bottom = savedShield.bottom || 'auto';
    } else {
        resetShieldPosition();
    }

    clampToViewport(shield);
    saveShieldPos();

    var rect = shield.getBoundingClientRect();
    if (
        rect.width < 20 ||
        rect.height < 20 ||
        rect.right < 0 ||
        rect.bottom < 0 ||
        rect.left > window.innerWidth ||
        rect.top > window.innerHeight
    ) {
        resetShieldPosition();
        clampToViewport(shield);
        saveShieldPos();
    }

    makeDraggable(shield, shield, saveShieldPos, function () {
        updateBadge();
        if (!GM_getValue(K_OVERLAY_POS, null) && !isOpen) {
            positionOverlayNearShield();
        }
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
        saveShieldPos();
        saveOverlayPos();
        updateBadge();
    });

    renderBody();

    var savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (
        savedOverlay &&
        typeof savedOverlay === 'object' &&
        typeof savedOverlay.left === 'number' &&
        typeof savedOverlay.top === 'number'
    ) {
        overlay.style.left = savedOverlay.left + 'px';
        overlay.style.top = savedOverlay.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
        clampElementPosition(overlay, savedOverlay.left, savedOverlay.top);
    } else {
        positionOverlayNearShield();
    }

    if (isOpen) overlay.classList.add('open');
    else overlay.classList.remove('open');

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
