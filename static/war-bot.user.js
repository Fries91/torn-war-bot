// ==UserScript==
// @name         War Hub ⚔️
// @namespace    fries91-war-hub
// @version      3.1.7
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
    var currentFactionMembers = [];
    var liveSummaryCache = null;
    var liveSummaryLoading = false;
    var liveSummaryError = '';
    var liveSummaryLastAt = 0;
    var warEnemiesCache = [];
    var warEnemiesFactionName = '';
    var warEnemiesFactionId = '';
    var warEnemiesLoadedAt = 0;
    var warEnemyStatsCache = {};
    var warEnemyStatsLoadedAt = 0;
    
    var overlay = null;
    var shield = null;
    var badge = null;

    var mounted = false;
    var dragMoved = false;
    var isOpen = !!GM_getValue(K_OPEN, false);
    var currentTab = GM_getValue(K_TAB, 'settings');
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
    }\n\
    .warhub-tab.active {\n\
      background: linear-gradient(180deg, #d23333, #851616) !important;\n\
      color: #fff !important;\n\
    }\n\
\n\
    .warhub-body {\n\
      flex: 1 1 auto !important;\n\
      min-height: 0 !important;\n\
      overflow-y: auto !important;\n\
      overflow-x: hidden !important;\n\
      -webkit-overflow-scrolling: touch !important;\n\
      padding: 10px !important;\n\
      display: block !important;\n\
    }\n\
\n\
    .warhub-card {\n\
      border: 1px solid rgba(255,255,255,.07) !important;\n\
      border-radius: 12px !important;\n\
      padding: 10px !important;\n\
      margin-bottom: 10px !important;\n\
      background: rgba(255,255,255,.035) !important;\n\
    }\n\
    .warhub-hero-card {\n\
      border: 1px solid rgba(210,51,51,.45) !important;\n\
      background: linear-gradient(180deg, rgba(210,51,51,.16), rgba(255,255,255,.04)) !important;\n\
      box-shadow: 0 10px 30px rgba(0,0,0,.22) !important;\n\
    }\n\
\n\
    .warhub-hero-vs {\n\
      font-size: 14px !important;\n\
      font-weight: 800 !important;\n\
      color: #fff !important;\n\
      margin-bottom: 10px !important;\n\
      line-height: 1.35 !important;\n\
    }\n\
    .warhub-hero-vs span {\n\
      opacity: .7 !important;\n\
      font-weight: 600 !important;\n\
      margin: 0 4px !important;\n\
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
    .warhub-list-item {\n\
      transition: transform .15s ease, border-color .15s ease !important;\n\
    }\n\
    .warhub-list-item:hover {\n\
      transform: translateY(-1px) !important;\n\
      border-color: rgba(210,51,51,.35) !important;\n\
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
    .warhub-mini {\n\
      font-size: 12px !important;\n\
      line-height: 1.45 !important;\n\
      color: #fff !important;\n\
      opacity: .88 !important;\n\
    }\n\
    .warhub-count {\n\
      opacity: .75 !important;\n\
      font-size: 11px !important;\n\
      color: #fff !important;\n\
    }\n\
            .warhub-hero-card {\n\
      border: 1px solid rgba(210,51,51,.45) !important;\n\
      background: linear-gradient(180deg, rgba(210,51,51,.16), rgba(255,255,255,.04)) !important;\n\
      box-shadow: 0 10px 30px rgba(0,0,0,.22) !important;\n\
    }\n\
    .warhub-hero-vs {\n\
      font-size: 14px !important;\n\
      font-weight: 800 !important;\n\
      color: #fff !important;\n\
      margin-bottom: 10px !important;\n\
      line-height: 1.35 !important;\n\
    }\n\
    .warhub-hero-vs span {\n\
      opacity: .7 !important;\n\
      font-weight: 600 !important;\n\
      margin: 0 4px !important;\n\
    }\n\
    .warhub-mini {\n\
      font-size: 12px !important;\n\
      line-height: 1.45 !important;\n\
      color: #fff !important;\n\
      opacity: .88 !important;\n\
    }\n\
    .warhub-list-item {\n\
      transition: transform .15s ease, border-color .15s ease !important;\n\
    }\n\
    .warhub-list-item:hover {\n\
      transform: translateY(-1px) !important;\n\
      border-color: rgba(210,51,51,.35) !important;\n\
    }\n\
    .warhub-faction-member-row {\n\
      display: flex !important;\n\
      align-items: center !important;\n\
      justify-content: space-between !important;\n\
      gap: 10px !important;\n\
    }\n\
    .warhub-faction-member-main {\n\
      min-width: 0 !important;\n\
      flex: 1 1 auto !important;\n\
    }\n\
    .warhub-faction-member-action {\n\
      flex: 0 0 auto !important;\n\
      display: flex !important;\n\
      align-items: center !important;\n\
      justify-content: flex-end !important;\n\
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

     function pushLocalNotification(kind, text) {
        var items = getLocalNotifications();
        items.unshift({
            id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8),
            kind: String(kind || 'info'),
            text: String(text || ''),
            created_at: new Date().toISOString()
        });
        if (items.length > 50) items = items.slice(0, 50);
        setLocalNotifications(items);
        updateBadge();
    }

    function setStatus(msg, isErr) {
        lastStatusMsg = String(msg || '');
        lastStatusErr = !!isErr;
        renderStatus();
    }

    function renderStatus() {
        if (!overlay) return;
        var box = overlay.querySelector('#warhub-status');
        if (!box) return;

        if (!lastStatusMsg) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        box.innerHTML = '<div class="warhub-pill ' + (lastStatusErr ? 'bad' : 'good') + '">' + esc(lastStatusMsg) + '</div>';
    }

    function updateBadge() {
        if (!badge) return;
        var count = getLocalNotifications().filter(function (x) { return !x.seen; }).length;
        if (!count) {
            badge.style.display = 'none';
            badge.textContent = '';
            return;
        }
        badge.style.display = 'block';
        badge.textContent = count > 99 ? '99+' : String(count);
        positionBadge();
    }

// ============================================================
// 08. ASYNC / REQUEST HELPERS
// ============================================================

function _asyncToGenerator(fn) {
    return function () {
        var self = this, args = arguments;
        return new Promise(function (resolve, reject) {
            var gen = fn.apply(self, args);
            function step(key, arg) {
                var info;
                try {
                    info = gen[key](arg);
                } catch (error) {
                    reject(error);
                    return;
                }
                var value = info.value;
                if (info.done) {
                    resolve(value);
                } else {
                    Promise.resolve(value).then(function (val) {
                        step('next', val);
                    }, function (err) {
                        step('throw', err);
                    });
                }
            }
            step('next');
        });
    };
}

function req(method, path, body, extraHeaders) {
    return new Promise(function (resolve) {
        var headers = {
            'Content-Type': 'application/json'
        };

        var sessionToken = cleanInputValue(GM_getValue(K_SESSION, ''));
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        var ownerToken = cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''));
        if (ownerToken) headers['X-Owner-Token'] = ownerToken;

        var adminKey = cleanInputValue(GM_getValue(K_ADMIN_KEY, ''));
        if (adminKey) headers['X-Admin-Key'] = adminKey;

        if (extraHeaders && typeof extraHeaders === 'object') {
            Object.keys(extraHeaders).forEach(function (k) {
                headers[k] = extraHeaders[k];
            });
        }

        GM_xmlhttpRequest({
            method: String(method || 'GET').toUpperCase(),
            url: BASE_URL + String(path || ''),
            headers: headers,
            data: body == null ? null : JSON.stringify(body),
            timeout: 30000,
            onload: function (res) {
                var json = null;
                try {
                    json = JSON.parse(res.responseText || '{}');
                } catch (_unused3) {
                    json = null;
                }

                if (!json || typeof json !== 'object') {
                    resolve({
                        ok: false,
                        status: res.status || 0,
                        error: 'Invalid server response.'
                    });
                    return;
                }

                if (json.ok === false) {
                    resolve({
                        ok: false,
                        status: res.status || 0,
                        error: String(json.error || json.message || 'Request failed.'),
                        data: json
                    });
                    return;
                }

                resolve({
                    ok: true,
                    status: res.status || 200,
                    data: json
                });
            },
            onerror: function () {
                resolve({
                    ok: false,
                    status: 0,
                    error: 'Network request failed.'
                });
            },
            ontimeout: function () {
                resolve({
                    ok: false,
                    status: 0,
                    error: 'Request timed out.'
                });
            }
        });
    });
}

function getKnownWarId() {
    var liveRoot = (typeof liveSummaryCache === 'object' && liveSummaryCache) ? liveSummaryCache : {};
    var live = (liveRoot && typeof liveRoot.item === 'object' && liveRoot.item) ? liveRoot.item : liveRoot;
    var liveWar = (live && typeof live.war === 'object') ? live.war : {};
    var stateWar = (state && typeof state.war === 'object') ? state.war : {};

    var candidates = [
        live && live.war_id,
        live && live.ranked_war_id,
        live && live.id,
        liveWar && liveWar.war_id,
        liveWar && liveWar.ranked_war_id,
        liveWar && liveWar.id,
        state && state.war_id,
        state && state.ranked_war_id,
        stateWar && stateWar.war_id,
        stateWar && stateWar.ranked_war_id,
        stateWar && stateWar.id
    ];

    for (var i = 0; i < candidates.length; i++) {
        var v = String(candidates[i] || '').trim();
        if (v) return v;
    }

    return '';
}

function authedReq(method, path, body) {
    return req(method, path, body);
}

function adminReq(method, path, body) {
    return req(method, path, body);
}

    // ============================================================
    // 09. ACCESS / SESSION HELPERS
    // ============================================================

function normalizeAccessCache(v) {
    var data = v && typeof v === 'object' ? v : {};
    return {
        is_owner: !!data.is_owner,
        is_admin: !!data.is_admin,
        show_admin: !!data.show_admin,
        show_all_tabs: !!data.show_all_tabs,
        can_manage_faction: !!data.can_manage_faction,
        member_enabled: !!data.member_enabled,
        is_faction_leader: !!data.is_faction_leader,
        payment_required: !!data.payment_required,
        expired: !!data.expired,
        trial_active: !!data.trial_active,
        status: String(data.status || ''),
        can_use_features: !!data.can_use_features,
        is_user_exempt: !!data.is_user_exempt,
        is_faction_exempt: !!data.is_faction_exempt,
        message: String(data.message || ''),
        license: data.license && typeof data.license === 'object' ? data.license : {}
    };
}

function saveAccessCache(v) {
    accessState = normalizeAccessCache(v);
    GM_setValue(K_ACCESS_CACHE, accessState);
}

function getSessionToken() {
    return cleanInputValue(GM_getValue(K_SESSION, ''));
}

function isLoggedIn() {
    return !!getSessionToken();
}

function isOwnerSession() {
    if (accessState && accessState.is_owner) return true;
    if (!state || !state.me) return false;
    var me = state.me || {};
    return String(me.user_id || '') === String(OWNER_USER_ID) || String(me.name || '').toLowerCase() === String(OWNER_NAME).toLowerCase();
}

function canUseFeatures() {
    return !!(accessState && accessState.can_use_features);
}

function isFactionLeader() {
    return !!(accessState && accessState.is_faction_leader);
}

function canManageFaction() {
    return !!(accessState && accessState.can_manage_faction);
}

function canSeeAdmin() {
    return !!(accessState && accessState.show_admin);
}

    // ============================================================
    // 10. OVERVIEW BOX PREFS / UI POSITION HELPERS
    // ============================================================

    function getOverviewBoxPrefs() {
        var v = GM_getValue(K_OVERVIEW_BOXES, null);
        if (!v || typeof v !== 'object') {
            return {
                payments: true,
                war: true,
                members: true,
                notifications: true
            };
        }
        return {
            payments: v.payments !== false,
            war: v.war !== false,
            members: v.members !== false,
            notifications: v.notifications !== false
        };
    }

    function saveOverviewBoxPrefs(v) {
        GM_setValue(K_OVERVIEW_BOXES, v || {});
    }

    function clampToViewport(el) {
        if (!el) return;
        var rect = el.getBoundingClientRect();
        var left = rect.left;
        var top = rect.top;

        if (left < 0) left = 0;
        if (top < 0) top = 0;
        if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width);
        if (top + rect.height > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height);

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
        positionBadge();
    }

    function saveOverlayPos() {
        if (!overlay) return;
        var rect = overlay.getBoundingClientRect();
        GM_setValue(K_OVERLAY_POS, {
            left: rect.left,
            top: rect.top
        });
    }

    function resetShieldPosition() {
        if (!shield) return;
        shield.style.top = '120px';
        shield.style.right = '14px';
        shield.style.left = 'auto';
        shield.style.bottom = 'auto';
    }

    function positionBadge() {
        if (!shield || !badge) return;
        var rect = shield.getBoundingClientRect();
        badge.style.left = (rect.right - 8) + 'px';
        badge.style.top = (rect.top - 6) + 'px';
    }

    // ============================================================
    // 11. PAYMENT / EXEMPTION NORMALIZERS + CACHES
    // ============================================================

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

    function normalizeExemptionPayload(res) {
        var data = (res && (res.data || res.payload)) || res || {};
        return data && typeof data === 'object' ? data : {};
    }

    function normalizeFactionExemptions(res) {
        var data = normalizeExemptionPayload(res);
        return arr(data.items || data.faction_exemptions || []);
    }

    function normalizeUserExemptions(res) {
        var data = normalizeExemptionPayload(res);
        return arr(data.items || data.user_exemptions || []);
    }

    function normalizeExemptionSummary(res) {
        var data = normalizeExemptionPayload(res);
        var summary = data.summary || data.exemption_summary || data.counts || {};
        return {
            faction_count: Number(summary.faction_count || 0) || 0,
            user_count: Number(summary.user_count || 0) || 0,
            total_count: Number(summary.total_count || 0) || 0
        };
    }

    var factionPaymentCache = null;
    var factionPaymentHistoryCache = [];
    var currentBillingCycleCache = null;

    var adminPaymentDueCache = [];
    var adminPaymentPendingCache = [];
    var adminPaymentHistoryCache = [];

    var adminFactionExemptionsCache = [];
    var adminUserExemptionsCache = [];
    var adminExemptionSummaryCache = {
        faction_count: 0,
        user_count: 0,
        total_count: 0
    };

    // ============================================================
    // 12. STATE LOADERS
    // ============================================================

    function loadState() {
        return _loadState.apply(this, arguments);
    }

    function _loadState() {
        _loadState = _asyncToGenerator(function* () {
            if (!isLoggedIn()) {
                state = null;
                renderBody();
                return null;
            }

            var res = yield authedReq('GET', '/api/state');
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    GM_deleteValue(K_SESSION);
                    state = null;
                }
                setStatus(res.error || 'Could not load state.', true);
                renderBody();
                return null;
            }

            state = res.data || {};
            if (state && state.access) saveAccessCache(state.access);
            renderBody();
            return state;
        });
        return _loadState.apply(this, arguments);
    }

    function loadFactionPaymentStatus() {
        return _asyncToGenerator(function* () {
            var res = yield authedReq('GET', '/api/payment/status');
            if (!res.ok) {
                factionPaymentCache = null;
                return null;
            }
            factionPaymentCache = normalizePaymentPayload(res);
            return factionPaymentCache;
        })();
    }

    function loadFactionPaymentHistory() {
        return _asyncToGenerator(function* () {
            var res = yield authedReq('GET', '/api/payment/history');
            if (!res.ok) {
                factionPaymentHistoryCache = [];
                return [];
            }
            factionPaymentHistoryCache = normalizePaymentItems(res);
            return factionPaymentHistoryCache;
        })();
    }

    function loadCurrentBillingCycle() {
        return _asyncToGenerator(function* () {
            var res = yield authedReq('GET', '/api/payment/current-cycle');
            if (!res.ok) {
                currentBillingCycleCache = null;
                return null;
            }
            currentBillingCycleCache = normalizePaymentPayload(res);
            return currentBillingCycleCache;
        })();
    }

    function refreshFactionPaymentData() {
        return _refreshFactionPaymentData.apply(this, arguments);
    }

    function _refreshFactionPaymentData() {
        _refreshFactionPaymentData = _asyncToGenerator(function* () {
            yield loadFactionPaymentStatus();
            yield loadFactionPaymentHistory();
            yield loadCurrentBillingCycle();
            renderBody();
        });
        return _refreshFactionPaymentData.apply(this, arguments);
    }

    function loadFactionMembers(force) {
    return _loadFactionMembers.apply(this, arguments);
}

