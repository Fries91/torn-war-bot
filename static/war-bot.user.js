// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.1.1
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
var K_TABS_SCROLL_LEFT = 'warhub_tabs_scroll_left_v3';
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
    ['admin', 'Admin'],
    ['wartop5', 'War Top 5']
];
    var state = null;
    var analyticsCache = null;
    var adminTopFiveCache = null;
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
    var css = "\n    #warhub-shield {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      width: 42px !important;\n      height: 42px !important;\n      border-radius: 12px !important;\n      display: flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      font-size: 22px !important;\n      line-height: 1 !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n      border: 1px solid rgba(255,255,255,.10) !important;\n      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n      color: #fff !important;\n      top: 120px !important;\n      right: 14px !important;\n      left: auto !important;\n      bottom: auto !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      pointer-events: auto !important;\n    }\n    #warhub-shield.dragging { cursor: grabbing !important; }\n\n    #warhub-badge {\n      position: fixed !important;\n      z-index: 2147483647 !important;\n      min-width: 16px !important;\n      height: 16px !important;\n      padding: 0 4px !important;\n      border-radius: 999px !important;\n      background: #ffd54a !important;\n      color: #111 !important;\n      font-size: 10px !important;\n      line-height: 16px !important;\n      text-align: center !important;\n      font-weight: 800 !important;\n      box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;\n      display: none !important;\n      pointer-events: none !important;\n    }\n\n    #warhub-overlay {\n      position: fixed !important;\n      z-index: 2147483646 !important;\n      right: 12px !important;\n      top: 170px !important;\n      width: min(96vw, 520px) !important;\n      height: min(88vh, 900px) !important;\n      max-height: 88vh !important;\n      min-height: 420px !important;\n      overflow: hidden !important;\n      border-radius: 14px !important;\n      background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n      color: #f2f2f2 !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n      display: none !important;\n      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n      left: auto !important;\n      bottom: auto !important;\n      flex-direction: column !important;\n      box-sizing: border-box !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n    }\n    #warhub-overlay.open { display: flex !important; }\n\n    #warhub-overlay *,\n    #warhub-overlay *::before,\n    #warhub-overlay *::after {\n      box-sizing: border-box !important;\n    }\n\n    .warhub-head {\n      padding: 10px 12px 9px !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;\n      cursor: grab !important;\n      user-select: none !important;\n      -webkit-user-select: none !important;\n      -webkit-touch-callout: none !important;\n      touch-action: none !important;\n      flex: 0 0 auto !important;\n      display: block !important;\n      width: 100% !important;\n      min-height: 54px !important;\n    }\n    .warhub-head.dragging { cursor: grabbing !important; }\n\n    .warhub-toprow {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 10px !important;\n      width: 100% !important;\n    }\n\n    .warhub-title {\n      font-weight: 800 !important;\n      font-size: 16px !important;\n      letter-spacing: .2px !important;\n      color: #fff !important;\n    }\n    .warhub-sub {\n      opacity: .72 !important;\n      font-size: 11px !important;\n      margin-top: 2px !important;\n      color: #fff !important;\n    }\n\n    .warhub-close {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 9px !important;\n      background: rgba(255,255,255,.08) !important;\n      color: #fff !important;\n      padding: 5px 9px !important;\n      font-weight: 700 !important;\n      cursor: pointer !important;\n      font-size: 12px !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n    }\n\n    .warhub-tabs {\n      display: flex !important;\n      flex: 0 0 auto !important;\n      flex-wrap: nowrap !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 8px !important;\n      overflow-x: auto !important;\n      overflow-y: hidden !important;\n      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n      background: rgba(255,255,255,.02) !important;\n      scrollbar-width: thin !important;\n      -webkit-overflow-scrolling: touch !important;\n      width: 100% !important;\n      min-height: 48px !important;\n      max-height: 48px !important;\n      white-space: nowrap !important;\n    }\n\n    .warhub-tab {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      color: #fff !important;\n      padding: 6px 10px !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n      white-space: nowrap !important;\n      cursor: pointer !important;\n      flex: 0 0 auto !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      min-height: 30px !important;\n      line-height: 1.1 !important;\n      opacity: 1 !important;\n      visibility: visible !important;\n      gap: 6px !important;\n    }\n    .warhub-tab.active {\n      background: linear-gradient(180deg, #d23333, #831515) !important;\n      color: #fff !important;\n    }\n    .warhub-tab.locked {\n      opacity: .55 !important;\n    }\n\n    .warhub-body {\n      padding: 8px !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      flex: 1 1 auto !important;\n      min-height: 0 !important;\n      width: 100% !important;\n      display: block !important;\n    }\n\n    .warhub-status {\n      display: none !important;\n      margin-bottom: 8px !important;\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      font-size: 12px !important;\n      background: rgba(255,255,255,.06) !important;\n      color: #fff !important;\n    }\n    .warhub-status.show { display: block !important; }\n    .warhub-status.err {\n      background: rgba(185,52,52,.22) !important;\n      color: #ffdcdc !important;\n    }\n\n    .warhub-banner {\n      margin-bottom: 8px !important;\n      padding: 10px 12px !important;\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.06) !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      display: grid !important;\n      gap: 6px !important;\n    }\n\n    .warhub-grid {\n      display: grid !important;\n      gap: 8px !important;\n    }\n    .warhub-grid.two {\n      grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n    }\n    .warhub-grid.three {\n      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;\n    }\n\n    .warhub-card {\n      background: rgba(255,255,255,.04) !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      border-radius: 12px !important;\n      padding: 10px !important;\n      margin-bottom: 8px !important;\n      overflow: hidden !important;\n    }\n    .warhub-card h3 {\n      margin: 0 0 8px !important;\n      font-size: 13px !important;\n      color: #fff !important;\n    }\n\n    .warhub-section-title {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      margin-bottom: 8px !important;\n    }\n    .warhub-section-title h3 {\n      margin: 0 !important;\n      color: #fff !important;\n    }\n\n    .warhub-row {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: space-between !important;\n      gap: 8px !important;\n      padding: 8px 0 !important;\n      border-bottom: 1px solid rgba(255,255,255,.06) !important;\n    }\n    .warhub-row:last-child {\n      border-bottom: 0 !important;\n      padding-bottom: 0 !important;\n    }\n\n    .warhub-left {\n      min-width: 0 !important;\n      display: grid !important;\n      gap: 2px !important;\n    }\n\n    .warhub-name {\n      font-weight: 800 !important;\n      color: #fff !important;\n      font-size: 13px !important;\n      line-height: 1.2 !important;\n      word-break: break-word !important;\n    }\n\n    .warhub-meta {\n      font-size: 11px !important;\n      opacity: .74 !important;\n      color: #fff !important;\n      line-height: 1.25 !important;\n      word-break: break-word !important;\n    }\n\n    .warhub-right {\n      display: flex !important;\n      align-items: center !important;\n      justify-content: flex-end !important;\n      gap: 6px !important;\n      flex-wrap: wrap !important;\n      flex: 0 0 auto !important;\n    }\n\n    .warhub-actions {\n      display: flex !important;\n      flex-wrap: wrap !important;\n      gap: 6px !important;\n    }\n\n    .warhub-btn {\n      appearance: none !important;\n      -webkit-appearance: none !important;\n      border: 0 !important;\n      border-radius: 9px !important;\n      background: rgba(255,255,255,.09) !important;\n      color: #fff !important;\n      padding: 7px 10px !important;\n      font-size: 12px !important;\n      font-weight: 800 !important;\n      cursor: pointer !important;\n      min-height: 30px !important;\n      text-decoration: none !important;\n      display: inline-flex !important;\n      align-items: center !important;\n      justify-content: center !important;\n      line-height: 1 !important;\n    }\n    .warhub-btn.primary {\n      background: linear-gradient(180deg, #d23333, #831515) !important;\n      color: #fff !important;\n    }\n    .warhub-btn.good {\n      background: linear-gradient(180deg, #2d9b5d, #186a3b) !important;\n      color: #fff !important;\n    }\n    .warhub-btn.warn {\n      background: linear-gradient(180deg, #b93b3b, #7a1e1e) !important;\n      color: #fff !important;\n    }\n\n    .warhub-metric {\n      border-radius: 11px !important;\n      background: rgba(255,255,255,.05) !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      padding: 10px !important;\n    }\n    .warhub-metric .k {\n      font-size: 11px !important;\n      opacity: .72 !important;\n      color: #fff !important;\n    }\n    .warhub-metric .v {\n      margin-top: 3px !important;\n      font-size: 18px !important;\n      font-weight: 900 !important;\n      color: #fff !important;\n      line-height: 1.15 !important;\n      word-break: break-word !important;\n    }\n\n    .warhub-empty {\n      padding: 12px !important;\n      text-align: center !important;\n      font-size: 12px !important;\n      opacity: .76 !important;\n      color: #fff !important;\n    }\n\n    .warhub-select,\n    .warhub-input,\n    .warhub-textarea {\n      width: 100% !important;\n      border: 1px solid rgba(255,255,255,.12) !important;\n      background: rgba(255,255,255,.06) !important;\n      color: #fff !important;\n      border-radius: 10px !important;\n      padding: 9px 10px !important;\n      font-size: 13px !important;\n      outline: none !important;\n      box-shadow: none !important;\n    }\n\n    .warhub-input[readonly] {\n      opacity: .9 !important;\n      background: rgba(255,255,255,.035) !important;\n    }\n\n    .warhub-textarea { min-height: 94px !important; resize: vertical !important; }\n\n    .warhub-label {\n      font-size: 11px !important;\n      opacity: .74 !important;\n      margin-bottom: 4px !important;\n      display: block !important;\n      color: #fff !important;\n    }\n\n   .warhub-pill {\n      display: inline-flex !important;\n      align-items: center !important;\n      gap: 6px !important;\n      padding: 4px 8px !important;\n      border-radius: 999px !important;\n      background: rgba(255,255,255,.07) !important;\n      border: 1px solid rgba(255,255,255,.08) !important;\n      font-size: 11px !important;\n      font-weight: 700 !important;\n    }\n\n    .warhub-pill.online {\n      background: rgba(40,140,90,.20) !important;\n      color: #b7ffd5 !important;\n    }\n\n    .warhub-pill.idle {\n      background: rgba(197,141,46,.22) !important;\n      color: #ffe3a5 !important;\n    }\n\n    .warhub-pill.offline {\n      background: rgba(113,113,113,.20) !important;\n      color: #dadada !important;\n    }\n\n    .warhub-pill.hosp {\n      background: rgba(181,62,62,.24) !important;\n      color: #ffd0d0 !important;\n    }\n\n    .warhub-pill.travel {\n      background: rgba(53,110,190,.24) !important;\n      color: #d5e7ff !important;\n    }\n\n    .warhub-pill.jail {\n      background: rgba(110,68,175,.24) !important;\n      color: #e5d8ff !important;\n    }\n\n    .warhub-pill.leader {\n      background: rgba(66,110,185,.24) !important;\n      color: #d3e3ff !important;\n    }\n\n    .warhub-pill.enabled {\n      background: rgba(35,140,82,.22) !important;\n      color: #b7ffd5 !important;\n    }\n\n    .warhub-pill.disabled {\n      background: rgba(145,37,37,.24) !important;\n      color: #ffd0d0 !important;\n    }\n\n    .warhub-pill.good {\n      background: rgba(34,197,94,.18) !important;\n      border-color: rgba(34,197,94,.45) !important;\n      color: #bbf7d0 !important;\n    }\n\n    .warhub-pill.bad {\n      background: rgba(239,68,68,.18) !important;\n      border-color: rgba(239,68,68,.45) !important;\n      color: #fecaca !important;\n    }\n\n    .warhub-pill.neutral {\n      background: rgba(148,163,184,.16) !important;\n      border-color: rgba(148,163,184,.35) !important;\n      color: #e2e8f0 !important;\n    }\n\n    .warhub-pos {\n      color: #86efac !important;\n    }\n\n    .warhub-neg {\n      color: #fca5a5 !important;\n    }\n\n    .warhub-divider {\n      height: 1px !important;\n      background: rgba(255,255,255,.07) !important;\n      margin: 8px 0 !important;\n    }\n    .warhub-mini { font-size: 11px !important; opacity: .78 !important; color: #fff !important; }\n    .warhub-link { color: #fff !important; text-decoration: none !important; }\n\n    .warhub-section-scroll {\n      max-height: 52vh !important;\n      overflow-y: auto !important;\n      overflow-x: hidden !important;\n      -webkit-overflow-scrolling: touch !important;\n      padding-right: 2px !important;\n    }\n\n    .warhub-payment-line {\n      padding: 8px 10px !important;\n      border-radius: 10px !important;\n      background: rgba(255,255,255,.06) !important;\n      font-weight: 800 !important;\n      text-align: center !important;\n      margin-top: 8px !important;\n    }\n\n    @media (max-width: 700px) {\n      #warhub-overlay {\n        width: 98vw !important;\n        height: 88vh !important;\n        min-height: 360px !important;\n        top: 56px !important;\n        left: 1vw !important;\n        right: 1vw !important;\n        border-radius: 12px !important;\n      }\n      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr !important; }\n      .warhub-body { padding-bottom: 18px !important; }\n      #warhub-shield {\n        width: 40px !important;\n        height: 40px !important;\n        font-size: 21px !important;\n      }\n      .warhub-section-scroll { max-height: 34vh !important; }\n      .warhub-tabs {\n        min-height: 44px !important;\n        max-height: 44px !important;\n      }\n    }\n  ";
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

        if (!accessState.loggedIn) {
            return accessState.message || 'Log in with your Torn API key to start using War Hub.';
        }

        if (accessState.isFactionLeader || isOwnerSession()) {
            if (accessState.trialActive) {
                var days = accessState.daysLeft != null ? accessState.daysLeft : fmtDaysLeftFromIso(accessState.expiresAt);
                return accessState.message || ("Faction trial active" + (days != null ? " \u2022 " + days + " day" + (days === 1 ? '' : 's') + " left" : '') + ".");
            }
            return accessState.message || 'Leader access active.';
        }

        if (accessState.memberEnabled) {
            return accessState.message || 'Member access enabled by your faction leader.';
        }

        return accessState.message || 'Read-only access until your faction leader enables your script.';
    }
    function canUseFeaturesNow() {
        return !!(accessState && accessState.canUseFeatures);
    }
    function getSavedApiKey() {
        return cleanInputValue(GM_getValue(K_API_KEY, ''));
    }
    function getSavedAdminKey() {
        return cleanInputValue(GM_getValue(K_ADMIN_KEY, ''));
    }
    function getSessionId() {
        return cleanInputValue(GM_getValue(K_SESSION, ''));
    }
    function saveSessionId(sessionId) {
        sessionId = cleanInputValue(sessionId || '');
        if (sessionId) GM_setValue(K_SESSION, sessionId);else GM_deleteValue(K_SESSION);
    }
    function saveApiKey(v) {
        v = cleanInputValue(v || '');
        if (v) GM_setValue(K_API_KEY, v);else GM_deleteValue(K_API_KEY);
    }
    function saveAdminKey(v) {
        v = cleanInputValue(v || '');
        if (v) GM_setValue(K_ADMIN_KEY, v);else GM_deleteValue(K_ADMIN_KEY);
    }
    function isOwnerSession() {
        var uid = String((state && state.user && state.user.user_id) || (state && state.me && state.me.user_id) || (accessState && accessState.userId) || '').trim();
        return uid === OWNER_USER_ID;
    }
    function ownerTokenAllowed() {
        var saved = cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''));
        return !!saved && saved === String(window.AVAIL_TOKEN || '');
    }
    function activeUserId() {
        return String((state && state.user && state.user.user_id) || (state && state.me && state.me.user_id) || '').trim();
    }
    function activeFactionId() {
        return String((state && state.user && state.user.faction_id) || (state && state.me && state.me.faction_id) || '').trim();
    }
    function activeFactionName() {
        return String((state && state.user && state.user.faction_name) || (state && state.me && state.me.faction_name) || '').trim();
    }
    function wantsLiveStats() {
        var me = arr((state && state.members) || []).find(function (m) {
            return String((m && (m.user_id || m.id)) || '') === activeUserId();
        });
        return !!(me && me.live_stats_enabled);
    }
    function supportFormLink() {
        var uid = activeUserId();
        return uid ? "https://www.torn.com/messages.php#/p=compose&XID=".concat(OWNER_USER_ID, "&subject=").concat(encodeURIComponent('War Hub support request'), "&message=").concat(encodeURIComponent('Hi ' + OWNER_NAME + ', I need help with War Hub. My user ID is ' + uid + '.')) : "https://www.torn.com/profiles.php?XID=".concat(OWNER_USER_ID);
    }
    function adminSupportLink() {
        return "https://www.torn.com/profiles.php?XID=".concat(OWNER_USER_ID);
    }
    function buildQuery(params) {
        var pairs = [];
        Object.keys(params || {}).forEach(function (k) {
            var v = params[k];
            if (v == null || v === '') return;
            pairs.push("".concat(encodeURIComponent(k), "=").concat(encodeURIComponent(String(v))));
        });
        return pairs.length ? "?".concat(pairs.join('&')) : '';
    }
    function currentWarId() {
        return String((state && state.war && state.war.war_id) || '').trim();
    }
    function currentWarStatus() {
        return state && state.war ? state.war.status || '' : '';
    }
    function currentTargetScore() {
        return Number((state && state.score && state.score.target) || (state && state.war && state.war.target_score) || 0) || 0;
    }
    function currentOurScore() {
        return Number((state && state.score && state.score.our) || (state && state.war && state.war.score_us) || 0) || 0;
    }
    function currentEnemyScore() {
        return Number((state && state.score && state.score.enemy) || (state && state.war && state.war.score_them) || 0) || 0;
    }
    function currentNetScore() {
        return currentOurScore() - currentEnemyScore();
    }
    function withSessionHeaders(extra) {
        var headers = _objectSpread({}, extra || {});
        var sid = getSessionId();
        if (sid) headers['X-Session-Id'] = sid;
        return headers;
    }
    function gmXhr(method, path, body, extraHeaders) {
        return new Promise(function (resolve, reject) {
            var url = path.indexOf('http') === 0 ? path : "".concat(BASE_URL).concat(path);
            var headers = _objectSpread({
                'Content-Type': 'application/json'
            }, extraHeaders || {});
            GM_xmlhttpRequest({
                method: method,
                url: url,
                headers: headers,
                data: body ? JSON.stringify(body) : undefined,
                timeout: 30000,
                onload: function onload(resp) {
                    try {
                        var json = resp && resp.responseText ? JSON.parse(resp.responseText) : {};
                        resolve({
                            ok: resp.status >= 200 && resp.status < 300,
                            status: resp.status,
                            data: json
                        });
                    } catch (e) {
                        resolve({
                            ok: false,
                            status: resp.status || 0,
                            data: {
                                ok: false,
                                error: 'Invalid server response.'
                            }
                        });
                    }
                },
                onerror: function onerror() {
                    reject(new Error("Network error: ".concat(method, " ").concat(path)));
                },
                ontimeout: function ontimeout() {
                    reject(new Error("Timeout: ".concat(method, " ").concat(path)));
                }
            });
        });
    }
    function api(method, path, body) {
        return gmXhr(method, path, body, withSessionHeaders());
    }
    function detectEnemyFromWarInfo(s, members) {
    var war = s && s.war ? s.war : {};
    var ourFactionId = String((s && s.faction && s.faction.faction_id) || (s && s.me && s.me.faction_id) || '').trim();
    var ourFactionName = String((s && s.faction && s.faction.name) || (s && s.me && s.me.faction_name) || '').trim().toLowerCase();

    var enemyId = String((s && s.enemy_faction_id) || (s && s.enemyFaction && s.enemyFaction.faction_id) || (s && s.enemy_faction && s.enemy_faction.faction_id) || '').trim();
    var enemyName = String((s && s.enemy_faction_name) || (s && s.enemyFaction && s.enemyFaction.name) || (s && s.enemy_faction && s.enemy_faction.name) || '').trim();

    if (enemyId && ourFactionId && enemyId === ourFactionId) enemyId = '';
    if (enemyName && ourFactionName && enemyName.toLowerCase() === ourFactionName) enemyName = '';

    var debugFactions = arr(s && s.debug && s.debug.debug_factions);
    if ((!enemyId || !enemyName) && debugFactions.length) {
        debugFactions.forEach(function (row) {
            if (!row || _typeof(row) !== 'object') return;
            var fid = String(row.faction_id || '').trim();
            var fname = String(row.faction_name || '').trim();

            if (fid && ourFactionId && fid === ourFactionId) return;
            if (fname && ourFactionName && fname.toLowerCase() === ourFactionName) return;

            if (!enemyId && fid) enemyId = fid;
            if (!enemyName && fname) enemyName = fname;
        });
    }

    var rawEnemies = arr((s && s.enemies) || (war && war.enemy_members) || (s && s.enemy_members));
    var enemyMembers = rawEnemies.filter(function (x) {
        var uid = String((x && (x.user_id || x.id)) || '').trim();
        return uid && !arr(members).some(function (m) {
            return String((m && (m.user_id || m.id)) || '').trim() === uid;
        });
    });

    return {
        enemyId: enemyId,
        enemyName: enemyName,
        enemyMembers: enemyMembers
    };
}
function getEnemyFactionMeta() {
    var s = state || {};
    var war = s.war || {};
    var members = arr(s.members);
    var detected = detectEnemyFromWarInfo(s, members);

    return {
        id: detected.enemyId || String((s.enemy_faction && s.enemy_faction.faction_id) || (s.enemyFaction && s.enemyFaction.faction_id) || '').trim(),
        name: detected.enemyName || String((s.enemy_faction && s.enemy_faction.name) || (s.enemyFaction && s.enemyFaction.name) || '').trim(),
        score: Number((s.enemy_faction && s.enemy_faction.score) || (s.enemyFaction && s.enemyFaction.score) || war.score_them || 0) || 0,
        chain: Number((s.enemy_faction && s.enemy_faction.chain) || (s.enemyFaction && s.enemyFaction.chain) || war.chain_them || 0) || 0,
        members: detected.enemyMembers
    };
}
    function canViewTab(tab) {
        if (tab === 'admin') return isOwnerSession();
        if (tab === 'wartop5') return isOwnerSession();
        if (tab === 'faction') return !!(accessState && (accessState.isFactionLeader || isOwnerSession() || accessState.isUserExempt || accessState.isFactionExempt));
        return true;
    }
    function visibleTabs() {
        return TAB_ORDER.filter(function (row) {
            return canViewTab(row[0]);
        });
    }
    function isTabVisible(tab) {
        return visibleTabs().some(function (row) {
            return row[0] === tab;
        });
    }
    function ensureVisibleTab() {
        if (!isTabVisible(currentTab)) {
            currentTab = visibleTabs()[0][0];
            GM_setValue(K_TAB, currentTab);
        }
    }
    function upsertLocalNotification(note) {
        if (!note || !note.message) return;
        var list = getLocalNotifications();
        list.unshift({
            id: "local-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 8)),
            message: note.message,
            created_at: new Date().toISOString()
        });
        setLocalNotifications(list.slice(0, 50));
        updateBadge();
        if (currentTab === 'overview' && isOpen) renderBody();
    }
    function healthCheck() {
        return _healthCheck.apply(this, arguments);
    }
    function _healthCheck() {
        _healthCheck = _asyncToGenerator(function* () {
            try {
                var res = yield gmXhr('GET', '/api/health');
                return !!(res.ok && res.data && res.data.ok);
            } catch (_unused3) {
                return false;
            }
        });
        return _healthCheck.apply(this, arguments);
    }
    function login() {
        return _login.apply(this, arguments);
    }
    function _login() {
        _login = _asyncToGenerator(function* () {
            var apiKey = cleanInputValue(getSavedApiKey());
            if (!apiKey) throw new Error('Enter and save your API key first.');
            var ownerToken = cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''));
            var payload = ownerTokenAllowed() ? {
                api_key: apiKey,
                owner_token: ownerToken
            } : {
                api_key: apiKey
            };
            var res = yield gmXhr('POST', '/api/login', payload);
            if (!res.ok || !res.data || !res.data.ok) {
                var err = res && res.data && (res.data.error || res.data.message) || 'Login failed.';
                if (res && res.data && (res.data.blocked || res.data.payment_required)) {
                    accessState = normalizeAccessCache({
                        loggedIn: true,
                        blocked: !!res.data.blocked,
                        paymentRequired: !!res.data.payment_required,
                        trialActive: !!res.data.trial_active,
                        trialExpired: !!res.data.trial_expired,
                        expiresAt: res.data.expires_at || '',
                        daysLeft: res.data.days_left,
                        reason: res.data.reason || '',
                        message: res.data.message || err,
                        source: 'login-block',
                        userId: res.data.user_id || '',
                        userName: res.data.user_name || '',
                        factionId: res.data.faction_id || '',
                        factionName: res.data.faction_name || '',
                        isFactionLeader: !!res.data.is_faction_leader,
                        memberEnabled: !!res.data.member_enabled,
                        canUseFeatures: !!(res.data.can_use_features || res.data.is_faction_leader || res.data.member_enabled),
                        paymentPlayer: res.data.payment_player || PAYMENT_PLAYER,
                        pricePerMember: res.data.price_per_member || PRICE_PER_MEMBER,
                        isOwner: !!res.data.is_owner,
                        isUserExempt: !!res.data.is_user_exempt,
                        isFactionExempt: !!res.data.is_faction_exempt
                    });
                    saveAccessCache();
                }
                throw new Error(err);
            }
            saveSessionId(res.data.session_id || '');
            accessState = normalizeAccessCache({
                loggedIn: true,
                blocked: false,
                paymentRequired: !!res.data.payment_required,
                trialActive: !!res.data.trial_active,
                trialExpired: !!res.data.trial_expired,
                expiresAt: res.data.expires_at || '',
                daysLeft: res.data.days_left,
                reason: '',
                message: res.data.message || 'Logged in.',
                source: 'login',
                userId: res.data.user_id || '',
                userName: res.data.user_name || '',
                factionId: res.data.faction_id || '',
                factionName: res.data.faction_name || '',
                isFactionLeader: !!res.data.is_faction_leader,
                memberEnabled: !!res.data.member_enabled,
                canUseFeatures: !!(res.data.can_use_features || res.data.is_faction_leader || res.data.member_enabled),
                paymentPlayer: res.data.payment_player || PAYMENT_PLAYER,
                pricePerMember: res.data.price_per_member || PRICE_PER_MEMBER,
                isOwner: !!res.data.is_owner,
                isUserExempt: !!res.data.is_user_exempt,
                isFactionExempt: !!res.data.is_faction_exempt
            });
            saveAccessCache();
            return res.data;
        });
        return _login.apply(this, arguments);
    }
    function _req() {
        return _req.apply(this, arguments);
    }
    function _req() {
        _req = _asyncToGenerator(function* (method, path, body) {
            var res = yield api(method, path, body);
            if (res && res.status === 401) {
                saveSessionId('');
                throw new Error('Session expired. Please log in again.');
            }
            if (!res.ok || !res.data || !res.data.ok) {
                var err = res && res.data && (res.data.error || res.data.message) || 'Request failed.';
                throw new Error(err);
            }
            return res.data;
        });
        return _req.apply(this, arguments);
    }
    function req(method, path, body) {
        return _req(method, path, body);
    }
    function adminReq(method, path, body) {
        return _adminReq.apply(this, arguments);
    }
    function _adminReq() {
        _adminReq = _asyncToGenerator(function* (method, path, body) {
            var payload = _objectSpread({}, body || {});
            var adminKey = cleanInputValue(getSavedAdminKey());
            if (adminKey) payload.admin_key = adminKey;
            var data = yield req(method, path, payload);
            return data;
        });
        return _adminReq.apply(this, arguments);
    }
    function normalizeState(data) {
    var s = data || {};
    var members = arr(s.members);
    var faction = s.faction || s.our_faction || {};
    var war = s.war || {};

    var detectedEnemy = detectEnemyFromWarInfo(s, members);
    var enemyFaction = _objectSpread({
        faction_id: detectedEnemy.enemyId || String((s.enemy_faction && s.enemy_faction.faction_id) || (s.enemyFaction && s.enemyFaction.faction_id) || '').trim(),
        name: detectedEnemy.enemyName || String((s.enemy_faction && s.enemy_faction.name) || (s.enemyFaction && s.enemyFaction.name) || '').trim(),
        score: Number((s.enemy_faction && s.enemy_faction.score) || (s.enemyFaction && s.enemyFaction.score) || war.score_them || 0) || 0,
        chain: Number((s.enemy_faction && s.enemy_faction.chain) || (s.enemyFaction && s.enemyFaction.chain) || war.chain_them || 0) || 0
    }, s.enemy_faction || s.enemyFaction || {});

    var enemies = detectedEnemy.enemyMembers.length ? detectedEnemy.enemyMembers : arr(s.enemies);

    var medDeals = arr(s.med_deals || s.medDeals);
    var medDealsMessage = s.med_deals_message || s.medDealsMessage || '';

    var dibs = arr(s.dibs);
    var terms = s.terms || s.war_terms || null;
    var notifications = arr(s.notifications);
    var bounties = arr(s.bounties);
    var targets = arr(s.targets);
    var hasWar = !!(s.has_war || s.is_ranked_war || war.active || war.registered || currentWarId());

    return {
        ok: !!s.ok,
        me: s.me || {},
        user: s.user || {},
        access: s.access || {},
        members: members,
        faction: faction,
        our_faction: s.our_faction || faction,
        war: war,
        enemyFaction: enemyFaction,
        enemy_faction: enemyFaction,
        enemy_faction_id: enemyFaction.faction_id || '',
        enemy_faction_name: enemyFaction.name || '',
        enemies: enemies,
        assignments: arr(s.assignments),
        notes: arr(s.notes),
        med_deals: medDeals,
        medDeals: medDeals,
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
var nextState = normalizeState(res);
var prevEnemyMeta = prevState ? getEnemyMetaFromState(prevState) : { id: '', name: '', members: [] };
var nextEnemyMeta = getEnemyMetaFromState(nextState);

var fallbackEnemyKey = '';
try {
    fallbackEnemyKey = String(GM_getValue('warhub_last_enemy_key_v3', '') || '');
} catch (_unused4) {}

var fallbackEnemyData = null;
try {
    fallbackEnemyData = GM_getValue('warhub_last_enemy_data_v3', null);
} catch (_unused5) {}

var nextEnemyKey = (nextEnemyMeta.id || '') + '|' + (nextEnemyMeta.name || '');
var prevEnemyKey = (prevEnemyMeta.id || '') + '|' + (prevEnemyMeta.name || '');

if (
    nextEnemyMeta.members.length > 0 &&
    nextEnemyKey &&
    nextEnemyKey !== '|'
) {
    try {
        GM_setValue('warhub_last_enemy_key_v3', nextEnemyKey);
        GM_setValue('warhub_last_enemy_data_v3', {
            enemy_faction_id: nextEnemyMeta.id || '',
            enemy_faction_name: nextEnemyMeta.name || '',
            enemies: nextEnemyMeta.members
        });
    } catch (_unused6) {}
}

if (
    nextEnemyMeta.members.length === 0 &&
    fallbackEnemyData &&
    _typeof(fallbackEnemyData) === 'object'
) {
    var fallbackId = String(fallbackEnemyData.enemy_faction_id || '').trim();
    var fallbackName = String(fallbackEnemyData.enemy_faction_name || '').trim();
    var fallbackMembers = arr(fallbackEnemyData.enemies);

    var sameAsNext =
        (fallbackId && nextEnemyMeta.id && fallbackId === nextEnemyMeta.id) ||
        (fallbackName && nextEnemyMeta.name && fallbackName.toLowerCase() === String(nextEnemyMeta.name || '').toLowerCase());

    var nextMissingIdentity = !nextEnemyMeta.id && !nextEnemyMeta.name;

    if ((sameAsNext || nextMissingIdentity || fallbackEnemyKey === nextEnemyKey) && fallbackMembers.length) {
        nextState.enemies = fallbackMembers;
        if (!nextState.enemy_faction_id && fallbackId) nextState.enemy_faction_id = fallbackId;
        if (!nextState.enemy_faction_name && fallbackName) nextState.enemy_faction_name = fallbackName;

        if (!nextState.enemy_faction || _typeof(nextState.enemy_faction) !== 'object') nextState.enemy_faction = {};
        if (!nextState.enemyFaction || _typeof(nextState.enemyFaction) !== 'object') nextState.enemyFaction = {};

        if (!nextState.enemy_faction.faction_id && fallbackId) nextState.enemy_faction.faction_id = fallbackId;
        if (!nextState.enemy_faction.name && fallbackName) nextState.enemy_faction.name = fallbackName;

        if (!nextState.enemyFaction.faction_id && fallbackId) nextState.enemyFaction.faction_id = fallbackId;
        if (!nextState.enemyFaction.name && fallbackName) nextState.enemyFaction.name = fallbackName;
    }
}

var preserved = preserveEditingState();
state = nextState;
syncAccessFromState(state);
ensureVisibleTab();
restoreEditingState(preserved);
if (!silent || !isTypingInOverlay()) {
    renderBody();
}
if (!silent) {
    setStatus('');
}
            } catch (e) {
                if (!silent) setStatus(e.message || 'Could not load state.', true);
            } finally {
                loadInFlight = false;
                updateBadge();
            }
        });
        return _loadState.apply(this, arguments);
    }
    function getEnemyMetaFromState(s) {
        var st = normalizeState(s || {});
        var factionId = String(st.enemy_faction_id || (st.enemy_faction && st.enemy_faction.faction_id) || (st.enemyFaction && st.enemyFaction.faction_id) || '').trim();
        var factionName = String(st.enemy_faction_name || (st.enemy_faction && st.enemy_faction.name) || (st.enemyFaction && st.enemyFaction.name) || '').trim();
        var enemies = arr(st.enemies);
        return {
            id: factionId,
            name: factionName,
            members: enemies
        };
    }
    function syncAccessFromState(s) {
        var access = s && s.access && _typeof(s.access) === 'object' ? s.access : {};
        var me = s && s.me && _typeof(s.me) === 'object' ? s.me : {};
        var user = s && s.user && _typeof(s.user) === 'object' ? s.user : {};
        var license = s && s.license && _typeof(s.license) === 'object' ? s.license : {};
        var loggedIn = !!(getSessionId() || user.user_id || me.user_id);
        var blocked = !!(license.blocked || access.blocked);
        var paymentRequired = !!(license.payment_required || access.payment_required);
        var trialExpired = !!(license.trial_expired || access.trial_expired);
        var trialActive = !!(license.trial_active || access.trial_active);
        var isFactionLeader = !!(user.is_leader || access.is_faction_leader);
        var memberEnabled = !!(access.member_enabled || license.viewer_member_enabled || access.memberEnabled);
        var canUseFeatures = !!(access.can_use_features || access.canUseFeatures || isOwnerSession() || isFactionLeader || memberEnabled || access.is_user_exempt || access.is_faction_exempt || license.viewer_is_exempt_user || license.faction_exempt);
        accessState = normalizeAccessCache({
            loggedIn: loggedIn,
            blocked: blocked,
            paymentRequired: paymentRequired,
            trialActive: trialActive,
            trialExpired: trialExpired,
            expiresAt: license.expires_at || access.expires_at || access.expiresAt || '',
            daysLeft: license.days_left || access.days_left || access.daysLeft,
            reason: license.block_reason || access.reason || '',
            message: access.message || license.message || '',
            source: 'state',
            userId: user.user_id || me.user_id || access.user_id || '',
            userName: user.name || me.name || access.user_name || '',
            factionId: user.faction_id || me.faction_id || access.faction_id || license.faction_id || '',
            factionName: user.faction_name || me.faction_name || access.faction_name || license.faction_name || '',
            isFactionLeader: isFactionLeader,
            memberEnabled: memberEnabled,
            canUseFeatures: canUseFeatures,
            paymentPlayer: license.payment_player || access.payment_player || PAYMENT_PLAYER,
            pricePerMember: license.payment_per_member || access.price_per_member || PRICE_PER_MEMBER,
            isOwner: !!(user.is_owner || access.is_owner),
            isUserExempt: !!(access.is_user_exempt || license.viewer_is_exempt_user),
            isFactionExempt: !!(access.is_faction_exempt || license.faction_exempt)
        });
        saveAccessCache();
    }
    function canUseProtectedFeatures() {
        if (!accessState) return true;
        if (isOwnerSession()) return true;
        return !!accessState.canUseFeatures;
    }
    function preserveEditingState() {
        if (!overlay) return null;
        var active = document.activeElement;
        var isInside = !!(active && overlay.contains(active));
        var body = overlay.querySelector('.warhub-body');
        var tabs = overlay.querySelector('.warhub-tabs');
        return {
            activeId: isInside ? active.id || '' : '',
            activeName: isInside ? active.getAttribute('name') || '' : '',
            selectionStart: isInside && typeof active.selectionStart === 'number' ? active.selectionStart : null,
            selectionEnd: isInside && typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
            bodyScrollTop: body ? body.scrollTop : 0,
            tabsScrollLeft: tabs ? tabs.scrollLeft : 0,
            pageScrollX: window.scrollX || window.pageXOffset || 0,
            pageScrollY: window.scrollY || window.pageYOffset || 0
        };
    }
    function restoreEditingState(snapshot) {
        if (!snapshot || !overlay) return;
        var body = overlay.querySelector('.warhub-body');
        var tabs = overlay.querySelector('.warhub-tabs');
        if (body) body.scrollTop = snapshot.bodyScrollTop || 0;
        if (tabs) tabs.scrollLeft = snapshot.tabsScrollLeft || 0;
        try {
            window.scrollTo(snapshot.pageScrollX || 0, snapshot.pageScrollY || 0);
        } catch (_unused7) {}
        var target = null;
        if (snapshot.activeId) {
            target = overlay.querySelector('#' + cssEscape(snapshot.activeId));
        }
        if (!target && snapshot.activeName) {
            target = overlay.querySelector('[name="' + cssEscape(snapshot.activeName) + '"]');
        }
        if (target && typeof target.focus === 'function') {
            try {
                target.focus({
                    preventScroll: true
                });
            } catch (_unused8) {
                try {
                    target.focus();
                } catch (_unused9) {}
            }
            if (typeof target.setSelectionRange === 'function' && snapshot.selectionStart != null && snapshot.selectionEnd != null) {
                try {
                    target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
                } catch (_unused10) {}
            }
        }
    }
    function cssEscape(value) {
        return String(value || '').replace(/([ #;?%&,.+*~\\':"!^$[\]()=>|/@])/g, '\\$1');
    }
    function isTypingInOverlay() {
        if (!overlay) return false;
        var active = document.activeElement;
        if (!active || !overlay.contains(active)) return false;
        var tag = String(active.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || active.isContentEditable;
    }
    function schedulePoll() {
        if (pollTimer) clearInterval(pollTimer);
        var ms = Number(GM_getValue(K_REFRESH, 30000)) || 30000;
        ms = Math.max(10000, ms);
        pollTimer = setInterval(function () {
            if (!isOpen) return;
            if (dragMoved) return;
            if (isDraggingOverlay || isDraggingShield) return;
            var preserved = preserveEditingState();
            var pageX = window.scrollX || window.pageXOffset || 0;
            var pageY = window.scrollY || window.pageYOffset || 0;
            var selectedTab = currentTab;
            var tabs = overlay ? overlay.querySelector('.warhub-tabs') : null;
            var tabsLeft = tabs ? tabs.scrollLeft : 0;
            loadState(true).then(function () {
                currentTab = selectedTab;
                GM_setValue(K_TAB, currentTab);
                requestAnimationFrame(function () {
                    if (overlay && overlay.classList.contains('open')) {
                        var body = overlay.querySelector('.warhub-body');
                        var tabsEl = overlay.querySelector('.warhub-tabs');
                        if (body && preserved) body.scrollTop = preserved.bodyScrollTop || 0;
                        if (tabsEl) tabsEl.scrollLeft = tabsLeft || 0;
                    }
                    try {
                        window.scrollTo(pageX, pageY);
                    } catch (_unused11) {}
                });
            })["catch"](function () {});
        }, ms);
    }
    function sortByName(list) {
        return arr(list).slice().sort(function (a, b) {
            return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
        });
    }
    function onlineRank(m) {
        var s = String((m && m.online_state) || '').toLowerCase();
        if (s === 'online') return 0;
        if (s === 'idle') return 1;
        if (s === 'travel') return 2;
        if (s === 'hospital') return 3;
        if (s === 'jail') return 4;
        return 5;
    }
    function sortMembersLive(list) {
        return arr(list).slice().sort(function (a, b) {
            var ar = onlineRank(a);
            var br = onlineRank(b);
            if (ar !== br) return ar - br;
            var ah = Number((a && a.hospital_seconds) || 0) || 0;
            var bh = Number((b && b.hospital_seconds) || 0) || 0;
            if (ah !== bh) return ah - bh;
            return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
        });
    }
    function sortHosp(list) {
        return arr(list).slice().sort(function (a, b) {
            return (Number((a && a.hospital_seconds) || 0) || 0) - (Number((b && b.hospital_seconds) || 0) || 0);
        });
    }
    function statusPill(member) {
        var online = String((member && member.online_state) || '').toLowerCase();
        var label = member && (member.display_status || member.status || member.status_detail || member.last_action) || 'Unknown';
        if (online === 'online') return '<span class="warhub-pill online">Online</span>';
        if (online === 'idle') return '<span class="warhub-pill idle">Idle</span>';
        if (online === 'travel') return '<span class="warhub-pill travel">' + esc(label) + '</span>';
        if (online === 'hospital') return '<span class="warhub-pill hosp">' + esc(member && member.hospital_text || label || 'Hospital') + '</span>';
        if (online === 'jail') return '<span class="warhub-pill jail">' + esc(label) + '</span>';
        return '<span class="warhub-pill offline">' + esc(label || 'Offline') + '</span>';
    }
    function renderMemberRow(member) {
        var userId = String((member && (member.user_id || member.id)) || '');
        var canUse = canUseProtectedFeatures();
        var attackUrl = member && member.attack_url ? member.attack_url : userId ? "https://www.torn.com/loader.php?sid=attack&user2ID=".concat(userId) : '#';
        var bountyUrl = member && member.bounty_url ? member.bounty_url : userId ? "https://www.torn.com/bounties.php#/p=add&userID=".concat(userId) : '#';
        var profileUrl = member && member.profile_url ? member.profile_url : userId ? "https://www.torn.com/profiles.php?XID=".concat(userId) : '#';
        var pos = member && member.position ? '<span class="warhub-pill leader">' + esc(member.position) + '</span>' : '';
        return '\
      <div class="warhub-row">\
        <div class="warhub-left">\
          <div class="warhub-name"><a class="warhub-link" target="_blank" href="' + esc(profileUrl) + '">' + esc((member && member.name) || 'Unknown') + '</a></div>\
          <div class="warhub-meta">Lv ' + esc(String((member && member.level) || '—')) + ' • ' + esc((member && member.last_action) || (member && member.status_detail) || 'Unknown') + '</div>\
          <div class="warhub-right" style="justify-content:flex-start;">' + statusPill(member) + ' ' + pos + '</div>\
        </div>\
        <div class="warhub-right">\
          <a class="warhub-btn" target="_blank" href="' + esc(profileUrl) + '">Profile</a>\
          ' + (canUse ? '<a class="warhub-btn primary" target="_blank" href="' + esc(attackUrl) + '">Attack</a>' : '') + '\
          ' + (canUse ? '<a class="warhub-btn" target="_blank" href="' + esc(bountyUrl) + '">Bounty</a>' : '') + '\
        </div>\
      </div>';
    }
    function renderEnemyRow(member) {
        var userId = String((member && (member.user_id || member.id)) || '');
        var canUse = canUseProtectedFeatures();
        var attackUrl = member && member.attack_url ? member.attack_url : userId ? "https://www.torn.com/loader.php?sid=attack&user2ID=".concat(userId) : '#';
        var profileUrl = member && member.profile_url ? member.profile_url : userId ? "https://www.torn.com/profiles.php?XID=".concat(userId) : '#';
        var pos = member && member.position ? '<span class="warhub-pill leader">' + esc(member.position) + '</span>' : '';
        return '\
      <div class="warhub-row">\
        <div class="warhub-left">\
          <div class="warhub-name"><a class="warhub-link" target="_blank" href="' + esc(profileUrl) + '">' + esc((member && member.name) || 'Unknown') + '</a></div>\
          <div class="warhub-meta">Lv ' + esc(String((member && member.level) || '—')) + ' • ' + esc((member && member.last_action) || (member && member.status_detail) || 'Unknown') + '</div>\
          <div class="warhub-right" style="justify-content:flex-start;">' + statusPill(member) + ' ' + pos + '</div>\
        </div>\
        <div class="warhub-right">\
          <a class="warhub-btn" target="_blank" href="' + esc(profileUrl) + '">Profile</a>\
          ' + (canUse ? '<a class="warhub-btn primary" target="_blank" href="' + esc(attackUrl) + '">Attack</a>' : '') + '\
        </div>\
      </div>';
    }
    function renderNotificationRows(items) {
        items = arr(items);
        if (!items.length) return '<div class="warhub-empty">No notifications yet.</div>';
        return items.map(function (n) {
            return '\
        <div class="warhub-row">\
          <div class="warhub-left">\
            <div class="warhub-name">' + esc(n.message || 'Notification') + '</div>\
            <div class="warhub-meta">' + esc(fmtTs(n.created_at || n.createdAt || new Date().toISOString())) + '</div>\
          </div>\
        </div>';
        }).join('');
    }
    function canDeleteTerms() {
        return !!(isOwnerSession() || (accessState && accessState.isFactionLeader));
    }
    function getOverviewBoxPrefs() {
        var raw = GM_getValue(K_OVERVIEW_BOXES, null);
        var base = {
            medDeals: true,
            dibs: true,
            terms: true,
            warOverview: true
        };
        if (!raw || _typeof(raw) !== 'object') return base;
        return {
            medDeals: raw.medDeals !== false,
            dibs: raw.dibs !== false,
            terms: raw.terms !== false,
            warOverview: raw.warOverview !== false
        };
    }
    function saveOverviewBoxPrefs(prefs) {
        GM_setValue(K_OVERVIEW_BOXES, _objectSpread({}, prefs));
    }
    function buildTopFive(list) {
        return sortMembersLive(arr(list)).slice(0, 5);
    }
    function renderTopFiveSelect(label, factionName, list, selectId) {
        var rows = buildTopFive(list);
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>' + esc(label) + '</h3>\
          <span class="warhub-pill neutral">' + esc(factionName || 'Unknown Faction') + '</span>\
        </div>\
        ' + (rows.length ? '\
          <label class="warhub-label">Top 5 Players</label>\
          <select class="warhub-select" id="' + esc(selectId) + '">\
            ' + rows.map(function (m) {
                var uid = String((m && (m.user_id || m.id)) || '');
                return '<option value="' + esc(uid) + '">' + esc((m && m.name) || 'Unknown') + ' • Lv ' + esc(String((m && m.level) || '—')) + ' • ' + esc((m && m.position) || 'Member') + '</option>';
            }).join('') + '\
          </select>\
        ' : '<div class="warhub-empty">No players available.</div>') + '\
      </div>';
    }
    function renderAnalyticsBox(title, member, emptyText) {
        if (!member) {
            return '\
        <div class="warhub-card">\
          <h3>' + esc(title) + '</h3>\
          <div class="warhub-empty">' + esc(emptyText || 'No data yet.') + '</div>\
        </div>';
        }
        return '\
      <div class="warhub-card">\
        <h3>' + esc(title) + '</h3>\
        <div class="warhub-name">' + esc(member.name || 'Unknown') + '</div>\
        <div class="warhub-meta">\
          Respect: ' + esc(fmtNum(member.respect || 0)) + ' • \
          Hits: ' + esc(fmtNum(member.hits || 0)) + ' • \
          Attacks: ' + esc(fmtNum(member.attacks || 0)) + ' • \
          Net: ' + esc(fmtNum(member.net || 0)) + '\
        </div>\
      </div>';
    }
    function getSummaryLeaders() {
        var data = analyticsCache && _typeof(analyticsCache) === 'object' ? analyticsCache : {};
        var leaders = arr(data.members || []);
        if (!leaders.length) return {
            top: null,
            bottom: null
        };
        var sorted = leaders.slice().sort(function (a, b) {
            return (Number(b.net || 0) || 0) - (Number(a.net || 0) || 0);
        });
        return {
            top: sorted[0] || null,
            bottom: sorted[sorted.length - 1] || null
        };
    }
    function loadAnalytics() {
        return _loadAnalytics.apply(this, arguments);
    }
    function _loadAnalytics() {
        _loadAnalytics = _asyncToGenerator(function* () {
            try {
                analyticsCache = yield req('GET', '/api/war/analytics');
            } catch (_unused12) {
                analyticsCache = null;
            }
        });
        return _loadAnalytics.apply(this, arguments);
    }
    function loadAdminTopFive() {
        return _loadAdminTopFive.apply(this, arguments);
    }
    function _loadAdminTopFive() {
        _loadAdminTopFive = _asyncToGenerator(function* () {
            if (!isOwnerSession()) return null;
            try {
                adminTopFiveCache = yield adminReq('GET', '/api/admin/war-top-five');
            } catch (_unused13) {
                adminTopFiveCache = null;
            }
            return adminTopFiveCache;
        });
        return _loadAdminTopFive.apply(this, arguments);
    }
    function renderOverviewTab() {
        var prefs = getOverviewBoxPrefs();
        var deals = arr(state && (state.medDeals || state.med_deals));
        var dibs = arr(state && state.dibs);
        var terms = state && state.terms;
        var war = state && state.war || {};
        var faction = state && (state.faction || state.our_faction) || {};
        var enemy = state && (state.enemy_faction || state.enemyFaction) || {};
        var html = '';
        if (prefs.medDeals) {
            html += '\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>Med Deals</h3>\
            <button class="warhub-btn" data-open-tab="meddeals">Open</button>\
          </div>\
          ' + (deals.length ? deals.slice(0, 5).map(function (d) {
                return '<div class="warhub-row"><div class="warhub-left"><div class="warhub-name">' + esc((d.member_name || 'Member') + ' ↔ ' + (d.enemy_name || 'Enemy')) + '</div><div class="warhub-meta">' + esc(d.note || 'No note') + '</div></div></div>';
            }).join('') : '<div class="warhub-empty">No med deals yet.</div>') + '\
        </div>';
        }
        if (prefs.dibs) {
            html += '\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>Dibs</h3>\
            <button class="warhub-btn" data-open-tab="hospital">Open</button>\
          </div>\
          ' + (dibs.length ? dibs.slice(0, 5).map(function (d) {
                return '<div class="warhub-row"><div class="warhub-left"><div class="warhub-name">' + esc((d.member_name || 'Member') + ' → ' + (d.enemy_name || 'Enemy')) + '</div><div class="warhub-meta">' + esc(d.created_at ? fmtTs(d.created_at) : 'Assigned') + '</div></div></div>';
            }).join('') : '<div class="warhub-empty">No dibs yet.</div>') + '\
        </div>';
        }
        if (prefs.terms) {
            html += '\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>Terms</h3>\
            <button class="warhub-btn" data-open-tab="terms">Open</button>\
          </div>\
          ' + (terms ? '<div class="warhub-mini" style="white-space:pre-wrap;line-height:1.5;">' + esc(terms.text || terms.body || String(terms)) + '</div>' : '<div class="warhub-empty">No terms posted.</div>') + '\
        </div>';
        }
        if (prefs.warOverview) {
            html += '\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>War Overview</h3>\
            <button class="warhub-btn" data-open-tab="war">Open</button>\
          </div>\
          <div class="warhub-grid two">\
            <div class="warhub-metric"><div class="k">' + esc((faction && faction.name) || 'Our Faction') + '</div><div class="v">' + esc(fmtNum((state && state.score && state.score.our) || faction.score || 0)) + '</div></div>\
            <div class="warhub-metric"><div class="k">' + esc((enemy && enemy.name) || 'Enemy Faction') + '</div><div class="v">' + esc(fmtNum((state && state.score && state.score.enemy) || enemy.score || 0)) + '</div></div>\
            <div class="warhub-metric"><div class="k">Target</div><div class="v">' + esc(fmtNum((state && state.score && state.score.target) || war.target_score || war.target || 0)) + '</div></div>\
            <div class="warhub-metric"><div class="k">Status</div><div class="v" style="font-size:14px;">' + esc(war.status || 'Unknown') + '</div></div>\
          </div>\
        </div>';
        }
        return html || '<div class="warhub-empty">Nothing enabled in overview.</div>';
    }
    function renderFactionTab() {
        if (!canViewTab('faction')) {
            return renderAccessBanner() + '<div class="warhub-card"><div class="warhub-empty">Faction tab is leader/admin only.</div></div>';
        }
        var members = sortMembersLive(arr(state && state.members));
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Faction Members</h3>\
          <span class="warhub-count">' + fmtNum(members.length) + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (members.length ? members.map(renderMemberRow).join('') : '<div class="warhub-empty">No faction members loaded.</div>') + '</div>\
      </div>';
    }
    function renderWarTab() {
        var war = state && state.war || {};
        var our = state && (state.faction || state.our_faction) || {};
        var enemy = state && (state.enemy_faction || state.enemyFaction) || {};
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>War</h3>\
          <span class="warhub-pill neutral">' + esc(war.phase || 'unknown') + '</span>\
        </div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">' + esc(our.name || 'Our Faction') + '</div><div class="v">' + esc(fmtNum((state && state.score && state.score.our) || our.score || 0)) + '</div></div>\
          <div class="warhub-metric"><div class="k">' + esc(enemy.name || 'Enemy Faction') + '</div><div class="v">' + esc(fmtNum((state && state.score && state.score.enemy) || enemy.score || 0)) + '</div></div>\
          <div class="warhub-metric"><div class="k">Target Score</div><div class="v">' + esc(fmtNum((state && state.score && state.score.target) || war.target_score || war.target || 0)) + '</div></div>\
          <div class="warhub-metric"><div class="k">Status</div><div class="v" style="font-size:14px;">' + esc(war.status || 'Currently not in war') + '</div></div>\
          <div class="warhub-metric"><div class="k">Start</div><div class="v" style="font-size:13px;">' + esc(war.start ? fmtTs(new Date(Number(war.start) * 1000).toISOString()) : '—') + '</div></div>\
          <div class="warhub-metric"><div class="k">End</div><div class="v" style="font-size:13px;">' + esc(war.end ? fmtTs(new Date(Number(war.end) * 1000).toISOString()) : '—') + '</div></div>\
        </div>\
      </div>';
    }
    function renderSummaryTab() {
        var leaders = getSummaryLeaders();
        return '\
      <div class="warhub-grid">\
        ' + renderAnalyticsBox('Carrying the War', leaders.top, 'No war summary data yet.') + '\
        ' + renderAnalyticsBox('Member Losing Ground', leaders.bottom, 'No war summary data yet.') + '\
      </div>';
    }
    function renderChainTab() {
        var members = sortMembersLive(arr(state && state.members)).filter(function (m) {
            return !!m.available;
        });
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Available Members</h3>\
          <span class="warhub-count">' + fmtNum(members.length) + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (members.length ? members.map(renderMemberRow).join('') : '<div class="warhub-empty">No available members yet. Click Available to show up here.</div>') + '</div>\
      </div>';
    }
    function renderTermsTab() {
        var terms = state && state.terms;
        var canEdit = canDeleteTerms();
        var text = terms && (terms.text || terms.body || String(terms)) || '';
        return '\
      <div class="warhub-card">\
        <h3>Faction Terms</h3>\
        <label class="warhub-label">Terms</label>\
        <textarea class="warhub-textarea" id="wh-terms-box" placeholder="Enter terms for this war...">' + esc(text) + '</textarea>\
        <div class="warhub-actions" style="margin-top:8px;">\
          ' + (canEdit ? '<button class="warhub-btn primary" id="wh-save-terms">Save</button><button class="warhub-btn warn" id="wh-delete-terms">Delete</button>' : '') + '\
        </div>\
      </div>';
    }
    function renderMembersTab() {
        var members = sortMembersLive(arr(state && state.members));
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Members</h3>\
          <span class="warhub-count">' + fmtNum(members.length) + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (members.length ? members.map(renderMemberRow).join('') : '<div class="warhub-empty">No members loaded.</div>') + '</div>\
      </div>';
    }
    function renderEnemiesTab() {
        var enemyMeta = getEnemyFactionMeta();
        var enemies = sortMembersLive(arr(enemyMeta.members));
        return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Enemy Members</h3>\
          <span class="warhub-pill neutral">' + esc(enemyMeta.name || 'Unknown Enemy') + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (enemies.length ? enemies.map(renderEnemyRow).join('') : '<div class="warhub-empty">No enemy members loaded.</div>') + '</div>\
      </div>';
    }
    function filterHospitalEnemiesForTab(enemyHospRaw) {
        return arr(enemyHospRaw);
    }
    function renderHospitalTab() {
        var ours = sortHosp(arr(state && state.members).filter(function (x) {
            return Number((x && x.hospital_seconds) || 0) > 0;
        }));
        var enemyHospRaw = sortHosp(arr(state && state.enemies).filter(function (x) {
            return Number((x && x.hospital_seconds) || 0) > 0;
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
          <div class="warhub-metric"><div class="k">Our Hospital</div><div class="v">' + fmtNum(ours.length) + '</div></div>\
          <div class="warhub-metric"><div class="k">Enemy Hospital</div><div class="v">' + fmtNum(theirs.length) + '</div></div>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <h3>Our Members</h3>\
        <div class="warhub-section-scroll">' + (ours.length ? ours.map(renderMemberRow).join('') : '<div class="warhub-empty">Nobody is in hospital.</div>') + '</div>\
      </div>\
      <div class="warhub-card">\
        <h3>Enemies</h3>\
        <div class="warhub-section-scroll">' + (theirs.length ? theirs.map(renderEnemyRow).join('') : '<div class="warhub-empty">No enemies in hospital.</div>') + '</div>\
      </div>';
    }
    function memberOptionsHtml(list) {
        return sortByName(list).map(function (m) {
            var id = String((m && (m.user_id || m.id)) || '');
            return '<option value="' + esc(id) + '">' + esc((m && m.name) || 'Unknown') + '</option>';
        }).join('');
    }
    function renderMedDealsTab() {
        var members = sortByName(arr(state && state.members));
        var enemies = sortByName(arr(state && state.enemies));
        var deals = arr(state && (state.medDeals || state.med_deals));
        return '\
      <div class="warhub-card">\
        <h3>Add Med Deal</h3>\
        <label class="warhub-label">Faction Member</label>\
        <select class="warhub-select" id="wh-med-member"><option value="">Select member</option>' + memberOptionsHtml(members) + '</select>\
        <label class="warhub-label" style="margin-top:8px;">Enemy Member</label>\
        <select class="warhub-select" id="wh-med-enemy"><option value="">Select enemy</option>' + memberOptionsHtml(enemies) + '</select>\
        <label class="warhub-label" style="margin-top:8px;">Note</label>\
        <input class="warhub-input" id="wh-med-note" placeholder="Optional note">\
        <div class="warhub-actions" style="margin-top:8px;">\
          <button class="warhub-btn primary" id="wh-add-med">Add Deal</button>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Med Deals</h3>\
          <span class="warhub-count">' + fmtNum(deals.length) + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (deals.length ? deals.map(function (d) {
            return '\
            <div class="warhub-row">\
              <div class="warhub-left">\
                <div class="warhub-name">' + esc((d.member_name || 'Member') + ' ↔ ' + (d.enemy_name || 'Enemy')) + '</div>\
                <div class="warhub-meta">' + esc(d.note || 'No note') + '</div>\
              </div>\
              <div class="warhub-right">\
                <button class="warhub-btn warn" data-med-delete="' + esc(String(d.id || '')) + '">Delete</button>\
              </div>\
            </div>';
        }).join('') : '<div class="warhub-empty">No med deals yet.</div>') + '</div>\
      </div>';
    }
    function renderTargetsTab() {
        var enemies = sortByName(arr(state && state.enemies));
        var targets = arr(state && state.targets);
        return '\
      <div class="warhub-card">\
        <h3>Add Target</h3>\
        <label class="warhub-label">Enemy Member</label>\
        <select class="warhub-select" id="wh-target-enemy"><option value="">Select enemy</option>' + memberOptionsHtml(enemies) + '</select>\
        <label class="warhub-label" style="margin-top:8px;">Note</label>\
        <input class="warhub-input" id="wh-target-note" placeholder="Optional note">\
        <div class="warhub-actions" style="margin-top:8px;">\
          <button class="warhub-btn primary" id="wh-add-target">Add Target</button>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Targets</h3>\
          <span class="warhub-count">' + fmtNum(targets.length) + '</span>\
        </div>\
        <div class="warhub-section-scroll">' + (targets.length ? targets.map(function (t) {
            return '\
            <div class="warhub-row" data-target-row="' + esc(String(t.id || '')) + '">\
              <div class="warhub-left">\
                <div class="warhub-name">' + esc(t.enemy_name || 'Enemy') + '</div>\
                <div class="warhub-meta">' + esc(t.note || 'No note') + '</div>\
              </div>\
              <div class="warhub-right">\
                <button class="warhub-btn warn" data-target-delete="' + esc(String(t.id || '')) + '">Delete</button>\
              </div>\
            </div>';
        }).join('') : '<div class="warhub-empty">No targets yet.</div>') + '</div>\
      </div>';
    }
    function renderInstructionsTab() {
        return '\
      <div class="warhub-card">\
        <h3>Getting Started</h3>\
        <div class="warhub-mini" style="line-height:1.6;">\
          1. Paste your Torn API key in Settings and press Save Keys.<br>\
          2. Press Login once to create your session.<br>\
          3. Move the icon and overlay where you want them.<br>\
          4. Use Available in Chain when you want to be shown there.<br>\
          5. Leaders and admin get extra tabs automatically.\
        </div>\
      </div>\
      <div class="warhub-card">\
        <h3>Terms of Service</h3>\
        <div class="warhub-mini" style="line-height:1.6;">\
          War Hub is a faction coordination overlay. Your leader/admin controls faction access and enabled members. Exempt factions and exempt users do not need payment or renewal.\
        </div>\
      </div>\
      <div class="warhub-card">\
        <h3>API Key Storage</h3>\
        <div class="warhub-mini" style="line-height:1.6;">\
          Your saved API key is stored in your userscript storage on your device so login can restore on return. Logout clears the session and saved key when requested.\
        </div>\
      </div>';
    }
    function renderSettingsTab() {
        var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
        var enabledCount = arr(state && state.members).filter(function (m) {
            return !!m.live_stats_enabled;
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
    return '\
      <div class="warhub-banner">\
        <div class="warhub-name">Access</div>\
        <div class="warhub-mini" style="line-height:1.5;">' + esc(msg) + '</div>\
      </div>';
}
function renderAdminTab() {
    if (!isOwnerSession()) {
        return renderAccessBanner() + '<div class="warhub-card"><div class="warhub-empty">Admin access is restricted to ' + esc(OWNER_NAME) + ' [' + esc(OWNER_USER_ID) + '].</div></div>';
    }

    var adminData = state && state.admin ? state.admin : {};
    var factionExemptions = arr(adminData.faction_exemptions);
    var userExemptions = arr(adminData.user_exemptions);
    var debugJson = '';
    try {
        debugJson = JSON.stringify(state || {}, null, 2);
    } catch (_unused14) {
        debugJson = '{}';
    }

    return '\
      <div class="warhub-card">\
        <h3>Admin Dashboard</h3>\
        <div class="warhub-mini" style="line-height:1.6;">\
          Admin: <strong>' + esc(OWNER_NAME) + ' [' + esc(OWNER_USER_ID) + ']</strong><br>\
          Use this tab to manage exemptions and inspect API state.\
        </div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Faction Exemptions</h3>\
        <label class="warhub-label">Faction ID</label>\
        <input class="warhub-input" id="wh-exempt-faction-id" placeholder="Enter faction ID">\
        <label class="warhub-label" style="margin-top:8px;">Faction Name (optional)</label>\
        <input class="warhub-input" id="wh-exempt-faction-name" placeholder="Optional faction name">\
        <div class="warhub-actions" style="margin-top:8px;">\
          <button class="warhub-btn primary" id="wh-add-faction-exempt">Add Faction Exemption</button>\
        </div>\
        <div class="warhub-divider"></div>\
        <div class="warhub-section-scroll">' + (factionExemptions.length ? factionExemptions.map(function (x) {
            return '\
            <div class="warhub-row">\
              <div class="warhub-left">\
                <div class="warhub-name">' + esc(x.faction_name || ('Faction ' + (x.faction_id || ''))) + '</div>\
                <div class="warhub-meta">Faction ID: ' + esc(String(x.faction_id || '')) + '</div>\
              </div>\
              <div class="warhub-right">\
                <button class="warhub-btn warn" data-remove-faction-exempt="' + esc(String(x.faction_id || '')) + '">Remove</button>\
              </div>\
            </div>';
        }).join('') : '<div class="warhub-empty">No faction exemptions.</div>') + '</div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>Player Exemptions</h3>\
        <label class="warhub-label">Player ID</label>\
        <input class="warhub-input" id="wh-exempt-user-id" placeholder="Enter player ID">\
        <label class="warhub-label" style="margin-top:8px;">Player Name (optional)</label>\
        <input class="warhub-input" id="wh-exempt-user-name" placeholder="Optional player name">\
        <div class="warhub-actions" style="margin-top:8px;">\
          <button class="warhub-btn primary" id="wh-add-user-exempt">Add Player Exemption</button>\
        </div>\
        <div class="warhub-divider"></div>\
        <div class="warhub-section-scroll">' + (userExemptions.length ? userExemptions.map(function (x) {
            return '\
            <div class="warhub-row">\
              <div class="warhub-left">\
                <div class="warhub-name">' + esc(x.user_name || ('Player ' + (x.user_id || ''))) + '</div>\
                <div class="warhub-meta">Player ID: ' + esc(String(x.user_id || '')) + '</div>\
              </div>\
              <div class="warhub-right">\
                <button class="warhub-btn warn" data-remove-user-exempt="' + esc(String(x.user_id || '')) + '">Remove</button>\
              </div>\
            </div>';
        }).join('') : '<div class="warhub-empty">No player exemptions.</div>') + '</div>\
      </div>\
\
      <div class="warhub-card">\
        <h3>API State Debug</h3>\
        <div class="warhub-actions" style="margin-bottom:8px;">\
          <button class="warhub-btn" id="wh-refresh-api-state">Refresh</button>\
        </div>\
        <textarea class="warhub-textarea" id="wh-api-state-box" readonly style="min-height:260px;">' + esc(debugJson) + '</textarea>\
      </div>';
}
function renderWarTop5Tab() {
    if (!isOwnerSession()) {
        return '<div class="warhub-card"><div class="warhub-empty">Admin only.</div></div>';
    }

    var cache = adminTopFiveCache && _typeof(adminTopFiveCache) === 'object' ? adminTopFiveCache : null;
    var factions = arr(cache && cache.factions);

    if (!factions.length) {
        var ourFaction = state && (state.faction || state.our_faction) || {};
        var enemyFaction = getEnemyFactionMeta();

        factions = [{
            faction_id: String(ourFaction.faction_id || activeFactionId() || ''),
            faction_name: String(ourFaction.name || activeFactionName() || 'Our Faction'),
            players: buildTopFive(arr(state && state.members))
        }, {
            faction_id: String(enemyFaction.id || ''),
            faction_name: String(enemyFaction.name || 'Enemy Faction'),
            players: buildTopFive(arr(enemyFaction.members))
        }].filter(function (f) {
            return arr(f.players).length > 0;
        });
    }

    return '\
      <div class="warhub-grid">' + (factions.length ? factions.map(function (f, idx) {
        return renderTopFiveSelect('Faction Top 5', f.faction_name || ('Faction ' + (f.faction_id || '')), arr(f.players), 'wh-top5-' + idx);
    }).join('') : '<div class="warhub-card"><div class="warhub-empty">No top five data loaded yet.</div></div>') + '\
      </div>';
}
function renderBody() {
    if (!overlay) return;
    ensureVisibleTab();

    var body = overlay.querySelector('.warhub-body');
    if (!body) return;

    var banner = renderAccessBanner();
    var html = '';

    if (currentTab === 'overview') html = renderOverviewTab();
    else if (currentTab === 'faction') html = renderFactionTab();
    else if (currentTab === 'war') html = renderWarTab();
    else if (currentTab === 'summary') html = renderSummaryTab();
    else if (currentTab === 'chain') html = renderChainTab();
    else if (currentTab === 'terms') html = renderTermsTab();
    else if (currentTab === 'members') html = renderMembersTab();
    else if (currentTab === 'enemies') html = renderEnemiesTab();
    else if (currentTab === 'hospital') html = renderHospitalTab();
    else if (currentTab === 'meddeals') html = renderMedDealsTab();
    else if (currentTab === 'targets') html = renderTargetsTab();
    else if (currentTab === 'instructions') html = renderInstructionsTab();
    else if (currentTab === 'settings') html = renderSettingsTab();
    else if (currentTab === 'admin') html = renderAdminTab();
    else if (currentTab === 'wartop5') html = renderWarTop5Tab();
    else html = '<div class="warhub-card"><div class="warhub-empty">Tab not found.</div></div>';

    var savedScrollTop = body.scrollTop || 0;
    var tabsEl = overlay.querySelector('.warhub-tabs');
    var savedTabsLeft = tabsEl ? tabsEl.scrollLeft : 0;
    var pageX = window.scrollX || window.pageXOffset || 0;
    var pageY = window.scrollY || window.pageYOffset || 0;

    body.innerHTML = '\
      <div id="warhub-status" class="warhub-status"></div>\
      ' + banner + '\
      ' + html;

    restoreStatus();

    if (tabsEl) {
        requestAnimationFrame(function () {
            tabsEl.scrollLeft = savedTabsLeft || Number(GM_getValue(K_TABS_SCROLL_LEFT, 0)) || 0;
        });
    }

    requestAnimationFrame(function () {
        body.scrollTop = savedScrollTop || Number(GM_getValue(K_OVERLAY_SCROLL, 0)) || 0;
        try {
            window.scrollTo(pageX, pageY);
        } catch (_unused15) {}
    });
}
function updateTabs() {
    if (!overlay) return;
    ensureVisibleTab();
    var tabs = overlay.querySelector('.warhub-tabs');
    if (!tabs) return;

    var scrollLeft = tabs.scrollLeft || 0;
    tabs.innerHTML = visibleTabs().map(function (row) {
        var tab = row[0];
        var label = row[1];
        var extra = tab === currentTab ? ' active' : '';
        return '<button class="warhub-tab' + extra + '" data-tab="' + esc(tab) + '">' + esc(label) + '</button>';
    }).join('');

    requestAnimationFrame(function () {
        tabs.scrollLeft = scrollLeft || Number(GM_getValue(K_TABS_SCROLL_LEFT, 0)) || 0;
    });
}
function updateBadge() {
    if (!badge || !shield) return;
    var count = unreadCount();
    if (!count) {
        badge.style.display = 'none';
        return;
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    var r = shield.getBoundingClientRect();
    badge.style.left = (r.left + r.width - 10) + 'px';
    badge.style.top = (r.top - 6) + 'px';
    badge.style.display = 'block';
}
function openOverlay() {
    isOpen = true;
    GM_setValue(K_OPEN, true);
    if (!overlay) mount();
    overlay.classList.add('open');
    updateTabs();
    renderBody();
    updateBadge();
}
function closeOverlay() {
    isOpen = false;
    GM_setValue(K_OPEN, false);
    if (overlay) overlay.classList.remove('open');
}
function toggleOverlay() {
    if (isOpen) closeOverlay(); else openOverlay();
}
function clampToViewport(el) {
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var maxLeft = Math.max(0, window.innerWidth - rect.width);
    var maxTop = Math.max(0, window.innerHeight - rect.height);
    var left = rect.left;
    var top = rect.top;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
}
function saveShieldPos() {
    if (!shield) return;
    var rect = shield.getBoundingClientRect();
    GM_setValue(K_SHIELD_POS, {
        left: rect.left,
        top: rect.top
    });
    updateBadge();
}
function saveOverlayPos() {
    if (!overlay) return;
    var rect = overlay.getBoundingClientRect();
    GM_setValue(K_OVERLAY_POS, {
        left: rect.left,
        top: rect.top
    });
}
function saveOverlayScroll() {
    if (!overlay) return;
    var body = overlay.querySelector('.warhub-body');
    if (body) GM_setValue(K_OVERLAY_SCROLL, body.scrollTop || 0);
}
function resetShieldPosition() {
    GM_deleteValue(K_SHIELD_POS);
    if (!shield) return;
    shield.style.top = '120px';
    shield.style.right = '14px';
    shield.style.left = 'auto';
    shield.style.bottom = 'auto';
}
function resetOverlayPosition() {
    GM_deleteValue(K_OVERLAY_POS);
    if (!overlay) return;
    overlay.style.top = '170px';
    overlay.style.right = '12px';
    overlay.style.left = 'auto';
    overlay.style.bottom = 'auto';
}
var isDraggingShield = false;
var isDraggingOverlay = false;
function enableDrag(el, handle, onSave, isShield) {
    if (!el || !handle) return;

    var startX = 0;
    var startY = 0;
    var startLeft = 0;
    var startTop = 0;
    var holdTimer = null;
    var activePointerId = null;
    var dragStarted = false;

    function clearHold() {
        if (holdTimer) {
            clearTimeout(holdTimer);
            holdTimer = null;
        }
    }

    function beginDrag(clientX, clientY) {
        var rect = el.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        startX = clientX;
        startY = clientY;
        dragStarted = true;
        dragMoved = true;
        if (isShield) {
            isDraggingShield = true;
            shield.classList.add('dragging');
        } else {
            isDraggingOverlay = true;
            handle.classList.add('dragging');
        }
    }

    function moveTo(clientX, clientY) {
        if (!dragStarted) return;
        var dx = clientX - startX;
        var dy = clientY - startY;
        el.style.left = (startLeft + dx) + 'px';
        el.style.top = (startTop + dy) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        clampToViewport(el);
        updateBadge();
    }

    function endDrag() {
        clearHold();
        if (dragStarted) {
            clampToViewport(el);
            if (typeof onSave === 'function') onSave();
        }
        if (isShield) {
            isDraggingShield = false;
            if (shield) shield.classList.remove('dragging');
        } else {
            isDraggingOverlay = false;
            if (handle) handle.classList.remove('dragging');
        }
        activePointerId = null;
        dragStarted = false;
        setTimeout(function () {
            dragMoved = false;
        }, 120);
    }

    handle.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        activePointerId = e.pointerId;
        clearHold();
        holdTimer = setTimeout(function () {
            beginDrag(e.clientX, e.clientY);
        }, 150);
    }, {
        passive: true
    });

    handle.addEventListener('pointermove', function (e) {
        if (activePointerId !== e.pointerId) return;
        if (dragStarted) {
            e.preventDefault();
            moveTo(e.clientX, e.clientY);
            return;
        }
        if (Math.abs(e.movementX || 0) > 4 || Math.abs(e.movementY || 0) > 4) {
            clearHold();
            beginDrag(e.clientX, e.clientY);
        }
    }, {
        passive: false
    });

    handle.addEventListener('pointerup', function (e) {
        if (activePointerId !== e.pointerId) return;
        endDrag();
    });
    handle.addEventListener('pointercancel', function (e) {
        if (activePointerId !== e.pointerId) return;
        endDrag();
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
    overlay.innerHTML = '\
      <div class="warhub-head">\
        <div class="warhub-toprow">\
          <div>\
            <div class="warhub-title">War Hub ⚔️</div>\
            <div class="warhub-sub">By ' + esc(OWNER_NAME) + '</div>\
          </div>\
          <button class="warhub-close" id="warhub-close-btn">Close</button>\
        </div>\
      </div>\
      <div class="warhub-tabs"></div>\
      <div class="warhub-body"></div>';

    document.body.appendChild(shield);
    document.body.appendChild(badge);
    document.body.appendChild(overlay);

    var savedShield = GM_getValue(K_SHIELD_POS, null);
    if (savedShield && _typeof(savedShield) === 'object' && typeof savedShield.left === 'number' && typeof savedShield.top === 'number') {
        shield.style.left = savedShield.left + 'px';
        shield.style.top = savedShield.top + 'px';
        shield.style.right = 'auto';
        shield.style.bottom = 'auto';
    }
    clampToViewport(shield);
    saveShieldPos();

    var savedOverlay = GM_getValue(K_OVERLAY_POS, null);
    if (savedOverlay && _typeof(savedOverlay) === 'object' && typeof savedOverlay.left === 'number' && typeof savedOverlay.top === 'number') {
        overlay.style.left = savedOverlay.left + 'px';
        overlay.style.top = savedOverlay.top + 'px';
        overlay.style.right = 'auto';
        overlay.style.bottom = 'auto';
    }
    clampToViewport(overlay);
    saveOverlayPos();

    updateTabs();
    renderBody();
    bindOverlayEvents();

    enableDrag(shield, shield, saveShieldPos, true);
    enableDrag(overlay, overlay.querySelector('.warhub-head'), saveOverlayPos, false);

    if (isOpen) overlay.classList.add('open');
    updateBadge();
}
    function bindOverlayEvents() {
    if (!overlay) return;

    overlay.addEventListener('click', function (e) {
        var tabBtn = e.target.closest('[data-tab]');
        if (tabBtn) {
            var tab = tabBtn.getAttribute('data-tab') || 'overview';
            currentTab = tab;
            GM_setValue(K_TAB, currentTab);
            var tabs = overlay.querySelector('.warhub-tabs');
            if (tabs) GM_setValue(K_TABS_SCROLL_LEFT, tabs.scrollLeft || 0);
            renderBody();
            return;
        }

        var openTabBtn = e.target.closest('[data-open-tab]');
        if (openTabBtn) {
            var targetTab = openTabBtn.getAttribute('data-open-tab') || 'overview';
            currentTab = targetTab;
            GM_setValue(K_TAB, currentTab);
            renderBody();
            return;
        }

        if (e.target.id === 'warhub-close-btn') {
            closeOverlay();
            return;
        }

        if (e.target.id === 'wh-login-btn') {
            _asyncToGenerator(function* () {
                try {
                    setStatus('Logging in...');
                    yield login();
                    yield loadState(false);
                    setStatus('Logged in. Auto-login is now active.');
                } catch (err) {
                    setStatus((err && err.message) || 'Login failed.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-save-keys') {
            _asyncToGenerator(function* () {
                try {
                    var keyInput = overlay.querySelector('#wh-api-key');
                    var apiKey = cleanInputValue(keyInput ? keyInput.value : '');
                    saveApiKey(apiKey);
                    setStatus(apiKey ? 'API key saved. Logging in...' : 'API key cleared.');
                    if (apiKey) {
                        yield login();
                        yield loadState(false);
                        setStatus('API key saved and login restored.');
                    }
                } catch (err) {
                    setStatus((err && err.message) || 'Could not save API key.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-logout-btn') {
            _asyncToGenerator(function* () {
                try {
                    saveSessionId('');
                    clearSavedKeys();
                    accessState = normalizeAccessCache({});
                    saveAccessCache();
                    state = null;
                    setStatus('Logged out.');
                    renderBody();
                } catch (err) {
                    setStatus((err && err.message) || 'Logout failed.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-reset-positions') {
            resetShieldPosition();
            resetOverlayPosition();
            clampToViewport(shield);
            clampToViewport(overlay);
            saveShieldPos();
            saveOverlayPos();
            setStatus('Overlay and icon positions reset.');
            return;
        }

        if (e.target.id === 'wh-save-terms') {
            _asyncToGenerator(function* () {
                try {
                    var box = overlay.querySelector('#wh-terms-box');
                    var text = box ? box.value : '';
                    yield req('POST', '/api/terms', {
                        text: text
                    });
                    if (state) state.terms = text ? {
                        text: text
                    } : null;
                    renderBody();
                    setStatus('Terms saved.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not save terms.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-delete-terms') {
            _asyncToGenerator(function* () {
                try {
                    yield req('DELETE', '/api/terms');
                    if (state) state.terms = null;
                    renderBody();
                    var box = overlay.querySelector('#wh-terms-box');
                    if (box) box.value = '';
                    setStatus('Terms deleted.');
                } catch (err) {
                    try {
                        yield req('POST', '/api/terms', {
                            text: ''
                        });
                        if (state) state.terms = null;
                        renderBody();
                        var box2 = overlay.querySelector('#wh-terms-box');
                        if (box2) box2.value = '';
                        setStatus('Terms cleared.');
                    } catch (err2) {
                        setStatus((err2 && err2.message) || (err && err.message) || 'Could not delete terms.', true);
                    }
                }
            })();
            return;
        }

        if (e.target.id === 'wh-add-med') {
            _asyncToGenerator(function* () {
                try {
                    var memberSel = overlay.querySelector('#wh-med-member');
                    var enemySel = overlay.querySelector('#wh-med-enemy');
                    var noteInput = overlay.querySelector('#wh-med-note');
                    var memberId = cleanInputValue(memberSel ? memberSel.value : '');
                    var enemyId = cleanInputValue(enemySel ? enemySel.value : '');
                    var note = cleanInputValue(noteInput ? noteInput.value : '');

                    if (!memberId || !enemyId) throw new Error('Select both member and enemy.');

                    var memberObj = arr(state && state.members).find(function (m) {
                        return String((m && (m.user_id || m.id)) || '') === memberId;
                    });
                    var enemyObj = arr(state && state.enemies).find(function (m) {
                        return String((m && (m.user_id || m.id)) || '') === enemyId;
                    });

                    yield req('POST', '/api/med-deals', {
                        member_id: memberId,
                        member_name: memberObj ? memberObj.name : '',
                        enemy_id: enemyId,
                        enemy_name: enemyObj ? enemyObj.name : '',
                        note: note
                    });

                    yield loadState(false);
                    setStatus('Med deal added.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not add med deal.', true);
                }
            })();
            return;
        }

        var medDeleteBtn = e.target.closest('[data-med-delete]');
        if (medDeleteBtn) {
            _asyncToGenerator(function* () {
                try {
                    var id = cleanInputValue(medDeleteBtn.getAttribute('data-med-delete') || '');
                    if (!id) throw new Error('Missing med deal id.');
                    yield req('DELETE', '/api/med-deals/' + encodeURIComponent(id));
                    yield loadState(false);
                    setStatus('Med deal deleted.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not delete med deal.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-add-target') {
            _asyncToGenerator(function* () {
                try {
                    var enemySelect = overlay.querySelector('#wh-target-enemy');
                    var targetNote = overlay.querySelector('#wh-target-note');
                    var targetEnemyId = cleanInputValue(enemySelect ? enemySelect.value : '');
                    var targetNoteText = cleanInputValue(targetNote ? targetNote.value : '');

                    if (!targetEnemyId) throw new Error('Select an enemy.');

                    var targetEnemyObj = arr(state && state.enemies).find(function (m) {
                        return String((m && (m.user_id || m.id)) || '') === targetEnemyId;
                    });

                    yield req('POST', '/api/targets', {
                        enemy_id: targetEnemyId,
                        enemy_name: targetEnemyObj ? targetEnemyObj.name : '',
                        note: targetNoteText
                    });

                    yield loadState(false);
                    setStatus('Target added.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not add target.', true);
                }
            })();
            return;
        }

        var targetDeleteBtn = e.target.closest('[data-target-delete]');
        if (targetDeleteBtn) {
            _asyncToGenerator(function* () {
                try {
                    var targetId = cleanInputValue(targetDeleteBtn.getAttribute('data-target-delete') || '');
                    if (!targetId) throw new Error('Missing target id.');

                    var row = overlay.querySelector('[data-target-row="' + cssEscape(targetId) + '"]');
                    if (row) row.remove();

                    yield req('DELETE', '/api/targets/' + encodeURIComponent(targetId));
                    yield loadState(false);
                    setStatus('Target deleted.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not delete target.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-refresh-api-state') {
            _asyncToGenerator(function* () {
                try {
                    yield loadState(false);
                    var box = overlay.querySelector('#wh-api-state-box');
                    if (box) {
                        try {
                            box.value = JSON.stringify(state || {}, null, 2);
                        } catch (_unused16) {
                            box.value = '{}';
                        }
                    }
                    setStatus('API state refreshed.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not refresh API state.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-add-faction-exempt') {
            _asyncToGenerator(function* () {
                try {
                    var fid = cleanInputValue((overlay.querySelector('#wh-exempt-faction-id') || {}).value || '');
                    var fname = cleanInputValue((overlay.querySelector('#wh-exempt-faction-name') || {}).value || '');
                    if (!fid) throw new Error('Enter a faction ID.');
                    yield adminReq('POST', '/api/admin/exempt/faction', {
                        faction_id: fid,
                        faction_name: fname
                    });
                    yield loadState(false);
                    setStatus('Faction exemption added.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not add faction exemption.', true);
                }
            })();
            return;
        }

        if (e.target.id === 'wh-add-user-exempt') {
            _asyncToGenerator(function* () {
                try {
                    var uid = cleanInputValue((overlay.querySelector('#wh-exempt-user-id') || {}).value || '');
                    var uname = cleanInputValue((overlay.querySelector('#wh-exempt-user-name') || {}).value || '');
                    if (!uid) throw new Error('Enter a player ID.');
                    yield adminReq('POST', '/api/admin/exempt/user', {
                        user_id: uid,
                        user_name: uname
                    });
                    yield loadState(false);
                    setStatus('Player exemption added.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not add player exemption.', true);
                }
            })();
            return;
        }

        var remFactionBtn = e.target.closest('[data-remove-faction-exempt]');
        if (remFactionBtn) {
            _asyncToGenerator(function* () {
                try {
                    var remFid = cleanInputValue(remFactionBtn.getAttribute('data-remove-faction-exempt') || '');
                    if (!remFid) throw new Error('Missing faction id.');
                    yield adminReq('DELETE', '/api/admin/exempt/faction/' + encodeURIComponent(remFid));
                    yield loadState(false);
                    setStatus('Faction exemption removed.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not remove faction exemption.', true);
                }
            })();
            return;
        }

        var remUserBtn = e.target.closest('[data-remove-user-exempt]');
        if (remUserBtn) {
            _asyncToGenerator(function* () {
                try {
                    var remUid = cleanInputValue(remUserBtn.getAttribute('data-remove-user-exempt') || '');
                    if (!remUid) throw new Error('Missing user id.');
                    yield adminReq('DELETE', '/api/admin/exempt/user/' + encodeURIComponent(remUid));
                    yield loadState(false);
                    setStatus('Player exemption removed.');
                } catch (err) {
                    setStatus((err && err.message) || 'Could not remove player exemption.', true);
                }
            })();
            return;
        }
    });

    overlay.addEventListener('input', function (e) {
        var tabs = overlay.querySelector('.warhub-tabs');
        if (tabs) GM_setValue(K_TABS_SCROLL_LEFT, tabs.scrollLeft || 0);
        saveOverlayScroll();

        if (e.target && e.target.id === 'wh-api-state-box') return;
    });

    var tabsEl = overlay.querySelector('.warhub-tabs');
    if (tabsEl) {
        tabsEl.addEventListener('scroll', function () {
            GM_setValue(K_TABS_SCROLL_LEFT, tabsEl.scrollLeft || 0);
        }, {
            passive: true
        });
    }

    var bodyEl = overlay.querySelector('.warhub-body');
    if (bodyEl) {
        bodyEl.addEventListener('scroll', function () {
            saveOverlayScroll();
        }, {
            passive: true
        });
    }

    shield.addEventListener('click', function () {
        if (dragMoved) return;
        toggleOverlay();
    });

    window.addEventListener('resize', function () {
        clampToViewport(shield);
        clampToViewport(overlay);
        saveShieldPos();
        saveOverlayPos();
    });
}
function ensureMounted() {
    if (!document.body) return;
    if (!shield || !document.body.contains(shield) || !overlay || !document.body.contains(overlay)) {
        mounted = false;
        mount();
    }
}
function scheduleRemountWatcher() {
    if (remountTimer) clearInterval(remountTimer);
    remountTimer = setInterval(function () {
        ensureMounted();
        updateBadge();
    }, 1500);
}
function tryAutoLogin() {
    return _tryAutoLogin.apply(this, arguments);
}
function _tryAutoLogin() {
    _tryAutoLogin = _asyncToGenerator(function* () {
        var apiKey = getSavedApiKey();
        if (!apiKey) return false;

        var sid = getSessionId();
        if (sid) {
            try {
                yield loadState(true);
                return true;
            } catch (_unused17) {}
        }

        try {
            yield login();
            yield loadState(true);
            return true;
        } catch (_unused18) {
            return false;
        }
    });
    return _tryAutoLogin.apply(this, arguments);
}
   function boot() {
    return _boot.apply(this, arguments);
}
function _boot() {
    _boot = _asyncToGenerator(function* () {
        try {
            mount();
            updateBadge();
            schedulePoll();
            scheduleRemountWatcher();

            var ok = yield healthCheck();
            if (!ok) {
                setStatus('Backend offline or unreachable.', true);
            }

            yield tryAutoLogin();

            if (isOwnerSession()) {
                yield loadAdminTopFive();
            }
            yield loadAnalytics();
            yield loadState(true);

            if (isOpen) {
                openOverlay();
            } else {
                closeOverlay();
            }
        } catch (err) {
            setStatus((err && err.message) || 'Boot failed.', true);
        }
    });
    return _boot.apply(this, arguments);
}

function onReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(fn, 0);
    } else {
        document.addEventListener('DOMContentLoaded', fn, {
            once: true
        });
    }
}

function shouldRunHere() {
    try {
        if (window.top !== window.self) return false;
    } catch (_unused19) {
        return false;
    }
    return /torn\.com$/i.test(location.hostname);
}

function watchSpaNavigation() {
    var lastHref = location.href;

    function handleMaybeChanged() {
        if (location.href === lastHref) return;
        lastHref = location.href;

        ensureMounted();
        updateTabs();
        if (isOpen) {
            renderBody();
            updateBadge();
        }
    }

    var pushState = history.pushState;
    var replaceState = history.replaceState;

    if (typeof pushState === 'function') {
        history.pushState = function () {
            var result = pushState.apply(this, arguments);
            setTimeout(handleMaybeChanged, 50);
            return result;
        };
    }

    if (typeof replaceState === 'function') {
        history.replaceState = function () {
            var result = replaceState.apply(this, arguments);
            setTimeout(handleMaybeChanged, 50);
            return result;
        };
    }

    window.addEventListener('popstate', function () {
        setTimeout(handleMaybeChanged, 50);
    });

    setInterval(handleMaybeChanged, 1200);
}

if (!shouldRunHere()) return;
onReady(function () {
    watchSpaNavigation();
    boot();
});
})(); 
