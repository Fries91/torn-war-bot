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

    // ============================================================
    // 01. CORE CONFIG / STORAGE KEYS
    // ============================================================

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

    // ============================================================
    // 02. PAYMENT / OWNER CONFIG
    // ============================================================

    var PAYMENT_PLAYER = 'Fries91';
    var OWNER_NAME = 'Fries91';
    var OWNER_USER_ID = '3679030';
    var PRICE_PER_MEMBER = 3;

    // ============================================================
    // 03. TAB ORDER
    // ============================================================

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

    // ============================================================
    // 04. RUNTIME STATE / CACHES
    // ============================================================

    var state = null;
    var analyticsCache = null;
    var adminTopFiveCache = null;
    var factionMembersCache = null;

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

    // ============================================================
    // 05. STYLES
    // ============================================================

    var css = "\n\
    #warhub-shield {\n\
      position: fixed !important;\n\
      z-index: 2147483647 !important;\n\
      width: 42px !important;\n\
      height: 42px !important;\n\
      border-radius: 12px !important;\n\
      display: flex !important;\n\
      align-items: center !important;\n\
      justify-content: center !important;\n\
      font-size: 22px !important;\n\
      line-height: 1 !important;\n\
      cursor: grab !important;\n\
      user-select: none !important;\n\
      -webkit-user-select: none !important;\n\
      -webkit-touch-callout: none !important;\n\
      touch-action: none !important;\n\
      box-shadow: 0 8px 24px rgba(0,0,0,.45) !important;\n\
      border: 1px solid rgba(255,255,255,.10) !important;\n\
      background: radial-gradient(circle at 30% 20%, rgba(220,75,75,.98), rgba(110,12,12,.98) 55%, rgba(48,6,6,.98)) !important;\n\
      color: #fff !important;\n\
      top: 120px !important;\n\
      right: 14px !important;\n\
      left: auto !important;\n\
      bottom: auto !important;\n\
      opacity: 1 !important;\n\
      visibility: visible !important;\n\
      pointer-events: auto !important;\n\
    }\n\
    #warhub-shield.dragging { cursor: grabbing !important; }\n\
\n\
    #warhub-badge {\n\
      position: fixed !important;\n\
      z-index: 2147483647 !important;\n\
      min-width: 16px !important;\n\
      height: 16px !important;\n\
      padding: 0 4px !important;\n\
      border-radius: 999px !important;\n\
      background: #ffd54a !important;\n\
      color: #111 !important;\n\
      font-size: 10px !important;\n\
      line-height: 16px !important;\n\
      text-align: center !important;\n\
      font-weight: 800 !important;\n\
      box-shadow: 0 3px 12px rgba(0,0,0,.45) !important;\n\
      display: none !important;\n\
      pointer-events: none !important;\n\
    }\n\
\n\
    #warhub-overlay {\n\
      position: fixed !important;\n\
      z-index: 2147483646 !important;\n\
      right: 12px !important;\n\
      top: 170px !important;\n\
      width: min(96vw, 520px) !important;\n\
      height: min(88vh, 900px) !important;\n\
      max-height: 88vh !important;\n\
      min-height: 420px !important;\n\
      overflow: hidden !important;\n\
      border-radius: 14px !important;\n\
      background: linear-gradient(180deg, #171717, #0c0c0c) !important;\n\
      color: #f2f2f2 !important;\n\
      border: 1px solid rgba(255,255,255,.08) !important;\n\
      box-shadow: 0 16px 38px rgba(0,0,0,.54) !important;\n\
      display: none !important;\n\
      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif !important;\n\
      left: auto !important;\n\
      bottom: auto !important;\n\
      flex-direction: column !important;\n\
      box-sizing: border-box !important;\n\
      opacity: 1 !important;\n\
      visibility: visible !important;\n\
    }\n\
    #warhub-overlay.open { display: flex !important; }\n\
\n\
    #warhub-overlay *,\n\
    #warhub-overlay *::before,\n\
    #warhub-overlay *::after {\n\
      box-sizing: border-box !important;\n\
    }\n\
\n\
    .warhub-head {\n\
      padding: 10px 12px 9px !important;\n\
      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n\
      background: linear-gradient(180deg, rgba(170,18,18,.30), rgba(20,20,20,.20)) !important;\n\
      cursor: grab !important;\n\
      user-select: none !important;\n\
      -webkit-user-select: none !important;\n\
      -webkit-touch-callout: none !important;\n\
      touch-action: none !important;\n\
      flex: 0 0 auto !important;\n\
      display: block !important;\n\
      width: 100% !important;\n\
      min-height: 54px !important;\n\
    }\n\
    .warhub-head.dragging { cursor: grabbing !important; }\n\
\n\
    .warhub-toprow {\n\
      display: flex !important;\n\
      align-items: center !important;\n\
      justify-content: space-between !important;\n\
      gap: 10px !important;\n\
      width: 100% !important;\n\
    }\n\
\n\
    .warhub-title {\n\
      font-weight: 800 !important;\n\
      font-size: 16px !important;\n\
      letter-spacing: .2px !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-sub {\n\
      opacity: .72 !important;\n\
      font-size: 11px !important;\n\
      margin-top: 2px !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-close {\n\
      appearance: none !important;\n\
      -webkit-appearance: none !important;\n\
      border: 0 !important;\n\
      border-radius: 9px !important;\n\
      background: rgba(255,255,255,.08) !important;\n\
      color: #fff !important;\n\
      padding: 5px 9px !important;\n\
      font-weight: 700 !important;\n\
      cursor: pointer !important;\n\
      font-size: 12px !important;\n\
      flex: 0 0 auto !important;\n\
      display: inline-flex !important;\n\
      align-items: center !important;\n\
      justify-content: center !important;\n\
      min-height: 30px !important;\n\
    }\n\
\n\
    .warhub-tabs {\n\
      display: flex !important;\n\
      flex: 0 0 auto !important;\n\
      flex-wrap: nowrap !important;\n\
      align-items: center !important;\n\
      gap: 6px !important;\n\
      padding: 8px !important;\n\
      overflow-x: auto !important;\n\
      overflow-y: hidden !important;\n\
      border-bottom: 1px solid rgba(255,255,255,.08) !important;\n\
      background: rgba(255,255,255,.02) !important;\n\
      scrollbar-width: thin !important;\n\
      -webkit-overflow-scrolling: touch !important;\n\
      width: 100% !important;\n\
      min-height: 48px !important;\n\
      max-height: 48px !important;\n\
      white-space: nowrap !important;\n\
    }\n\
\n\
    .warhub-tab {\n\
      appearance: none !important;\n\
      -webkit-appearance: none !important;\n\
      border: 0 !important;\n\
      border-radius: 999px !important;\n\
      background: rgba(255,255,255,.07) !important;\n\
      color: #fff !important;\n\
      padding: 6px 10px !important;\n\
      font-size: 11px !important;\n\
      font-weight: 700 !important;\n\
      white-space: nowrap !important;\n\
      cursor: pointer !important;\n\
      flex: 0 0 auto !important;\n\
      display: inline-flex !important;\n\
      align-items: center !important;\n\
      justify-content: center !important;\n\
      min-height: 30px !important;\n\
      line-height: 1.1 !important;\n\
      opacity: 1 !important;\n\
      visibility: visible !important;\n\
      gap: 6px !important;\n\
    }\n\
    .warhub-tab.active {\n\
      background: linear-gradient(180deg, #d23333, #831515) !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-tab.locked {\n\
      opacity: .55 !important;\n\
    }\n\
\n\
    .warhub-body {\n\
      padding: 8px !important;\n\
      overflow-y: auto !important;\n\
      overflow-x: hidden !important;\n\
      -webkit-overflow-scrolling: touch !important;\n\
      flex: 1 1 auto !important;\n\
      min-height: 0 !important;\n\
      width: 100% !important;\n\
      display: block !important;\n\
    }\n\
\n\
    .warhub-status {\n\
      display: none !important;\n\
      margin-bottom: 8px !important;\n\
      padding: 8px 10px !important;\n\
      border-radius: 10px !important;\n\
      font-size: 12px !important;\n\
      background: rgba(255,255,255,.06) !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-status.show { display: block !important; }\n\
    .warhub-status.err { background: rgba(190,32,32,.22) !important; }\n\
\n\
    .warhub-card {\n\
      border: 1px solid rgba(255,255,255,.08) !important;\n\
      border-radius: 12px !important;\n\
      padding: 10px !important;\n\
      margin-bottom: 8px !important;\n\
      background: rgba(255,255,255,.035) !important;\n\
    }\n\
\n\
    .warhub-grid {\n\
      display: grid !important;\n\
      gap: 8px !important;\n\
    }\n\
    .warhub-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }\n\
    .warhub-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }\n\
\n\
    .warhub-metric {\n\
      border: 1px solid rgba(255,255,255,.06) !important;\n\
      border-radius: 10px !important;\n\
      padding: 8px !important;\n\
      background: rgba(255,255,255,.03) !important;\n\
    }\n\
    .warhub-metric .k {\n\
      font-size: 11px !important;\n\
      opacity: .72 !important;\n\
      margin-bottom: 4px !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-metric .v {\n\
      font-weight: 800 !important;\n\
      font-size: 14px !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-list {\n\
      display: flex !important;\n\
      flex-direction: column !important;\n\
      gap: 8px !important;\n\
    }\n\
    .warhub-list-item,\n\
    .warhub-row {\n\
      border: 1px solid rgba(255,255,255,.07) !important;\n\
      border-radius: 10px !important;\n\
      padding: 8px !important;\n\
      background: rgba(255,255,255,.03) !important;\n\
    }\n\
\n\
    .warhub-name {\n\
      font-weight: 700 !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-meta {\n\
      font-size: 11px !important;\n\
      opacity: .75 !important;\n\
      margin-top: 3px !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-actions {\n\
      display: flex !important;\n\
      flex-wrap: wrap !important;\n\
      gap: 8px !important;\n\
      margin-top: 8px !important;\n\
    }\n\
\n\
    .warhub-btn {\n\
      appearance: none !important;\n\
      -webkit-appearance: none !important;\n\
      border: 0 !important;\n\
      border-radius: 10px !important;\n\
      padding: 8px 10px !important;\n\
      font-size: 12px !important;\n\
      font-weight: 700 !important;\n\
      cursor: pointer !important;\n\
      background: rgba(255,255,255,.08) !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-btn.primary {\n\
      background: linear-gradient(180deg, #d23333, #831515) !important;\n\
    }\n\
    .warhub-btn.warn {\n\
      background: rgba(185,45,45,.85) !important;\n\
    }\n\
    .warhub-btn.small {\n\
      padding: 6px 8px !important;\n\
      font-size: 11px !important;\n\
    }\n\
\n\
    .warhub-input,\n\
    .warhub-select,\n\
    .warhub-textarea {\n\
      width: 100% !important;\n\
      border: 1px solid rgba(255,255,255,.10) !important;\n\
      border-radius: 10px !important;\n\
      padding: 8px 10px !important;\n\
      background: rgba(0,0,0,.22) !important;\n\
      color: #fff !important;\n\
      font-size: 13px !important;\n\
    }\n\
\n\
    .warhub-label {\n\
      display: block !important;\n\
      font-size: 11px !important;\n\
      opacity: .8 !important;\n\
      margin-bottom: 5px !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-empty {\n\
      font-size: 12px !important;\n\
      opacity: .75 !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-section-title {\n\
      display: flex !important;\n\
      align-items: center !important;\n\
      justify-content: space-between !important;\n\
      gap: 8px !important;\n\
      margin-bottom: 8px !important;\n\
    }\n\
    .warhub-section-title h3 {\n\
      margin: 0 !important;\n\
      font-size: 14px !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-count {\n\
      opacity: .75 !important;\n\
      font-size: 11px !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-pill {\n\
      display: inline-flex !important;\n\
      align-items: center !important;\n\
      justify-content: center !important;\n\
      padding: 3px 8px !important;\n\
      border-radius: 999px !important;\n\
      border: 1px solid rgba(255,255,255,.10) !important;\n\
      font-size: 11px !important;\n\
      font-weight: 700 !important;\n\
    }\n\
\n\
    .warhub-pill.online {\n\
      background: rgba(40,140,90,.20) !important;\n\
      color: #b7ffd5 !important;\n\
    }\n\
    .warhub-pill.idle {\n\
      background: rgba(197,141,46,.22) !important;\n\
      color: #ffe3a5 !important;\n\
    }\n\
    .warhub-pill.offline {\n\
      background: rgba(113,113,113,.20) !important;\n\
      color: #dadada !important;\n\
    }\n\
    .warhub-pill.hosp {\n\
      background: rgba(181,62,62,.24) !important;\n\
      color: #ffd0d0 !important;\n\
    }\n\
    .warhub-pill.travel {\n\
      background: rgba(53,110,190,.24) !important;\n\
      color: #d5e7ff !important;\n\
    }\n\
    .warhub-pill.jail {\n\
      background: rgba(110,68,175,.24) !important;\n\
      color: #e5d8ff !important;\n\
    }\n\
    .warhub-pill.leader {\n\
      background: rgba(66,110,185,.24) !important;\n\
      color: #d3e3ff !important;\n\
    }\n\
    .warhub-pill.enabled {\n\
      background: rgba(35,140,82,.22) !important;\n\
      color: #b7ffd5 !important;\n\
    }\n\
    .warhub-pill.disabled {\n\
      background: rgba(145,37,37,.24) !important;\n\
      color: #ffd0d0 !important;\n\
    }\n\
    .warhub-pill.good {\n\
      background: rgba(34,197,94,.18) !important;\n\
      border-color: rgba(34,197,94,.45) !important;\n\
      color: #bbf7d0 !important;\n\
    }\n\
    .warhub-pill.bad {\n\
      background: rgba(239,68,68,.18) !important;\n\
      border-color: rgba(239,68,68,.45) !important;\n\
      color: #fecaca !important;\n\
    }\n\
    .warhub-pill.neutral {\n\
      background: rgba(148,163,184,.16) !important;\n\
      border-color: rgba(148,163,184,.35) !important;\n\
      color: #e2e8f0 !important;\n\
    }\n\
\n\
    .warhub-pos { color: #86efac !important; }\n\
    .warhub-neg { color: #fca5a5 !important; }\n\
\n\
    .warhub-divider {\n\
      height: 1px !important;\n\
      background: rgba(255,255,255,.07) !important;\n\
      margin: 8px 0 !important;\n\
    }\n\
    .warhub-mini {\n\
      font-size: 11px !important;\n\
      opacity: .78 !important;\n\
      color: #fff !important;\n\
    }\n\
    .warhub-link {\n\
      color: #fff !important;\n\
      text-decoration: none !important;\n\
    }\n\
\n\
    .warhub-section-scroll {\n\
      max-height: 52vh !important;\n\
      overflow-y: auto !important;\n\
      overflow-x: hidden !important;\n\
      -webkit-overflow-scrolling: touch !important;\n\
      padding-right: 2px !important;\n\
    }\n\
\n\
    .warhub-payment-line {\n\
      padding: 8px 10px !important;\n\
      border-radius: 10px !important;\n\
      background: rgba(255,255,255,.06) !important;\n\
      font-weight: 800 !important;\n\
      text-align: center !important;\n\
      margin-top: 8px !important;\n\
    }\n\
\n\
    @media (max-width: 700px) {\n\
      #warhub-overlay {\n\
        width: 98vw !important;\n\
        height: 88vh !important;\n\
        min-height: 360px !important;\n\
        top: 56px !important;\n\
        left: 1vw !important;\n\
        right: 1vw !important;\n\
        border-radius: 12px !important;\n\
      }\n\
      .warhub-grid.two, .warhub-grid.three { grid-template-columns: 1fr !important; }\n\
      .warhub-body { padding-bottom: 18px !important; }\n\
      #warhub-shield {\n\
        width: 40px !important;\n\
        height: 40px !important;\n\
        font-size: 21px !important;\n\
      }\n\
      .warhub-section-scroll { max-height: 34vh !important; }\n\
      .warhub-tabs {\n\
        min-height: 44px !important;\n\
        max-height: 44px !important;\n\
      }\n\
    }\n\
  ";

    GM_addStyle(css);

    // ============================================================
    // 06. BASIC UTILITIES
    // ============================================================

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
        return String(v || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .trim()
            .replace(/^['"]+|['"]+$/g, '')
            .trim();
    }

    // ============================================================
    // 07. LOCAL NOTIFICATIONS / STATUS
    // ============================================================

    function getLocalNotifications() {
        return arr(GM_getValue(K_LOCAL_NOTIFICATIONS, []));
    }

    function setLocalNotifications(v) {
        GM_setValue(K_LOCAL_NOTIFICATIONS, arr(v));
    }

    function mergedNotifications() {
        return [].concat(
            _toConsumableArray(arr(state && state.notifications)),
            _toConsumableArray(getLocalNotifications())
        ).slice(0, 50);
    }

    function unreadCount() {
        return mergedNotifications().length;
    }

    function setStatus(msg, isErr) {
        if (isErr === void 0) isErr = false;

        lastStatusMsg = String(msg || '');
        lastStatusErr = !!isErr;

        var box = overlay ? overlay.querySelector('#warhub-status') : null;
        if (!box) return;

        if (!msg) {
            box.className = 'warhub-status';
            box.textContent = '';
            return;
        }

        box.className = ("warhub-status show " + (isErr ? 'err' : '')).trim();
        box.textContent = msg;
    }

    function restoreStatus() {
        if (lastStatusMsg) setStatus(lastStatusMsg, lastStatusErr);
    }

    // ============================================================
    // 08. ACCESS CACHE / OWNER HELPERS
    // ============================================================

    function normalizeAccessCache(raw) {
        var a = raw && typeof raw === 'object' ? raw : {};
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

            return accessState.message || 'Read-only access. Your leader must enable you after trial starts, or faction renewal is required.';
        }

        if (accessState.trialActive) {
            if (accessState.isFactionLeader || isOwnerSession()) {
                if (accessState.daysLeft != null) {
                    return "Faction trial active. " + accessState.daysLeft + " day" + (accessState.daysLeft === 1 ? '' : 's') + " left. Members can see War Hub now, and you choose who gets full access.";
                }
                return 'Faction trial active. Members can see War Hub now, and you choose who gets full access.';
            }

            if (!accessState.memberEnabled && accessState.loggedIn) {
                return 'Faction trial is active, but you are read-only until your leader enables your access.';
            }

            if (accessState.memberEnabled) {
                return 'Your leader enabled your access for this faction cycle. Your access stays on until the next renewal/payment cycle.';
            }
        }

        if (accessState.loggedIn && !accessState.isFactionLeader && !accessState.memberEnabled && !accessState.canUseFeatures) {
            return 'Read-only access. Your leader must enable you before you can use shared faction tools.';
        }

        if (accessState.loggedIn && (accessState.isFactionLeader || isOwnerSession())) {
            return 'Leader access ready. Trial starts automatically the first time the faction leader logs in. Billing is ' + String(ppm) + ' Xanax per enabled member.';
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
        var d = payload && typeof payload === 'object' ? payload : {};
        var access = d.access && typeof d.access === 'object' ? d.access : {};
        var payment = d.payment && typeof d.payment === 'object' ? d.payment : {};
        var factionAccess = d.faction_access && typeof d.faction_access === 'object' ? d.faction_access : {};
        var memberAccess = d.member_access && typeof d.member_access === 'object' ? d.member_access : {};
        var license = d.license && typeof d.license === 'object' ? d.license : {};

        var paymentRequired =
            !!d.payment_required ||
            !!d.requires_payment ||
            !!d.paymentRequired ||
            !!access.payment_required ||
            !!access.requires_payment ||
            !!access.paymentRequired ||
            !!license.payment_required;

        var blocked =
            !!d.blocked ||
            !!d.access_blocked ||
            !!d.locked ||
            !!d.denied ||
            !!access.blocked ||
            !!access.access_blocked ||
            !!access.locked ||
            !!access.denied ||
            paymentRequired;

        var expiresAt =
            d.trial_expires_at ||
            d.trialEndsAt ||
            d.expires_at ||
            access.trial_expires_at ||
            access.trialEndsAt ||
            access.expires_at ||
            license.trial_expires_at ||
            license.expires_at ||
            '';

        var explicitDaysLeft =
            d.trial_days_left != null ? d.trial_days_left :
            d.days_left != null ? d.days_left :
            access.trial_days_left != null ? access.trial_days_left :
            access.days_left != null ? access.days_left :
            license.days_left != null ? license.days_left :
            null;

        var computedDaysLeft = explicitDaysLeft != null ? Number(explicitDaysLeft) : fmtDaysLeftFromIso(expiresAt);

        var trialExpired =
            !!d.trial_expired ||
            !!d.expired ||
            !!access.trial_expired ||
            !!access.expired ||
            !!license.trial_expired ||
            ((computedDaysLeft != null && computedDaysLeft < 0 && !paymentRequired) ? true : false);

        var trialActive =
            !!d.trial_active ||
            !!access.trial_active ||
            !!license.trial_active ||
            ((computedDaysLeft != null && computedDaysLeft >= 0 && !paymentRequired && !trialExpired) ? true : false);

        var accessStatus = String(
            d.access_status ||
            d.status ||
            access.status ||
            access.access_status ||
            license.status ||
            ''
        ).toLowerCase();

        var reason =
            d.reason ||
            d.block_reason ||
            d.error ||
            access.reason ||
            access.block_reason ||
            memberAccess.reason ||
            license.block_reason ||
            '';

        var message =
            d.message ||
            d.notice ||
            d.details ||
            access.message ||
            access.notice ||
            payment.message ||
            license.message ||
            '';

        var isOwner =
            !!d.is_owner ||
            !!(d.user && d.user.is_owner) ||
            !!(d.me && d.me.is_owner) ||
            !!(d.owner && d.owner.is_owner) ||
            !!factionAccess.is_owner;

        var isFactionLeader =
            !!d.is_faction_leader ||
            !!access.is_faction_leader ||
            !!factionAccess.is_faction_leader ||
            !!(d.me && d.me.is_faction_leader);

        var isUserExempt =
            !!access.is_user_exempt ||
            !!factionAccess.is_user_exempt ||
            !!license.viewer_is_exempt_user;

        var isFactionExempt =
            !!access.is_faction_exempt ||
            !!factionAccess.is_faction_exempt ||
            !!license.faction_exempt;

        var memberEnabled =
            !!memberAccess.enabled ||
            !!factionAccess.member_enabled ||
            !!access.member_enabled ||
            !!memberAccess.allowed;

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

        if (
            next.blocked ||
            next.paymentRequired ||
            next.trialExpired ||
            (next.loggedIn && !next.canUseFeatures && !next.isFactionLeader && !next.isOwner)
        ) {
            accessState = normalizeAccessCache(Object.assign({}, accessState, next));
            saveAccessCache();
            return accessState;
        }

        if (
            next.trialActive ||
            next.expiresAt ||
            next.daysLeft != null ||
            next.factionId ||
            next.isFactionLeader ||
            next.userId ||
            next.loggedIn
        ) {
            accessState = normalizeAccessCache(
                Object.assign({}, accessState, next, {
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
                })
            );
            saveAccessCache();
            return accessState;
        }

        if (loggedInHint === true) {
            accessState = normalizeAccessCache(Object.assign({}, accessState, {
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

     // ============================================================
    // 09. REQUEST / NETWORK HELPERS
    // ============================================================

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

    // ============================================================
    // 10. WAR PAIR / FACTION FALLBACK HELPERS
    // ============================================================

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

    // ============================================================
    // 11. AUTH / API REQUEST FLOW
    // ============================================================

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

            var res = yield req(method, path, body);

            if (!res.ok) {
                var backendMsg =
                    (res.data && (res.data.error || res.data.details || res.data.message)) ||
                    res.error ||
                    ("Admin request failed: " + method + " " + path);

                return {
                    ok: false,
                    status: res.status || 0,
                    data: res.data || null,
                    error: backendMsg
                };
            }

            return res;
        });
        return _adminReq.apply(this, arguments);
    }

    // ============================================================
    // 12. STATE NORMALIZATION
    // ============================================================

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

        if ((!enemyFactionId || !enemyFactionName) && enemies.length) {
            var inferredEnemyFactionId = '';
            var inferredEnemyFactionName = '';

            enemies.forEach(function (enemy) {
                if (inferredEnemyFactionId && inferredEnemyFactionName) return;

                var fid = String(
                    enemy.faction_id ||
                    enemy.enemy_faction_id ||
                    enemy.factionId ||
                    ''
                ).trim();

                var fname = String(
                    enemy.faction_name ||
                    enemy.enemy_faction_name ||
                    enemy.factionName ||
                    ''
                ).trim();

                if (fid && ownFactionId && fid === ownFactionId) return;
                if (fname && ownFactionName && fname.toLowerCase() === ownFactionName) return;

                if (!inferredEnemyFactionId && fid) inferredEnemyFactionId = fid;
                if (!inferredEnemyFactionName && fname) inferredEnemyFactionName = fname;
            });

            if (!enemyFactionId && inferredEnemyFactionId) enemyFactionId = inferredEnemyFactionId;
            if (!enemyFactionName && inferredEnemyFactionName) enemyFactionName = inferredEnemyFactionName;
        }

        if (enemyFactionId || enemyFactionName) {
            whSaveWarPairFallback({
                enemy_faction_id: enemyFactionId,
                enemy_faction_name: enemyFactionName
            });
        } else {
            var fallback = whLoadWarPairFallback() || {};
            enemyFactionId = enemyFactionId || fallback.enemy_faction_id || '';
            enemyFactionName = enemyFactionName || fallback.enemy_faction_name || '';
        }

        var enemyFaction = Object.assign({}, enemyFactionRaw, {
            faction_id: enemyFactionId || enemyFactionRaw.faction_id || enemyFactionRaw.id || '',
            id: enemyFactionId || enemyFactionRaw.id || enemyFactionRaw.faction_id || '',
            name: enemyFactionName || enemyFactionRaw.name || ''
        });

        return {
            me: me,
            user: s.user || me,
            war: war,
            score: s.score || {},
            faction: faction,
            our_faction: s.our_faction || faction,
            enemy_faction: enemyFaction,
            enemy_faction_id: enemyFaction.faction_id || '',
            enemy_faction_name: enemyFaction.name || '',
            members: members,
            enemies: enemies,
            med_deals: medDeals,
            dibs: dibs,
            notifications: notifications,
            bounties: bounties,
            targets: targets,
            med_deals_message: medDealsMessage,
            war_terms: terms,
            stats: s.stats || {},
            debug: s.debug || {}
        };
    }

     // ============================================================
    // 13. OVERVIEW / MEMBER / PAYMENT HELPERS
    // ============================================================

    function getOverviewBoxPrefs() {
        var raw = GM_getValue(K_OVERVIEW_BOXES, null);
        var out = raw && typeof raw === 'object' ? raw : {};
        return {
            medDeals: out.medDeals !== false,
            dibs: out.dibs !== false,
            notifications: out.notifications !== false,
            bounties: out.bounties !== false
        };
    }

    function setOverviewBoxPref(key, value) {
        var prefs = getOverviewBoxPrefs();
        prefs[key] = !!value;
        GM_setValue(K_OVERVIEW_BOXES, prefs);
    }

    function splitRosterGroups(list) {
        var groups = {
            online: [],
            offline: [],
            hospital: [],
            travel: [],
            jail: [],
            idle: []
        };

        arr(list).forEach(function (m) {
            var status = String(
                m.status ||
                m.state ||
                m.presence ||
                ''
            ).toLowerCase();

            var online = !!m.online || status.indexOf('online') >= 0;
            var hosp = !!m.hospital || status.indexOf('hospital') >= 0 || status.indexOf('hosp') >= 0;
            var travel = !!m.traveling || !!m.abroad || status.indexOf('travel') >= 0 || status.indexOf('abroad') >= 0;
            var jail = !!m.jail || !!m.jailed || status.indexOf('jail') >= 0;
            var idle = !!m.idle || status.indexOf('idle') >= 0 || status.indexOf('away') >= 0;

            if (hosp) groups.hospital.push(m);
            else if (travel) groups.travel.push(m);
            else if (jail) groups.jail.push(m);
            else if (online) groups.online.push(m);
            else if (idle) groups.idle.push(m);
            else groups.offline.push(m);
        });

        return groups;
    }

    function memberStatusPill(m) {
        var status = String(
            m.status ||
            m.state ||
            m.presence ||
            ''
        ).toLowerCase();

        if (m.hospital || status.indexOf('hospital') >= 0 || status.indexOf('hosp') >= 0) {
            return '<span class="warhub-pill hosp">Hospital</span>';
        }
        if (m.traveling || m.abroad || status.indexOf('travel') >= 0 || status.indexOf('abroad') >= 0) {
            return '<span class="warhub-pill travel">Travel</span>';
        }
        if (m.jail || m.jailed || status.indexOf('jail') >= 0) {
            return '<span class="warhub-pill jail">Jail</span>';
        }
        if (m.online || status.indexOf('online') >= 0) {
            return '<span class="warhub-pill online">Online</span>';
        }
        if (m.idle || status.indexOf('idle') >= 0 || status.indexOf('away') >= 0) {
            return '<span class="warhub-pill idle">Idle</span>';
        }
        return '<span class="warhub-pill offline">Offline</span>';
    }

    function rosterCard(title, list, opts) {
        opts = opts || {};
        var extraClass = opts.extraClass || '';
        var body = arr(list).length ? arr(list).map(function (m) {
            var memberId = String(m.user_id || m.id || m.player_id || '').trim();
            var memberName = String(m.name || m.member_name || ('ID ' + memberId));
            var memberRole = String(m.position || m.faction_position || m.role || '');
            var statusPill = memberStatusPill(m);

            var meta = [];
            if (memberId) meta.push('ID ' + memberId);
            if (memberRole) meta.push(memberRole);
            if (m.last_action) meta.push('Last: ' + m.last_action);
            if (m.hospital_reason) meta.push(m.hospital_reason);

            return '\
              <div class="warhub-row ' + esc(extraClass) + '">\
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">\
                  <div style="min-width:0;flex:1;">\
                    <div class="warhub-name">' + esc(memberName) + '</div>\
                    <div class="warhub-meta">' + esc(meta.filter(Boolean).join(' • ')) + '</div>\
                  </div>\
                  <div>' + statusPill + '</div>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No members found.</div>';

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>' + esc(title) + '</h3>\
              <span class="warhub-count">' + fmtNum(arr(list).length) + '</span>\
            </div>\
            <div class="warhub-list">' + body + '</div>\
          </div>';
    }

    function rosterDropdown(title, list, opts) {
        opts = opts || {};
        var open = !!opts.open;
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>' + esc(title) + '</h3>\
              <span class="warhub-count">' + fmtNum(arr(list).length) + '</span>\
            </div>\
            ' + (open ? '<div class="warhub-list">' + arr(list).map(function (m) {
                var memberId = String(m.user_id || m.id || m.player_id || '').trim();
                var memberName = String(m.name || m.member_name || ('ID ' + memberId));
                return '<div class="warhub-row"><div class="warhub-name">' + esc(memberName) + '</div><div class="warhub-meta">' + esc(memberId ? ('ID ' + memberId) : '') + '</div></div>';
            }).join('') + '</div>' : '<div class="warhub-empty">Collapsed.</div>') + '\
          </div>';
    }

    function normalizePaymentPayload(res) {
        var data = (res && (res.data || res.payment || res.payload)) || res || {};
        return data && typeof data === 'object' ? data : {};
    }

    function normalizePaymentItems(res) {
        var data = normalizePaymentPayload(res);
        return arr(data.items || data.rows || data.history || []);
    }

    function normalizeDueItems(res) {
        var data = normalizePaymentPayload(res);
        return arr(data.items || data.due_items || []);
    }

    function normalizePendingItems(res) {
        var data = normalizePaymentPayload(res);
        return arr(data.items || data.pending_items || []);
    }

    var factionPaymentCache = null;
    var factionPaymentHistoryCache = [];
    var currentBillingCycleCache = null;

    var adminPaymentDueCache = [];
    var adminPaymentPendingCache = [];
    var adminPaymentHistoryCache = [];

    function getFactionPaymentSummary() {
        var payload = factionPaymentCache || {};
        var license = payload.license || {};
        var cycle = currentBillingCycleCache || {};

        return {
            factionId: payload.faction_id || '',
            factionName: (license && (license.faction_name || license.name)) || '',
            renewalCost: Number(payload.renewal_cost != null ? payload.renewal_cost : (license && license.renewal_cost) || 0) || 0,
            enabledMemberCount: Number(payload.enabled_member_count != null ? payload.enabled_member_count : (license && license.enabled_member_count) || 0) || 0,
            paymentInstruction: payload.payment_instruction || '',
            paymentKind: payload.payment_kind || 'xanax',
            paymentPlayer: payload.payment_player || 'Fries91',
            paymentNotifyUserId: payload.payment_notify_user_id || '3679030',
            status: (license && (license.status || '')) || '',
            paymentRequired: !!(license && license.payment_required),
            trialActive: !!(license && license.trial_active),
            trialExpired: !!(license && license.trial_expired),
            paidUntil: (license && (license.paid_until || license.paid_until_at || '')) || '',
            cycleStatus: cycle.status || '',
            cycleStart: cycle.cycle_start_at || cycle.start_at || '',
            cycleEnd: cycle.cycle_end_at || cycle.end_at || '',
            cycleAmountDue: Number(cycle.amount_due != null ? cycle.amount_due : 0) || 0
        };
    }

    // ============================================================
    // 14. DATA LOADERS
    // ============================================================

    function loadState() {
        return _loadState.apply(this, arguments);
    }

    function _loadState() {
        _loadState = _asyncToGenerator(function* () {
            if (loadInFlight) return state;
            loadInFlight = true;

            try {
                if (!cleanInputValue(GM_getValue(K_SESSION, ''))) {
                    var okLogin = yield login(false);
                    if (!okLogin) {
                        renderBody();
                        return state;
                    }
                }

                var res = yield req('GET', '/api/state');
                if (!res.ok) {
                    if ((accessState === null || accessState === void 0 ? void 0 : accessState.blocked) || (accessState === null || accessState === void 0 ? void 0 : accessState.paymentRequired) || (accessState === null || accessState === void 0 ? void 0 : accessState.trialExpired)) {
                        setStatus(accessSummaryMessage() || 'Faction access blocked.', true);
                    } else {
                        setStatus(res.error || 'Could not load state.', true);
                    }
                    renderBody();
                    return state;
                }

                state = normalizeState(res.data || {});
                updateAccessFromPayload(res.data, res.status, true);
                restoreStatus();
                updateBadge();
                renderBody();
                return state;
            } finally {
                loadInFlight = false;
            }
        });
        return _loadState.apply(this, arguments);
    }

    function loadFactionMembersAdmin() {
        return _loadFactionMembersAdmin.apply(this, arguments);
    }

    function _loadFactionMembersAdmin() {
        _loadFactionMembersAdmin = _asyncToGenerator(function* () {
            var res = yield req('GET', '/api/faction/members');
            if (!res.ok) {
                factionMembersCache = {
                    items: [],
                    members: []
                };
                return factionMembersCache;
            }

            var data = normalizePaymentPayload(res);
            var items = arr(data.items || data.members || []);
            factionMembersCache = {
                items: items,
                members: items
            };
            return factionMembersCache;
        });
        return _loadFactionMembersAdmin.apply(this, arguments);
    }

    function loadFactionPaymentStatus() {
        return _asyncToGenerator(function* () {
            var res = yield doAction('GET', '/api/faction/payment/status', null, '', false);
            if (res) factionPaymentCache = normalizePaymentPayload(res);
            return factionPaymentCache;
        })();
    }

    function loadFactionPaymentHistory() {
        return _asyncToGenerator(function* () {
            var res = yield doAction('GET', '/api/faction/payment/history', null, '', false);
            factionPaymentHistoryCache = normalizePaymentItems(res);
            return factionPaymentHistoryCache;
        })();
    }

    function loadCurrentBillingCycle() {
        return _asyncToGenerator(function* () {
            var res = yield doAction('GET', '/api/faction/payment/current-cycle', null, '', false);
            currentBillingCycleCache = normalizePaymentPayload(res);
            return currentBillingCycleCache;
        })();
    }

    function refreshFactionPaymentData() {
        return _asyncToGenerator(function* () {
            yield loadFactionPaymentStatus();
            yield loadFactionPaymentHistory();
            yield loadCurrentBillingCycle();
            renderBody();
        })();
    }

    function loadAdminPaymentDue() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/admin/faction-payments/due');
            if (!res.ok) {
                setStatus(res.error || 'Could not load due factions.', true);
                return [];
            }
            adminPaymentDueCache = normalizeDueItems(res);
            return adminPaymentDueCache;
        })();
    }

    function loadAdminPaymentPending() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/admin/faction-payments/pending');
            if (!res.ok) {
                setStatus(res.error || 'Could not load pending payment requests.', true);
                return [];
            }
            adminPaymentPendingCache = normalizePendingItems(res);
            return adminPaymentPendingCache;
        })();
    }

    function loadAdminPaymentHistory() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/admin/faction-payments/history');
            if (!res.ok) {
                setStatus(res.error || 'Could not load payment history.', true);
                return [];
            }
            adminPaymentHistoryCache = normalizePaymentItems(res);
            return adminPaymentHistoryCache;
        })();
    }

    function loadAdminPayments() {
        return _asyncToGenerator(function* () {
            yield loadAdminPaymentDue();
            yield loadAdminPaymentPending();
            yield loadAdminPaymentHistory();
            renderBody();
        })();
    }

    function refreshLeaderFactionData() {
        return _refreshLeaderFactionData.apply(this, arguments);
    }

    function _refreshLeaderFactionData() {
        _refreshLeaderFactionData = _asyncToGenerator(function* () {
            yield loadState();
            yield loadFactionMembersAdmin();
            yield refreshFactionPaymentData();
            renderBody();
        });
        return _refreshLeaderFactionData.apply(this, arguments);
    }

    function loadAdminDashboard() {
        return _loadAdminDashboard.apply(this, arguments);
    }

    function _loadAdminDashboard() {
        _loadAdminDashboard = _asyncToGenerator(function* () {
            yield loadAdminPayments();
            renderBody();
        });
        return _loadAdminDashboard.apply(this, arguments);
    }

    // ============================================================
    // 15. ACTION HELPERS
    // ============================================================

    function doAction(method, path, body, successMsg, showOk) {
        return _doAction.apply(this, arguments);
    }

    function _doAction() {
        _doAction = _asyncToGenerator(function* (method, path, body, successMsg, showOk) {
            if (showOk === void 0) showOk = true;

            if (!ensureAllowedOrMessage()) return null;

            var res = yield req(method, path, body);
            if (!res.ok) {
                setStatus(res.error || 'Action failed.', true);
                return null;
            }

            if (successMsg && showOk) setStatus(successMsg);
            return res.data || res;
        });
        return _doAction.apply(this, arguments);
    }

    function logout() {
        return _logout.apply(this, arguments);
    }

    function _logout() {
        _logout = _asyncToGenerator(function* () {
            try {
                yield req('POST', '/api/logout', {});
            } catch (e) {}

            GM_deleteValue(K_SESSION);
            accessState = normalizeAccessCache({
                loggedIn: false
            });
            saveAccessCache();
            state = null;
            factionMembersCache = null;
            factionPaymentCache = null;
            factionPaymentHistoryCache = [];
            currentBillingCycleCache = null;
            adminPaymentDueCache = [];
            adminPaymentPendingCache = [];
            adminPaymentHistoryCache = [];
            setStatus('Logged out.');
            updateBadge();
            renderBody();
        });
        return _logout.apply(this, arguments);
    }

     // ============================================================
    // 16. OVERLAY POSITION / MOUNT HELPERS
    // ============================================================

    function clampToViewport(el) {
        if (!el) return;

        var rect = el.getBoundingClientRect();
        var margin = 8;

        var left = rect.left;
        var top = rect.top;

        if (rect.width > window.innerWidth - margin * 2) {
            left = margin;
        } else {
            if (rect.left < margin) left = margin;
            if (rect.right > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - rect.width - margin);
        }

        if (rect.height > window.innerHeight - margin * 2) {
            top = margin;
        } else {
            if (rect.top < margin) top = margin;
            if (rect.bottom > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - rect.height - margin);
        }

        el.style.left = "".concat(Math.round(left), "px");
        el.style.top = "".concat(Math.round(top), "px");
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }

    function saveShieldPos() {
        if (!shield) return;
        var rect = shield.getBoundingClientRect();
        GM_setValue(K_SHIELD_POS, {
            left: Math.round(rect.left),
            top: Math.round(rect.top)
        });
    }

    function resetShieldPosition() {
        if (!shield) return;
        shield.style.left = 'auto';
        shield.style.top = '120px';
        shield.style.right = '14px';
        shield.style.bottom = 'auto';
    }

    function saveOverlayPos() {
        if (!overlay) return;
        var rect = overlay.getBoundingClientRect();
        GM_setValue(K_OVERLAY_POS, {
            left: Math.round(rect.left),
            top: Math.round(rect.top)
        });
    }

    function saveOverlayScroll() {
        if (!overlay) return;
        var body = overlay.querySelector('.warhub-body');
        if (!body) return;
        GM_setValue(K_OVERLAY_SCROLL, Number(body.scrollTop || 0) || 0);
    }

    function restoreOverlayScroll() {
        if (!overlay) return;
        var body = overlay.querySelector('.warhub-body');
        if (!body) return;
        var saved = Number(GM_getValue(K_OVERLAY_SCROLL, 0)) || 0;
        body.scrollTop = saved;
    }

    function openOverlay() {
        isOpen = true;
        GM_setValue(K_OPEN, true);
        if (overlay) overlay.classList.add('open');
        restoreStatus();
        restoreOverlayScroll();
        renderBody();
    }

    function closeOverlay() {
        isOpen = false;
        GM_setValue(K_OPEN, false);
        saveOverlayScroll();
        if (overlay) overlay.classList.remove('open');
    }

    function updateBadge() {
        if (!badge || !shield) return;

        var count = unreadCount();
        if (!count) {
            badge.style.display = 'none';
            return;
        }

        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'block';

        var r = shield.getBoundingClientRect();
        badge.style.left = "".concat(Math.round(r.right - 8), "px");
        badge.style.top = "".concat(Math.round(r.top - 6), "px");
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

        var savedOverlay = GM_getValue(K_OVERLAY_POS, null);
        if (
            savedOverlay &&
            typeof savedOverlay === 'object' &&
            typeof savedOverlay.left === 'number' &&
            typeof savedOverlay.top === 'number'
        ) {
            overlay.style.left = "".concat(savedOverlay.left, "px");
            overlay.style.top = "".concat(savedOverlay.top, "px");
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
        }

        var savedShield = GM_getValue(K_SHIELD_POS, null);
        if (
            savedShield &&
            typeof savedShield === 'object' &&
            typeof savedShield.left === 'number' &&
            typeof savedShield.top === 'number'
        ) {
            shield.style.left = "".concat(savedShield.left, "px");
            shield.style.top = "".concat(savedShield.top, "px");
            shield.style.right = 'auto';
            shield.style.bottom = 'auto';
            clampToViewport(shield);
            saveShieldPos();
        }

        if (isOpen) overlay.classList.add('open');

        bindShieldEvents();
        bindOverlayDrag();
        bindOverlayEvents();
        renderBody();
        updateBadge();

        if (cleanInputValue(GM_getValue(K_SESSION, ''))) {
            loadState();
        }
    }

    function unmount() {
        mounted = false;
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (remountTimer) {
            clearTimeout(remountTimer);
            remountTimer = null;
        }
        if (shield && shield.parentNode) shield.parentNode.removeChild(shield);
        if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        shield = null;
        badge = null;
        overlay = null;
    }

    function scheduleRemount() {
        if (remountTimer) clearTimeout(remountTimer);
        remountTimer = setTimeout(function () {
            if (!document.body) return scheduleRemount();
            if (!shield || !document.body.contains(shield) || !overlay || !document.body.contains(overlay)) {
                try {
                    unmount();
                } catch (e) {}
                mount();
            }
        }, 1200);
    }

    // ============================================================
    // 17. SHIELD / OVERLAY DRAG EVENTS
    // ============================================================

    function bindShieldEvents() {
        if (!shield) return;

        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;
        var moved = false;

        function onMove(ev) {
            var point = ev.touches ? ev.touches[0] : ev;
            if (!point) return;

            var dx = point.clientX - startX;
            var dy = point.clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

            shield.style.left = "".concat(Math.round(startLeft + dx), "px");
            shield.style.top = "".concat(Math.round(startTop + dy), "px");
            shield.style.right = 'auto';
            shield.style.bottom = 'auto';
            updateBadge();
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.removeEventListener('touchmove', onMove, true);
            document.removeEventListener('touchend', onUp, true);

            shield.classList.remove('dragging');
            clampToViewport(shield);
            saveShieldPos();
            updateBadge();
            dragMoved = moved;
        }

        function onDown(ev) {
            var point = ev.touches ? ev.touches[0] : ev;
            if (!point) return;

            dragMoved = false;
            moved = false;
            shield.classList.add('dragging');

            var rect = shield.getBoundingClientRect();
            startX = point.clientX;
            startY = point.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
            document.addEventListener('touchmove', onMove, true);
            document.addEventListener('touchend', onUp, true);
        }

        shield.addEventListener('mousedown', onDown, true);
        shield.addEventListener('touchstart', onDown, {
            passive: true,
            capture: true
        });

        shield.addEventListener('click', function () {
            if (dragMoved) {
                dragMoved = false;
                return;
            }
            if (isOpen) closeOverlay();
            else openOverlay();
        }, true);
    }

    function bindOverlayDrag() {
        if (!overlay) return;

        var head = null;
        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;

        function onMove(ev) {
            var point = ev.touches ? ev.touches[0] : ev;
            if (!point || !overlay) return;

            var dx = point.clientX - startX;
            var dy = point.clientY - startY;

            overlay.style.left = "".concat(Math.round(startLeft + dx), "px");
            overlay.style.top = "".concat(Math.round(startTop + dy), "px");
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.removeEventListener('touchmove', onMove, true);
            document.removeEventListener('touchend', onUp, true);

            if (head) head.classList.remove('dragging');
            clampToViewport(overlay);
            saveOverlayPos();
        }

        function bindHead() {
            head = overlay ? overlay.querySelector('.warhub-head') : null;
            if (!head || head.__warhubDragBound) return;
            head.__warhubDragBound = true;

            function onDown(ev) {
                if (!overlay) return;
                var point = ev.touches ? ev.touches[0] : ev;
                if (!point) return;

                var target = ev.target;
                if (target && (target.closest('.warhub-close') || target.closest('.warhub-tab') || target.closest('button') || target.closest('input') || target.closest('select') || target.closest('textarea'))) {
                    return;
                }

                head.classList.add('dragging');

                var rect = overlay.getBoundingClientRect();
                startX = point.clientX;
                startY = point.clientY;
                startLeft = rect.left;
                startTop = rect.top;

                document.addEventListener('mousemove', onMove, true);
                document.addEventListener('mouseup', onUp, true);
                document.addEventListener('touchmove', onMove, true);
                document.addEventListener('touchend', onUp, true);
            }

            head.addEventListener('mousedown', onDown, true);
            head.addEventListener('touchstart', onDown, {
                passive: true,
                capture: true
            });
        }

        bindHead();

        var mo = new MutationObserver(function () {
            bindHead();
        });
        mo.observe(overlay, {
            childList: true,
            subtree: true
        });
    }

    // ============================================================
    // 18. TAB VISIBILITY HELPERS
    // ============================================================

    function isTabVisible(tab) {
        if (tab === 'admin') return isOwnerSession();
        if (tab === 'faction') return !!((accessState && accessState.isFactionLeader) || isOwnerSession());
        return true;
    }

    function tabLocked(tab) {
        if (tab === 'admin') return !isOwnerSession();
        if (tab === 'faction') return !((accessState && accessState.isFactionLeader) || isOwnerSession());
        if (tab === 'settings' || tab === 'instructions' || tab === 'terms') return false;
        return !canUseProtectedFeatures();
    }

    function visibleTabs() {
        return TAB_ORDER.filter(function (t) {
            return isTabVisible(t[0]);
        });
    }

    function ensureValidCurrentTab() {
        var tabs = visibleTabs().map(function (x) {
            return x[0];
        });
        if (tabs.indexOf(currentTab) === -1) currentTab = tabs[0] || 'overview';
    }

    function renderTabs() {
        ensureValidCurrentTab();

        return visibleTabs().map(function (pair) {
            var key = pair[0];
            var label = pair[1];
            var active = currentTab === key;
            var locked = tabLocked(key);

            return '<button class="warhub-tab ' + (active ? 'active ' : '') + (locked ? 'locked' : '') + '" data-tab="' + esc(key) + '">' + esc(label) + (locked ? ' 🔒' : '') + '</button>';
        }).join('');
    }

    function renderHeader() {
        var title = 'War Hub ⚔️';
        var sub = accessSummaryMessage() || 'Faction tools, war info, and shared coordination.';

        return '\
          <div class="warhub-head">\
            <div class="warhub-toprow">\
              <div>\
                <div class="warhub-title">' + esc(title) + '</div>\
                <div class="warhub-sub">' + esc(sub) + '</div>\
              </div>\
              <button class="warhub-close" id="warhub-close-btn">Close</button>\
            </div>\
          </div>\
          <div class="warhub-tabs">' + renderTabs() + '</div>\
          <div class="warhub-body">\
            <div id="warhub-status" class="warhub-status"></div>\
            <div id="warhub-content"></div>\
          </div>';
    }

     // ============================================================
    // 19. TAB RENDERERS
    // ============================================================

    function renderAccessBanner() {
        var msg = accessSummaryMessage();
        if (!msg) return '';

        var cls =
            (accessState && accessState.paymentRequired) ||
            (accessState && accessState.blocked) ||
            (accessState && accessState.trialExpired)
                ? 'bad'
                : (accessState && accessState.trialActive)
                    ? 'neutral'
                    : 'good';

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Faction Access</h3>\
              <span class="warhub-pill ' + cls + '">' + esc((accessState && accessState.status) || 'info') + '</span>\
            </div>\
            <div class="warhub-mini" style="line-height:1.5;">' + esc(msg) + '</div>\
          </div>';
    }

    function renderOverviewTab() {
        if (!state) {
            return renderAccessBanner() + '\
              <div class="warhub-card">\
                <div class="warhub-empty">Loading overview...</div>\
              </div>';
        }

        var prefs = getOverviewBoxPrefs();
        var deals = arr((state && (state.medDeals || state.med_deals)) || []);
        var allDibs = arr((state && state.dibs) || []);
        var notices = mergedNotifications();
        var bounties = arr((state && state.bounties) || []);
        var war = (state && state.war) || {};
        var our = (state && (state.faction || state.our_faction)) || {};
        var enemy = (state && (state.enemy_faction || state.enemyFaction)) || {};
        var members = arr((state && state.members) || []);
        var enemies = arr((state && state.enemies) || []);
        var scoreUs = Number(war.score_us != null ? war.score_us : war.our_score) || 0;
        var scoreThem = Number(war.score_them != null ? war.score_them : war.enemy_score) || 0;
        var chainUs = Number(war.chain_us != null ? war.chain_us : war.our_chain) || 0;
        var chainThem = Number(war.chain_them != null ? war.chain_them : war.enemy_chain) || 0;
        var net = scoreUs - scoreThem;
        var prefsHtml = '\
          <div class="warhub-actions" style="margin-top:8px;">\
            <button class="warhub-btn small" data-toggle-overview="medDeals">' + (prefs.medDeals ? 'Hide' : 'Show') + ' Med Deals</button>\
            <button class="warhub-btn small" data-toggle-overview="dibs">' + (prefs.dibs ? 'Hide' : 'Show') + ' Dibs</button>\
            <button class="warhub-btn small" data-toggle-overview="notifications">' + (prefs.notifications ? 'Hide' : 'Show') + ' Notifications</button>\
            <button class="warhub-btn small" data-toggle-overview="bounties">' + (prefs.bounties ? 'Hide' : 'Show') + ' Bounties</button>\
          </div>';

        var dealsHtml = prefs.medDeals ? '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Med Deals</h3>\
              <span class="warhub-count">' + fmtNum(deals.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                deals.length ? deals.slice(0, 8).map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.name || x.member_name || x.user_name || 'Unknown') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.kind || x.type || '',
                            x.note || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No med deals.</div>'
            ) + '</div>\
          </div>' : '';

        var dibsHtml = prefs.dibs ? '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Dibs</h3>\
              <span class="warhub-count">' + fmtNum(allDibs.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                allDibs.length ? allDibs.slice(0, 8).map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.target_name || x.name || 'Target') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.claimed_by_name || x.user_name || '',
                            x.note || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No dibs.</div>'
            ) + '</div>\
          </div>' : '';

        var noticesHtml = prefs.notifications ? '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Notifications</h3>\
              <span class="warhub-count">' + fmtNum(notices.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                notices.length ? notices.slice(0, 8).map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.title || x.kind || 'Notice') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.message || x.text || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No notifications.</div>'
            ) + '</div>\
          </div>' : '';

        var bountiesHtml = prefs.bounties ? '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Bounties</h3>\
              <span class="warhub-count">' + fmtNum(bounties.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                bounties.length ? bounties.slice(0, 8).map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.target_name || x.name || 'Bounty') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.amount != null ? ('$' + fmtNum(x.amount)) : '',
                            x.note || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No bounties.</div>'
            ) + '</div>\
          </div>' : '';

        return '' +
            renderAccessBanner() +
            '\
            <div class="warhub-card">\
              <div class="warhub-section-title">\
                <h3>Overview</h3>\
                <span class="warhub-pill ' + (war.active ? 'good' : 'neutral') + '">' + esc(war.active ? 'Active War' : 'No War') + '</span>\
              </div>\
              <div class="warhub-grid three">\
                <div class="warhub-metric">\
                  <div class="k">Our Faction</div>\
                  <div class="v">' + esc(our.name || '—') + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Enemy Faction</div>\
                  <div class="v">' + esc(enemy.name || state.enemy_faction_name || '—') + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Net Score</div>\
                  <div class="v">' + netPill(net, '') + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Score Us</div>\
                  <div class="v">' + fmtNum(scoreUs) + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Score Them</div>\
                  <div class="v">' + fmtNum(scoreThem) + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Members / Enemies</div>\
                  <div class="v">' + fmtNum(members.length) + ' / ' + fmtNum(enemies.length) + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Chain Us</div>\
                  <div class="v">' + fmtNum(chainUs) + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Chain Them</div>\
                  <div class="v">' + fmtNum(chainThem) + '</div>\
                </div>\
                <div class="warhub-metric">\
                  <div class="k">Unread</div>\
                  <div class="v">' + fmtNum(unreadCount()) + '</div>\
                </div>\
              </div>\
              ' + prefsHtml + '\
            </div>\
            ' + dealsHtml + dibsHtml + noticesHtml + bountiesHtml;
    }

    function renderInstructionsTab() {
        var banner = accessSummaryMessage()
            ? "<div class=\"warhub-card\"><div class=\"warhub-section-title\"><h3>Faction Access</h3><span class=\"warhub-pill " + (((accessState && accessState.paymentRequired) || (accessState && accessState.blocked) || (accessState && accessState.trialExpired)) ? 'bad' : ((accessState && accessState.trialActive) ? 'neutral' : 'good')) + "\">" + esc((accessState && accessState.status) || 'info') + "</span></div><div class=\"warhub-mini\" style=\"margin-top:6px;line-height:1.5;\">" + esc(accessSummaryMessage()) + "</div></div>"
            : '';

        return "\
          " + banner + "\
          <div class=\"warhub-card\">\
            <h3>Getting Started</h3>\
            <div class=\"warhub-list\">\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">1. Save your API key</div>\
                <div class=\"warhub-meta\">Open Settings, paste your personal Torn API key, then press Save Keys.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">2. Login to War Hub</div>\
                <div class=\"warhub-meta\">Press Login in Settings. War Hub will load your faction, war state, members, and enemies.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">3. Set your war status</div>\
                <div class=\"warhub-meta\">Use the Chain tab to mark yourself Available or Unavailable and to switch Chain Sitter on or off.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">4. Use the faction tabs</div>\
                <div class=\"warhub-meta\">Members, Enemies, Hospital, Med Deals, Targets, and War Summary all pull from the backend once your access is enabled.</div>\
              </div>\
            </div>\
          </div>\
          <div class=\"warhub-card\">\
            <h3>Terms of Service</h3>\
            <div class=\"warhub-list\">\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">Use at your own risk</div>\
                <div class=\"warhub-meta\">War Hub is a private Torn utility. You are responsible for how you use the data, links, and shared tools.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">Access is role-based</div>\
                <div class=\"warhub-meta\">Leader-only and admin-only tabs stay locked unless your role allows them. Exempt players still do not get Admin or leader tabs.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">Service can change</div>\
                <div class=\"warhub-meta\">Torn API limits, browser caching, PDA behavior, or backend restarts can affect refresh speed and available features.</div>\
              </div>\
            </div>\
          </div>\
          <div class=\"warhub-card\">\
            <h3>API Key Storage</h3>\
            <div class=\"warhub-list\">\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">Saved in local userscript storage</div>\
                <div class=\"warhub-meta\">Your API key is stored on your device in Tampermonkey/PDA script storage so the overlay can log you in.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">Used by your backend only</div>\
                <div class=\"warhub-meta\">The script sends the key to your War Hub backend for login and Torn API requests. Do not share your key with anyone you do not trust.</div>\
              </div>\
              <div class=\"warhub-list-item\">\
                <div class=\"warhub-name\">You can change it anytime</div>\
                <div class=\"warhub-meta\">Open Settings to save a new key, or use Logout to clear the active session.</div>\
              </div>\
            </div>\
          </div>";
    }

    function renderFactionTab() {
        var faction =
            (state && (state.faction || state.ourFaction || state.our_faction)) ||
            {};
        var members = arr((state && state.members) || []);
        var factionName = String((faction && faction.name) || ((state && state.user) && state.user.faction_name) || 'Your Faction');
        var leaderAccess = !!((accessState && accessState.isFactionLeader) || isOwnerSession());

        var memberAccessRows = arr(((typeof factionMembersCache !== 'undefined' && factionMembersCache) && (factionMembersCache.members || factionMembersCache.items)) || []);
        var accessMap = {};
        memberAccessRows.forEach(function (x) {
            var id = String(x.member_user_id || x.user_id || x.id || '').trim();
            if (id) accessMap[id] = x || {};
        });

        var enabledCount = memberAccessRows.filter(function (x) {
            return !!(x && (x.member_enabled || x.enabled));
        }).length;

        var totalXanaxOwed = memberAccessRows.reduce(function (sum, x) {
            return sum + (Number(x && (x.xanax_owed != null ? x.xanax_owed : ((x.member_enabled || x.enabled) ? 3 : 0))) || 0);
        }, 0);

        var accessRowsHtml = '';
        if (leaderAccess) {
            accessRowsHtml = members.length ? members.map(function (m) {
                var memberId = String(m.user_id || m.id || m.player_id || '').trim();
                var liveName = String(m.name || m.member_name || ('ID ' + memberId));
                var position = String(m.position || m.faction_position || m.role || '');
                var saved = accessMap[memberId] || {};
                var enabled = !!(saved.member_enabled || saved.enabled);
                var cycleLocked = !!(saved.cycle_locked || saved.locked_until_renewal);
                var xanaxOwed = Number(saved.xanax_owed != null ? saved.xanax_owed : (enabled ? 3 : 0)) || 0;
                var activatedAt = saved.activated_at || '';
                var lastRenewedAt = saved.last_renewed_at || '';
                var hasSavedRow = !!Object.keys(saved).length;

                var statusPill = enabled
                    ? '<span class="warhub-pill enabled">Active</span>'
                    : '<span class="warhub-pill disabled">Inactive</span>';

                var lockLine = cycleLocked
                    ? '<div class="warhub-mini" style="margin-top:4px;color:#f6c244;">Locked until next paid renewal.</div>'
                    : '';

                var metaBits = [
                    position || '',
                    'Xanax owed: ' + xanaxOwed
                ];

                if (activatedAt) metaBits.push('Activated: ' + fmtTs(activatedAt));
                if (lastRenewedAt) metaBits.push('Renewed: ' + fmtTs(lastRenewedAt));

                var actionHtml = '';

                if (!enabled) {
                    actionHtml += '<button class="warhub-btn primary small" data-add-faction-member="' + esc(memberId) + '" data-member-name="' + esc(liveName) + '" data-member-position="' + esc(position) + '">Activate</button>';
                }

                if (hasSavedRow && !cycleLocked) {
                    actionHtml += '<button class="warhub-btn warn small" data-del-member="' + esc(memberId) + '" data-cycle-locked="0">Delete</button>';
                } else if (cycleLocked) {
                    actionHtml += '<span class="warhub-mini">Delete disabled this cycle</span>';
                }

                return '\
                  <div class="warhub-row">\
                    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">\
                      <div style="min-width:0;flex:1;">\
                        <div style="font-weight:700;">' + esc(liveName) + '</div>\
                        <div class="warhub-mini">' + esc(metaBits.filter(Boolean).join(' • ')) + '</div>\
                        ' + lockLine + '\
                      </div>\
                      <div>' + statusPill + '</div>\
                    </div>\
                    <div class="warhub-actions" style="margin-top:8px;">' + actionHtml + '</div>\
                  </div>';
            }).join('') : '<div class="warhub-empty">No faction members found.</div>';
        }

        var paymentCard = '';
        if (leaderAccess) {
            var p = getFactionPaymentSummary();
            var paymentHistory = arr(factionPaymentHistoryCache || []).slice(0, 5);
            var historyHtml = paymentHistory.length
                ? paymentHistory.map(function (x) {
                    var amount = x.amount != null ? fmtNum(x.amount) : '—';
                    var when = fmtTs(x.created_at || x.ts || x.time || x.payment_at || '');
                    var by = x.renewed_by || x.created_by || x.payment_player || '';
                    return '<div class="warhub-row"><div style="font-weight:700;">' + esc(amount + ' ' + (p.paymentKind || 'xanax')) + '</div><div class="warhub-mini">' + esc([when, by].filter(Boolean).join(' • ')) + '</div></div>';
                }).join('')
                : '<div class="warhub-empty">No payment history yet.</div>';

            paymentCard = '\
              <div class="warhub-card">\
                <div class="warhub-section-title">\
                  <h3>Payment</h3>\
                  <span class="warhub-count">' + fmtNum(p.renewalCost) + '</span>\
                </div>\
                <div class="warhub-grid two">\
                  <div class="warhub-metric">\
                    <div class="k">Renewal Cost</div>\
                    <div class="v">' + fmtNum(p.renewalCost) + ' ' + esc(p.paymentKind || 'xanax') + '</div>\
                  </div>\
                  <div class="warhub-metric">\
                    <div class="k">Enabled Members</div>\
                    <div class="v">' + fmtNum(p.enabledMemberCount) + '</div>\
                  </div>\
                  <div class="warhub-metric">\
                    <div class="k">Status</div>\
                    <div class="v">' + esc(p.status || '—') + '</div>\
                  </div>\
                  <div class="warhub-metric">\
                    <div class="k">Paid Until</div>\
                    <div class="v">' + esc(p.paidUntil ? fmtTs(p.paidUntil) : '—') + '</div>\
                  </div>\
                  <div class="warhub-metric">\
                    <div class="k">Cycle</div>\
                    <div class="v">' + esc(p.cycleStatus || '—') + '</div>\
                  </div>\
                  <div class="warhub-metric">\
                    <div class="k">Cycle Due</div>\
                    <div class="v">' + fmtNum(p.cycleAmountDue || p.renewalCost) + ' ' + esc(p.paymentKind || 'xanax') + '</div>\
                  </div>\
                </div>\
                <div class="warhub-mini" style="margin-top:8px;line-height:1.5;">' + esc(p.paymentInstruction || '') + '</div>\
                <div class="warhub-actions" style="margin-top:8px;">\
                  <button class="warhub-btn" id="wh-refresh-payment">Refresh Payment</button>\
                  <button class="warhub-btn primary" id="wh-request-renewal">Request Renewal</button>\
                </div>\
                <div class="warhub-list" style="margin-top:10px;">' + historyHtml + '</div>\
              </div>';
        }

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Faction</h3>\
              <span class="warhub-count">' + fmtNum(members.length) + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Faction</div>\
                <div class="v">' + esc(factionName || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Member Access</div>\
                <div class="v">' + (leaderAccess ? fmtNum(enabledCount) : 'Leader') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Xanax Owed</div>\
                <div class="v">' + fmtNum(totalXanaxOwed) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Members</div>\
                <div class="v">' + fmtNum(members.length) + '</div>\
              </div>\
            </div>\
          </div>\
          ' + paymentCard + '\
          ' + (leaderAccess ? '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Member Access Control</h3>\
              <span class="warhub-count">' + fmtNum(enabledCount) + '</span>\
            </div>\
            <div class="warhub-mini" style="margin-bottom:8px;line-height:1.5;">\
              Activate gives the member access and records Xanax owed for the cycle.\
              Delete removes the saved member row, but stays locked once activated until the next paid renewal.\
            </div>\
            <div class="warhub-list">' + accessRowsHtml + '</div>\
          </div>\
          ' : '');
    }

     function renderWarTab() {
        var war = (state && state.war) || {};
        var ourFaction = (state && (state.faction || state.our_faction)) || {};
        var enemyFaction = (state && (state.enemy_faction || state.enemyFaction)) || {};
        var scoreUs = Number(war.score_us != null ? war.score_us : war.our_score) || 0;
        var scoreThem = Number(war.score_them != null ? war.score_them : war.enemy_score) || 0;
        var chainUs = Number(war.chain_us != null ? war.chain_us : war.our_chain) || 0;
        var chainThem = Number(war.chain_them != null ? war.chain_them : war.enemy_chain) || 0;
        var active = !!war.active;
        var startAt = war.started_at || war.start_at || war.war_started_at || '';
        var endAt = war.ends_at || war.end_at || war.war_ends_at || '';
        var diff = scoreUs - scoreThem;

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>War</h3>\
              <span class="warhub-pill ' + (active ? 'good' : 'neutral') + '">' + esc(active ? 'Active' : 'Inactive') + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Our Faction</div>\
                <div class="v">' + esc(ourFaction.name || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Enemy Faction</div>\
                <div class="v">' + esc(enemyFaction.name || state.enemy_faction_name || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Score Us</div>\
                <div class="v">' + fmtNum(scoreUs) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Score Them</div>\
                <div class="v">' + fmtNum(scoreThem) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Net Score</div>\
                <div class="v">' + fmtNum(diff) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Chain Us</div>\
                <div class="v">' + fmtNum(chainUs) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Chain Them</div>\
                <div class="v">' + fmtNum(chainThem) + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Started</div>\
                <div class="v">' + esc(startAt ? fmtTs(startAt) : '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Ends</div>\
                <div class="v">' + esc(endAt ? fmtTs(endAt) : '—') + '</div>\
              </div>\
            </div>\
          </div>';
    }

    function renderSummaryTab() {
        var war = (state && state.war) || {};
        var debug = (state && state.debug) || {};
        var enemyMeta = getEnemyFactionMeta();

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>War Summary</h3>\
              <span class="warhub-count">' + esc(war.active ? 'Live' : 'Snapshot') + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Enemy ID</div>\
                <div class="v">' + esc(enemyMeta.id || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Enemy Name</div>\
                <div class="v">' + esc(enemyMeta.name || '—') + '</div>\
              </div>\
            </div>\
            <div class="warhub-divider"></div>\
            <div class="warhub-mini">' + esc(JSON.stringify(debug || {}, null, 2)) + '</div>\
          </div>';
    }

    function renderChainTab() {
        var me = (state && (state.me || state.user)) || {};
        var available = !!(me.available || me.is_available);
        var sitter = !!(me.chain_sitter || me.is_chain_sitter);

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Chain</h3>\
              <span class="warhub-count">' + esc((me.name || me.player_name || 'You')) + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Availability</div>\
                <div class="v">' + esc(available ? 'Available' : 'Unavailable') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Chain Sitter</div>\
                <div class="v">' + esc(sitter ? 'On' : 'Off') + '</div>\
              </div>\
            </div>\
            <div class="warhub-actions">\
              <button class="warhub-btn primary" id="warhub-set-available">Set Available</button>\
              <button class="warhub-btn warn" id="warhub-set-unavailable">Set Unavailable</button>\
              <button class="warhub-btn" id="warhub-chain-sitter-toggle">' + esc(sitter ? 'Disable Chain Sitter' : 'Enable Chain Sitter') + '</button>\
            </div>\
          </div>';
    }

    function renderTermsTab() {
        var terms = (state && (state.war_terms || state.terms)) || {};
        var body = String(terms.body || terms.text || terms.note || '').trim();

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Terms</h3>\
              <span class="warhub-count">' + esc(body ? 'Saved' : 'Empty') + '</span>\
            </div>\
            ' + (body
                ? '<div class="warhub-mini" style="white-space:pre-wrap;line-height:1.5;">' + esc(body) + '</div>'
                : '<div class="warhub-empty">No war terms saved.</div>') + '\
          </div>';
    }

    function renderMembersTab() {
        var members = arr((state && state.members) || []);
        return rosterCard('Members', members, {});
    }

    function renderEnemiesTab() {
        var enemies = arr((state && state.enemies) || []);
        var enemyMeta = getEnemyFactionMeta();
        var header = '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Enemies</h3>\
              <span class="warhub-count">' + fmtNum(enemies.length) + '</span>\
            </div>\
            <div class="warhub-grid two">\
              <div class="warhub-metric">\
                <div class="k">Enemy Faction</div>\
                <div class="v">' + esc(enemyMeta.name || '—') + '</div>\
              </div>\
              <div class="warhub-metric">\
                <div class="k">Enemy Faction ID</div>\
                <div class="v">' + esc(enemyMeta.id || '—') + '</div>\
              </div>\
            </div>\
          </div>';

        var body = enemies.length ? enemies.map(function (m) {
            var memberId = String(m.user_id || m.id || m.player_id || '').trim();
            var memberName = String(m.name || m.member_name || ('ID ' + memberId));
            var statusPill = memberStatusPill(m);
            var meta = [];
            if (memberId) meta.push('ID ' + memberId);
            if (m.level != null) meta.push('Lvl ' + m.level);
            if (m.last_action) meta.push('Last: ' + m.last_action);

            return '\
              <div class="warhub-row">\
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">\
                  <div style="min-width:0;flex:1;">\
                    <div class="warhub-name">' + esc(memberName) + '</div>\
                    <div class="warhub-meta">' + esc(meta.join(' • ')) + '</div>\
                  </div>\
                  <div>' + statusPill + '</div>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No enemies found.</div>';

        return header + '\
          <div class="warhub-card">\
            <div class="warhub-list">' + body + '</div>\
          </div>';
    }

    function renderHospitalTab() {
        var members = arr((state && state.members) || []);
        var enemies = arr((state && state.enemies) || []);
        var hospMembers = members.filter(function (m) {
            var s = String(m.status || m.state || '').toLowerCase();
            return !!m.hospital || s.indexOf('hospital') >= 0 || s.indexOf('hosp') >= 0;
        });
        var hospEnemies = enemies.filter(function (m) {
            var s = String(m.status || m.state || '').toLowerCase();
            return !!m.hospital || s.indexOf('hospital') >= 0 || s.indexOf('hosp') >= 0;
        });

        return rosterCard('Hospital Members', hospMembers, {}) + rosterCard('Hospital Enemies', hospEnemies, {});
    }

    function renderMedDealsTab() {
        var deals = arr((state && (state.med_deals || state.medDeals)) || []);
        var message = String((state && state.med_deals_message) || '');

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Med Deals</h3>\
              <span class="warhub-count">' + fmtNum(deals.length) + '</span>\
            </div>\
            ' + (message ? '<div class="warhub-mini" style="margin-bottom:8px;">' + esc(message) + '</div>' : '') + '\
            <div class="warhub-list">' + (
                deals.length ? deals.map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.name || x.member_name || x.user_name || 'Unknown') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.kind || x.type || '',
                            x.note || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No med deals.</div>'
            ) + '</div>\
          </div>';
    }

    function renderTargetsTab() {
        var targets = arr((state && state.targets) || []);
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Targets</h3>\
              <span class="warhub-count">' + fmtNum(targets.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                targets.length ? targets.map(function (x) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">' + esc(x.target_name || x.name || 'Target') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.note || '',
                            x.assigned_to_name || x.claimed_by_name || '',
                            x.created_at ? fmtTs(x.created_at) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No targets.</div>'
            ) + '</div>\
          </div>';
    }

    function renderSettingsTab() {
        var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
        var refreshMs = Number(GM_getValue(K_REFRESH, 30000)) || 30000;

        return '\
          <div class="warhub-card">\
            <h3>Keys</h3>\
            <label class="warhub-label">Your Torn API Key</label>\
            <input class="warhub-input" id="wh-api-key" value="' + esc(apiKey) + '" placeholder="Paste your API key">\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn primary" id="wh-save-keys">Save Keys</button>\
              <button class="warhub-btn" id="wh-login-btn">Login</button>\
              <button class="warhub-btn warn" id="wh-logout-btn">Logout</button>\
            </div>\
          </div>\
          <div class="warhub-card">\
            <h3>Refresh</h3>\
            <label class="warhub-label">Poll every (ms)</label>\
            <input class="warhub-input" id="wh-refresh-ms" value="' + esc(String(refreshMs)) + '" placeholder="30000">\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn" id="wh-save-refresh">Save Refresh</button>\
            </div>\
          </div>';
    }

    function renderAdminTab() {
        if (!isOwnerSession()) {
            return '\
              <div class="warhub-card">\
                <div class="warhub-empty">Admin access required.</div>\
              </div>';
        }

        var dueItems = arr(adminPaymentDueCache || []);
        var pendingItems = arr(adminPaymentPendingCache || []);

        var dueHtml = dueItems.length ? dueItems.map(function (x) {
            var lic = x.license || x;
            var factionId = String(lic.faction_id || x.faction_id || '');
            var factionName = String(lic.faction_name || x.faction_name || factionId || 'Unknown');
            var amount = Number(lic.renewal_cost != null ? lic.renewal_cost : x.renewal_cost || 0) || 0;

            return '\
              <div class="warhub-row">\
                <div style="font-weight:700;">' + esc(factionName) + '</div>\
                <div class="warhub-mini">' + esc('Faction ID: ' + factionId + ' • Due: ' + amount) + '</div>\
                <div class="warhub-actions" style="margin-top:8px;">\
                  <button class="warhub-btn small" data-admin-renew="' + esc(factionId) + '">Confirm Payment</button>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No due factions.</div>';

        var pendingHtml = pendingItems.length ? pendingItems.map(function (x) {
            var intentId = String(x.intent_id || x.id || '');
            var factionId = String(x.faction_id || '');
            var amount = Number(x.amount_due != null ? x.amount_due : 0) || 0;
            var requestedBy = x.requested_by_name || x.requested_by_user_id || '';

            return '\
              <div class="warhub-row">\
                <div style="font-weight:700;">' + esc((x.faction_name || factionId || 'Pending Request')) + '</div>\
                <div class="warhub-mini">' + esc(['Intent: ' + intentId, 'Amount: ' + amount, requestedBy].filter(Boolean).join(' • ')) + '</div>\
                <div class="warhub-actions" style="margin-top:8px;">\
                  <button class="warhub-btn small" data-admin-confirm-intent="' + esc(intentId) + '" data-admin-confirm-amount="' + esc(String(amount)) + '">Confirm</button>\
                  <button class="warhub-btn warn small" data-admin-cancel-intent="' + esc(intentId) + '">Cancel</button>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No pending renewal requests.</div>';

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Admin Payments</h3>\
              <span class="warhub-count">' + fmtNum(dueItems.length + pendingItems.length) + '</span>\
            </div>\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn" id="wh-admin-refresh-payments">Refresh Payments</button>\
              <button class="warhub-btn" id="wh-admin-warning-scan">Run Warning Scan</button>\
              <button class="warhub-btn" id="wh-admin-auto-match">Run Auto Match</button>\
            </div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Due Factions</h3>\
              <span class="warhub-count">' + fmtNum(dueItems.length) + '</span>\
            </div>\
            <div class="warhub-list">' + dueHtml + '</div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Pending Renewal Requests</h3>\
              <span class="warhub-count">' + fmtNum(pendingItems.length) + '</span>\
            </div>\
            <div class="warhub-list">' + pendingHtml + '</div>\
          </div>';
    }

    function renderWarTop5Tab() {
        var items = arr(adminTopFiveCache || []);
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>War Top 5</h3>\
              <span class="warhub-count">' + fmtNum(items.length) + '</span>\
            </div>\
            <div class="warhub-list">' + (
                items.length ? items.map(function (x, i) {
                    return '\
                      <div class="warhub-row">\
                        <div class="warhub-name">#' + esc(String(i + 1)) + ' ' + esc(x.name || x.player_name || 'Unknown') + '</div>\
                        <div class="warhub-meta">' + esc([
                            x.score != null ? ('Score: ' + x.score) : '',
                            x.attacks != null ? ('Attacks: ' + x.attacks) : ''
                        ].filter(Boolean).join(' • ')) + '</div>\
                      </div>';
                }).join('') : '<div class="warhub-empty">No data yet.</div>'
            ) + '</div>\
          </div>';
    }

    // ============================================================
    // 20. MAIN RENDER FLOW
    // ============================================================

    function renderTabBody() {
        if (tabLocked(currentTab)) {
            return renderAccessBanner();
        }

        switch (currentTab) {
            case 'overview':
                return renderOverviewTab();
            case 'faction':
                return renderFactionTab();
            case 'war':
                return renderWarTab();
            case 'summary':
                return renderSummaryTab();
            case 'chain':
                return renderChainTab();
            case 'terms':
                return renderTermsTab();
            case 'members':
                return renderMembersTab();
            case 'enemies':
                return renderEnemiesTab();
            case 'hospital':
                return renderHospitalTab();
            case 'meddeals':
                return renderMedDealsTab();
            case 'targets':
                return renderTargetsTab();
            case 'instructions':
                return renderInstructionsTab();
            case 'settings':
                return renderSettingsTab();
            case 'admin':
                return renderAdminTab();
            case 'wartop5':
                return renderWarTop5Tab();
            default:
                return renderOverviewTab();
        }
    }

    function renderBody() {
        if (!overlay) return;

        overlay.innerHTML = renderHeader();

        var content = overlay.querySelector('#warhub-content');
        if (content) content.innerHTML = renderTabBody();

        restoreStatus();

        var body = overlay.querySelector('.warhub-body');
        if (body) {
            body.addEventListener('scroll', function () {
                saveOverlayScroll();
            }, { passive: true });
        }

        bindOverlayEvents();
    }

     // ============================================================
    // 21. EVENT BINDING
    // ============================================================

    function bindOverlayEvents() {
        if (!overlay) return;

        overlay.querySelectorAll('[data-tab]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var tab = btn.getAttribute('data-tab') || 'overview';
                if (tabLocked(tab)) {
                    setStatus(accessSummaryMessage() || 'Faction access locked.', true);
                    renderBody();
                    return;
                }

                currentTab = tab;
                GM_setValue(K_TAB, currentTab);

                if (tab === 'faction' && ((accessState && accessState.isFactionLeader) || isOwnerSession())) {
                    yield refreshLeaderFactionData();
                }
                if (tab === 'admin' && isOwnerSession()) {
                    yield loadAdminDashboard();
                }

                renderBody();
            }));
        });

        var closeBtn = overlay.querySelector('#warhub-close-btn');
        if (closeBtn && !closeBtn.__warhubBound) {
            closeBtn.__warhubBound = true;
            closeBtn.addEventListener('click', function () {
                closeOverlay();
            });
        }

        var saveKeysBtn = overlay.querySelector('#wh-save-keys');
        if (saveKeysBtn && !saveKeysBtn.__warhubBound) {
            saveKeysBtn.__warhubBound = true;
            saveKeysBtn.addEventListener('click', function () {
                var input = overlay.querySelector('#wh-api-key');
                var apiKey = cleanInputValue(input ? input.value : '');
                GM_setValue(K_API_KEY, apiKey);
                setStatus(apiKey ? 'API key saved.' : 'API key cleared.');
            });
        }

        var loginBtn = overlay.querySelector('#wh-login-btn');
        if (loginBtn && !loginBtn.__warhubBound) {
            loginBtn.__warhubBound = true;
            loginBtn.addEventListener('click', _asyncToGenerator(function* () {
                var input = overlay.querySelector('#wh-api-key');
                var apiKey = cleanInputValue(input ? input.value : '');
                if (!apiKey) {
                    setStatus('Paste your API key first.', true);
                    return;
                }

                GM_setValue(K_API_KEY, apiKey);

                var okLogin = yield login(true);
                if (!okLogin) return;

                yield loadState();

                if ((accessState && accessState.isFactionLeader) || isOwnerSession()) {
                    yield refreshLeaderFactionData();
                }
                if (isOwnerSession()) {
                    yield loadAdminDashboard();
                }

                setStatus('Logged in.');
            }));
        }

        var logoutBtn = overlay.querySelector('#wh-logout-btn');
        if (logoutBtn && !logoutBtn.__warhubBound) {
            logoutBtn.__warhubBound = true;
            logoutBtn.addEventListener('click', _asyncToGenerator(function* () {
                yield logout();
            }));
        }

        var saveRefreshBtn = overlay.querySelector('#wh-save-refresh');
        if (saveRefreshBtn && !saveRefreshBtn.__warhubBound) {
            saveRefreshBtn.__warhubBound = true;
            saveRefreshBtn.addEventListener('click', function () {
                var input = overlay.querySelector('#wh-refresh-ms');
                var n = Number(cleanInputValue(input ? input.value : '30000')) || 30000;
                if (n < 5000) n = 5000;
                GM_setValue(K_REFRESH, n);
                restartPolling();
                setStatus('Refresh saved.');
            });
        }

        var avOn = overlay.querySelector('#warhub-set-available');
        if (avOn && !avOn.__warhubBound) {
            avOn.__warhubBound = true;
            avOn.addEventListener('click', _asyncToGenerator(function* () {
                var res = yield doAction('POST', '/api/availability', {
                    available: true
                }, 'Availability updated.', false);
                if (res) {
                    yield loadState();
                    setStatus('Set available.');
                }
            }));
        }

        var avOff = overlay.querySelector('#warhub-set-unavailable');
        if (avOff && !avOff.__warhubBound) {
            avOff.__warhubBound = true;
            avOff.addEventListener('click', _asyncToGenerator(function* () {
                var res = yield doAction('POST', '/api/availability', {
                    available: false
                }, 'Availability updated.', false);
                if (res) {
                    yield loadState();
                    setStatus('Set unavailable.');
                }
            }));
        }

        var sitterBtn = overlay.querySelector('#warhub-chain-sitter-toggle');
        if (sitterBtn && !sitterBtn.__warhubBound) {
            sitterBtn.__warhubBound = true;
            sitterBtn.addEventListener('click', _asyncToGenerator(function* () {
                var me = (state && (state.me || state.user)) || {};
                var next = !(me.chain_sitter || me.is_chain_sitter);
                var res = yield doAction('POST', '/api/chain-sitter', {
                    enabled: next
                }, 'Chain sitter updated.', false);
                if (res) {
                    yield loadState();
                    setStatus(next ? 'Chain sitter enabled.' : 'Chain sitter disabled.');
                }
            }));
        }

        overlay.querySelectorAll('[data-toggle-overview]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', function () {
                var key = cleanInputValue(btn.getAttribute('data-toggle-overview') || '');
                if (!key) return;
                var prefs = getOverviewBoxPrefs();
                setOverviewBoxPref(key, !prefs[key]);
                renderBody();
            });
        });

        var refreshPaymentBtn = overlay.querySelector('#wh-refresh-payment');
        if (refreshPaymentBtn && !refreshPaymentBtn.__warhubBound) {
            refreshPaymentBtn.__warhubBound = true;
            refreshPaymentBtn.addEventListener('click', _asyncToGenerator(function* () {
                yield refreshFactionPaymentData();
                setStatus('Payment details refreshed.');
            }));
        }

        var requestRenewalBtn = overlay.querySelector('#wh-request-renewal');
        if (requestRenewalBtn && !requestRenewalBtn.__warhubBound) {
            requestRenewalBtn.__warhubBound = true;
            requestRenewalBtn.addEventListener('click', _asyncToGenerator(function* () {
                var note = prompt('Optional note for renewal request:', '') || '';
                var res = yield doAction('POST', '/api/faction/payment/request-renewal', {
                    note: note
                }, 'Renewal requested.', false);

                if (res) {
                    yield refreshFactionPaymentData();
                    if (isOwnerSession()) yield loadAdminPayments();
                    setStatus('Renewal request sent.');
                }
            }));
        }

        var saveFactionMember = overlay.querySelector('#wh-fm-save');
        if (saveFactionMember && !saveFactionMember.__warhubBound) {
            saveFactionMember.__warhubBound = true;
            saveFactionMember.addEventListener('click', _asyncToGenerator(function* () {
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
                }, 'Member activated for this faction cycle.', false);

                if (res) {
                    yield refreshLeaderFactionData();
                    setStatus('Member activated and Xanax owed recorded.');
                }
            }));
        }

        overlay.querySelectorAll('[data-add-faction-member]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var member_user_id = cleanInputValue(btn.getAttribute('data-add-faction-member') || '');
                if (!member_user_id) {
                    setStatus('Missing member ID.', true);
                    return;
                }

                var member_name = cleanInputValue(btn.getAttribute('data-member-name') || '');
                var position = cleanInputValue(btn.getAttribute('data-member-position') || '');

                var res = yield doAction('POST', '/api/faction/members', {
                    member_user_id: member_user_id,
                    member_name: member_name,
                    enabled: true,
                    position: position
                }, 'Member activated for this faction cycle.', false);

                if (res) {
                    yield refreshLeaderFactionData();
                    setStatus('Member activated and Xanax owed recorded.');
                }
            }));
        });

        overlay.querySelectorAll('[data-toggle-member]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var memberId = cleanInputValue(btn.getAttribute('data-toggle-member') || '');
                var enabled = cleanInputValue(btn.getAttribute('data-enabled') || '') === '1';
                var cycleLocked = cleanInputValue(btn.getAttribute('data-cycle-locked') || '') === '1';

                if (!memberId) return;
                if (cycleLocked) {
                    setStatus('Enabled member access is locked until the next renewal/payment cycle.', true);
                    return;
                }

                var res = yield doAction(
                    'POST',
                    "/api/faction/members/".concat(encodeURIComponent(memberId), "/enable"),
                    { enabled: enabled },
                    enabled ? 'Member enabled.' : 'Member disabled.',
                    false
                );

                if (res) yield refreshLeaderFactionData();
            }));
        });

        overlay.querySelectorAll('[data-del-member]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var memberId = cleanInputValue(btn.getAttribute('data-del-member') || '');
                var cycleLocked = cleanInputValue(btn.getAttribute('data-cycle-locked') || '') === '1';

                if (!memberId) return;
                if (cycleLocked) {
                    setStatus('Enabled member access is locked until the next renewal/payment cycle.', true);
                    return;
                }

                var res = yield doAction(
                    'DELETE',
                    "/api/faction/members/".concat(encodeURIComponent(memberId)),
                    null,
                    'Faction member removed.',
                    false
                );

                if (res) yield refreshLeaderFactionData();
            }));
        });

        var adminRefreshPaymentsBtn = overlay.querySelector('#wh-admin-refresh-payments');
        if (adminRefreshPaymentsBtn && !adminRefreshPaymentsBtn.__warhubBound) {
            adminRefreshPaymentsBtn.__warhubBound = true;
            adminRefreshPaymentsBtn.addEventListener('click', _asyncToGenerator(function* () {
                yield loadAdminPayments();
                setStatus('Admin payments refreshed.');
            }));
        }

        var adminWarningScanBtn = overlay.querySelector('#wh-admin-warning-scan');
        if (adminWarningScanBtn && !adminWarningScanBtn.__warhubBound) {
            adminWarningScanBtn.__warhubBound = true;
            adminWarningScanBtn.addEventListener('click', _asyncToGenerator(function* () {
                var res = yield adminReq('POST', '/api/admin/faction-payments/run-warning-scan', {});
                if (!res.ok) {
                    setStatus(res.error || 'Warning scan failed.', true);
                    return;
                }
                yield loadAdminPayments();
                setStatus('Warning scan complete.');
            }));
        }

        var adminAutoMatchBtn = overlay.querySelector('#wh-admin-auto-match');
        if (adminAutoMatchBtn && !adminAutoMatchBtn.__warhubBound) {
            adminAutoMatchBtn.__warhubBound = true;
            adminAutoMatchBtn.addEventListener('click', _asyncToGenerator(function* () {
                var res = yield adminReq('POST', '/internal/payments/run-auto-match', {});
                if (!res.ok) {
                    setStatus(res.error || 'Auto match failed.', true);
                    return;
                }
                yield loadAdminPayments();
                setStatus('Auto match run complete.');
            }));
        }

        overlay.querySelectorAll('[data-admin-confirm-intent]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var intentId = cleanInputValue(btn.getAttribute('data-admin-confirm-intent') || '');
                var amount = Number(cleanInputValue(btn.getAttribute('data-admin-confirm-amount') || '0')) || 0;
                if (!intentId) return;

                var note = prompt('Optional note for payment confirmation:', '') || '';
                var res = yield adminReq('POST', '/api/admin/faction-payments/confirm', {
                    intent_id: intentId,
                    amount: amount,
                    note: note
                });

                if (!res.ok) {
                    setStatus(res.error || 'Could not confirm payment.', true);
                    return;
                }

                yield loadAdminPayments();
                yield refreshFactionPaymentData();
                setStatus('Payment confirmed.');
            }));
        });

        overlay.querySelectorAll('[data-admin-cancel-intent]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var intentId = cleanInputValue(btn.getAttribute('data-admin-cancel-intent') || '');
                if (!intentId) return;

                var note = prompt('Optional note for cancelling intent:', '') || '';
                var res = yield adminReq(
                    'POST',
                    "/api/admin/faction-payments/".concat(encodeURIComponent(intentId), "/cancel"),
                    { note: note }
                );

                if (!res.ok) {
                    setStatus(res.error || 'Could not cancel intent.', true);
                    return;
                }

                yield loadAdminPayments();
                setStatus('Payment intent cancelled.');
            }));
        });

        overlay.querySelectorAll('[data-admin-history]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var factionId = cleanInputValue(btn.getAttribute('data-admin-history') || '');
                if (!factionId) return;

                var res = yield adminReq('GET', "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/history"));
                if (!res.ok) {
                    setStatus(res.error || 'Could not load payment history.', true);
                    return;
                }

                var items = arr((res.data && res.data.items) || []);
                var lines = items.length ? items.map(function (x) {
                    var amount = x.amount != null ? fmtMoney(x.amount) : '—';
                    var when = fmtTs(x.created_at || x.ts || x.time || '');
                    var by = x.renewed_by || x.created_by || x.payment_player || '';
                    return "".concat(when, " • ").concat(amount).concat(by ? " • ".concat(by) : '');
                }).join('\n') : 'No payment history found.';

                alert(lines);
            }));
        });

        overlay.querySelectorAll('[data-admin-renew]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

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
                var res = yield adminReq(
                    'POST',
                    "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/renew"),
                    { amount: amount, note: note }
                );

                if (!res.ok) {
                    setStatus(res.error || 'Renew failed.', true);
                    return;
                }

                setStatus('Faction renewed.');
                yield loadAdminDashboard();
            }));
        });

        overlay.querySelectorAll('[data-admin-expire]').forEach(function (btn) {
            if (btn.__warhubBound) return;
            btn.__warhubBound = true;

            btn.addEventListener('click', _asyncToGenerator(function* () {
                var factionId = cleanInputValue(btn.getAttribute('data-admin-expire') || '');
                if (!factionId) return;
                if (!confirm("Expire faction ".concat(factionId, "?"))) return;

                var res = yield adminReq(
                    'POST',
                    "/api/admin/faction-licenses/".concat(encodeURIComponent(factionId), "/expire"),
                    {}
                );

                if (!res.ok) {
                    setStatus(res.error || 'Expire failed.', true);
                    return;
                }

                setStatus('Faction expired.');
                yield loadAdminDashboard();
            }));
        });
    }

    // ============================================================
    // 22. POLLING / BOOT
    // ============================================================

    function restartPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        var refreshMs = Number(GM_getValue(K_REFRESH, 30000)) || 30000;
        if (refreshMs < 5000) refreshMs = 5000;

        pollTimer = setInterval(function () {
            if (!cleanInputValue(GM_getValue(K_SESSION, ''))) return;
            if (!document.hidden) loadState();
        }, refreshMs);
    }

    function boot() {
        mount();
        restartPolling();
        scheduleRemount();

        window.addEventListener('resize', function () {
            if (shield) clampToViewport(shield);
            if (overlay) clampToViewport(overlay);
            updateBadge();
        });

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && cleanInputValue(GM_getValue(K_SESSION, ''))) {
                loadState();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

})();