function _loadFactionMembers() {
    _loadFactionMembers = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) return [];
        if (!canManageFaction()) return [];

        try {
            var res = yield authedReq('GET', '/api/faction/members');
            if (!res.ok) {
                currentFactionMembers = [];
                return [];
            }
            currentFactionMembers = Array.isArray(res.data && res.data.items) ? res.data.items : [];
            return currentFactionMembers;
        } catch (e) {
            currentFactionMembers = [];
            return [];
        }
    });
    return _loadFactionMembers.apply(this, arguments);
}

    function loadAdminPaymentDue() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/license-admin/due');
            if (!res.ok) {
                adminPaymentDueCache = [];
                return [];
            }
            adminPaymentDueCache = normalizeDueItems(res);
            return adminPaymentDueCache;
        })();
    }

    function loadAdminPaymentPending() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/license-admin/pending');
            if (!res.ok) {
                adminPaymentPendingCache = [];
                return [];
            }
            adminPaymentPendingCache = normalizePendingItems(res);
            return adminPaymentPendingCache;
        })();
    }

    function loadAdminPaymentHistory() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/license-admin/history');
            if (!res.ok) {
                adminPaymentHistoryCache = [];
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

    function loadAdminExemptions() {
        return _asyncToGenerator(function* () {
            var res = yield adminReq('GET', '/api/admin/exemptions');
            if (!res.ok) {
                adminFactionExemptionsCache = [];
                adminUserExemptionsCache = [];
                adminExemptionSummaryCache = {
                    faction_count: 0,
                    user_count: 0,
                    total_count: 0
                };
                return {
                    faction_exemptions: [],
                    user_exemptions: [],
                    summary: adminExemptionSummaryCache
                };
            }

            var data = normalizeExemptionPayload(res);
            adminFactionExemptionsCache = arr(data.faction_exemptions || []);
            adminUserExemptionsCache = arr(data.user_exemptions || []);
            adminExemptionSummaryCache = normalizeExemptionSummary(res);

            return {
                faction_exemptions: adminFactionExemptionsCache,
                user_exemptions: adminUserExemptionsCache,
                summary: adminExemptionSummaryCache
            };
        })();
    }

    function refreshLeaderFactionData() {
        return _refreshLeaderFactionData.apply(this, arguments);
    }

    function _refreshLeaderFactionData() {
        _refreshLeaderFactionData = _asyncToGenerator(function* () {
            yield loadState();
            yield refreshFactionPaymentData();
            renderBody();
        });
        return _refreshLeaderFactionData.apply(this, arguments);
    }

    function activateFactionMember(memberId, memberName, position) {
        return _activateFactionMember.apply(this, arguments);
}

function _activateFactionMember() {
    _activateFactionMember = _asyncToGenerator(function* (memberId, memberName, position) {
        if (!memberId) throw new Error('Missing member ID.');

        var payload = {
            member_user_id: String(memberId || ''),
            member_name: String(memberName || ''),
            position: String(position || '')
        };

        var res = yield authedReq('POST', '/api/faction/members', payload);
        if (!res.ok) {
            throw new Error(res.error || 'Could not activate member.');
        }

        if (res.data && res.data.license) {
            accessState = accessState || {};
            accessState.license = res.data.license;
            GM_setValue(K_ACCESS_CACHE, accessState);
        }

        yield loadFactionMembers(true);
        return res.data || {};
    });
    return _activateFactionMember.apply(this, arguments);
}

function loadLiveSummary(force) {
    return _loadLiveSummary.apply(this, arguments);
}

function _loadLiveSummary() {
    _loadLiveSummary = _asyncToGenerator(function* (force) {
        if (!isLoggedIn()) {
            liveSummaryCache = null;
            liveSummaryLoading = false;
            liveSummaryError = '';
            liveSummaryLastAt = 0;
            return null;
        }

        var now = Date.now();
        if (!force && liveSummaryCache && now - liveSummaryLastAt < 15000) {
            return liveSummaryCache;
        }

        liveSummaryLoading = true;
        liveSummaryError = '';

        try {
            var res = yield authedReq('GET', '/api/war/summary-live');
            var data = (res && res.data) ? res.data : null;

            if (!res || !res.ok) {
                liveSummaryCache = null;
                liveSummaryError = (res && res.error) || (data && (data.error || data.message)) || 'Failed to load live summary.';
                liveSummaryLastAt = Date.now();
                return null;
            }

            liveSummaryCache = data || null;
            liveSummaryError = '';
            liveSummaryLastAt = Date.now();
            return liveSummaryCache;
        } catch (err) {
            liveSummaryCache = null;
            liveSummaryError = err && err.message ? err.message : 'Failed to load live summary.';
            liveSummaryLastAt = Date.now();
            return null;
        } finally {
            liveSummaryLoading = false;
        }
    });
    return _loadLiveSummary.apply(this, arguments);
}

function loadWarEnemiesById(force) {
    return _asyncToGenerator(function* () {
        window.__warEnemyDebug = {
            war_id: '',
            ok: false,
            status: 0,
            error: 'loader_started',
            enemy_members_count: 0,
            raw_enemy_members_length: 0,
            enemy_faction_name: '',
            enemy_faction_id: ''
        };

        var warId = getKnownWarId();
        window.__warEnemyDebug.war_id = warId || '';

        if (!warId) {
            warEnemiesCache = [];
            warEnemiesFactionName = '';
            warEnemiesFactionId = '';
            setWarEnemyStatsCache([]);
            window.__warEnemyDebug.error = 'missing_war_id_before_request';
            return [];
        }

        var res;
        try {
            res = yield authedReq('GET', '/api/war/enemies?war_id=' + encodeURIComponent(warId));
        } catch (err) {
            warEnemiesCache = [];
            warEnemiesFactionName = '';
            warEnemiesFactionId = '';
            setWarEnemyStatsCache([]);
            window.__warEnemyDebug.error = err && err.message ? err.message : 'request_threw';
            return [];
        }

        if (!res || !res.ok) {
            warEnemiesCache = [];
            warEnemiesFactionName = '';
            warEnemiesFactionId = '';
            setWarEnemyStatsCache([]);

            window.__warEnemyDebug = {
                war_id: warId,
                ok: false,
                status: Number((res && res.status) || 0) || 0,
                error: String((res && res.error) || 'request_failed'),
                enemy_members_count: 0,
                raw_enemy_members_length: 0,
                enemy_faction_name: '',
                enemy_faction_id: ''
            };
            return [];
        }

        var data = (res && res.data) ? res.data : {};
        warEnemiesCache = Array.isArray(data.enemy_members) ? data.enemy_members : [];
        warEnemiesFactionName = String(data.enemy_faction_name || '');
        warEnemiesFactionId = String(data.enemy_faction_id || '');
        warEnemiesLoadedAt = Date.now();

        if (Array.isArray(data.enemy_stats)) {
            setWarEnemyStatsCache(data.enemy_stats);
        } else {
            setWarEnemyStatsCache([]);
        }

        window.__warEnemyDebug = {
            war_id: warId,
            ok: true,
            status: Number((res && res.status) || 200) || 200,
            error: '',
            enemy_members_count: Number(data.enemy_members_count || 0) || 0,
            raw_enemy_members_length: warEnemiesCache.length,
            enemy_faction_name: warEnemiesFactionName,
            enemy_faction_id: warEnemiesFactionId,
            debug: data.debug || {}
        };

        return warEnemiesCache;
    })();
}

    function loadAdminDashboard() {
        return _loadAdminDashboard.apply(this, arguments);
    }

    function _loadAdminDashboard() {
        _loadAdminDashboard = _asyncToGenerator(function* () {
            yield loadAdminPayments();
            yield loadAdminExemptions();
            renderBody();
        });
        return _loadAdminDashboard.apply(this, arguments);
    }

     // ============================================================
    // 13. DATA HELPERS / NORMALIZERS
    // ============================================================

function getMe() {
    var me = (state && state.me) ? state.me : {};
    var sessionUser = (state && state.user) ? state.user : {};
    var accessUser = (accessState && accessState.user) ? accessState.user : {};

    return {
        user_id: me.user_id || sessionUser.user_id || accessUser.user_id || '',
        name: me.name || me.user_name || sessionUser.name || sessionUser.user_name || accessUser.name || accessUser.user_name || '',
        available: me.available != null ? me.available : (
            sessionUser.available != null ? sessionUser.available : accessUser.available
        ),
        chain_sitter: me.chain_sitter != null ? me.chain_sitter : (
            sessionUser.chain_sitter != null ? sessionUser.chain_sitter : accessUser.chain_sitter
        ),
        is_available: me.is_available,
        is_chain_sitter: me.is_chain_sitter,
        faction_id: me.faction_id || sessionUser.faction_id || accessUser.faction_id || '',
        faction_name: me.faction_name || sessionUser.faction_name || accessUser.faction_name || ''
    };
}

    function getWar() {
        return state && state.war ? state.war : {};
    }

    function getFaction() {
        return state && state.faction ? state.faction : {};
    }

    function getEnemyFaction() {
        return state && state.enemy_faction ? state.enemy_faction : {};
    }

    function getMembers() {
        return arr(state && state.members);
    }

    function getEnemyMembers() {
        return arr(state && state.enemy_members);
    }

    function getNotifications() {
        return arr(state && state.notifications);
    }

    function getTargets() {
        return arr(state && state.targets);
    }

    function getBounties() {
        return arr(state && state.bounties);
    }

    function getMedDeals() {
        return arr(state && state.med_deals);
    }

    function getWarNotes() {
        return arr(state && state.war_notes);
    }

    function getAssignments() {
        return arr(state && state.target_assignments);
    }

    function getWarTerms() {
        return state && state.war_terms ? state.war_terms : {};
    }

    function getFactionMembers() {
        return Array.isArray(currentFactionMembers) ? currentFactionMembers : [];
    }

    function getMyUserId() {
        var me = getMe();
        return String(me.user_id || '');
    }

    function isLeaderRow(member) {
        if (!member || typeof member !== 'object') return false;
        if (member.is_leader) return true;
        var pos = String(member.position || member.role || '').toLowerCase();
        return pos.indexOf('leader') >= 0;
    }

    function getMemberStatusClass(member) {
        var s = String((member && (member.status || member.state || member.last_action_status)) || '').toLowerCase();
        if (s.indexOf('hospital') >= 0) return 'hosp';
        if (s.indexOf('travel') >= 0 || s.indexOf('abroad') >= 0) return 'travel';
        if (s.indexOf('jail') >= 0) return 'jail';
        if (s.indexOf('online') >= 0) return 'online';
        if (s.indexOf('idle') >= 0) return 'idle';
        return 'offline';
    }

    function getMemberStatusText(member) {
        if (!member) return 'Unknown';
        return String(
            member.status_text ||
            member.status ||
            member.state ||
            member.last_action_status ||
            'Unknown'
        );
    }

    function boolPill(v, yes, no) {
        return '<span class="warhub-pill ' + (v ? 'good' : 'bad') + '">' + esc(v ? (yes || 'Yes') : (no || 'No')) + '</span>';
    }

    function statusPill(member) {
        var cls = getMemberStatusClass(member);
        var txt = getMemberStatusText(member);
        return '<span class="warhub-pill ' + esc(cls) + '">' + esc(txt) + '</span>';
    }

    function memberEnabledPill(member) {
        var enabled = !!(member && (member.enabled || member.member_enabled || member.has_access));
        return '<span class="warhub-pill ' + (enabled ? 'enabled' : 'disabled') + '">' + esc(enabled ? 'Enabled' : 'Disabled') + '</span>';
    }

    function exemptionPill(member) {
        var userEx = !!(member && (member.is_user_exempt || member.user_exempt));
        var factionEx = !!(member && (member.is_faction_exempt || member.faction_exempt));
        if (userEx) return '<span class="warhub-pill good">Player Exempt</span>';
        if (factionEx) return '<span class="warhub-pill good">Faction Exempt</span>';
        return '';
    }

    function licenseStatusPill(lic) {
        var status = String((lic && lic.status) || '').toLowerCase();
        if (status === 'active') return '<span class="warhub-pill good">Active</span>';
        if (status === 'trial') return '<span class="warhub-pill neutral">Trial</span>';
        if (status === 'expired') return '<span class="warhub-pill bad">Expired</span>';
        if (status === 'exempt') return '<span class="warhub-pill good">Exempt</span>';
        if (status === 'pending') return '<span class="warhub-pill neutral">Pending</span>';
        return '<span class="warhub-pill neutral">' + esc(status || 'Unknown') + '</span>';
    }

    // ============================================================
    // 14. RENDER HELPERS
    // ============================================================

    function renderHead() {
        var me = getMe();
        var name = me.name || 'Not logged in';
        var sub = isLoggedIn()
            ? ((me.faction_name || 'No faction') + (canUseFeatures() ? ' • Access OK' : ' • Access Limited'))
            : 'Save key and log in';

        return '\
          <div class="warhub-head" id="warhub-drag-head">\
            <div class="warhub-toprow">\
              <div>\
                <div class="warhub-title">War Hub ⚔️</div>\
                <div class="warhub-sub">' + esc(name) + ' • ' + esc(sub) + '</div>\
              </div>\
              <button class="warhub-close" id="warhub-close-btn">Close</button>\
            </div>\
          </div>';
    }

 function renderTabs() {
    var html = TAB_ORDER.map(function (pair) {
        var key = pair[0];
        var label = pair[1];

        if (key === 'admin' && !canSeeAdmin()) return '';
        if (key === 'faction' && !canManageFaction()) return '';
        if (key === 'members' && !canManageFaction()) return '';

        return '<button class="warhub-tab ' + (currentTab === key ? 'active' : '') + '" data-tab="' + esc(key) + '">' + esc(label) + '</button>';
    }).join('');

    return '<div class="warhub-tabs">' + html + '</div>';
}

function renderFactionTab() {
    var faction = getFaction();
    var lic = accessState && accessState.license ? accessState.license : {};
    var cycle = currentBillingCycleCache || {};
    var factionMembers = getFactionMembers();

    var factionName = faction.name || lic.faction_name || '—';
    var leaderName = lic.leader_name || faction.leader_name || faction.leader || '—';
    var memberCount = Number(faction.member_count || getMembers().length || 0);
    var enabledCount = Number(lic.enabled_member_count || 0);
    var renewalCost = Number(lic.renewal_cost || cycle.amount_due || 0);
    var expiresAt = lic.expires_at || '';
    var daysLeft = fmtDaysLeftFromIso(expiresAt);
    var statusPill = licenseStatusPill(lic);

    var membersHtml = factionMembers.length ? factionMembers.map(function (m) {
        var memberId = String(m.member_user_id || m.user_id || '');
        var memberName = m.member_name || m.name || 'Unknown';
        var position = m.position || '';
        var enabled = !!m.enabled;
        var cycleLocked = !!m.cycle_locked;
        var xanaxOwed = Number(m.xanax_owed || 0);
        var activatedAt = m.activated_at || '';

        var statePill = enabled
            ? (cycleLocked
                ? '<span class="warhub-pill good">Active</span>'
                : '<span class="warhub-pill good">Enabled</span>')
            : '<span class="warhub-pill bad">Inactive</span>';

        var actionBtn = enabled
            ? '<button class="warhub-btn small" disabled>' + (cycleLocked ? 'Locked' : 'Enabled') + '</button>'
            : '<button class="warhub-btn primary wh-faction-activate" data-member-id="' + esc(memberId) + '" data-member-name="' + esc(memberName) + '" data-position="' + esc(position) + '">Activate</button>';

        return '\
          <div class="warhub-list-item warhub-faction-member-row">\
            <div class="warhub-faction-member-main">\
              <div class="warhub-name">' + esc(memberName) + ' ' + statePill + '</div>\
              <div class="warhub-meta">' + esc(position || 'Member') + (memberId ? ' • ID: ' + memberId : '') + (xanaxOwed ? ' • Owed: ' + fmtNum(xanaxOwed) : '') + (activatedAt ? ' • Activated: ' + fmtTs(activatedAt) : '') + '</div>\
            </div>\
            <div class="warhub-faction-member-action">' + actionBtn + '</div>\
          </div>';
    }).join('') : '<div class="warhub-empty">No faction billing members loaded yet.</div>';

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>🏰 Faction</h3></div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">Faction Name</div><div class="v">' + esc(factionName) + '</div></div>\
          <div class="warhub-metric"><div class="k">Leader</div><div class="v">' + esc(leaderName) + '</div></div>\
          <div class="warhub-metric"><div class="k">License</div><div class="v">' + statusPill + '</div></div>\
          <div class="warhub-metric"><div class="k">Member Count</div><div class="v">' + fmtNum(memberCount) + '</div></div>\
        </div>\
        <div class="warhub-actions">\
          <button class="warhub-btn" id="wh-refresh-faction">Refresh</button>\
        </div>\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>💰 Billing</h3>\
          <span class="warhub-count">' + statusPill + '</span>\
        </div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">Enabled Members</div><div class="v">' + fmtNum(enabledCount) + '</div></div>\
          <div class="warhub-metric"><div class="k">Renewal Cost</div><div class="v">' + fmtNum(renewalCost) + '</div></div>\
          <div class="warhub-metric"><div class="k">Expires</div><div class="v">' + esc(expiresAt ? fmtTs(expiresAt) : '—') + '</div></div>\
          <div class="warhub-metric"><div class="k">Days Left</div><div class="v">' + esc(daysLeft == null ? '—' : String(daysLeft)) + '</div></div>\
        </div>\
        ' + ((accessState && accessState.is_faction_exempt) ? '<div class="warhub-payment-line">Faction exemption active.</div>' : '') + '\
        ' + ((accessState && accessState.is_user_exempt) ? '<div class="warhub-payment-line">Player exemption active.</div>' : '') + '\
      </div>\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>👥 Faction Members</h3>\
          <span class="warhub-count">' + fmtNum(factionMembers.length) + '</span>\
        </div>\
        <div class="warhub-list">' + membersHtml + '</div>\
      </div>';
}

function renderOverviewTab() {
    var war = getWar();
    var faction = getFaction();
    var enemy = getEnemyFaction();
    var notices = getNotifications();
    var overviewPrefs = getOverviewBoxPrefs();
    var terms = getWarTerms();
    var medDeals = getMedDeals();
    var dibs = getAssignments();

    var ourFactionName = faction.name || war.my_faction_name || '—';
    var enemyFactionName = enemy.name || war.enemy_faction_name || '—';

    var scoreUs = Number(war.score_us || 0);
    var scoreThem = Number(war.score_them || 0);
    var chainUs = Number(war.chain_us || 0);
    var chainThem = Number(war.chain_them || 0);

    var scoreDiff = scoreUs - scoreThem;
    var chainDiff = chainUs - chainThem;

    var scoreStatus = scoreDiff > 0
        ? '<span class="warhub-pill good">+' + fmtNum(scoreDiff) + ' lead</span>'
        : scoreDiff < 0
            ? '<span class="warhub-pill bad">' + fmtNum(Math.abs(scoreDiff)) + ' behind</span>'
            : '<span class="warhub-pill neutral">Even</span>';

    var chainStatus = chainDiff > 0
        ? '<span class="warhub-pill good">+' + fmtNum(chainDiff) + ' chain</span>'
        : chainDiff < 0
            ? '<span class="warhub-pill bad">' + fmtNum(Math.abs(chainDiff)) + ' behind</span>'
            : '<span class="warhub-pill neutral">Even chain</span>';

    var heroBox = overviewPrefs.war ? '\
      <div class="warhub-card warhub-hero-card">\
        <div class="warhub-section-title">\
          <h3>⚔️ War Overview</h3>\
          <span class="warhub-count">' + scoreStatus + '</span>\
        </div>\
        <div class="warhub-hero-vs">' + esc(ourFactionName) + ' <span>vs</span> ' + esc(enemyFactionName) + '</div>\
        <div class="warhub-grid two">\
          <div class="warhub-metric"><div class="k">🏆 Score Us</div><div class="v">' + fmtNum(scoreUs) + '</div></div>\
          <div class="warhub-metric"><div class="k">🏆 Score Them</div><div class="v">' + fmtNum(scoreThem) + '</div></div>\
          <div class="warhub-metric"><div class="k">⛓️ Chain Us</div><div class="v">' + fmtNum(chainUs) + '</div></div>\
          <div class="warhub-metric"><div class="k">⛓️ Chain Them</div><div class="v">' + fmtNum(chainThem) + '</div></div>\
        </div>\
        <div class="warhub-actions" style="margin-top:10px;">\
          ' + scoreStatus + '\
          ' + chainStatus + '\
        </div>\
      </div>' : '';

    var termsBox = '\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>📜 War Terms</h3></div>\
        <div class="warhub-mini">' + esc(terms.text || terms.terms || 'No terms set.') + '</div>\
      </div>';

    var middleBox = '\
      <div class="warhub-grid two">\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>💊 Med Deals</h3>\
            <span class="warhub-count">' + fmtNum(medDeals.length) + '</span>\
          </div>\
          <div class="warhub-list">' + (medDeals.length ? medDeals.slice(0, 5).map(function (d) {
                return '\
                  <div class="warhub-list-item">\
                    <div class="warhub-name">' + esc(d.player_name || d.user_name || 'Unknown') + '</div>\
                    <div class="warhub-meta">' + esc(d.text || d.note || '') + '</div>\
                  </div>';
            }).join('') : '<div class="warhub-empty">No med deals.</div>') + '</div>\
        </div>\
        <div class="warhub-card">\
          <div class="warhub-section-title">\
            <h3>🎯 Dibs</h3>\
            <span class="warhub-count">' + fmtNum(dibs.length) + '</span>\
          </div>\
          <div class="warhub-list">' + (dibs.length ? dibs.slice(0, 5).map(function (a) {
                return '\
                  <div class="warhub-list-item">\
                    <div class="warhub-name">' + esc(a.target_name || a.name || a.enemy_name || 'Unknown') + '</div>\
                    <div class="warhub-meta">' + esc((a.assigned_to_name || a.claimed_by_name || a.user_name || 'Claimed') + ((a.target_id || a.enemy_id || a.user_id) ? ' • ID: ' + String(a.target_id || a.enemy_id || a.user_id) : '')) + '</div>\
                  </div>';
            }).join('') : '<div class="warhub-empty">No dibs claimed.</div>') + '</div>\
        </div>\
      </div>';

    var notificationsBox = overviewPrefs.notifications ? '\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>🔔 Recent Notifications</h3></div>\
        <div class="warhub-list">' + (notices.length ? notices.slice(0, 5).map(function (n) {
            return '<div class="warhub-list-item"><div class="warhub-name">' + esc(n.title || n.kind || 'Notice') + '</div><div class="warhub-meta">' + esc(n.text || n.message || '') + '</div></div>';
        }).join('') : '<div class="warhub-empty">No notifications.</div>') + '</div>\
      </div>' : '';

    return heroBox + termsBox + middleBox + notificationsBox;
}

    function numFmt(value) {
    var n = Number(value || 0);
    if (!isFinite(n)) n = 0;
    try {
        return n.toLocaleString();
    } catch (e) {
        return String(n);
    }
}

function liveSummaryName(item, fallback) {
    if (!item) return fallback || '-';
    return item.name || item.member_name || item.user_name || fallback || '-';
}

function liveSummaryId(item) {
    if (!item) return '';
    return String(item.user_id || item.member_user_id || item.id || '').trim();
}

function liveSummaryStat(item, key) {
    if (!item) return 0;
    var n = Number(item[key] || 0);
    return isFinite(n) ? n : 0;
}

function summaryLeaderRow(label, item, statKey) {
    var name = liveSummaryName(item, '-');
    var userId = liveSummaryId(item);
    var val = numFmt(liveSummaryStat(item, statKey));

    return "\n      <div class=\"warhub-stat\">\n        <span>".concat(esc(label), "</span>\n        <strong>").concat(esc(name)).concat(userId ? " [" + esc(userId) + "]" : "", " • ").concat(esc(val), "</strong>\n      </div>\n    ");
}

function summaryMemberRow(member) {
    var name = liveSummaryName(member, '-');
    var userId = liveSummaryId(member);
    var attacksWon = numFmt(liveSummaryStat(member, 'attacks_won'));
    var respectGain = numFmt(liveSummaryStat(member, 'respect_gain'));
    var respectLost = numFmt(liveSummaryStat(member, 'respect_lost'));
    var attacksLost = numFmt(liveSummaryStat(member, 'attacks_lost'));
    var pointsBleeder = numFmt(
        Number(member && (member.points_bleeder || member.respect_lost || member.attacks_lost) || 0)
    );
    var hasKey = !!(member && member.has_key);
    var keyText = hasKey ? 'Key' : 'No key';

    return "\n      <tr>\n        <td>".concat(esc(name)).concat(userId ? " [" + esc(userId) + "]" : "", "</td>\n        <td>").concat(esc(attacksWon), "</td>\n        <td>").concat(esc(respectGain), "</td>\n        <td>").concat(esc(pointsBleeder), "</td>\n        <td>").concat(esc(respectLost), "</td>\n        <td>").concat(esc(attacksLost), "</td>\n        <td>").concat(esc(keyText), "</td>\n      </tr>\n    ");
}
    
function renderSummaryTab() {
    var root = (typeof liveSummaryCache === 'object' && liveSummaryCache) ? liveSummaryCache : {};
    var s = (root && typeof root.item === 'object' && root.item) ? root.item : root;

    var totals = s.totals || {};
    var leaders = s.leaders || {};
    var members = Array.isArray(s.members) ? s.members : [];

    var updatedAt = s.generated_at || s.updated_at || '';
    var updatedText = updatedAt ? "Updated: ".concat(esc(updatedAt)) : 'Updated: -';

    var loadingHtml = liveSummaryLoading ? "\n      <div class=\"warhub-muted\" style=\"margin-bottom:8px;\">Loading live summary…</div>\n    " : '';
    var errorHtml = liveSummaryError ? "\n      <div class=\"warhub-muted\" style=\"margin-bottom:8px;color:#ff8a8a;\">".concat(esc(liveSummaryError), "</div>\n    ") : '';
    var emptyHtml = !liveSummaryLoading && !liveSummaryError && !members.length ? "\n      <div class=\"warhub-muted\">No live member war data yet.</div>\n    " : '';

    var rowsHtml = members.map(summaryMemberRow).join('');

    return "\n      <div class=\"warhub-card\">\n        <div class=\"warhub-row\" style=\"justify-content:space-between;align-items:center;gap:8px;\">\n          <h3 style=\"margin:0;\">Live War Summary</h3>\n          <div class=\"warhub-muted\" style=\"font-size:12px;\">".concat(updatedText, "</div>\n        </div>\n        ").concat(loadingHtml, "\n        ").concat(errorHtml, "\n\n        <div class=\"warhub-stats\" style=\"margin-top:8px;\">\n          ").concat(summaryLeaderRow('Top Hitter', leaders.top_hitter, 'attacks_won'), "\n          ").concat(summaryLeaderRow('Top Respect Gain', leaders.top_respect_gain, 'respect_gain'), "\n          ").concat(summaryLeaderRow('Top Points Bleeder', leaders.top_points_bleeder, 'points_bleeder'), "\n          <div class=\"warhub-stat\">\n            <span>Total Attacks Won</span>\n            <strong>").concat(esc(numFmt(totals.attacks_won || 0)), "</strong>\n          </div>\n          <div class=\"warhub-stat\">\n            <span>Total Respect Gain</span>\n            <strong>").concat(esc(numFmt(totals.respect_gain || 0)), "</strong>\n          </div>\n          <div class=\"warhub-stat\">\n            <span>Total Respect Lost</span>\n            <strong>").concat(esc(numFmt(totals.respect_lost || 0)), "</strong>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"warhub-card\" style=\"margin-top:12px;\">\n        <div class=\"warhub-row\" style=\"justify-content:space-between;align-items:center;gap:8px;\">\n          <h3 style=\"margin:0;\">Faction Member Live Data</h3>\n          <button class=\"warhub-btn\" id=\"wh-refresh-live-summary\">Refresh</button>\n        </div>\n\n        <div style=\"overflow:auto;margin-top:10px;\">\n          <table class=\"warhub-table\">\n            <thead>\n              <tr>\n                <th>Member</th>\n                <th>Attacks Won</th>\n                <th>Respect Gain</th>\n                <th>Points Bleeder</th>\n                <th>Respect Lost</th>\n                <th>Attacks Lost</th>\n                <th>Key</th>\n              </tr>\n            </thead>\n            <tbody>\n              ").concat(rowsHtml, "\n            </tbody>\n          </table>\n        </div>\n\n        ").concat(emptyHtml, "\n      </div>\n    ");
}

function renderChainTab() {
    var war = getWar();
    var me = getMe();
    var faction = getFaction();
    var chainSitters = arr((state && (state.chain_sitters || state.chainSitters)) || []);

    var ourFactionName = (faction && (faction.name || faction.faction_name)) || war.my_faction_name || 'Your Faction';
    var chainUs = Number(war.chain_us || 0);
    var hasWar = !!(war && (war.active || war.has_war));
    var warStatus = war.status_text || (hasWar ? 'War active' : 'Currently not in war');

    var isAvailable = !!(me && (
        me.available === true ||
        me.available === 1 ||
        me.available === '1' ||
        me.is_available === true
    ));

    var isChainSitter = !!(me && (
        me.chain_sitter === true ||
        me.chain_sitter === 1 ||
        me.chain_sitter === '1' ||
        me.is_chain_sitter === true
    ));

    var availabilityPill = isAvailable
        ? '<span class="warhub-pill good">Available</span>'
        : '<span class="warhub-pill bad">Unavailable</span>';

    var sitterPill = isChainSitter
        ? '<span class="warhub-pill good">Chain Sitter Opted In</span>'
        : '<span class="warhub-pill neutral">Chain Sitter Opted Out</span>';

    var availableBtnClass = isAvailable ? 'warhub-btn primary' : 'warhub-btn';
    var unavailableBtnClass = !isAvailable ? 'warhub-btn warn' : 'warhub-btn';
    var optInBtnClass = isChainSitter ? 'warhub-btn primary' : 'warhub-btn';
    var optOutBtnClass = !isChainSitter ? 'warhub-btn warn' : 'warhub-btn';

    var chainNote = hasWar
        ? 'Live faction chain only.'
        : 'No active war right now. Chain tools still work.';

    var chainSittersHtml = chainSitters.length
        ? chainSitters.map(function (m) {
            var name = m.name || m.user_name || m.member_name || 'Unknown';
            var userId = String(m.user_id || m.member_user_id || '').trim();
            var statusBits = [];
            statusBits.push((m.available === 1 || m.available === true || m.available === '1') ? 'Available' : 'Unavailable');
            statusBits.push((m.chain_sitter === 1 || m.chain_sitter === true || m.chain_sitter === '1') ? 'Opted In' : 'Opted Out');

            return '<div class="warhub-row">' +
                '<div class="warhub-name">' + esc(name) + (userId ? ' [' + esc(userId) + ']' : '') + '</div>' +
                '<div class="warhub-meta">' + esc(statusBits.join(' • ')) + '</div>' +
            '</div>';
        }).join('')
        : '<div class="warhub-empty">No chain sitters opted in.</div>';

    return '\
      <div class="warhub-card warhub-hero-card">\
        <div class="warhub-section-title">\
          <h3>⛓️ Chain Status</h3>\
          <span class="warhub-count">' + fmtNum(chainUs) + '</span>\
        </div>\
        <div class="warhub-hero-vs">' + esc(ourFactionName) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">' + esc(chainNote) + '</div>\
        <div class="warhub-grid two" style="margin-top:12px;">\
          <div class="warhub-metric">\
            <div class="k">Faction Chain</div>\
            <div class="v">' + fmtNum(chainUs) + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">War Status</div>\
            <div class="v" style="font-size:14px;">' + esc(warStatus) + '</div>\
          </div>\
        </div>\
      </div>\
\
      <div class="warhub-card" style="margin-top:12px;">\
        <div class="warhub-section-title"><h3>🧍 Your Status</h3></div>\
        <div class="warhub-grid two" style="margin-top:10px;">\
          <div class="warhub-metric">\
            <div class="k">Availability</div>\
            <div class="v" style="font-size:14px;">' + (isAvailable ? 'Available' : 'Unavailable') + '</div>\
          </div>\
          <div class="warhub-metric">\
            <div class="k">Chain Sitter</div>\
            <div class="v" style="font-size:14px;">' + (isChainSitter ? 'Opted In' : 'Opted Out') + '</div>\
          </div>\
        </div>\
\
        <div class="warhub-actions" style="margin-top:12px;">\
          <button class="' + availableBtnClass + '" id="wh-set-available">Available</button>\
          <button class="' + unavailableBtnClass + '" id="wh-set-unavailable">Unavailable</button>\
        </div>\
\
        <div class="warhub-actions" style="margin-top:10px;">\
          <button class="' + optInBtnClass + '" id="wh-chain-opt-in">Chain Sitter Opt In</button>\
          <button class="' + optOutBtnClass + '" id="wh-chain-opt-out">Chain Sitter Opt Out</button>\
        </div>\
\
        <div class="warhub-actions" style="margin-top:12px;flex-wrap:wrap;">\
          ' + availabilityPill + '\
          ' + sitterPill + '\
        </div>\
\
        <div class="warhub-mini" style="margin-top:10px;">\
          Default status is unavailable until you click Available.\
        </div>\
      </div>\
\
      <div class="warhub-card" style="margin-top:12px;">\
        <div class="warhub-section-title">\
          <h3>👥 Chain Sitters</h3>\
          <span class="warhub-count">' + fmtNum(chainSitters.length) + '</span>\
        </div>\
        <div class="warhub-list" style="margin-top:10px;">' + chainSittersHtml + '</div>\
      </div>';
}

    function renderTermsTab() {
        var terms = getWarTerms();
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>Terms</h3></div>\
            <div class="warhub-mini">' + esc(terms.text || terms.terms || 'No terms set.') + '</div>\
          </div>';
    }

function renderMembersTab() {
    var members = arr((state && state.members) || []);

    var savedSearch = String(GM_getValue('warhub_members_search', '') || '').trim().toLowerCase();
    var savedFilter = String(GM_getValue('warhub_members_filter', 'all') || 'all').trim().toLowerCase();

    function toNum(v) {
        var n = Number(v || 0);
        return isFinite(n) ? n : 0;
    }

    function shortTime(secs) {
        var total = Number(secs || 0);
        if (!isFinite(total) || total <= 0) return 'Ready';

        total = Math.floor(total);

        var days = Math.floor(total / 86400);
        var hours = Math.floor((total % 86400) / 3600);
        var mins = Math.floor((total % 3600) / 60);
        var remSecs = total % 60;

        if (days > 0) return days + 'd ' + (hours > 0 ? hours + 'h' : '');
        if (hours > 0) return hours + 'h ' + (mins > 0 ? mins + 'm' : '');
        if (mins > 0) return mins + 'm ' + (remSecs > 0 ? remSecs + 's' : '');
        return remSecs + 's';
    }

    function memberState(member) {
        var s = String(member.online_state || member.status_class || '').trim().toLowerCase();
        if (s === 'online' || s === 'idle' || s === 'travel' || s === 'jail' || s === 'hospital' || s === 'offline') {
            return s;
        }

        var combined = [
            String(member.status || ''),
            String(member.status_detail || ''),
            String(member.last_action || '')
        ].join(' ').toLowerCase();

        if (combined.indexOf('hospital') >= 0) return 'hospital';
        if (combined.indexOf('jail') >= 0 || combined.indexOf('jailed') >= 0) return 'jail';
        if (
            combined.indexOf('travel') >= 0 ||
            combined.indexOf('travelling') >= 0 ||
            combined.indexOf('traveling') >= 0 ||
            combined.indexOf('abroad') >= 0 ||
            combined.indexOf('flying') >= 0
        ) return 'travel';
        if (combined.indexOf('idle') >= 0) return 'idle';
        if (combined.indexOf('online') >= 0) return 'online';
        return 'offline';
    }

    function stateLabel(stateName, member) {
        if (stateName === 'hospital') {
            var secs = toNum(member.hospital_seconds);
            return secs > 0 ? 'Hospital (' + shortTime(secs) + ')' : 'Hospital';
        }
        if (stateName === 'jail') return 'Jail';
        if (stateName === 'travel') return 'Travel';
        if (stateName === 'idle') return 'Idle';
        if (stateName === 'online') return 'Online';
        return 'Offline';
    }

    function statePillClass(stateName) {
        if (stateName === 'online') return 'warhub-pill good';
        if (stateName === 'idle') return 'warhub-pill neutral';
        if (stateName === 'travel') return 'warhub-pill travel';
        if (stateName === 'jail') return 'warhub-pill jail';
        if (stateName === 'hospital') return 'warhub-pill bad';
        return 'warhub-pill';
    }

    function statText(current, max) {
        var c = toNum(current);
        var m = toNum(max);
        if (m > 0) return fmtNum(c) + '/' + fmtNum(m);
        if (c > 0) return fmtNum(c);
        return '--';
    }

    function medCdText(member) {
        var cd = toNum(member.medical_cooldown);
        if (cd <= 0) return 'Ready';
        return shortTime(cd);
    }

    function hasLiveStats(member) {
        return !!(
            toNum(member.life_current) > 0 ||
            toNum(member.life_max) > 0 ||
            toNum(member.energy_current) > 0 ||
            toNum(member.energy_max) > 0 ||
            toNum(member.medical_cooldown) > 0 ||
            member.live_stats_enabled
        );
    }

    var filtered = members.filter(function (m) {
        var name = String(m.name || m.user_name || m.member_name || '').toLowerCase();
        var uid = String(m.user_id || m.id || '').toLowerCase();
        var stateName = memberState(m);

        var matchesSearch = !savedSearch || name.indexOf(savedSearch) >= 0 || uid.indexOf(savedSearch) >= 0;
        var matchesFilter = savedFilter === 'all' || stateName === savedFilter;

        return matchesSearch && matchesFilter;
    }).sort(function (a, b) {
        var order = {
            online: 1,
            idle: 2,
            travel: 3,
            jail: 4,
            hospital: 5,
            offline: 6
        };

        var aState = memberState(a);
        var bState = memberState(b);

        var aOrder = order[aState] || 99;
        var bOrder = order[bState] || 99;

        if (aOrder !== bOrder) return aOrder - bOrder;

        var aName = String(a.name || a.user_name || a.member_name || '').toLowerCase();
        var bName = String(b.name || b.user_name || b.member_name || '').toLowerCase();

        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    });

    var cardsHtml = filtered.map(function (m) {
        var name = String(m.name || m.user_name || m.member_name || 'Unknown');
        var userId = String(m.user_id || m.id || '').trim();
        var stateName = memberState(m);
        var pillClass = statePillClass(stateName);
        var pillText = stateLabel(stateName, m);

        var lifeCurrent = toNum(m.life_current);
        var lifeMax = toNum(m.life_max);
        var energyCurrent = toNum(m.energy_current);
        var energyMax = toNum(m.energy_max);
        var liveOk = hasLiveStats(m);

        var statusLine = String(m.status_detail || m.status || m.last_action || '').trim();

        if (stateName === 'hospital') {
            var hospSecs = toNum(m.hospital_seconds);
            statusLine = hospSecs > 0 ? ('Hospital for ' + shortTime(hospSecs)) : 'Hospitalized';
        } else if (stateName === 'jail') {
            statusLine = statusLine || 'In jail';
        } else if (stateName === 'travel') {
            statusLine = statusLine || 'Travelling';
        } else if (stateName === 'idle') {
            statusLine = statusLine || 'Idle';
        } else if (stateName === 'online') {
            statusLine = statusLine || 'Online';
        } else {
            statusLine = statusLine || 'Offline';
        }

        var attackUrl = String(m.attack_url || '').trim();
        var profileUrl = String(m.profile_url || '').trim();
        var bountyUrl = String(m.bounty_url || '').trim();

        return '\
          <div class="warhub-card" style="margin-top:12px;">\
            <div class="warhub-row" style="justify-content:space-between;align-items:center;gap:8px;">\
              <div>\
                <div class="warhub-name">' +
                    (profileUrl
                        ? '<a href="' + esc(profileUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>'
                        : esc(name)
                    ) +
                    (userId ? ' [' + esc(userId) + ']' : '') +
                '</div>\
                <div class="warhub-mini" style="margin-top:4px;">' + esc(statusLine) + '</div>\
              </div>\
              <div class="' + esc(pillClass) + '">' + esc(pillText) + '</div>\
            </div>\
\
            <div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">\
              <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">\
                <span title="Energy">⚡</span>\
                <span>' + esc(statText(energyCurrent, energyMax)) + '</span>\
              </div>\
              <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">\
                <span title="Medical Cooldown">💊</span>\
                <span>' + esc(liveOk ? medCdText(m) : '--') + '</span>\
              </div>\
              <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">\
                <span title="Life">➕</span>\
                <span>' + esc(statText(lifeCurrent, lifeMax)) + '</span>\
              </div>\
            </div>\
\
            <div class="warhub-actions" style="margin-top:12px;">\
              ' + (attackUrl ? '<a class="warhub-btn primary" href="' + esc(attackUrl) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '') + '\
              ' + (bountyUrl ? '<a class="warhub-btn" href="' + esc(bountyUrl) + '" target="_blank" rel="noopener noreferrer">Bounty</a>' : '<button class="warhub-btn" data-member-bounty="1" data-user-id="' + esc(userId) + '" data-user-name="' + esc(name) + '">Bounty</button>') + '\
            </div>\
          </div>';
    }).join('');

    return '\
      <div class="warhub-card warhub-hero-card">\
        <div class="warhub-section-title">\
          <h3>👥 Members</h3>\
          <span class="warhub-count">' + fmtNum(filtered.length) + ' / ' + fmtNum(members.length) + '</span>\
        </div>\
\
        <div class="warhub-grid two" style="margin-top:12px;">\
          <div>\
            <label class="warhub-label">Search Members</label>\
            <input class="warhub-input" id="wh-members-search" placeholder="Search name or ID" value="' + esc(savedSearch) + '">\
          </div>\
          <div>\
            <label class="warhub-label">Status Filter</label>\
            <select class="warhub-input" id="wh-members-filter">\
              <option value="all"' + (savedFilter === 'all' ? ' selected' : '') + '>All</option>\
              <option value="online"' + (savedFilter === 'online' ? ' selected' : '') + '>Online</option>\
              <option value="idle"' + (savedFilter === 'idle' ? ' selected' : '') + '>Idle</option>\
              <option value="travel"' + (savedFilter === 'travel' ? ' selected' : '') + '>Travel</option>\
              <option value="jail"' + (savedFilter === 'jail' ? ' selected' : '') + '>Jail</option>\
              <option value="hospital"' + (savedFilter === 'hospital' ? ' selected' : '') + '>Hospital</option>\
              <option value="offline"' + (savedFilter === 'offline' ? ' selected' : '') + '>Offline</option>\
            </select>\
          </div>\
        </div>\
\
        <div class="warhub-mini" style="margin-top:10px;">Classic member card layout with inline ⚡ energy, 💊 med cooldown, and ➕ life.</div>\
      </div>\
      ' + (cardsHtml || '<div class="warhub-card" style="margin-top:12px;">No members found.</div>');
}
function scrapeEnemyMembersFromPage() {
    return [];
}

function getEnemyMembersForTab() {
    return Array.isArray(warEnemiesCache) ? warEnemiesCache : [];
}

function toStatNum(v) {
    var n = Number(v || 0);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function fmtStat(v) {
    var n = toStatNum(v);
    if (!n) return '--';
    return fmtNum(n);
}

function normalizeSpyRow(row) {
    if (!row || typeof row !== 'object') return null;

    var userId = String(row.user_id || row.id || row.target_id || '').trim();
    if (!userId) return null;

    var strength = toStatNum(row.strength);
    var speed = toStatNum(row.speed);
    var dexterity = toStatNum(row.dexterity || row.dex);
    var defense = toStatNum(row.defense || row.def);
    var total = toStatNum(row.total || (strength + speed + dexterity + defense));

    return {
        user_id: userId,
        source: String(row.source || row.spy_source || row.kind || 'none').trim(),
        exact: !!(row.exact || row.spy_exact),
        predicted: !!(row.predicted || row.is_predicted),
        strength: strength,
        speed: speed,
        dexterity: dexterity,
        defense: defense,
        total: total,
        age: String(row.age || row.spy_age || '').trim(),
        updated_at: String(row.updated_at || '').trim()
    };
}

function setWarEnemyStatsCache(rows) {
    warEnemyStatsCache = {};

    if (!Array.isArray(rows)) {
        warEnemyStatsLoadedAt = Date.now();
        return warEnemyStatsCache;
    }

    rows.forEach(function (row) {
        var spy = normalizeSpyRow(row);
        if (!spy) return;
        warEnemyStatsCache[String(spy.user_id)] = spy;
    });

    warEnemyStatsLoadedAt = Date.now();
    return warEnemyStatsCache;
}

function getEnemySpyById(userId) {
    var key = String(userId || '').trim();
    if (!key) return null;
    return warEnemyStatsCache[key] || null;
}

function renderEnemySpyBlock(enemy) {
    var userId = String(enemy && (enemy.user_id || enemy.id) || '').trim();
    var spy = getEnemySpyById(userId);

    if (!spy) {
        return '\
          <div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">\
            <div class="warhub-mini">Stats: No spy data</div>\
          </div>';
    }

    var label = spy.exact ? 'Exact Spy' : (spy.predicted ? 'Predicted' : 'Stats');
    var sub = [];
    if (spy.source) sub.push(spy.source);
    if (spy.age) sub.push('Age ' + spy.age);

    return '\
      <div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);">\
        <div class="warhub-row" style="justify-content:space-between;align-items:center;gap:8px;">\
          <div><strong>' + esc(label) + '</strong></div>\
          <div class="warhub-mini">' + esc(sub.join(' • ') || 'No source') + '</div>\
        </div>\
        <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;">\
          <div style="white-space:nowrap;"><strong>STR:</strong> ' + esc(fmtStat(spy.strength)) + '</div>\
          <div style="white-space:nowrap;"><strong>SPD:</strong> ' + esc(fmtStat(spy.speed)) + '</div>\
          <div style="white-space:nowrap;"><strong>DEX:</strong> ' + esc(fmtStat(spy.dexterity)) + '</div>\
          <div style="white-space:nowrap;"><strong>DEF:</strong> ' + esc(fmtStat(spy.defense)) + '</div>\
          <div style="white-space:nowrap;"><strong>Total:</strong> ' + esc(fmtStat(spy.total)) + '</div>\
        </div>\
      </div>';
}

function renderEnemiesTab() {
    var warObj = (state && state.war && typeof state.war === 'object') ? state.war : {};
    var liveRoot = (typeof liveSummaryCache === 'object' && liveSummaryCache) ? liveSummaryCache : {};
    var live = (liveRoot && typeof liveRoot.item === 'object' && liveRoot.item) ? liveRoot.item : liveRoot;
    var liveWar = (live && typeof live.war === 'object') ? live.war : {};

    var enemies = getEnemyMembersForTab();
    var rawEnemyCacheCount = Array.isArray(warEnemiesCache) ? warEnemiesCache.length : 0;
    var warEnemyDebug = window.__warEnemyDebug || {
        war_id: '',
        ok: false,
        status: 0,
        error: 'debug_not_set',
        enemy_members_count: 0,
        raw_enemy_members_length: 0,
        enemy_faction_name: '',
        enemy_faction_id: ''
    };

    var enemyFactionName = String(
        warEnemiesFactionName ||
        (live && live.enemy_faction_name) ||
        (liveWar && liveWar.enemy_faction_name) ||
        (state && state.enemy_faction_name) ||
        (warObj && warObj.enemy_faction_name) ||
        'Enemy Faction'
    );

    var savedSearch = String(GM_getValue('warhub_enemies_search', '') || '').trim().toLowerCase();
    var savedFilter = String(GM_getValue('warhub_enemies_filter', 'all') || 'all').trim().toLowerCase();

    function toNum(v) {
        var n = Number(v || 0);
        return isFinite(n) ? n : 0;
    }

    function shortTime(secs) {
        var total = Number(secs || 0);
        if (!isFinite(total) || total <= 0) return 'Ready';

        total = Math.floor(total);

        var days = Math.floor(total / 86400);
        var hours = Math.floor((total % 86400) / 3600);
        var mins = Math.floor((total % 3600) / 60);
        var remSecs = total % 60;

        if (days > 0) return days + 'd ' + (hours > 0 ? hours + 'h' : '');
        if (hours > 0) return hours + 'h ' + (mins > 0 ? mins + 'm' : '');
        if (mins > 0) return mins + 'm ' + (remSecs > 0 ? remSecs + 's' : '');
        return remSecs + 's';
    }

    function enemyState(enemy) {
        var s = String(enemy.online_state || enemy.status_class || '').trim().toLowerCase();
        if (s === 'online' || s === 'idle' || s === 'travel' || s === 'jail' || s === 'hospital' || s === 'offline') {
            return s;
        }

        var combined = [
            String(enemy.status || ''),
            String(enemy.status_detail || ''),
            String(enemy.last_action || ''),
            String(enemy.display_status || '')
        ].join(' ').toLowerCase();

        if (combined.indexOf('hospital') >= 0) return 'hospital';
        if (combined.indexOf('jail') >= 0 || combined.indexOf('jailed') >= 0) return 'jail';
        if (
            combined.indexOf('travel') >= 0 ||
            combined.indexOf('travelling') >= 0 ||
            combined.indexOf('traveling') >= 0 ||
            combined.indexOf('abroad') >= 0 ||
            combined.indexOf('flying') >= 0
        ) return 'travel';
        if (combined.indexOf('idle') >= 0) return 'idle';
        if (combined.indexOf('online') >= 0) return 'online';
        return 'offline';
    }

    function stateLabel(stateName, enemy) {
        if (stateName === 'hospital') {
            var secs = toNum(enemy.hospital_seconds);
            return secs > 0 ? 'Hospital (' + shortTime(secs) + ')' : 'Hospital';
        }
        if (stateName === 'jail') return 'Jail';
        if (stateName === 'travel') return 'Travel';
        if (stateName === 'idle') return 'Idle';
        if (stateName === 'online') return 'Online';
        return 'Offline';
    }

    function statePillClass(stateName) {
        if (stateName === 'online') return 'warhub-pill good';
        if (stateName === 'idle') return 'warhub-pill neutral';
        if (stateName === 'travel') return 'warhub-pill travel';
        if (stateName === 'jail') return 'warhub-pill jail';
        if (stateName === 'hospital') return 'warhub-pill bad';
        return 'warhub-pill';
    }

    function matchesEnemy(e) {
        var name = String(e.name || e.user_name || e.member_name || '').toLowerCase();
        var uid = String(e.user_id || e.id || '').toLowerCase();
        var stateName = enemyState(e);

        var matchesSearch = !savedSearch || name.indexOf(savedSearch) >= 0 || uid.indexOf(savedSearch) >= 0;
        var matchesFilter = savedFilter === 'all' || stateName === savedFilter;

        return matchesSearch && matchesFilter;
    }

    function sortEnemies(a, b) {
        var aName = String(a.name || a.user_name || a.member_name || '').toLowerCase();
        var bName = String(b.name || b.user_name || b.member_name || '').toLowerCase();

        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
    }

    var filtered = enemies.filter(matchesEnemy).sort(sortEnemies);

    var groups = {
        online: [],
        idle: [],
        travel: [],
        jail: [],
        hospital: [],
        offline: []
    };

    filtered.forEach(function (e) {
        var s = enemyState(e);
        if (!groups[s]) s = 'offline';
        groups[s].push(e);
    });

    function renderEnemyRow(e) {
        var name = String(e.name || e.user_name || e.member_name || 'Unknown');
        var userId = String(e.user_id || e.id || '').trim();
        var level = String(e.level || '').trim();
        var position = String(e.position || '').trim();
        var stateName = enemyState(e);
        var pillClass = statePillClass(stateName);
        var pillText = stateLabel(stateName, e);

        var statusLine = String(e.display_status || e.status_detail || e.status || e.last_action || '').trim();
        if (stateName === 'hospital') {
            var hospSecs = toNum(e.hospital_seconds);
            statusLine = hospSecs > 0 ? ('Hospital for ' + shortTime(hospSecs)) : 'Hospitalized';
        } else if (stateName === 'jail') {
            statusLine = statusLine || 'In jail';
        } else if (stateName === 'travel') {
            statusLine = statusLine || 'Travelling';
        } else if (stateName === 'idle') {
            statusLine = statusLine || 'Idle';
        } else if (stateName === 'online') {
            statusLine = statusLine || 'Online';
        } else {
            statusLine = statusLine || 'Offline';
        }

        var attackUrl = String(
            e.attack_url ||
            (userId ? ('https://www.torn.com/loader.php?sid=attack&user2ID=' + encodeURIComponent(userId)) : '')
        ).trim();

        var profileUrl = String(
            e.profile_url ||
            (userId ? ('https://www.torn.com/profiles.php?XID=' + encodeURIComponent(userId)) : '')
        ).trim();

        var bountyUrl = String(
            e.bounty_url ||
            (userId ? ('https://www.torn.com/bounties.php?userID=' + encodeURIComponent(userId)) : '')
        ).trim();

        return '\
          <div class="warhub-card" style="margin-top:10px;">\
            <div class="warhub-row" style="justify-content:space-between;align-items:center;gap:8px;">\
              <div>\
                <div class="warhub-name" style="color:#fff !important;">' + esc(name) + (userId ? ' [' + esc(userId) + ']' : '') + '</div>\
                <div class="warhub-mini" style="margin-top:4px;">' + esc(statusLine) + '</div>\
              </div>\
              <div class="' + pillClass + '">' + esc(pillText) + '</div>\
            </div>\
\
            <div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:14px;flex-wrap:wrap;">\
              <div style="white-space:nowrap;"><strong>Lvl:</strong> ' + esc(level || '--') + '</div>\
              <div style="white-space:nowrap;"><strong>Role:</strong> ' + esc(position || '--') + '</div>\
              <div style="white-space:nowrap;"><strong>Status:</strong> ' + esc(pillText) + '</div>\
            </div>\
\
            ' + renderEnemySpyBlock(e) + '\
\
            <div class="warhub-actions" style="margin-top:10px;">\
              ' + (attackUrl ? '<a class="warhub-btn primary" href="' + esc(attackUrl) + '" target="_blank" rel="noopener noreferrer">Attack</a>' : '') + '\
              ' + (profileUrl ? '<a class="warhub-btn" href="' + esc(profileUrl) + '" target="_blank" rel="noopener noreferrer">Profile</a>' : '') + '\
              ' + (bountyUrl ? '<a class="warhub-btn" href="' + esc(bountyUrl) + '" target="_blank" rel="noopener noreferrer">Bounty</a>' : '') + '\
            </div>\
          </div>';
    }

    function renderGroup(title, key, pillClass) {
        var list = groups[key] || [];
        if (!list.length) return '';

        return '\
          <div class="warhub-card" style="margin-top:12px;">\
            <div class="warhub-section-title">\
              <h3>' + esc(title) + '</h3>\
              <span class="' + esc(pillClass) + '">' + fmtNum(list.length) + '</span>\
            </div>\
            ' + list.map(renderEnemyRow).join('') + '\
          </div>';
    }

    var groupedHtml =
        renderGroup('Online', 'online', 'warhub-pill good') +
        renderGroup('Idle', 'idle', 'warhub-pill neutral') +
        renderGroup('Travel', 'travel', 'warhub-pill travel') +
        renderGroup('Jail', 'jail', 'warhub-pill jail') +
        renderGroup('Hospital', 'hospital', 'warhub-pill bad') +
        renderGroup('Offline', 'offline', 'warhub-pill');

    return '\
      <div class="warhub-card warhub-hero-card">\
        <div class="warhub-section-title">\
          <h3>🎯 Enemies</h3>\
          <span class="warhub-count">' + fmtNum(filtered.length) + ' / ' + fmtNum(enemies.length) + '</span>\
        </div>\
        <div class="warhub-hero-vs">' + esc(enemyFactionName) + '</div>\
        <div class="warhub-mini" style="margin-top:6px;">Raw cache: ' + fmtNum(rawEnemyCacheCount) + ' | Filtered: ' + fmtNum(filtered.length) + ' | War ID: ' + esc(String(warEnemyDebug.war_id || getKnownWarId() || '--')) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Route count: ' + esc(String(warEnemyDebug.enemy_members_count != null ? warEnemyDebug.enemy_members_count : '--')) + ' | Route ok: ' + esc(String(warEnemyDebug.ok != null ? warEnemyDebug.ok : '--')) + ' | Route error: ' + esc(String(warEnemyDebug.error || '')) + '</div>\
        <div class="warhub-grid two" style="margin-top:12px;">\
          <div>\
            <label class="warhub-label">Search Enemies</label>\
            <input class="warhub-input" id="wh-enemies-search" placeholder="Search name or ID" value="' + esc(savedSearch) + '">\
          </div>\
          <div>\
            <label class="warhub-label">Status Filter</label>\
            <select class="warhub-input" id="wh-enemies-filter">\
              <option value="all"' + (savedFilter === 'all' ? ' selected' : '') + '>All</option>\
              <option value="online"' + (savedFilter === 'online' ? ' selected' : '') + '>Online</option>\
              <option value="idle"' + (savedFilter === 'idle' ? ' selected' : '') + '>Idle</option>\
              <option value="travel"' + (savedFilter === 'travel' ? ' selected' : '') + '>Travel</option>\
              <option value="jail"' + (savedFilter === 'jail' ? ' selected' : '') + '>Jail</option>\
              <option value="hospital"' + (savedFilter === 'hospital' ? ' selected' : '') + '>Hospital</option>\
              <option value="offline"' + (savedFilter === 'offline' ? ' selected' : '') + '>Offline</option>\
            </select>\
          </div>\
        </div>\
\
        <div class="warhub-mini" style="margin-top:10px;">Enemy faction members from war-id enemy cache only.</div>\
      </div>\
      ' + (groupedHtml || '<div class="warhub-card" style="margin-top:12px;">No enemies found.</div>');
}

    function renderHospitalTab() {
        var members = getMembers().filter(function (m) {
            return getMemberStatusClass(m) === 'hosp';
        });
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>Hospital</h3><span class="warhub-count">' + fmtNum(members.length) + '</span></div>\
            <div class="warhub-list">' + (members.length ? members.map(function (m) {
                return '<div class="warhub-row"><div class="warhub-name">' + esc(m.name || m.user_name || 'Unknown') + '</div><div class="warhub-meta">' + esc(getMemberStatusText(m)) + '</div></div>';
            }).join('') : '<div class="warhub-empty">Nobody hospitalized.</div>') + '</div>\
          </div>';
    }

    function renderMedDealsTab() {
        var deals = getMedDeals();
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>Med Deals</h3><span class="warhub-count">' + fmtNum(deals.length) + '</span></div>\
            <div class="warhub-list">' + (deals.length ? deals.map(function (d) {
                return '<div class="warhub-row"><div class="warhub-name">' + esc(d.player_name || d.user_name || 'Unknown') + '</div><div class="warhub-meta">' + esc(d.text || d.note || '') + '</div></div>';
            }).join('') : '<div class="warhub-empty">No med deals.</div>') + '</div>\
          </div>';
    }

    function renderTargetsTab() {
        var targets = getTargets();
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>Targets</h3><span class="warhub-count">' + fmtNum(targets.length) + '</span></div>\
            <div class="warhub-list">' + (targets.length ? targets.map(function (t) {
                return '<div class="warhub-row"><div class="warhub-name">' + esc(t.name || t.target_name || 'Unknown') + '</div><div class="warhub-meta">' + esc('ID: ' + String(t.target_id || t.user_id || '')) + '</div></div>';
            }).join('') : '<div class="warhub-empty">No targets set.</div>') + '</div>\
          </div>';
    }

    function renderInstructionsTab() {
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>Instructions</h3></div>\
            <div class="warhub-mini">Save your API key, log in, and use the tabs to manage war, faction access, and billing. Owner/Admin can manage exemptions in the Admin tab.</div>\
          </div>';
    }

    function renderSettingsTab() {
        var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
        var adminKey = cleanInputValue(GM_getValue(K_ADMIN_KEY, ''));
        var ownerToken = cleanInputValue(GM_getValue(K_OWNER_TOKEN, ''));
        var refreshMs = Number(GM_getValue(K_REFRESH, 30000)) || 30000;

        return '\
          <div class="warhub-card">\
            <h3>Keys</h3>\
            <label class="warhub-label">Your Torn API Key</label>\
            <input class="warhub-input" id="wh-api-key" value="' + esc(apiKey) + '" placeholder="Paste your API key">\
            <label class="warhub-label" style="margin-top:8px;">Admin Key</label>\
            <input class="warhub-input" id="wh-admin-key" value="' + esc(adminKey) + '" placeholder="Optional admin key">\
            <label class="warhub-label" style="margin-top:8px;">Owner Token</label>\
            <input class="warhub-input" id="wh-owner-token" value="' + esc(ownerToken) + '" placeholder="Owner token">\
            <label class="warhub-label" style="margin-top:8px;">Refresh (ms)</label>\
            <input class="warhub-input" id="wh-refresh-ms" value="' + esc(String(refreshMs)) + '" placeholder="30000">\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn primary" id="wh-save-keys">Save Keys</button>\
              <button class="warhub-btn" id="wh-login-btn">Login</button>\
              <button class="warhub-btn warn" id="wh-logout-btn">Logout</button>\
            </div>\
          </div>';
    }

function renderEnemyDebugCard() {
    var dbg = (state && state.debug && typeof state.debug === 'object') ? state.debug : {};
    var enemyFetch = (dbg.debug_enemy_fetch && typeof dbg.debug_enemy_fetch === 'object') ? dbg.debug_enemy_fetch : {};
    var debugFactions = Array.isArray(dbg.debug_factions) ? dbg.debug_factions : [];

    function mini(v) {
        if (v === null || v === undefined || v === '') return '--';
        if (typeof v === 'object') {
            try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
        }
        return String(v);
    }

    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title">\
          <h3>Enemy Debug</h3>\
          <span class="warhub-count">' + esc(String(state && state.enemy_members_count || 0)) + '</span>\
        </div>\
        <div class="warhub-mini">Enemy Faction ID: ' + esc(mini(state && state.enemy_faction_id)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Enemy Faction Name: ' + esc(mini(state && state.enemy_faction_name)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Source Note: ' + esc(mini(dbg.source_note)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Enemy Fetch Error: ' + esc(mini(enemyFetch.enemy_fetch_error)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Enemy Fetch ID: ' + esc(mini(enemyFetch.enemy_id)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Enemy Fetch Name: ' + esc(mini(enemyFetch.enemy_name)) + '</div>\
        <div class="warhub-mini" style="margin-top:4px;">Enemy Fetch Count: ' + esc(mini(enemyFetch.enemy_fetch_member_count)) + '</div>\
        <details style="margin-top:10px;">\
          <summary class="warhub-mini" style="cursor:pointer;">Show debug factions</summary>\
          <pre style="white-space:pre-wrap;font-size:11px;line-height:1.35;margin-top:8px;">' + esc(mini(debugFactions)) + '</pre>\
        </details>\
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
        var factionExemptions = arr(adminFactionExemptionsCache || []);
        var userExemptions = arr(adminUserExemptionsCache || []);
        var exSummary = adminExemptionSummaryCache || {
            faction_count: 0,
            user_count: 0,
            total_count: 0
        };

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

        var factionExemptionsHtml = factionExemptions.length ? factionExemptions.map(function (x) {
            var factionId = String(x.faction_id || '');
            var factionName = String(x.faction_name || factionId || 'Unknown faction');
            var reason = String(x.reason || '');
            var createdBy = String(x.created_by_name || x.created_by_user_id || '');
            var meta = [
                factionId ? ('Faction ID: ' + factionId) : '',
                reason,
                createdBy ? ('By: ' + createdBy) : ''
            ].filter(Boolean).join(' • ');

            return '\
              <div class="warhub-row">\
                <div style="font-weight:700;">' + esc(factionName) + '</div>\
                <div class="warhub-mini">' + esc(meta) + '</div>\
                <div class="warhub-actions" style="margin-top:8px;">\
                  <button class="warhub-btn warn small" data-admin-remove-faction-exemption="' + esc(factionId) + '">Remove</button>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No faction exemptions.</div>';

        var userExemptionsHtml = userExemptions.length ? userExemptions.map(function (x) {
            var userId = String(x.user_id || '');
            var userName = String(x.user_name || x.name || userId || 'Unknown player');
            var factionName = String(x.faction_name || '');
            var reason = String(x.reason || '');
            var createdBy = String(x.created_by_name || x.created_by_user_id || '');
            var meta = [
                userId ? ('User ID: ' + userId) : '',
                factionName,
                reason,
                createdBy ? ('By: ' + createdBy) : ''
            ].filter(Boolean).join(' • ');

            return '\
              <div class="warhub-row">\
                <div style="font-weight:700;">' + esc(userName) + '</div>\
                <div class="warhub-mini">' + esc(meta) + '</div>\
                <div class="warhub-actions" style="margin-top:8px;">\
                  <button class="warhub-btn warn small" data-admin-remove-user-exemption="' + esc(userId) + '">Remove</button>\
                </div>\
              </div>';
        }).join('') : '<div class="warhub-empty">No player exemptions.</div>';

        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Admin Payments</h3>\
              <span class="warhub-count">' + fmtNum(dueItems.length + pendingItems.length) + '</span>\
            </div>\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn" id="wh-admin-refresh-payments">Refresh Payments</button>\
              <button class="warhub-btn" id="wh-admin-refresh-exemptions">Refresh Exemptions</button>\
              <button class="warhub-btn" id="wh-admin-warning-scan">Run Warning Scan</button>\
              <button class="warhub-btn" id="wh-admin-auto-match">Run Auto Match</button>\
            </div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Add Faction Exemption</h3>\
              <span class="warhub-count">' + fmtNum(exSummary.faction_count || 0) + '</span>\
            </div>\
            <label class="warhub-label">Faction ID</label>\
            <input class="warhub-input" id="wh-admin-faction-exemption-id" placeholder="49384">\
            <label class="warhub-label" style="margin-top:8px;">Faction Name (optional)</label>\
            <input class="warhub-input" id="wh-admin-faction-exemption-name" placeholder="7DS*: Wrath">\
            <label class="warhub-label" style="margin-top:8px;">Reason (optional)</label>\
            <input class="warhub-input" id="wh-admin-faction-exemption-reason" placeholder="Owner exempt">\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn primary" id="wh-admin-add-faction-exemption">Add Faction Exemption</button>\
            </div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Add Player Exemption</h3>\
              <span class="warhub-count">' + fmtNum(exSummary.user_count || 0) + '</span>\
            </div>\
            <label class="warhub-label">Player ID</label>\
            <input class="warhub-input" id="wh-admin-user-exemption-id" placeholder="3679030">\
            <label class="warhub-label" style="margin-top:8px;">Player Name (optional)</label>\
            <input class="warhub-input" id="wh-admin-user-exemption-name" placeholder="Fries91">\
            <label class="warhub-label" style="margin-top:8px;">Faction ID (optional)</label>\
            <input class="warhub-input" id="wh-admin-user-exemption-faction-id" placeholder="49384">\
            <label class="warhub-label" style="margin-top:8px;">Faction Name (optional)</label>\
            <input class="warhub-input" id="wh-admin-user-exemption-faction-name" placeholder="7DS*: Wrath">\
            <label class="warhub-label" style="margin-top:8px;">Reason (optional)</label>\
            <input class="warhub-input" id="wh-admin-user-exemption-reason" placeholder="Owner override">\
            <div class="warhub-actions" style="margin-top:8px;">\
              <button class="warhub-btn primary" id="wh-admin-add-user-exemption">Add Player Exemption</button>\
            </div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Faction Exemptions</h3>\
              <span class="warhub-count">' + fmtNum(factionExemptions.length) + '</span>\
            </div>\
            <div class="warhub-list">' + factionExemptionsHtml + '</div>\
          </div>\
          <div class="warhub-card">\
            <div class="warhub-section-title">\
              <h3>Player Exemptions</h3>\
              <span class="warhub-count">' + fmtNum(userExemptions.length) + '</span>\
            </div>\
            <div class="warhub-list">' + userExemptionsHtml + '</div>\
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
          </div>\
          ' + renderEnemyDebugCard();
    }

    function renderWarTop5Tab() {
        var rows = arr(adminTopFiveCache || []);
        return '\
          <div class="warhub-card">\
            <div class="warhub-section-title"><h3>War Top 5</h3><span class="warhub-count">' + fmtNum(rows.length) + '</span></div>\
            <div class="warhub-list">' + (rows.length ? rows.map(function (r, idx) {
                return '<div class="warhub-row"><div class="warhub-name">#' + esc(String(idx + 1)) + ' ' + esc(r.name || r.user_name || 'Unknown') + '</div><div class="warhub-meta">' + esc('Respect: ' + fmtNum(r.respect || 0)) + '</div></div>';
            }).join('') : '<div class="warhub-empty">No war top 5 data.</div>') + '</div>\
          </div>';
    }

    function renderBodyInner() {
            if (!isLoggedIn()) {
    return '\
      <div class="warhub-card">\
        <div class="warhub-section-title"><h3>Not logged in</h3></div>\
        <div class="warhub-mini">You can still use Settings below to save your key and log in.</div>\
      </div>' + renderSettingsTab();
}
        if (!canUseFeatures() && currentTab !== 'settings' && currentTab !== 'overview' && currentTab !== 'admin') {
            return '\
              <div class="warhub-card">\
                <div class="warhub-section-title"><h3>Access Limited</h3></div>\
                <div class="warhub-mini">' + esc((accessState && accessState.message) || 'This faction or player does not currently have access.') + '</div>\
              </div>' + renderOverviewTab();
        }

        switch (currentTab) {
            case 'overview': return renderOverviewTab();
            case 'faction': return renderFactionTab();
            case 'war': return renderWarTab();
            case 'summary': return renderSummaryTab();
            case 'chain': return renderChainTab();
            case 'terms': return renderTermsTab();
            case 'members': return renderMembersTab();
            case 'enemies': return renderEnemiesTab();
            case 'hospital': return renderHospitalTab();
            case 'meddeals': return renderMedDealsTab();
            case 'targets': return renderTargetsTab();
            case 'instructions': return renderInstructionsTab();
            case 'settings': return renderSettingsTab();
            case 'admin': return renderAdminTab();
            case 'wartop5': return renderWarTop5Tab();
            default: return renderOverviewTab();
        }
    }

    function renderBody() {
        if (!overlay) return;

        overlay.innerHTML = '' +
            renderHead() +
            renderTabs() +
            '<div class="warhub-body" id="warhub-body">' +
                '<div id="warhub-status" style="display:none;margin-bottom:8px;"></div>' +
                renderBodyInner() +
            '</div>';

        renderStatus();

        var savedScroll = Number(GM_getValue(K_OVERLAY_SCROLL, 0)) || 0;
        var bodyEl = overlay.querySelector('#warhub-body');
        if (bodyEl) bodyEl.scrollTop = savedScroll;

        bindOverlayEvents();
    }
    

     // ============================================================
    // 15. ACTIONS
    // ============================================================

function loginWithSavedKey() {
    return _loginWithSavedKey.apply(this, arguments);
}

function _loginWithSavedKey() {
    _loginWithSavedKey = _asyncToGenerator(function* () {
        var apiKey = cleanInputValue(GM_getValue(K_API_KEY, ''));
        if (!apiKey) {
            setStatus('Save your API key first.', true);
            return;
        }

        var res = yield authedReq('POST', '/api/auth', {
            api_key: apiKey
        });

        if (!res.ok) {
            setStatus(res.error || 'Login failed.', true);
            return;
        }

        var data = res.data || {};
        var token = String(data.session_token || data.token || '');
        if (!token) {
            setStatus('Login failed: no session token returned.', true);
            return;
        }

        GM_setValue(K_SESSION, token);

        if (data.access) saveAccessCache(data.access);

        if (canManageFaction()) {
            yield loadFactionMembers(true);
        }

        yield loadState();
        yield refreshFactionPaymentData();

        if (canSeeAdmin()) {
            yield loadAdminDashboard();
        }

        setStatus('Logged in.');
        renderBody();
    });
    return _loginWithSavedKey.apply(this, arguments);
}

function logoutSession() {
    return _logoutSession.apply(this, arguments);
}

function _logoutSession() {
    _logoutSession = _asyncToGenerator(function* () {
        try {
            yield authedReq('POST', '/api/logout', {});
        } catch (_unused4) {}

        GM_deleteValue(K_SESSION);
        state = null;
        saveAccessCache(null);
        currentFactionMembers = [];
        factionPaymentCache = null;
        factionPaymentHistoryCache = [];
        currentBillingCycleCache = null;
        adminPaymentDueCache = [];
        adminPaymentPendingCache = [];
        adminPaymentHistoryCache = [];
        adminFactionExemptionsCache = [];
        adminUserExemptionsCache = [];
        adminExemptionSummaryCache = {
            faction_count: 0,
            user_count: 0,
            total_count: 0
        };

        setStatus('Logged out.');
        renderBody();
    });
    return _logoutSession.apply(this, arguments);
}
// ============================================================
// 16. EVENT BINDING
// ============================================================

function bindOverlayEvents() {
    if (!overlay) return;

    var bodyEl = overlay.querySelector('#warhub-body');
    if (bodyEl && !bodyEl.__warhubBoundScroll) {
        bodyEl.__warhubBoundScroll = true;
        bodyEl.addEventListener('scroll', function () {
            GM_setValue(K_OVERLAY_SCROLL, bodyEl.scrollTop || 0);
        }, { passive: true });
    }

    overlay.querySelectorAll('[data-tab]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var tab = btn.getAttribute('data-tab') || 'overview';
            currentTab = tab;
            GM_setValue(K_TAB, currentTab);

            if (tab === 'faction' && canManageFaction()) {
                yield loadFactionMembers(true);
                yield refreshFactionPaymentData();
            }

            if (tab === 'summary') {
                yield loadLiveSummary(true);
            }

            if (tab === 'enemies') {
                GM_setValue('warhub_enemies_search', '');
                GM_setValue('warhub_enemies_filter', 'all');
                yield loadLiveSummary(true);
                yield loadWarEnemiesById(true);
                renderBody();
                return;
            }

            if (tab === 'admin' && canSeeAdmin()) {
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
            var apiKeyEl = overlay.querySelector('#wh-api-key');
            var adminKeyEl = overlay.querySelector('#wh-admin-key');
            var ownerTokenEl = overlay.querySelector('#wh-owner-token');
            var refreshEl = overlay.querySelector('#wh-refresh-ms');

            GM_setValue(K_API_KEY, cleanInputValue(apiKeyEl && apiKeyEl.value || ''));
            GM_setValue(K_ADMIN_KEY, cleanInputValue(adminKeyEl && adminKeyEl.value || ''));
            GM_setValue(K_OWNER_TOKEN, cleanInputValue(ownerTokenEl && ownerTokenEl.value || ''));

            var refreshMs = Number(cleanInputValue(refreshEl && refreshEl.value || '30000')) || 30000;
            if (refreshMs < 5000) refreshMs = 5000;
            GM_setValue(K_REFRESH, refreshMs);

            restartPolling();
            setStatus('Keys saved.');
        });
    }

    var enemiesSearchInput = overlay.querySelector('#wh-enemies-search');
    if (enemiesSearchInput && !enemiesSearchInput.__warhubBound) {
        enemiesSearchInput.__warhubBound = true;
        enemiesSearchInput.addEventListener('input', function () {
            GM_setValue('warhub_enemies_search', String(enemiesSearchInput.value || ''));
            renderBody();
        });
    }

    var enemiesFilterSelect = overlay.querySelector('#wh-enemies-filter');
    if (enemiesFilterSelect && !enemiesFilterSelect.__warhubBound) {
        enemiesFilterSelect.__warhubBound = true;
        enemiesFilterSelect.addEventListener('change', function () {
            GM_setValue('warhub_enemies_filter', String(enemiesFilterSelect.value || 'all'));
            renderBody();
        });
    }

    var membersSearchInput = overlay.querySelector('#wh-members-search');
    if (membersSearchInput && !membersSearchInput.__warhubBound) {
        membersSearchInput.__warhubBound = true;
        membersSearchInput.addEventListener('input', function () {
            GM_setValue('warhub_members_search', String(membersSearchInput.value || ''));
            renderBody();
        });
    }

    var membersFilterSelect = overlay.querySelector('#wh-members-filter');
    if (membersFilterSelect && !membersFilterSelect.__warhubBound) {
        membersFilterSelect.__warhubBound = true;
        membersFilterSelect.addEventListener('change', function () {
            GM_setValue('warhub_members_filter', String(membersFilterSelect.value || 'all'));
            renderBody();
        });
    }

    overlay.querySelectorAll('[data-member-bounty="1"]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', function () {
            var bountyUrl = String(btn.getAttribute('data-bounty-url') || '').trim();
            var userId = String(btn.getAttribute('data-user-id') || '').trim();

            if (bountyUrl) {
                window.open(bountyUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            if (userId) {
                window.open('https://www.torn.com/bounties.php#/!p=add&userID=' + encodeURIComponent(userId), '_blank', 'noopener,noreferrer');
            }
        });
    });

    var loginBtn = overlay.querySelector('#wh-login-btn');
    if (loginBtn && !loginBtn.__warhubBound) {
        loginBtn.__warhubBound = true;
        loginBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield loginWithSavedKey();
        }));
    }

    var logoutBtn = overlay.querySelector('#wh-logout-btn');
    if (logoutBtn && !logoutBtn.__warhubBound) {
        logoutBtn.__warhubBound = true;
        logoutBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield logoutSession();

            liveSummaryCache = null;
            liveSummaryLoading = false;
            liveSummaryError = '';
            liveSummaryLastAt = 0;

            renderBody();
        }));
    }

    var refreshFactionBtn = overlay.querySelector('#wh-refresh-faction');
    if (refreshFactionBtn && !refreshFactionBtn.__warhubBound) {
        refreshFactionBtn.__warhubBound = true;
        refreshFactionBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield loadState();
            yield refreshFactionPaymentData();
            if (canManageFaction()) {
                yield loadFactionMembers(true);
            }
            renderBody();
            setStatus('Faction refreshed.');
        }));
    }

    overlay.querySelectorAll('.wh-faction-activate').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var memberId = btn.getAttribute('data-member-id') || '';
            var memberName = btn.getAttribute('data-member-name') || '';
            var position = btn.getAttribute('data-position') || '';

            btn.disabled = true;

            try {
                yield activateFactionMember(memberId, memberName, position);
                yield refreshFactionPaymentData();
                renderBody();
                setStatus('Member activated.');
            } catch (e) {
                btn.disabled = false;
                setStatus((e && e.message) ? e.message : 'Could not activate member.', true);
            }
        }));
    });

    var refreshLiveSummaryBtn = overlay.querySelector('#wh-refresh-live-summary');
    if (refreshLiveSummaryBtn && !refreshLiveSummaryBtn.__warhubBound) {
        refreshLiveSummaryBtn.__warhubBound = true;
        refreshLiveSummaryBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield loadLiveSummary(true);
            renderBody();
        }));
    }

    var adminRefreshPaymentsBtn = overlay.querySelector('#wh-admin-refresh-payments');
    if (adminRefreshPaymentsBtn && !adminRefreshPaymentsBtn.__warhubBound) {
        adminRefreshPaymentsBtn.__warhubBound = true;
        adminRefreshPaymentsBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield loadAdminPayments();
            renderBody();
            setStatus('Payments refreshed.');
        }));
    }

    var adminRefreshExemptionsBtn = overlay.querySelector('#wh-admin-refresh-exemptions');
    if (adminRefreshExemptionsBtn && !adminRefreshExemptionsBtn.__warhubBound) {
        adminRefreshExemptionsBtn.__warhubBound = true;
        adminRefreshExemptionsBtn.addEventListener('click', _asyncToGenerator(function* () {
            yield loadAdminExemptions();
            renderBody();
            setStatus('Exemptions refreshed.');
        }));
    }

    var setAvailableBtn = overlay.querySelector('#wh-set-available');
    if (setAvailableBtn && !setAvailableBtn.__warhubBound) {
        setAvailableBtn.__warhubBound = true;
        setAvailableBtn.addEventListener('click', _asyncToGenerator(function* () {
            var res = yield doAction('POST', '/api/availability', { available: true });
            if (res && res.ok) {
                yield loadState(true);
                renderBody();
            }
        }));
    }

    var setUnavailableBtn = overlay.querySelector('#wh-set-unavailable');
    if (setUnavailableBtn && !setUnavailableBtn.__warhubBound) {
        setUnavailableBtn.__warhubBound = true;
        setUnavailableBtn.addEventListener('click', _asyncToGenerator(function* () {
            var res = yield doAction('POST', '/api/availability', { available: false });
            if (res && res.ok) {
                yield loadState(true);
                renderBody();
            }
        }));
    }

    var chainOptInBtn = overlay.querySelector('#wh-chain-opt-in');
    if (chainOptInBtn && !chainOptInBtn.__warhubBound) {
        chainOptInBtn.__warhubBound = true;
        chainOptInBtn.addEventListener('click', _asyncToGenerator(function* () {
            var res = yield doAction('POST', '/api/chain-sitter', { enabled: true });
            if (res && res.ok) {
                yield loadState(true);
                renderBody();
            }
        }));
    }

    var chainOptOutBtn = overlay.querySelector('#wh-chain-opt-out');
    if (chainOptOutBtn && !chainOptInBtn.__warhubBound) {
        chainOptOutBtn.__warhubBound = true;
        chainOptOutBtn.addEventListener('click', _asyncToGenerator(function* () {
            var res = yield doAction('POST', '/api/chain-sitter', { enabled: false });
            if (res && res.ok) {
                yield loadState(true);
                renderBody();
            }
        }));
    }

    var adminAddFactionExemptionBtn = overlay.querySelector('#wh-admin-add-faction-exemption');
    if (adminAddFactionExemptionBtn && !adminAddFactionExemptionBtn.__warhubBound) {
        adminAddFactionExemptionBtn.__warhubBound = true;
        adminAddFactionExemptionBtn.addEventListener('click', _asyncToGenerator(function* () {
            var factionIdEl = overlay.querySelector('#wh-admin-faction-exemption-id');
            var factionNameEl = overlay.querySelector('#wh-admin-faction-exemption-name');
            var reasonEl = overlay.querySelector('#wh-admin-faction-exemption-reason');

            var factionId = cleanInputValue(factionIdEl && factionIdEl.value || '');
            var factionName = cleanInputValue(factionNameEl && factionNameEl.value || '');
            var reason = cleanInputValue(reasonEl && reasonEl.value || '');

            if (!factionId) {
                setStatus('Faction ID is required.', true);
                return;
            }

            var res = yield adminReq('POST', '/api/admin/exemptions/factions', {
                faction_id: factionId,
                faction_name: factionName,
                note: reason
            });

            if (!res.ok) {
                setStatus(res.error || 'Could not add faction exemption.', true);
                return;
            }

            yield loadAdminExemptions();
            renderBody();
            setStatus('Faction exemption added.');
        }));
    }

    var adminAddUserExemptionBtn = overlay.querySelector('#wh-admin-add-user-exemption');
    if (adminAddUserExemptionBtn && !adminAddUserExemptionBtn.__warhubBound) {
        adminAddUserExemptionBtn.__warhubBound = true;
        adminAddUserExemptionBtn.addEventListener('click', _asyncToGenerator(function* () {
            var userIdEl = overlay.querySelector('#wh-admin-user-exemption-id');
            var userNameEl = overlay.querySelector('#wh-admin-user-exemption-name');
            var factionIdEl = overlay.querySelector('#wh-admin-user-exemption-faction-id');
            var factionNameEl = overlay.querySelector('#wh-admin-user-exemption-faction-name');
            var reasonEl = overlay.querySelector('#wh-admin-user-exemption-reason');

            var userId = cleanInputValue(userIdEl && userIdEl.value || '');
            var userName = cleanInputValue(userNameEl && userNameEl.value || '');
            var factionId = cleanInputValue(factionIdEl && factionIdEl.value || '');
            var factionName = cleanInputValue(factionNameEl && factionNameEl.value || '');
            var reason = cleanInputValue(reasonEl && reasonEl.value || '');

            if (!userId) {
                setStatus('Player ID is required.', true);
                return;
            }

            var res = yield adminReq('POST', '/api/admin/exemptions/users', {
                user_id: userId,
                user_name: userName,
                faction_id: factionId,
                faction_name: factionName,
                note: reason
            });

            if (!res.ok) {
                setStatus(res.error || 'Could not add player exemption.', true);
                return;
            }

            yield loadAdminExemptions();
            renderBody();
            setStatus('Player exemption added.');
        }));
    }

    overlay.querySelectorAll('[data-admin-remove-faction-exemption]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var factionId = cleanInputValue(btn.getAttribute('data-admin-remove-faction-exemption') || '');
            if (!factionId) return;
            if (!confirm('Remove faction exemption for ' + factionId + '?')) return;

            var res = yield adminReq('DELETE', '/api/admin/exemptions/factions/' + encodeURIComponent(factionId));
            if (!res.ok) {
                setStatus(res.error || 'Could not remove faction exemption.', true);
                return;
            }

            yield loadAdminExemptions();
            renderBody();
            setStatus('Faction exemption removed.');
        }));
    });

    overlay.querySelectorAll('[data-admin-remove-user-exemption]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var userId = cleanInputValue(btn.getAttribute('data-admin-remove-user-exemption') || '');
            if (!userId) return;
            if (!confirm('Remove player exemption for ' + userId + '?')) return;

            var res = yield adminReq('DELETE', '/api/admin/exemptions/users/' + encodeURIComponent(userId));
            if (!res.ok) {
                setStatus(res.error || 'Could not remove player exemption.', true);
                return;
            }

            yield loadAdminExemptions();
            renderBody();
            setStatus('Player exemption removed.');
        }));
    });

    overlay.querySelectorAll('[data-admin-renew]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var factionId = cleanInputValue(btn.getAttribute('data-admin-renew') || '');
            if (!factionId) return;

            var res = yield adminReq('POST', '/api/license-admin/renew', {
                faction_id: factionId
            });

            if (!res.ok) {
                setStatus(res.error || 'Could not confirm payment.', true);
                return;
            }

            yield loadAdminPayments();
            renderBody();
            setStatus('Payment confirmed.');
        }));
    });

    overlay.querySelectorAll('[data-admin-confirm-intent]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var intentId = cleanInputValue(btn.getAttribute('data-admin-confirm-intent') || '');
            var amount = Number(btn.getAttribute('data-admin-confirm-amount') || 0) || 0;
            if (!intentId) return;

            var res = yield adminReq('POST', '/api/license-admin/confirm-intent', {
                intent_id: intentId,
                amount_paid: amount
            });

            if (!res.ok) {
                setStatus(res.error || 'Could not confirm intent.', true);
                return;
            }

            yield loadAdminPayments();
            renderBody();
            setStatus('Renewal request confirmed.');
        }));
    });

    overlay.querySelectorAll('[data-admin-cancel-intent]').forEach(function (btn) {
        if (btn.__warhubBound) return;
        btn.__warhubBound = true;

        btn.addEventListener('click', _asyncToGenerator(function* () {
            var intentId = cleanInputValue(btn.getAttribute('data-admin-cancel-intent') || '');
            if (!intentId) return;

            var res = yield adminReq('POST', '/api/license-admin/cancel-intent', {
                intent_id: intentId
            });

            if (!res.ok) {
                setStatus(res.error || 'Could not cancel intent.', true);
                return;
            }

            yield loadAdminPayments();
            renderBody();
            setStatus('Renewal request cancelled.');
        }));
    });
}

    // ============================================================
    // 17. OPEN / CLOSE / MOUNT
    // ============================================================

    function openOverlay() {
        if (!overlay) return;
        isOpen = true;
        GM_setValue(K_OPEN, true);
        overlay.classList.add('open');
        renderBody();
    }

    function closeOverlay() {
        if (!overlay) return;
        isOpen = false;
        GM_setValue(K_OPEN, false);
        overlay.classList.remove('open');
    }

    function bindDrag(el, handle, onDone) {
        if (!el || !handle) return;

        var startX = 0;
        var startY = 0;
        var left = 0;
        var top = 0;
        var dragging = false;

        function onMove(ev) {
            if (!dragging) return;
            var clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
            var clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;

            var nx = left + (clientX - startX);
            var ny = top + (clientY - startY);

            el.style.left = nx + 'px';
            el.style.top = ny + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';

            clampToViewport(el);
            dragMoved = true;
        }

        function onUp() {
            if (!dragging) return;
            dragging = false;
            handle.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.removeEventListener('touchmove', onMove, true);
            document.removeEventListener('touchend', onUp, true);

            if (typeof onDone === 'function') onDone();
        }

        function onDown(ev) {
            var target = ev.target;
            if (target && (target.closest('button') || target.closest('input') || target.closest('textarea') || target.closest('select'))) {
                return;
            }

            dragging = true;
            dragMoved = false;
            handle.classList.add('dragging');

            var rect = el.getBoundingClientRect();
            left = rect.left;
            top = rect.top;

            startX = ev.touches ? ev.touches[0].clientX : ev.clientX;
            startY = ev.touches ? ev.touches[0].clientY : ev.clientY;

            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('mouseup', onUp, true);
            document.addEventListener('touchmove', onMove, true);
            document.addEventListener('touchend', onUp, true);
        }

        handle.addEventListener('mousedown', onDown, true);
        handle.addEventListener('touchstart', onDown, { passive: true, capture: true });
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
        if (savedShield && typeof savedShield === 'object' && typeof savedShield.left === 'number' && typeof savedShield.top === 'number') {
            shield.style.left = savedShield.left + 'px';
            shield.style.top = savedShield.top + 'px';
            shield.style.right = 'auto';
            shield.style.bottom = 'auto';
        } else {
            resetShieldPosition();
        }

        var savedOverlay = GM_getValue(K_OVERLAY_POS, null);
        if (savedOverlay && typeof savedOverlay === 'object' && typeof savedOverlay.left === 'number' && typeof savedOverlay.top === 'number') {
            overlay.style.left = savedOverlay.left + 'px';
            overlay.style.top = savedOverlay.top + 'px';
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
        }

        clampToViewport(shield);
        clampToViewport(overlay);
        saveShieldPos();
        saveOverlayPos();

        shield.addEventListener('click', function () {
            if (dragMoved) return;
            if (isOpen) closeOverlay();
            else openOverlay();
        });

        bindDrag(shield, shield, function () {
            saveShieldPos();
            positionBadge();
        });

        renderBody();

        var head = function () { return overlay.querySelector('#warhub-drag-head'); };
        var bindHeadDrag = function () {
            var h = head();
            if (!h || h.__warhubDragBound) return;
            h.__warhubDragBound = true;
            bindDrag(overlay, h, function () {
                saveOverlayPos();
            });
        };

        bindHeadDrag();

        var observer = new MutationObserver(function () {
            bindHeadDrag();
        });
        observer.observe(overlay, { childList: true, subtree: true });

        if (isOpen) overlay.classList.add('open');
        else overlay.classList.remove('open');

        updateBadge();
    }

    // ============================================================
    // 18. POLLING
    // ============================================================

function tick() {
    return _tick.apply(this, arguments);
}

function _tick() {
    _tick = _asyncToGenerator(function* () {
        if (loadInFlight) return;
        if (!isLoggedIn()) return;

        loadInFlight = true;
        try {
            yield loadState();
            if (canUseFeatures()) {
                yield refreshFactionPaymentData();
            }
            if (currentTab === 'summary' && isLoggedIn()) {
                yield loadLiveSummary(false);
            }
            if (currentTab === 'enemies' && isLoggedIn()) {
                yield loadLiveSummary(false);
                yield loadWarEnemiesById(false);
            }
            if (isOwnerSession() && currentTab === 'admin') {
                yield loadAdminDashboard();
            }
            renderBody();
        } catch (_unused5) {
        } finally {
            loadInFlight = false;
        }
    });
    return _tick.apply(this, arguments);
}

    function restartPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        var ms = Number(GM_getValue(K_REFRESH, 30000)) || 30000;
        if (ms < 5000) ms = 5000;

        pollTimer = setInterval(function () {
            tick();
        }, ms);
    }

    // ============================================================
    // 19. STARTUP
    // ============================================================

    function boot() {
        mount();
        restartPolling();

        if (isLoggedIn()) {
            tick();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

})();
